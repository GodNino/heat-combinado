import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
test("quiz explanations unlock only after answering and prior scores stay visible", async () => {
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
 for(const file of ['001_heat','002_edit_menu_items','003_content_categories','004_food_cocktails','005_menu_quizzes','006_quiz_management','007_menu_service_details','008_quiz_content_versions','009_quiz_explanations','010_menu_service_notes'])await db.exec(await readFile(new URL('../supabase/migrations/'+file+'.sql',import.meta.url),'utf8'));
 const asUser=async(n:number)=>db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-${String(n).padStart(12,'0')}',false);`);
 await asUser(1);
 const rid=(await db.query<{id:string}>("insert into public.restaurants(name) values ('Training') returning id")).rows[0].id;
 const mid=(await db.query<{id:string}>("insert into public.menu_items(restaurant_id,name,description,ingredients,allergens,photo_path,category) values ($1,'Citrus Fish',E'Citrus fish.\\n\\nSauces and component recipes:\\nLime sauce: lime, salt',array['Fish','Lime'],array['Fish','Shellfish (CC)'],$2,'Ceviches') returning id",[rid,rid+'/a.jpg'])).rows[0].id;
 const token=(await db.query<{token:string}>("select public.create_employee_invite($1) token",[rid])).rows[0].token;
 const rpc=async(name:string,args:unknown[]=[])=> (await db.query<{q:any}>(`select public.${name}(${args.map((_,i)=>'$'+(i+1)).join(',')}) q`,args)).rows[0]?.q;
 const bank=await rpc('manage_menu_quiz',[mid]);const questions=bank.questions.slice(0,2).map((q:any)=>({...q,explanation:'This explanation names the correct ingredient.'}));
 await rpc('manage_menu_quiz',[mid,JSON.stringify(questions),bank.version]);
 await db.query('update public.menu_items set table_setting=$1,observations=$2 where id=$3',['Sharing spoon','Pour sauce tableside',mid]);
 await asUser(2);await rpc('join_restaurant',[token]);
 const visible=(await db.query<{table_setting:string;observations:string}>('select table_setting,observations from public.menu_items where id=$1',[mid])).rows[0];assert.equal(visible.observations,'Pour sauce tableside');
 await db.query('update public.menu_items set observations=$1 where id=$2',['Employee overwrite',mid]);
 assert.equal((await db.query<{observations:string}>('select observations from public.menu_items where id=$1',[mid])).rows[0].observations,'Pour sauce tableside');
 const preview=await rpc('get_menu_quiz',[mid]);assert.equal(preview.questions[0].explanation,undefined);assert.equal(preview.questions[0].correct,undefined);
 const start=await rpc('start_menu_quiz',[mid]);assert.equal(start.questions[0].explanation,undefined);
 const first=await rpc('answer_menu_quiz',[start.id,0,questions[0].correct]);assert.equal(first.questions[0].explanation,questions[0].explanation);assert.equal(first.questions[1].explanation,undefined);
 await rpc('answer_menu_quiz',[start.id,1,questions[1].correct]);
 await asUser(1);const current=await rpc('manage_menu_quiz',[mid]);questions[0].prompt='An updated question';await rpc('manage_menu_quiz',[mid,JSON.stringify(questions),current.version]);
 await asUser(2);const progress=(await db.query<{correct:number;needs_review:boolean}>('select * from public.get_quiz_progress($1)',[rid])).rows[0];assert.equal(progress.correct,2);assert.equal(progress.needs_review,true);
 await assert.rejects(db.query('select * from public.quiz_bank_revisions'),/permission denied/);
 await asUser(3);assert.equal((await db.query('select * from public.get_quiz_progress($1)',[rid])).rows.length,0);
 } finally {await db.close();}
});
test('all rewritten menu quizzes have six concise questions and explanations',async()=>{
 const bank=JSON.parse(await readFile(new URL('../supabase/menu-quizzes.json',import.meta.url),'utf8'));
 assert.equal(bank.length,85);for(const item of bank){assert.equal(item.questions.length,6,item.name);assert.equal(new Set(item.questions.map((q:any)=>q.prompt)).size,6,item.name);for(const q of item.questions){assert.equal(q.options.length,4);assert.equal(new Set(q.options.map((s:string)=>s.toLowerCase())).size,4);assert.ok(q.correct>=0&&q.correct<4);assert.ok(q.explanation.length>15&&q.explanation.length<=2000);assert.ok(q.prompt.length<180);assert.ok(q.options.every((s:string)=>s.length<180));}}
});
