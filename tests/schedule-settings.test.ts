import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Schedule settings (044): Team access changes them, the team reads them, and "only their own shifts"
// really hides coworkers' shifts in the database, not just on the screen.
test("schedule settings are the schedulers' to change, and can keep each person to their own shifts", async () => {
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
    // 1 owner; 2 GM (Team access); 3 server; 4 bartender; 5 outsider.
    for (let id = 1; id <= 5; id++) await db.query("insert into auth.users(id,email) values($1,$2)", [uid(id), `p${id}@osaka.test`]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    const asUser = (id: number) => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${uid(id)}',false);`);
    const rows = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

    await db.exec("reset role");
    const rid = (await rows<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Osaka Miami') returning id", [uid(1)]))[0].id;
    await db.query("insert into public.restaurant_members(restaurant_id,user_id,access) values($1,$2,'{team}'),($1,$3,'{}'),($1,$4,'{}')", [rid, uid(2), uid(3), uid(4)]);

    // The GM saves Thursday weeks, colours and quick shifts; a server can read them but not change them.
    await asUser(2);
    await db.query(`insert into public.schedule_settings(restaurant_id,week_start,position_colors,overtime_daily,shift_presets)
      values($1,4,'{"Bartender":"red"}',8,'[{"name":"Dinner","start":"17:00","end":"23:00"}]')`, [rid]);
    await assert.rejects(db.query("update public.schedule_settings set week_start = 9 where restaurant_id = $1", [rid]), /check constraint/);
    await assert.rejects(db.query("update public.schedule_settings set shift_presets = (select jsonb_agg(x) from generate_series(1,13) x) where restaurant_id = $1", [rid]), /check constraint/, "at most 12 quick shifts");
    await asUser(3);
    assert.equal((await rows<{week_start: number}>("select week_start from public.schedule_settings"))[0].week_start, 4);
    await db.query("update public.schedule_settings set week_start = 1 where restaurant_id = $1", [rid]);
    await asUser(2);
    assert.equal((await rows<{week_start: number}>("select week_start from public.schedule_settings"))[0].week_start, 4, "a server's update changes nothing");
    await asUser(5);
    assert.equal((await rows("select * from public.schedule_settings")).length, 0, "an outsider sees nothing");

    // A published week: the server sees the bartender's shift until the GM keeps people to their own.
    await asUser(2);
    for (const [user, position, day] of [[3, "Server", "2026-10-22"], [4, "Bartender", "2026-10-23"]] as const) {
      await db.query("insert into public.schedule_shifts(restaurant_id,user_id,position,starts_at,ends_at) values($1,$2,$3,$4::date + time '21:00',$4::date + time '23:59')", [rid, uid(user), position, day]);
    }
    await db.query("select public.publish_schedule($1,'2026-10-22','2026-10-29')", [rid]);
    await asUser(3);
    assert.equal((await rows("select id from public.schedule_shifts")).length, 2, "by default the team sees everyone");
    await asUser(2);
    await db.query("update public.schedule_settings set team_sees_all = false where restaurant_id = $1", [rid]);
    await asUser(3);
    assert.deepEqual((await rows<{position: string}>("select position from public.schedule_shifts")).map(r => r.position), ["Server"], "only their own");
    await asUser(2);
    assert.equal((await rows("select id from public.schedule_shifts")).length, 2, "the scheduler still sees the whole week");
  } finally {
    await db.close();
  }
});
