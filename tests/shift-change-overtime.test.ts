import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Shift changes and overtime (047): released shifts only reach people in the same position who'd stay
// under overtime, the picker puts overtime last, and the manager sees the hours a change would bring.
test("shift changes keep people under overtime first, and tell the manager when they wouldn't", async () => {
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
    // 1 owner; 2 GM (Team access); 3, 4 and 5 servers; 6 bartender.
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
    for (const [id, role] of [[2, "GM"], [3, "Server"], [4, "Server"], [5, "Server"], [6, "Bartender"]] as const) {
      await db.query("insert into public.member_profiles(restaurant_id,user_id,display_name,role) values($1,$2,$3,$4)", [rid, uid(id), `P${id}`, role]);
    }
    await db.query("insert into public.schedule_settings(restaurant_id, week_start, overtime_weekly, time_zone) values($1, 1, 40, 'America/New_York')", [rid]);

    // Next week, Monday to Sunday, in Miami time: every shift lands in the same week.
    const day = (n: number, hour: number) => `((date_trunc('week', now() at time zone 'America/New_York') + interval '${7 + n} days' + interval '${hour} hours') at time zone 'America/New_York')`;
    const shift = async (user: number, n: number, hour: number, length: number, position = "Server") =>
      (await one<{id: string}>(`insert into public.schedule_shifts(restaurant_id,user_id,position,starts_at,ends_at,published,created_by)
        values($1,$2,$3,${day(n, hour)},${day(n, hour)} + interval '${length} hours',true,$4) returning id`, [rid, uid(user), position, uid(2)])).id;
    // Server 3 already has 36 hours next week; server 4 has 8.
    for (let n = 0; n < 4; n++) await shift(3, n, 10, 9);
    await shift(4, 0, 10, 8);
    const friday = await shift(5, 4, 17, 6);
    const barSaturday = await shift(6, 5, 17, 6, "Bartender");

    // Server 5 releases Friday: server 3 would reach 42 hours, so only server 4 sees it.
    await asUser(5);
    const released = (await one<{id: string}>("select public.release_shift($1) as id", [friday])).id;
    await asUser(3);
    assert.equal((await all("select * from public.shift_change_list($1)", [rid])).length, 0, "overtime: not shown");
    await assert.rejects(db.query("select public.take_released_shift($1)", [released]), /into overtime/);
    await asUser(4);
    assert.equal((await all("select * from public.shift_change_list($1)", [rid])).length, 1);
    await asUser(5);
    const told = await one<{user_ids: string[]}>("select * from public.push_audience('shift_released', $1)", [released]);
    assert.deepEqual(told.user_ids, [uid(4)], "only the server who'd stay under overtime hears about it");
    await db.query("select public.cancel_shift_change($1)", [released]);

    // Someone covers: same position under overtime, then same position over, then the other area.
    const people = await all<{user_id: string; same_area: boolean; overtime: boolean; hours: string}>("select * from public.shift_change_people($1)", [friday]);
    assert.equal(people[0].user_id, uid(4));
    assert.equal(people[1].user_id, uid(3));
    assert.deepEqual([Number(people[1].hours), people[1].overtime], [42, true]);
    assert.ok(!people.slice(0, 2).some(p => !p.same_area));

    // Offered to server 3 anyway: the manager sees 42 hours and overtime before deciding.
    const offer = (await one<{id: string}>("select public.offer_shift($1, $2) as id", [friday, uid(3)])).id;
    await asUser(3);
    await db.query("select public.answer_shift_change($1, true)", [offer]);
    await asUser(2);
    const seen = await one<{taker_hours: string; taker_overtime: boolean}>("select taker_hours, taker_overtime from public.shift_change_list($1) where id = $2", [rid, offer]);
    assert.deepEqual([Number(seen.taker_hours), seen.taker_overtime], [42, true]);
    await db.query("select public.decide_shift_change($1, false)", [offer]);

    // A swap shows the coworker's hours with the shift they'd take instead of theirs.
    await asUser(5);
    const swaps = await all<{user_id: string; hours: string; overtime: boolean}>("select * from public.shift_swap_choices($1)", [friday]);
    const bartender = swaps.find(s => s.user_id === uid(6))!;
    assert.deepEqual([Number(bartender.hours), bartender.overtime], [6, false], "6 hours: theirs goes, ours comes");

    // A daily limit counts too: 8 a day, and server 4's Monday is already 8.
    await asUser(2);
    await db.query("update public.schedule_settings set overtime_daily = 8 where restaurant_id = $1", [rid]);
    await db.exec("reset role");
    const mondayNight = await shift(5, 0, 19, 4);
    await asUser(5);
    const monday = await all<{user_id: string; overtime: boolean}>("select * from public.shift_change_people($1)", [mondayNight]);
    assert.equal(monday.find(p => p.user_id === uid(4))!.overtime, true, "8 + 4 hours in a day");
  } finally {
    await db.close();
  }
});
