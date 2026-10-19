import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// The schedule (040): managers with Team access build and publish it, the team only sees what was
// published, edits go back to draft, and availability and time off belong to each person.
test("the schedule is built by managers, seen by the team once published, and kept honest", async () => {
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
    // 1 owner; 2 GM (Team access); 3 floor manager (Pre-shift only); 4 server; 5 outsider.
    for (let id = 1; id <= 5; id++) await db.query("insert into auth.users(id,email) values($1,$2)", [uid(id), `p${id}@osaka.test`]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    const asUser = (id: number) => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${uid(id)}',false);`);
    const rows = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

    await db.exec("reset role");
    const miami = (await rows<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Osaka Miami') returning id", [uid(1)]))[0].id;
    for (const [user, access] of [[2, "{team}"], [3, "{preshift}"], [4, "{}"]] as const) {
      await db.query("insert into public.restaurant_members(restaurant_id,user_id,access) values($1,$2,$3)", [miami, uid(user), access]);
    }
    const addShift = (user: number, start: string, end: string, position = "Server") => db.query<{id: string}>(
      "insert into public.schedule_shifts(restaurant_id,user_id,position,starts_at,ends_at) values($1,$2,$3,$4,$5) returning id", [miami, uid(user), position, start, end]);

    // The GM builds a draft; the server can't see it yet, and neither Pre-shift nor a server can build.
    await asUser(2);
    const dinner = (await addShift(4, "2026-10-20 21:00+00", "2026-10-21 03:00+00")).rows[0].id;
    await addShift(3, "2026-10-21 21:00+00", "2026-10-22 03:00+00", "Manager");
    await assert.rejects(addShift(5, "2026-10-20 21:00+00", "2026-10-21 03:00+00"), /row-level security/, "only people on the team can be scheduled");
    await assert.rejects(addShift(4, "2026-10-20 21:00+00", "2026-10-21 15:00+00"), /check constraint/, "no 18-hour shifts");
    await asUser(4);
    assert.equal((await rows("select id from public.schedule_shifts")).length, 0, "drafts are the manager's");
    await assert.rejects(addShift(4, "2026-10-22 21:00+00", "2026-10-23 03:00+00"), /row-level security/);
    await asUser(3);
    await assert.rejects(addShift(4, "2026-10-22 21:00+00", "2026-10-23 03:00+00"), /row-level security/, "Pre-shift access isn't Team access");
    await assert.rejects(db.query("select public.publish_schedule($1,'2026-10-19','2026-10-26')", [miami]), /Team access/);

    // Publishing shows the week to the whole team and records who it touched.
    await asUser(2);
    const published = (await rows<{p: {id: string; shifts: number; people: number}}>("select public.publish_schedule($1,'2026-10-19','2026-10-26') as p", [miami]))[0].p;
    assert.equal(published.shifts, 2);
    assert.equal(published.people, 2);
    await assert.rejects(db.query("select public.publish_schedule($1,'2026-10-01','2026-10-26')", [miami]), /one or two weeks/);
    await asUser(4);
    assert.equal((await rows("select id from public.schedule_shifts")).length, 2, "the team sees coworkers' published shifts");
    assert.deepEqual((await rows<{name: string; role: string}>("select name,role from public.schedule_team($1) order by name", [miami])).map(r => r.name), ["p1", "p2", "p3", "p4"]);

    // Editing a published shift makes it a draft again; publishing tells only the people touched.
    await asUser(2);
    await db.query("update public.schedule_shifts set ends_at='2026-10-21 04:00+00' where id=$1", [dinner]);
    await asUser(4);
    assert.equal((await rows("select id from public.schedule_shifts")).length, 1, "the changed shift waits for the next publish");
    await asUser(2);
    const again = (await rows<{p: {id: string; shifts: number}}>("select public.publish_schedule($1,'2026-10-19','2026-10-26') as p", [miami]))[0].p;
    assert.equal(again.shifts, 1);
    assert.deepEqual((await rows<{user_ids: string[]}>("select user_ids from public.push_audience('schedule_published',$1)", [again.id]))[0].user_ids, [uid(4)]);
    await asUser(3);
    await assert.rejects(db.query("select * from public.push_audience('schedule_published',$1)", [again.id]), /you published/);

    // Availability is each person's own; managers read it.
    await asUser(4);
    await db.query("insert into public.schedule_unavailability(restaurant_id,weekday) values($1,0)", [miami]);
    await db.query("insert into public.schedule_unavailability(restaurant_id,weekday,starts,ends) values($1,1,'09:00','15:00')", [miami]);
    await assert.rejects(db.query("insert into public.schedule_unavailability(restaurant_id,user_id,weekday) values($1,$2,2)", [miami, uid(3)]), /row-level security/, "a server can't set a coworker's availability");
    await asUser(3);
    assert.equal((await rows("select id from public.schedule_unavailability")).length, 0, "coworkers don't see each other's availability");
    await asUser(2);
    assert.equal((await rows("select id from public.schedule_unavailability")).length, 2);

    // Time off: asked by the person, decided by Team access, announced both ways.
    await asUser(4);
    const request = (await rows<{id: string}>("insert into public.time_off_requests(restaurant_id,starts_on,ends_on,note) values($1,current_date+3,current_date+4,'Wedding') returning id", [miami]))[0].id;
    assert.deepEqual((await rows<{user_ids: string[]}>("select user_ids from public.push_audience('time_off_requested',$1)", [request]))[0].user_ids.sort(), [uid(1), uid(2)]);
    await assert.rejects(db.query("insert into public.time_off_requests(restaurant_id,starts_on,ends_on,status) values($1,current_date+5,current_date+5,'approved')", [miami]), /row-level security/, "nobody approves their own time off");
    await assert.rejects(db.query("select public.decide_time_off($1,true)", [request]), /Team access/);
    await asUser(2);
    await db.query("select public.decide_time_off($1,true)", [request]);
    await assert.rejects(db.query("select public.decide_time_off($1,false)", [request]), /already decided/);
    assert.deepEqual((await rows<{user_ids: string[]}>("select user_ids from public.push_audience('time_off_decided',$1)", [request]))[0].user_ids, [uid(4)]);
    await asUser(4);
    assert.equal((await rows<{status: string}>("select status from public.time_off_requests"))[0].status, "approved");
    await asUser(4);
    await db.query("delete from public.time_off_requests where id=$1", [request]);
    assert.equal((await rows("select id from public.time_off_requests")).length, 1, "a decided request can't be withdrawn");

    // An outsider sees nothing at all.
    await asUser(5);
    assert.equal((await rows("select id from public.schedule_shifts")).length, 0);
    await assert.rejects(db.query("select * from public.schedule_team($1)", [miami]), /access to this restaurant/);
  } finally {
    await db.close();
  }
});
