import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Pre-shift to the people working today (049): published shifts starting today, in the restaurant's
// time zone; a manager with the Pre-shift chip can send it, a server can't ask.
test("pre-shift goes to whoever has a published shift today", async () => {
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
    // 1 owner; 2 pre-shift manager; 3 server on today (published); 4 server on today (draft); 5 server tomorrow.
    for (let id = 1; id <= 5; id++) await db.query("insert into auth.users(id,email) values($1,$2)", [uid(id), `p${id}@osaka.test`]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    const asUser = (id: number) => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${uid(id)}',false);`);
    await db.exec("reset role");
    const rid = (await db.query<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Osaka Miami') returning id", [uid(1)])).rows[0].id;
    await db.query("insert into public.restaurant_members(restaurant_id,user_id,access) values($1,$2,'{preshift}'),($1,$3,'{}'),($1,$4,'{}'),($1,$5,'{}')", [rid, uid(2), uid(3), uid(4), uid(5)]);
    await db.query("insert into public.schedule_settings(restaurant_id, time_zone) values($1, 'America/New_York')", [rid]);
    const today = "(now() at time zone 'America/New_York')::date";
    const at = (day: string, hour: number) => `((${day})::timestamp + interval '${hour} hours') at time zone 'America/New_York'`;
    await db.exec(`
      insert into public.schedule_shifts(restaurant_id,user_id,position,starts_at,ends_at,published,created_by) values
        ('${rid}','${uid(3)}','Server',${at(today, 0)} + interval '1 minute',${at(today, 6)},true,'${uid(1)}'),
        ('${rid}','${uid(4)}','Server',${at(today, 0)} + interval '2 minutes',${at(today, 6)},false,'${uid(1)}'),
        ('${rid}','${uid(5)}','Server',${at(today + " + 1", 0)} + interval '1 minute',${at(today + " + 1", 6)},true,'${uid(1)}');
    `);

    await asUser(2);
    const working = (await db.query<{user_id: string}>("select user_id from public.preshift_working_today($1)", [rid])).rows.map(r => r.user_id);
    assert.deepEqual(working, [uid(3)], "only today's published shift counts");
    // The Pre-shift chip is enough to post with an audience now, not only the owner.
    await db.query("select public.shift_team_options($1)", [rid]);
    const note = (await db.query<{id: string}>("select public.save_preshift_board($1, current_date, 'VIP at 8', '{}', '[]') as id", [rid])).rows[0].id;
    await db.query("select public.set_shift_recipients($1, $2)", [note, working]);
    assert.equal((await db.query("select * from public.shift_recipients($1)", [note])).rows.length, 1);

    // The person working sees it; the one off today doesn't.
    await asUser(3);
    assert.equal((await db.query("select id from public.shift_notes")).rows.length, 1);
    await asUser(5);
    assert.equal((await db.query("select id from public.shift_notes")).rows.length, 0);
    await assert.rejects(db.query("select * from public.preshift_working_today($1)", [rid]), /Manager access required/);
  } finally {
    await db.close();
  }
});
