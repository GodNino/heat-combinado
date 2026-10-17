import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// The brand layer (034 trial and demo, 035 organizations) on top of every earlier migration, in order.
test("brands group locations, their owner runs every location, and dishes are imported only by choice", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
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
    for (let id = 1; id <= 4; id++) await db.query("insert into auth.users(id,email) values($1,$2)", [uid(id), `person${id}@example.test`]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }

    const asUser = (id: number, anonymous = false) => db.exec(`reset role; set role authenticated;
      select set_config('request.jwt.claim.sub','${uid(id)}',false);
      select set_config('request.jwt.claims','${JSON.stringify({is_anonymous: anonymous})}',false);`);
    const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
    const visible = async () => (await db.query<{name: string}>("select name from public.restaurants order by name")).rows.map(r => r.name);

    // Owner 1 runs Miami as a full account, with two dishes, a category and a custom quiz.
    await db.exec("reset role");
    const miami = (await one<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Osaka Miami') returning id", [uid(1)])).id;
    await db.query("insert into public.menu_categories(restaurant_id,content_type,name,sort_order) values($1,'food','Tiraditos',2)", [miami]);
    const dish = async (rid: string, name: string, category = "Tiraditos") => (await one<{id: string}>(
      "insert into public.menu_items(restaurant_id,name,description,ingredients,allergens,category,price,photo_path) values($1,$2,'Thin-sliced fish',array['Fish','Lime'],array['Fish'],$3,24,$4) returning id",
      [rid, name, category, `${rid}/photo.jpg`])).id;
    const tiradito = await dish(miami, "Yellowtail Tiradito"), ceviche = await dish(miami, "Ceviche Clasico", "Ceviches");
    await db.query("insert into public.menu_quiz_edits(menu_item_id,questions) values($1,'[{\"q\":\"custom\"}]')", [tiradito]);
    // Person 2 is a Miami server; person 3 has a restaurant of their own elsewhere.
    await db.query("insert into public.restaurant_members(restaurant_id,user_id) values($1,$2)", [miami, uid(2)]);
    const elsewhere = (await one<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Elsewhere') returning id", [uid(3)])).id;

    // Starting a brand: only from a restaurant you own, never anonymously.
    await asUser(2);
    await assert.rejects(db.query("select public.create_organization('Osaka',$1)", [miami]), /Only the owner/);
    await asUser(1, true);
    await assert.rejects(db.query("select public.create_organization('Osaka',$1)", [miami]), /Sign in first/);
    await asUser(1);
    const osaka = (await one<{id: string}>("select public.create_organization('Osaka',$1) as id", [miami])).id;
    await assert.rejects(db.query("select public.add_restaurant_to_organization($1,$2)", [osaka, elsewhere]), /not yours to add/);

    // Opening Chicago: an empty location owned by the brand.
    const chicago = (await one<{id: string}>("select public.create_location($1,'Osaka Chicago') as id", [osaka])).id;
    assert.equal((await one<{n: number}>("select count(*)::int as n from public.menu_items where restaurant_id=$1", [chicago])).n, 0, "a new location starts with an empty menu");
    assert.deepEqual(await visible(), ["Osaka Chicago", "Osaka Miami"]);

    // The Miami server sees Miami and the brand name, but not Chicago.
    await asUser(2);
    assert.deepEqual(await visible(), ["Osaka Miami"]);
    assert.equal((await one<{name: string}>("select name from public.organizations")).name, "Osaka");
    await assert.rejects(db.query("select * from public.import_menu_items($1,$2,$3::uuid[])", [miami, chicago, [tiradito]]), /menu access in both/);
    // Someone outside the brand sees neither.
    await asUser(3);
    assert.deepEqual(await visible(), ["Elsewhere"]);
    assert.equal((await db.query("select * from public.organizations")).rows.length, 0);
    await assert.rejects(db.query("select * from public.import_menu_items($1,$2,$3::uuid[])", [miami, elsewhere, [tiradito]]), /same brand/);

    // The brand owner was never added to Chicago as a member, and still runs it.
    await asUser(1);
    assert.equal((await one<{ok: boolean}>("select public.is_restaurant_owner($1) as ok", [chicago])).ok, true, "the brand owner runs every location");

    // Importing only the chosen dish: the ceviche stays in Miami.
    const copied = (await db.query<{new_id: string; source_id: string; source_photo: string}>(
      "select * from public.import_menu_items($1,$2,$3::uuid[])", [miami, chicago, [tiradito]])).rows;
    assert.equal(copied.length, 1);
    assert.equal(copied[0].source_id, tiradito);
    assert.equal(copied[0].source_photo, `${miami}/photo.jpg`, "the app is told which photo to copy");
    const copy = await one<{name: string; restaurant_id: string; price: string; allergens: string[]; photo_path: string | null; category: string}>(
      "select name,restaurant_id,price::text,allergens,photo_path,category from public.menu_items where id=$1", [copied[0].new_id]);
    assert.deepEqual({...copy}, {name: "Yellowtail Tiradito", restaurant_id: chicago, price: "24.00", allergens: ["Fish"], photo_path: null, category: "Tiraditos"});
    assert.equal((await one<{n: number}>("select count(*)::int as n from public.menu_items where restaurant_id=$1", [chicago])).n, 1, "only what was chosen is copied");
    assert.equal((await one<{n: number}>("select count(*)::int as n from public.menu_categories where restaurant_id=$1 and name='Tiraditos'", [chicago])).n, 1, "the category comes with it");
    // Custom quizzes have no client access at all, so this one is checked from outside.
    await db.exec("reset role");
    assert.equal((await one<{n: number}>("select count(*)::int as n from public.menu_quiz_edits where menu_item_id=$1", [copied[0].new_id])).n, 1, "and so does its custom quiz");

    // Importing again skips what Chicago already has, under any capitalisation, and adds what is new.
    await db.query("update public.menu_items set name='YELLOWTAIL TIRADITO' where id=$1", [copied[0].new_id]);
    await asUser(1);
    const second = (await db.query<{source_id: string}>("select * from public.import_menu_items($1,$2,$3::uuid[])", [miami, chicago, [tiradito, ceviche]])).rows;
    assert.deepEqual(second.map(r => r.source_id), [ceviche]);

    // A copy is Chicago's own: changing it leaves Miami's dish alone.
    await db.exec("reset role");
    await db.query("update public.menu_items set price=30 where id=$1", [copied[0].new_id]);
    assert.equal((await one<{price: string}>("select price::text from public.menu_items where id=$1", [tiradito])).price, "24.00");

    // A trial brand cannot open more locations, and a trial can't be started twice or anonymously.
    await asUser(4);
    const trial = (await one<{id: string}>("select public.start_trial_restaurant('Trial Bistro') as id")).id;
    await assert.rejects(db.query("select public.start_trial_restaurant('Second Trial')"), /already started a free trial/);
    const trialBrand = (await one<{id: string}>("select public.create_organization('Trial Group',$1) as id", [trial])).id;
    await assert.rejects(db.query("select public.create_location($1,'Second site')", [trialBrand]), /full account/);
    await asUser(3, true);
    await assert.rejects(db.query("select public.start_trial_restaurant('Anonymous Diner')"), /Create an account/);
  } finally {
    await db.close();
  }
});
