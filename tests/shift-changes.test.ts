import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Shift changes (045): release, offer, swap, always approved by a manager, closed near the shift,
// and a released shift only goes to someone in the same position.
test("shift changes go through the coworker and the manager, stay in the right area, and never double-book", async () => {
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
    // 1 owner; 2 GM (Team access); 3 and 4 servers; 5 bartender.
    for (let id = 1; id <= 5; id++) await db.query("insert into auth.users(id,email) values($1,$2)", [uid(id), `p${id}@osaka.test`]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    const asUser = (id: number) => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${uid(id)}',false);`);
    const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

    await db.exec("reset role");
    const rid = (await one<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Osaka Miami') returning id", [uid(1)])).id;
    await db.query("insert into public.restaurant_members(restaurant_id,user_id,access) values($1,$2,'{team}'),($1,$3,'{}'),($1,$4,'{}'),($1,$5,'{}')", [rid, uid(2), uid(3), uid(4), uid(5)]);
    for (const [id, role] of [[3, "Server"], [4, "Server"], [5, "Bartender"]] as const) {
      await db.query("insert into public.member_profiles(restaurant_id,user_id,display_name,role) values($1,$2,$3,$4)", [rid, uid(id), `P${id}`, role]);
    }
    // Shifts a few days out, published.
    const at = (days: number, hour: number) => `now() + interval '${days} days' + interval '${hour} hours'`;
    const shift = async (user: number, position: string, days: number, hour = 0, length = 6) =>
      (await one<{id: string}>(`insert into public.schedule_shifts(restaurant_id,user_id,position,starts_at,ends_at,published,created_by)
        values($1,$2,$3,${at(days, hour)},${at(days, hour + length)},true,$4) returning id`, [rid, uid(user), position, uid(2)])).id;
    const friday = await shift(3, "Server", 3);
    const saturday = await shift(4, "Server", 4);
    const barNight = await shift(5, "Bartender", 5);
    const tomorrow = await shift(3, "Server", 0, 10);
    const ownerOf = async (id: string) => (await one<{user_id: string; published: boolean}>("select user_id, published from public.schedule_shifts where id = $1", [id]));
    const status = async (id: string) => (await one<{status: string}>("select status from public.shift_changes where id = $1", [id])).status;

    // Too close: 10 hours out, with the 24-hour default.
    await asUser(3);
    await assert.rejects(db.query("select public.release_shift($1)", [tomorrow]), /too close/);
    await assert.rejects(db.query("select public.release_shift($1)", [saturday]), /isn't one of your published shifts/);

    // Release: a bartender can't take a server's shift; a server can, then the manager approves.
    const released = (await one<{id: string}>("select public.release_shift($1, 'Family dinner') as id", [friday])).id;
    await assert.rejects(db.query("select public.release_shift($1)", [friday]), /already has a change waiting/);
    await asUser(5);
    await assert.rejects(db.query("select public.take_released_shift($1)", [released]), /This shift is for a Server/);
    assert.equal((await db.query("select * from public.shift_change_list($1)", [rid])).rows.length, 0, "a bartender doesn't see servers' released shifts");
    await asUser(4);
    assert.equal((await db.query("select * from public.shift_change_list($1)", [rid])).rows.length, 1, "another server does");
    await db.query("select public.take_released_shift($1)", [released]);
    assert.equal(await status(released), "pending");
    assert.equal((await ownerOf(friday)).user_id, uid(3), "nothing moves before the manager says yes");
    await assert.rejects(db.query("select public.decide_shift_change($1, true)", [released]), /Team access/);
    await asUser(2);
    await db.query("select public.decide_shift_change($1, true)", [released]);
    assert.deepEqual(await ownerOf(friday), {user_id: uid(4), published: true}, "the shift moves and stays published");

    // Offer across areas is allowed but flagged; the coworker can say no.
    await asUser(4);
    const offer = (await one<{id: string}>("select public.offer_shift($1, $2) as id", [saturday, uid(5)])).id;
    assert.equal((await one<{other_area: boolean}>("select other_area from public.shift_changes where id = $1", [offer])).other_area, true);
    await asUser(3);
    await assert.rejects(db.query("select public.answer_shift_change($1, true)", [offer]), /no longer waiting for you/, "only the person asked can answer");
    await asUser(5);
    await db.query("select public.answer_shift_change($1, false)", [offer]);
    assert.equal(await status(offer), "declined");

    // Swap: both shifts change hands on approval; denying leaves both alone.
    await asUser(4);
    const choices = (await db.query<{user_id: string; same_area: boolean}>("select * from public.shift_swap_choices($1)", [saturday])).rows;
    assert.ok(choices.some(c => c.user_id === uid(5) && !c.same_area), "a bartender's shift is offered as another area");
    const people = (await db.query<{user_id: string; same_area: boolean}>("select * from public.shift_change_people($1)", [saturday])).rows;
    assert.equal(people[0].same_area, true, "same position first");
    assert.ok(people.some(p => p.user_id === uid(5) && !p.same_area));
    const swap = (await one<{id: string}>("select public.swap_shift($1, $2) as id", [saturday, barNight])).id;
    await asUser(5);
    await db.query("select public.answer_shift_change($1, true)", [swap]);
    await asUser(2);
    await db.query("select public.decide_shift_change($1, true)", [swap]);
    assert.equal((await ownerOf(saturday)).user_id, uid(5));
    assert.equal((await ownerOf(barNight)).user_id, uid(4));

    // No double booking: offering a shift to someone who already works then is refused.
    await db.exec("reset role");
    const overlap = await shift(3, "Server", 5, 1);
    await asUser(4);
    await assert.rejects(db.query("select public.offer_shift($1, $2)", [barNight, uid(3)]), /already work during that shift/);

    // A manager editing the shift by hand cancels what was waiting on it.
    const waiting = (await one<{id: string}>("select public.offer_shift($1, $2) as id", [barNight, uid(5)])).id;
    await asUser(2);
    await db.query("update public.schedule_shifts set starts_at = starts_at + interval '1 hour' where id = $1", [barNight]);
    assert.equal(await status(waiting), "cancelled");

    // Nobody writes shift_changes directly, and the person asking can cancel.
    await asUser(3);
    await assert.rejects(db.query("insert into public.shift_changes(restaurant_id,kind,shift_id,requested_by,status) values($1,'release',$2,$3,'approved')", [rid, overlap, uid(3)]), /permission denied/);
    const mine = (await one<{id: string}>("select public.release_shift($1) as id", [overlap])).id;
    await db.query("select public.cancel_shift_change($1)", [mine]);
    assert.equal(await status(mine), "cancelled");

    // A cutoff of 0 lets a shift tomorrow change hands.
    await asUser(2);
    await db.query("insert into public.schedule_settings(restaurant_id, change_cutoff_hours) values($1, 0)", [rid]);
    await asUser(3);
    await db.query("select public.release_shift($1)", [tomorrow]);
  } finally {
    await db.close();
  }
});
