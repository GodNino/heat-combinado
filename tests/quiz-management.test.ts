import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("managed quizzes enforce editing, feedback and retake permissions", async () => {
 const db=new PGlite();try {
 await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users (id uuid primary key, email text);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1, '/') $$;
      alter table storage.objects enable row level security;
      grant usage on schema public, auth, storage to authenticated, anon;
      grant select, insert, delete on storage.objects to authenticated;
      insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003');
`);
 for(const file of ['001_heat','002_edit_menu_items','003_content_categories','004_food_cocktails','005_menu_quizzes','006_quiz_management'])await db.exec(await readFile(new URL('../supabase/migrations/'+file+'.sql',import.meta.url),'utf8'));
 const asUser=async(n:number)=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-${String(n).padStart(12,'0')}',false);`);
 await asUser(1);
 const rid=(await db.query<{id:string}>("insert into public.restaurants(name) values ('Training') returning id")).rows[0].id;
 const mid=(await db.query<{id:string}>("insert into public.menu_items(restaurant_id,name,description,ingredients,allergens,photo_path,category) values ($1,'Citrus Fish',E'Citrus fish.\\n\\nSauces and component recipes:\\nLime sauce: lime, salt',array['Fish','Lime'],array['Fish','Shellfish (CC)'],$2,'Ceviches') returning id",[rid,rid+'/a.jpg'])).rows[0].id;
 const token=(await db.query<{token:string}>("select public.create_employee_invite($1) token",[rid])).rows[0].token;
 const rpc=async(name:string,args:unknown[]=[])=> (await db.query<{q:any}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) q`,args)).rows[0]?.q;
 const bank=await rpc('manage_menu_quiz',[mid]);
 const questions=bank.questions.slice(0,2);questions[0].options=['A','B'];questions[0].correct=0;
 await assert.rejects(rpc('manage_menu_quiz',[mid,JSON.stringify(questions),'stale']),/changed/);
 const invalid=structuredClone(questions);invalid[0].options=['A','a'];await assert.rejects(rpc('manage_menu_quiz',[mid,JSON.stringify(invalid),bank.version]),/different/);
 await rpc('manage_menu_quiz',[mid,JSON.stringify(questions),bank.version]);
 assert.equal((await rpc('get_menu_quiz',[mid])).questions.length,2);
 await asUser(3);await assert.rejects(rpc('start_menu_quiz',[mid]),/unavailable/);
 await asUser(2);await db.query('select public.join_restaurant($1)',[token]);
 await assert.rejects(rpc('manage_menu_quiz',[mid]),/manager/);
 await assert.rejects(rpc('approve_quiz_retake',[mid,'00000000-0000-0000-0000-000000000002']),/Manager/);
 await assert.rejects(rpc('quiz_retake_requests',[rid]),/Manager/);
 await assert.rejects(rpc('submit_menu_quiz',[mid,bank.version,[0,0,0,0,0,0]]),/permission denied/);
 for(let attempt=0;attempt<3;attempt++){
  const s=await rpc('start_menu_quiz',[mid]);assert.ok(s.id);assert.equal(s.questions[0].correct,undefined);assert.equal((await rpc('start_menu_quiz',[mid])).id,s.id);
  await assert.rejects(rpc('answer_menu_quiz',[s.id,1,0]),/in order/);
  const first=await rpc('answer_menu_quiz',[s.id,0,1]);assert.equal(first.questions[0].correct,0);assert.equal(first.questions[1].correct,undefined);assert.equal(first.correct,0);
  assert.equal((await rpc('answer_menu_quiz',[s.id,0,1])).id,s.id);
  await assert.rejects(rpc('answer_menu_quiz',[s.id,0,0]),/cannot change/);
  const result=await rpc('answer_menu_quiz',[s.id,1,questions[1].correct]);assert.equal(result.completed,true);assert.equal(result.correct,1);
  await rpc('answer_menu_quiz',[s.id,1,questions[1].correct]);
 }
 assert.equal((await rpc('start_menu_quiz',[mid])).blocked,true);
 assert.equal((await db.query('select * from public.quiz_attempts')).rows.length,3);
 const progress=(await db.query<{correct:number;total:number}>('select * from public.get_quiz_progress($1)',[rid])).rows[0];assert.equal(progress.correct,1);assert.equal(progress.total,2);
 await rpc('request_quiz_retake',[mid]);await rpc('request_quiz_retake',[mid]);
 await asUser(1);assert.equal((await db.query('select * from public.quiz_retake_requests($1)',[rid])).rows.length,1);
 await rpc('approve_quiz_retake',[mid,'00000000-0000-0000-0000-000000000002']);
 await assert.rejects(rpc('approve_quiz_retake',[mid,'00000000-0000-0000-0000-000000000002']),/already/);
 await asUser(2);const fourth=await rpc('start_menu_quiz',[mid]);assert.ok(fourth.id);
 await asUser(1);await assert.rejects(rpc('answer_menu_quiz',[fourth.id,0,0]),/unavailable/);
 const edited=await rpc('manage_menu_quiz',[mid]);await rpc('manage_menu_quiz',[mid,JSON.stringify(questions),edited.version]);
 await asUser(2);await assert.rejects(rpc('answer_menu_quiz',[fourth.id,0,0]),/changed/);assert.equal((await rpc('start_menu_quiz',[mid])).blocked,true);assert.equal((await db.query('select * from public.get_quiz_progress($1)',[rid])).rows.length,0);
 await assert.rejects(db.query('select * from public.quiz_sessions'),/permission denied/);
 await assert.rejects(db.query('select * from public.menu_quiz_edits'),/permission denied/);
 } finally {await db.close();}
});
