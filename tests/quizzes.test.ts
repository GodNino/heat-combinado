import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("quizzes grade server-side, isolate learners, and invalidate stale progress", async () => {
 const db=new PGlite();try {
 await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1, '/') $$;
      alter table storage.objects enable row level security;
      grant usage on schema public, auth, storage to authenticated, anon;
      grant select, insert, delete on storage.objects to authenticated;
      insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003');
`);
 for(const file of ['001_heat','002_edit_menu_items','003_content_categories','004_food_cocktails','005_menu_quizzes'])await db.exec(await readFile(new URL('../supabase/migrations/'+file+'.sql',import.meta.url),'utf8'));
 const asUser=async(n:number)=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-${String(n).padStart(12,'0')}',false);`);
 await asUser(1);
 const rid=(await db.query<{id:string}>("insert into public.restaurants(name) values ('Training') returning id")).rows[0].id;
 const mid=(await db.query<{id:string}>("insert into public.menu_items(restaurant_id,name,description,ingredients,allergens,photo_path,category) values ($1,'Citrus Fish',E'Citrus fish.\\n\\nSauces and component recipes:\\nLime sauce: lime, salt',array['Fish','Lime'],array['Fish','Shellfish (CC)'],$2,'Ceviches') returning id",[rid,rid+'/a.jpg'])).rows[0].id;
 const token=(await db.query<{token:string}>("select public.create_employee_invite($1) token",[rid])).rows[0].token;
 await assert.rejects(db.query("select public.build_menu_quiz($1)",[mid]),/permission denied/);
 const get=async()=> (await db.query<{q:{version:string;questions:{prompt:string;options:string[];correct?:number}[]}}>("select public.get_menu_quiz($1) q",[mid])).rows[0].q;
 const q=await get();assert.equal(q.questions.length,6);for(const item of q.questions){assert.equal(item.options.length,4);assert.equal(new Set(item.options).size,4);assert.equal(item.correct,undefined);}
 await db.exec('reset role');
 const choices=(await db.query<{q:{options:string[]}}>("select public.quiz_choice('Test','A',array['A','B','C','D'],'Topic') q")).rows[0].q;assert.ok(choices.options.every(option=>['A','B','C','D'].includes(option)));
 const full=(await db.query<{q:{questions:{correct:number}[]}}>("select public.build_menu_quiz($1) q",[mid])).rows[0].q;
 const answers=full.questions.map(x=>x.correct);
 await asUser(1);
 await assert.rejects(db.query("select public.submit_menu_quiz($1,$2,array[0,1])",[mid,q.version]),/six questions/);
 await assert.rejects(db.query("select public.submit_menu_quiz($1,null,$2)",[mid,answers]),/changed/);
 const submit=async(a:number[])=> (await db.query<{r:{correct:number}}>("select public.submit_menu_quiz($1,$2,$3) r",[mid,q.version,a])).rows[0].r;
 const mixed=[...answers];mixed[0]=(mixed[0]+1)%4;assert.equal((await submit(mixed)).correct,5);
 assert.equal((await db.query<{correct:number}>("select * from public.get_quiz_progress($1)",[rid])).rows[0].correct,5);
 assert.equal((await submit(answers.map(a=>(a+1)%4))).correct,0);
 assert.equal((await db.query<{correct:number}>("select * from public.get_quiz_progress($1)",[rid])).rows[0].correct,0,'latest attempt drives progress');
 await assert.rejects(db.query("insert into public.quiz_attempts(user_id,menu_item_id,menu_updated_at,answers,correct,questions) values(auth.uid(),$1,now(),array[0,0,0,0,0,0],6,'[]')",[mid]),/permission denied/);
 await asUser(2);await assert.rejects(get(),/unavailable/);assert.equal((await db.query("select * from public.quiz_attempts")).rows.length,0);
 await db.query("select public.join_restaurant($1)",[token]);assert.equal((await get()).questions.length,6);assert.equal((await submit(answers)).correct,6);assert.equal((await db.query("select * from public.quiz_attempts")).rows.length,1,'employee sees only their own attempt');
 await asUser(1);await db.query("update public.menu_items set description='Updated recipe' where id=$1",[mid]);assert.equal((await db.query("select * from public.get_quiz_progress($1)",[rid])).rows.length,0);await assert.rejects(submit(answers),/changed/);
 await asUser(2);assert.equal((await db.query("select * from public.get_quiz_progress($1)",[rid])).rows.length,0);
 await db.exec('reset role;set role anon');await assert.rejects(get(),/permission denied/);
 } finally {await db.close();}
});
