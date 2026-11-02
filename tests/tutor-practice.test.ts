import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// What the tutor remembers (057): each person records and reads their own practice, only for cards of
// a restaurant they belong to; managers with Team access read their restaurant's; nobody edits it.
test("people record and read their own tutor practice; managers read their team's", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}',is_anonymous boolean not null default false,created_at timestamptz not null default now());
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
      create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
      create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
      create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
      create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;
      alter table storage.objects enable row level security;
      grant usage on schema public,auth,storage to authenticated,anon;
      grant select,insert,delete on storage.objects to authenticated;
    `);
    const uid = (id: number) => `00000000-0000-0000-0000-${String(id).padStart(12, "0")}`;
    // 1 owner; 2 manager (team); 3 server; 4 another server; 5 outsider (owns another restaurant)
    for (let id = 1; id <= 5; id++) await db.query("insert into auth.users(id,email) values($1,$2)", [uid(id), `p${id}@osaka.test`]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    const asUser = (id: number) => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${uid(id)}',false);`);
    await db.exec("reset role");
    const rid = (await db.query<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Osaka Miami') returning id", [uid(1)])).rows[0].id;
    const other = (await db.query<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Elsewhere') returning id", [uid(5)])).rows[0].id;
    await db.query("insert into public.restaurant_members(restaurant_id,user_id,access) values($1,$2,'{team}'),($1,$3,'{}'),($1,$4,'{}')", [rid, uid(2), uid(3), uid(4)]);
    const dish = async (restaurant: string, name: string) => (await db.query<{id: string}>(
      "insert into public.menu_items(restaurant_id,name,description,ingredients,allergens) values($1,$2,'Description',array['Fish'],array['Fish']) returning id", [restaurant, name])).rows[0].id;
    const ceviche = await dish(rid, "Ceviche Nikkei");
    const foreign = await dish(other, "Their dish");

    const record = (restaurant: string, item: string, extra = "") =>
      db.query(`insert into public.tutor_practice(restaurant_id,menu_item_id,result,missed${extra ? ",user_id" : ""}) values($1,$2,'wrong','sesame'${extra ? ",$3" : ""})`, extra ? [restaurant, item, extra] : [restaurant, item]);
    const count = async () => (await db.query<{n: number}>("select count(*)::int as n from public.tutor_practice")).rows[0].n;

    await asUser(3);
    await record(rid, ceviche);
    assert.equal(await count(), 1, "the server saves and reads their own practice");
    await assert.rejects(record(rid, ceviche, uid(4)), "nobody records practice in someone else's name");
    await assert.rejects(record(rid, foreign), "only a card of the same restaurant");
    await assert.rejects(record(other, foreign), "only in a restaurant they belong to");
    await assert.rejects(db.query("insert into public.tutor_practice(restaurant_id,menu_item_id,result) values($1,$2,'great')", [rid, ceviche]), "only correct, partly or wrong");
    await assert.rejects(db.exec("update public.tutor_practice set result = 'correct'"), "nobody edits a result");
    await assert.rejects(db.exec("delete from public.tutor_practice"), "nor deletes one");

    await asUser(4);
    assert.equal(await count(), 0, "another server doesn't see it");
    await asUser(5);
    assert.equal(await count(), 0, "an outsider doesn't see it");
    await asUser(2);
    assert.equal(await count(), 1, "a manager with Team access sees the team's practice");
    await asUser(3);
    assert.equal((await db.query<{result: string}>("select result from public.tutor_practice")).rows[0].result, "wrong", "the result is as it was saved");

    await db.exec("reset role");
    await db.query("delete from public.menu_items where id = $1", [ceviche]);
    assert.equal(await count(), 0, "deleting the card removes its practice");
  } finally {
    await db.close();
  }
});
