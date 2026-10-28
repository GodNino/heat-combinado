import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// The pre-shift board's day is the restaurant's own day (056), not the database's UTC date, so it
// doesn't jump to tomorrow in the middle of a Miami dinner.
test("the pre-shift day follows the restaurant's time zone", async () => {
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
    const owner = "00000000-0000-0000-0000-000000000001";
    await db.query("insert into auth.users(id,email) values($1,'owner@osaka.test')", [owner]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    const rid = (await db.query<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Osaka Miami') returning id", [owner])).rows[0].id;
    const day = async () => (await db.query<{d: string}>("select public.restaurant_today($1)::text as d", [rid])).rows[0].d;
    const at = async (tz: string) => (await db.query<{d: string}>(`select (now() at time zone '${tz}')::date::text as d`)).rows[0].d;
    assert.equal(await day(), await at("America/New_York"), "Miami's day until a zone is saved");
    // A zone a day ahead of UTC most of the time: the answer follows it, not the server.
    await db.query("insert into public.schedule_settings(restaurant_id, time_zone) values($1, 'Pacific/Kiritimati')", [rid]);
    assert.equal(await day(), await at("Pacific/Kiritimati"));
    await db.query("update public.schedule_settings set time_zone = 'Not/AZone' where restaurant_id = $1", [rid]);
    assert.equal(await day(), await at("America/New_York"), "a bad zone falls back to Miami");
    // The board reports and posts under that day.
    await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${owner}',false);`);
    const board = (await db.query<{b: {service_date: string}}>("select public.get_preshift_board($1) as b", [rid])).rows[0].b;
    assert.equal(board.service_date, await at("America/New_York"));
    await db.query("select public.save_preshift_board($1, $2::date, 'VIP at 8', '{}', '[]')", [rid, board.service_date]);
    await assert.rejects(db.query("select public.save_preshift_board($1, ($2::date + 1), 'x', '{}', '[]')", [rid, board.service_date]), /service day has changed/);
  } finally {
    await db.close();
  }
});
