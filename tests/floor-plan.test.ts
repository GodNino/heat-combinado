import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// The floor plan (050): a manager with the Pre-shift chip saves it from the published schedule;
// the team reads it; nobody else writes it.
test("the floor plan starts from the schedule, managers save it and the team reads it", async () => {
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
    // 1 owner; 2 manager (pre-shift); 3 server; 4 S.A.
    for (let id = 1; id <= 4; id++) await db.query("insert into auth.users(id,email) values($1,$2)", [uid(id), `p${id}@osaka.test`]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    const asUser = (id: number) => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${uid(id)}',false);`);
    await db.exec("reset role");
    const rid = (await db.query<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Osaka Miami') returning id", [uid(1)])).rows[0].id;
    await db.query("insert into public.restaurant_members(restaurant_id,user_id,access) values($1,$2,'{preshift}'),($1,$3,'{}'),($1,$4,'{}')", [rid, uid(2), uid(3), uid(4)]);
    await db.query("insert into public.schedule_settings(restaurant_id, time_zone) values($1, 'America/New_York')", [rid]);
    const day = "(now() at time zone 'America/New_York')::date";
    await db.exec(`
      insert into public.schedule_shifts(restaurant_id,user_id,position,starts_at,ends_at,published,created_by) values
        ('${rid}','${uid(3)}','Server',(${day})::timestamp at time zone 'America/New_York' + interval '17 hours',(${day})::timestamp at time zone 'America/New_York' + interval '23 hours',true,'${uid(1)}'),
        ('${rid}','${uid(4)}','Server assistant',(${day})::timestamp at time zone 'America/New_York' + interval '17 hours',(${day})::timestamp at time zone 'America/New_York' + interval '23 hours',false,'${uid(1)}');
    `);
    const today = (await db.query<{d: string}>(`select (${day})::text as d`)).rows[0].d;

    await asUser(2);
    const people = (await db.query<{user_id: string; shift_position: string}>("select * from public.floor_plan_people($1, $2::date)", [rid, today])).rows;
    assert.deepEqual(people.map(p => p.shift_position), ["Server"], "only the published schedule");
    const list = (await db.query<{id: string}>("insert into public.running_sidework_lists(restaurant_id,name,tasks) values($1,'Saturday · 7 servers',array['Trays/BTG','Coffee station']) returning id", [rid])).rows[0].id;
    const rows = JSON.stringify([{server_id: uid(3), server_name: "Ana", sa: [{id: uid(4), name: "Sol"}], section: "1", task: "Trays/BTG"}]);
    await db.query("insert into public.floor_plans(restaurant_id,service_date,service,list_id,rows) values($1,$2::date,'Dinner',$3,$4::jsonb)", [rid, today, list, rows]);
    await assert.rejects(db.query("insert into public.floor_plans(restaurant_id,service_date,service,rows) values($1,$2::date,'Dinner','[]')", [rid, today]), /duplicate key|unique/);

    // The team reads it; a server can't change it or ask who works.
    await asUser(4);
    const seen = (await db.query<{rows: {sa: {id: string}[]}[]}>("select rows from public.floor_plans")).rows;
    assert.equal(seen[0].rows[0].sa[0].id, uid(4));
    assert.equal((await db.query("update public.floor_plans set rows = '[]'")).affectedRows, 0);
    await assert.rejects(db.query("insert into public.running_sidework_lists(restaurant_id,name) values($1,'Mine')", [rid]), /row-level security/);
    await assert.rejects(db.query("select * from public.floor_plan_people($1, $2::date)", [rid, today]), /Manager access required/);
  } finally {
    await db.close();
  }
});
