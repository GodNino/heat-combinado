import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Front of house and kitchen schedules (048): the floor manager builds the floor, the head chef the
// kitchen, Team access both; each publishes and decides only their own side.
test("the floor manager and the head chef each build, publish and decide their own side", async () => {
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
    // 1 owner; 2 GM (Team); 3 floor manager (schedule_foh); 4 head chef (schedule_boh); 5 server; 6 line cook.
    for (let id = 1; id <= 6; id++) await db.query("insert into auth.users(id,email) values($1,$2)", [uid(id), `p${id}@osaka.test`]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    const asUser = (id: number) => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${uid(id)}',false);`);
    const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
    const all = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

    await db.exec("reset role");
    const rid = (await one<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Osaka Miami') returning id", [uid(1)])).id;
    await db.query("insert into public.restaurant_members(restaurant_id,user_id,access) values($1,$2,'{team}'),($1,$3,'{}'),($1,$4,'{}'),($1,$5,'{}'),($1,$6,'{}')", [rid, uid(2), uid(3), uid(4), uid(5), uid(6)]);
    for (const [id, role] of [[2, "GM"], [3, "Manager"], [4, "Head Chef"], [5, "Server"], [6, "Line Cook"]] as const) {
      await db.query("insert into public.member_profiles(restaurant_id,user_id,display_name,role) values($1,$2,$3,$4)", [rid, uid(id), `P${id}`, role]);
    }

    // The GM hands out the schedule chips (Team access may, even without holding them).
    await asUser(2);
    await db.query("select public.set_member_access($1, $2, '{schedule_foh}')", [rid, uid(3)]);
    await db.query("select public.set_member_access($1, $2, '{schedule_boh}')", [rid, uid(4)]);
    await assert.rejects(db.query("select public.set_member_access($1, $2, '{payroll}')", [rid, uid(5)]), /only give access|check constraint/);

    const add = (user: number, position: string, day: number) => db.query<{id: string}>(
      "insert into public.schedule_shifts(restaurant_id,user_id,position,starts_at,ends_at) values($1,$2,$3,now() + make_interval(days => $4) ,now() + make_interval(days => $4, hours => 6)) returning id",
      [rid, uid(user), position, day]);

    // The floor manager builds the floor, not the kitchen; the head chef the other way round.
    await asUser(3);
    const serverShift = (await add(5, "Server", 3)).rows[0].id;
    await assert.rejects(add(6, "Line Cook", 3), /row-level security/);
    await asUser(4);
    const cookShift = (await add(6, "Line Cook", 3)).rows[0].id;
    await assert.rejects(add(5, "Server", 4), /row-level security/);
    // Moving a kitchen shift onto a floor position isn't the head chef's to do.
    await assert.rejects(db.query("update public.schedule_shifts set position = 'Server' where id = $1", [cookShift]), /row-level security/);
    assert.equal((await db.query("update public.schedule_shifts set note = 'Grill' where id = $1", [cookShift])).affectedRows, 1);
    assert.equal((await db.query("delete from public.schedule_shifts where id = $1", [serverShift])).affectedRows, 0, "the floor's shift isn't the chef's to delete");

    // Each publishes only their side.
    const published = (await one<{p: {shifts: number}}>("select public.publish_schedule($1, now(), now() + interval '7 days') as p", [rid])).p;
    assert.equal(published.shifts, 1);
    await db.exec("reset role");
    assert.deepEqual((await all<{position: string; published: boolean}>("select position, published from public.schedule_shifts order by position")).map(r => [r.position, r.published]), [["Line Cook", true], ["Server", false]]);

    // Every scheduler sees the whole published week; drafts only on their own side.
    await asUser(4);
    assert.deepEqual((await all<{position: string}>("select position from public.schedule_shifts")).map(r => r.position), ["Line Cook"], "the floor's draft stays the floor manager's");
    await asUser(3);
    assert.equal((await all("select id from public.schedule_shifts")).length, 2, "the published kitchen shift and the floor's own draft");

    // Time off is decided by whoever schedules that person's side.
    await asUser(6);
    const off = (await one<{id: string}>("insert into public.time_off_requests(restaurant_id, starts_on, ends_on) values($1, current_date + 10, current_date + 10) returning id", [rid])).id;
    await asUser(3);
    await assert.rejects(db.query("select public.decide_time_off($1, true)", [off]), /schedule chip for their side/);
    await asUser(4);
    await db.query("select public.decide_time_off($1, true)", [off]);

    // A kitchen list saved in the gear decides what counts as kitchen: Expo moves to the floor here.
    await asUser(2);
    await db.query("insert into public.schedule_settings(restaurant_id, kitchen_positions) values($1, array['Head Chef','Line Cook'])", [rid]);
    await asUser(3);
    await add(5, "Expo", 5);
    await asUser(2);
    assert.ok((await all("select id from public.schedule_shifts")).length >= 3, "Team access still sees and builds everything");
  } finally {
    await db.close();
  }
});
