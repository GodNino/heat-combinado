import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("Seika accepts food items and only owners can delete menu cards", async () => {
  const db = new PGlite();
  try {
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

    for (const file of ['001_heat.sql','002_edit_menu_items.sql','003_content_categories.sql','004_food_cocktails.sql','005_menu_quizzes.sql','015_seika_delete_menu.sql']) await db.exec(await readFile(new URL('../supabase/migrations/'+file,import.meta.url),'utf8'));
    const asUser = async (id:number) => db.exec(`reset role;set role authenticated;select set_config('request.jwt.claim.sub','00000000-0000-0000-0000-${String(id).padStart(12,'0')}',false);`);
    await asUser(1);
    const rid=(await db.query<{id:string}>("insert into restaurants(name) values('Kitchen') returning id")).rows[0].id;
    const token=(await db.query<{token:string}>("select create_employee_invite($1) as token",[rid])).rows[0].token;
    const food=(await db.query<{id:string}>("insert into menu_items(restaurant_id,name,description,ingredients,photo_path,category) values($1,'Dessert','Sweet',array['Sugar'],$2,'Seika') returning id",[rid,rid+'/dessert.jpg'])).rows[0].id;
    const cocktail=(await db.query<{id:string}>("insert into menu_items(restaurant_id,name,description,ingredients,photo_path,category,content_type) values($1,'Drink','Citrus',array['Lime'],$2,'Tokubetsu','cocktails') returning id",[rid,rid+'/drink.jpg'])).rows[0].id;
    await db.exec('reset role');
    await db.query("insert into quiz_attempts(user_id,menu_item_id,menu_updated_at,answers,correct,questions) values('00000000-0000-0000-0000-000000000002',$1,now(),array[0,0,0,0,0,0],6,'[]')",[food]);
    await asUser(2);await db.query('select join_restaurant($1)',[token]);
    for(const id of [2,3]) {
      await asUser(id);
      for(const mid of [food,cocktail]) assert.equal((await db.query('delete from menu_items where id=$1 returning id',[mid])).rows.length,0);
    }
    await asUser(1);
    assert.equal((await db.query('delete from menu_items where id=$1 returning id',[food])).rows.length,1);
    assert.equal((await db.query('select * from menu_items where id=$1',[cocktail])).rows.length,1);
    assert.equal((await db.query('delete from menu_items where id=$1 returning id',[cocktail])).rows.length,1);
    await db.exec('reset role');
    assert.equal((await db.query('select * from quiz_attempts')).rows.length,0,'linked quiz history is deleted as disclosed');
    await db.exec('set role anon');
    await assert.rejects(db.query('delete from menu_items'),/permission denied/);
  } finally {await db.close();}
});
