import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// The demo kitchen as a private copy per visitor (037): each anonymous visitor owns their own
// copy, nobody sees anyone else's, the template is never touched, and old copies are cleaned up.
test("each demo visitor gets a private, editable copy that expires", async () => {
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
    // 1 owns the template; 2 and 3 are anonymous visitors; 4 is a real account.
    for (let id = 1; id <= 4; id++) await db.query("insert into auth.users(id,email,is_anonymous) values($1,$2,$3)", [uid(id), id === 2 || id === 3 ? null : `person${id}@example.test`, id === 2 || id === 3]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    await db.exec("alter table public.menu_items add column if not exists details jsonb");
    const asUser = (id: number, anonymous = false) => db.exec(`reset role; set role authenticated;
      select set_config('request.jwt.claim.sub','${uid(id)}',false);
      select set_config('request.jwt.claims','${JSON.stringify({is_anonymous: anonymous})}',false);`);
    const rows = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;
    const count = async (sql: string, params: unknown[] = []) => (await rows<{n: number}>(sql, params))[0].n;

    // The template: a section, a category, two dishes (one with a custom quiz), a word and a standard.
    await db.exec("reset role");
    const template = (await rows<{id: string}>("insert into public.restaurants(owner_id,name,is_demo) values($1,'HEAT Demo Kitchen',true) returning id", [uid(1)]))[0].id;
    await db.query("insert into public.menu_sections(restaurant_id,content_type,name) values($1,'food','Food')", [template]);
    await db.query("insert into public.menu_categories(restaurant_id,content_type,name,sort_order) values($1,'food','Raw bar',1)", [template]);
    const dish = async (name: string) => (await rows<{id: string}>("insert into public.menu_items(restaurant_id,name,description,ingredients,allergens,category) values($1,$2,'Description',array['Lime'],array['Fish'],'Raw bar') returning id", [template, name]))[0].id;
    const tiradito = await dish("Yellowtail Tiradito");
    await dish("Salmon Crudo");
    await db.query("insert into public.menu_quiz_edits(menu_item_id,questions) values($1,'[{\"q\":\"custom\"}]')", [tiradito]);
    await db.query("insert into public.glossary_terms(restaurant_id,term,means,created_by) values($1,'Ponzu','Citrus soy sauce',$2)", [template, uid(1)]);
    await db.query("insert into public.sops(restaurant_id,name,steps,created_by) values($1,'Greeting',array['Smile'],$2)", [template, uid(1)]);

    // A real account is never given a throwaway restaurant.
    await asUser(4);
    await assert.rejects(db.query("select public.start_demo()"), /visitors without an account/);

    // Visitor 2 gets their own copy, as its owner, and can change it.
    await asUser(2, true);
    const copy2 = (await rows<{id: string}>("select public.start_demo() as id"))[0].id;
    assert.notEqual(copy2, template);
    assert.equal((await rows<{id: string}>("select public.start_demo() as id"))[0].id, copy2, "coming back reopens the same copy");
    assert.deepEqual((await rows<{name: string}>("select name from public.restaurants")).map(r => r.name), ["HEAT Demo Kitchen"], "the visitor sees only their copy, not the template");
    assert.equal(await count("select count(*)::int n from public.menu_items where restaurant_id=$1", [copy2]), 2);
    assert.equal(await count("select count(*)::int n from public.menu_categories where restaurant_id=$1", [copy2]), 1);
    assert.equal(await count("select count(*)::int n from public.glossary_terms where restaurant_id=$1", [copy2]), 1);
    assert.equal(await count("select count(*)::int n from public.sops where restaurant_id=$1", [copy2]), 1);
    assert.equal((await rows<{ok: boolean}>("select public.is_restaurant_owner($1) as ok", [copy2]))[0].ok, true);
    await db.query("insert into public.menu_items(restaurant_id,name,description,ingredients,category) values($1,'My new dish','Mine',array['Rice'],'Raw bar')", [copy2]);
    assert.ok((await rows<{token: string}>("select public.create_employee_invite($1) as token", [copy2]))[0].token, "they can make an invite link");
    // But a demo visitor still cannot start a brand or a trial.
    await assert.rejects(db.query("select public.create_organization('Mine',$1)", [copy2]), /Sign in first/);
    await assert.rejects(db.query("select public.start_trial_restaurant('Mine')"), /Create an account/);

    // Visitor 3 gets a different copy and cannot see visitor 2's.
    await asUser(3, true);
    const copy3 = (await rows<{id: string}>("select public.start_demo() as id"))[0].id;
    assert.notEqual(copy3, copy2);
    assert.equal(await count("select count(*)::int n from public.menu_items where restaurant_id=$1", [copy2]), 0, "another visitor's copy is invisible");
    assert.equal(await count("select count(*)::int n from public.menu_items where restaurant_id=$1", [copy3]), 2, "and their own copy starts clean");

    // The template is untouched, and its custom quiz came along with the copy.
    await db.exec("reset role");
    assert.equal(await count("select count(*)::int n from public.menu_items where restaurant_id=$1", [template]), 2);
    assert.equal(await count("select count(*)::int n from public.menu_quiz_edits q join public.menu_items m on m.id=q.menu_item_id where m.restaurant_id=$1", [copy2]), 1);
    assert.equal((await rows<{d: boolean}>("select demo_expires_at between now() + interval '6 days' and now() + interval '8 days' as d from public.restaurants where id=$1", [copy2]))[0].d, true, "a copy lasts 7 days");

    // Clean-up removes only what has expired, and the visitors left with nothing.
    await asUser(1);
    await assert.rejects(db.query("select public.purge_expired_demos()"), /permission denied/);
    await db.exec("reset role");
    await db.query("update public.restaurants set demo_expires_at = now() - interval '1 hour' where id=$1", [copy2]);
    await db.query("update auth.users set created_at = now() - interval '9 days' where id in ($1,$2)", [uid(2), uid(3)]);
    assert.equal((await rows<{n: number}>("select public.purge_expired_demos() as n"))[0].n, 1);
    assert.equal(await count("select count(*)::int n from public.restaurants where id=$1", [copy2]), 0);
    assert.equal(await count("select count(*)::int n from public.menu_items where restaurant_id=$1", [copy2]), 0, "its menu goes with it");
    assert.equal(await count("select count(*)::int n from public.restaurants where id in ($1,$2)", [copy3, template]), 2, "an unexpired copy and the template stay");
    assert.deepEqual((await rows<{id: string}>("select id from auth.users where id in ($1,$2) order by id", [uid(2), uid(3)])).map(r => r.id), [uid(3)], "only the visitor who still owns a copy is kept");
  } finally {
    await db.close();
  }
});
