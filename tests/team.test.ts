import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("team RPCs isolate managers and learners, preserve history, and count current results", async () => {
 const db = new PGlite();
 try {
  await db.exec(`
   create role anon; create role authenticated;
   create schema auth; create schema storage;
   create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
   create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
   create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
   create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
   create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
   alter table storage.objects enable row level security;
   grant usage on schema public,auth,storage to authenticated,anon;
   grant select,insert,delete on storage.objects to authenticated;
  `);
  const uid=(id:number)=>`00000000-0000-0000-0000-${String(id).padStart(12,"0")}`;
  for(let id=1;id<=5;id++) await db.query("insert into auth.users values($1,$2,$3::jsonb)",[uid(id),`person${id}@example.test`,JSON.stringify(id===2?{display_name:"Ana"}:{})]);
  for(const file of ['001_heat.sql','002_edit_menu_items.sql','003_content_categories.sql','004_food_cocktails.sql','005_menu_quizzes.sql','006_quiz_management.sql','007_menu_service_details.sql','008_quiz_content_versions.sql','009_quiz_explanations.sql','010_menu_service_notes.sql','011_preshift_board.sql']) {
   await db.exec(await readFile(new URL(`../supabase/migrations/${file}`,import.meta.url),'utf8'));
  }
  const policySnapshot=async()=> (await db.query("select * from pg_policies where schemaname='public' and tablename in ('quiz_attempts','quiz_sessions','restaurant_members') order by tablename,policyname")).rows;
  const policiesBefore=await policySnapshot();
  await db.exec(await readFile(new URL('../supabase/migrations/012_team_workspace.sql',import.meta.url),'utf8'));
  assert.deepEqual(await policySnapshot(),policiesBefore,"existing RLS policies stay unchanged");
  const asUser=async(id:number)=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','${uid(id)}',false);`);
  const makeRestaurant=async(name:string)=>(await db.query<{id:string}>("insert into public.restaurants(name) values($1) returning id",[name])).rows[0].id;
  const makeItem=async(rid:string,name:string)=>(await db.query<{id:string}>("insert into public.menu_items(restaurant_id,name,description,ingredients,photo_path) values($1,$2,'Description',array['Lime'],$3) returning id",[rid,name,`${rid}/photo.jpg`])).rows[0].id;
  await asUser(1);
  const rid=await makeRestaurant('HEAT Team'),mid1=await makeItem(rid,'One'),mid2=await makeItem(rid,'Two'),mid3=await makeItem(rid,'Stale');
  const token=(await db.query<{token:string}>("select public.create_employee_invite($1) as token",[rid])).rows[0].token;
  const secondOwned=await makeRestaurant('Second kitchen'),secondItem=await makeItem(secondOwned,'Other owned item');
  await asUser(3);
  const foreignRid=await makeRestaurant('Foreign restaurant'),foreignItem=await makeItem(foreignRid,'Foreign item');
  for(const id of [2,4]){await asUser(id);await db.query("select public.join_restaurant($1)",[token]);}
  await db.exec('reset role');
  const attempt=async(learner:number,mid:string,correct:number,total:number,stamp:string,stale=false)=>db.query("insert into public.quiz_attempts(user_id,menu_item_id,menu_updated_at,answers,correct,total,questions,created_at) select $1,id,updated_at - $6::interval,array_fill(0,array[$4::integer]),$3,$4,'[]'::jsonb,$5::timestamptz from public.menu_items where id=$2",[uid(learner),mid,correct,total,stamp,stale?'1 second':'0 seconds']);
  await attempt(2,mid1,1,1,'2026-09-15T10:00:00Z');
  await attempt(2,mid2,6,6,'2026-09-14T10:00:00Z');
  await attempt(2,mid2,3,6,'2026-09-16T10:00:00Z');
  await attempt(2,mid3,6,6,'2026-09-16T11:00:00Z',true);
  await attempt(4,mid1,6,6,'2026-09-16T12:00:00Z');
  await attempt(2,foreignItem,6,6,'2026-09-16T12:00:00Z');
  await db.query("insert into public.quiz_sessions(user_id,menu_item_id,version,menu_updated_at,questions,answers) select $1,id,'sample',updated_at,'[]','{}' from public.menu_items where id=$2",[uid(2),mid1]);
  await asUser(1);
  type Row={user_id:string;name:string;role:string;is_owner:boolean;items_taken:number;correct_sum:number;total_sum:number;needs_review:number;last_attempt_at:string|null};
  const roster=async(r=rid)=>(await db.query<Row>("select * from public.team_roster($1)",[r])).rows;
  let people=await roster();
  assert.equal(people.length,3,"includes owner and both members, not other restaurants");
  assert.equal(people.find(p=>p.user_id===uid(1))!.is_owner,true);
  assert.equal(people.find(p=>p.user_id===uid(1))!.role,'Manager');
  assert.equal(people.find(p=>p.user_id===uid(1))!.last_attempt_at,null);
  const ana=people.find(p=>p.user_id===uid(2))!;
  assert.equal(ana.name,'Ana');assert.equal(ana.role,'Server');assert.equal(ana.items_taken,2);
  assert.equal(ana.correct_sum,4);assert.equal(ana.total_sum,7);assert.equal(ana.needs_review,1);
  assert.equal(Math.round(ana.correct_sum/ana.total_sum*100),57,"accuracy is weighted by questions, not an average of percentages");
  assert.equal(new Date(ana.last_attempt_at!).toISOString(),'2026-09-16T10:00:00.000Z');
  const perfect=people.find(p=>p.user_id===uid(4))!;
  assert.equal(perfect.items_taken,1);assert.equal(perfect.correct_sum/perfect.total_sum,1,"one perfect quiz is 100% accuracy with one item covered");
  const detail=(await db.query<{menu_item_id:string;correct:number}>("select * from public.team_member_detail($1,$2)",[rid,uid(2)])).rows;
  assert.equal(detail.length,2);assert.equal(detail.find(r=>r.menu_item_id===mid2)!.correct,3);
  await db.query("select public.set_member_profile($1,$2,'Ana Maria','Bartender')",[rid,uid(2)]);
  people=await roster();assert.equal(people.find(p=>p.user_id===uid(2))!.name,'Ana Maria');assert.equal(people.find(p=>p.user_id===uid(2))!.role,'Bartender');
  await assert.rejects(db.query("select public.set_member_profile($1,$2,'Ana','Invalid')",[rid,uid(2)]),/check constraint/);
  await assert.rejects(db.query("select public.set_member_profile($1,$2,repeat('x',81),'Server')",[rid,uid(2)]),/check constraint/);
  await assert.rejects(db.query("select public.set_member_profile($1,$2,'Stranger','Server')",[rid,uid(5)]),/Team member unavailable/);
  await assert.rejects(db.query("select * from public.team_member_detail($1,$2)",[rid,uid(3)]),/Team member unavailable/);
  for(const mid of [foreignItem,secondItem,null]) await assert.rejects(db.query("select public.assign_menu_items($1,$2,$3::uuid[])",[rid,uid(2),[mid1,mid]]),/Every menu item must belong/);
  assert.equal((await db.query("select * from public.team_member_assignments($1,$2)",[rid,uid(2)])).rows.length,0,"invalid batches insert nothing");
  await assert.rejects(db.query("select public.assign_menu_items($1,$2,$3::uuid[])",[rid,uid(5),[mid1]]),/Team member unavailable/);
  await db.query("select public.assign_menu_items($1,$2,$3::uuid[],'Study sauces','2026-09-18')",[rid,uid(2),[mid1,mid2,mid1]]);
  await db.query("select public.assign_menu_items($1,$2,$3::uuid[],'Study ingredients',null)",[rid,uid(4),[mid1]]);
  let assigned=(await db.query<{id:string;note:string;due_on:string|null}>("select * from public.team_member_assignments($1,$2)",[rid,uid(2)])).rows;
  assert.equal(assigned.length,2,"duplicates are deduplicated");
  const assignmentId=assigned[0].id;
  await db.query("select public.assign_menu_items($1,$2,$3::uuid[],'Updated note',null)",[rid,uid(2),[mid1,mid2]]);
  assigned=(await db.query<{id:string;note:string;due_on:string|null}>("select * from public.team_member_assignments($1,$2)",[rid,uid(2)])).rows;
  assert.equal(assigned.length,2);assert.ok(assigned.some(a=>a.id===assignmentId));assert.ok(assigned.every(a=>a.note==='Updated note'&&a.due_on===null));
  await assert.rejects(db.query("select public.assign_menu_items($1,$2,$3::uuid[],repeat('x',201))",[rid,uid(2),[mid1]]),/check constraint/);
  const managerCalls=[
   ["select * from public.team_roster($1)",[rid]],
   ["select * from public.team_member_detail($1,$2)",[rid,uid(2)]],
   ["select * from public.team_member_assignments($1,$2)",[rid,uid(2)]],
   ["select public.set_member_profile($1,$2,'Forged','Manager')",[rid,uid(2)]],
   ["select public.assign_menu_items($1,$2,$3::uuid[])",[rid,uid(2),[mid1]]],
   ["select public.remove_assignment($1)",[assignmentId]],
   ["select public.remove_team_member($1,$2)",[rid,uid(2)]],
  ] as const;
  for(const actor of [2,3]) {
   await asUser(actor);
   for(const [sql,args] of managerCalls) await assert.rejects(db.query(sql,[...args]),/Manager access required/);
  }
  await asUser(2);
  assert.equal((await db.query("select * from public.quiz_attempts where user_id=$1",[uid(4)])).rows.length,0,"employees cannot read each other's attempts");
  assert.equal((await db.query("select * from public.quiz_attempts")).rows.length,4,"only own restaurant's own attempts visible");
  assert.equal((await db.query("select * from public.my_assignments($1)",[rid])).rows.length,2);
  assert.equal((await db.query("select * from public.my_assignments($1)",[foreignRid])).rows.length,0);
  await asUser(4);
  assert.equal((await db.query<{note:string}>("select * from public.my_assignments($1)",[rid])).rows[0].note,'Study ingredients');
  for(const actor of [1,2]) {
   await asUser(actor);
   for(const table of ['member_profiles','assignments']) await assert.rejects(db.query(`select * from public.${table}`),/permission denied/);
  }
  await asUser(1);
  await db.query("select public.remove_assignment($1)",[assignmentId]);
  assert.equal((await db.query("select * from public.team_member_assignments($1,$2)",[rid,uid(2)])).rows.length,1);
  await assert.rejects(db.query("select public.remove_team_member($1,$2)",[rid,uid(1)]),/owner cannot be removed/);
  await db.query("select public.remove_team_member($1,$2)",[rid,uid(2)]);
  assert.equal((await roster()).length,2);
  await db.exec('reset role');
  assert.equal((await db.query("select * from public.quiz_attempts where user_id=$1",[uid(2)])).rows.length,5,"removing membership keeps every attempt");
  assert.equal((await db.query("select * from public.quiz_sessions where user_id=$1",[uid(2)])).rows.length,1);
  assert.equal((await db.query<{display_name:string}>("select display_name from public.member_profiles where user_id=$1",[uid(2)])).rows[0].display_name,'Ana Maria');
  await asUser(2);
  assert.equal((await db.query("select * from public.my_assignments($1)",[rid])).rows.length,0,"removed members lose assignment access");
  await db.query("select public.join_restaurant($1)",[token]);
  assert.equal((await db.query("select * from public.my_assignments($1)",[rid])).rows.length,1);
  await asUser(1);
  assert.equal((await roster()).find(p=>p.user_id===uid(2))!.items_taken,2,"re-invited employee retains current results");
  assert.equal((await roster()).find(p=>p.user_id===uid(2))!.name,'Ana Maria');
  await db.exec('reset role;set role anon;');
  for(const [sql,args] of managerCalls) await assert.rejects(db.query(sql,[...args]),/permission denied/);
  await assert.rejects(db.query("select * from public.my_assignments($1)",[rid]),/permission denied/);
 } finally {await db.close();}
});
