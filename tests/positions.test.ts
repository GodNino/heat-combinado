import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Positions (041): any job title saves, newcomers without one are listed for the manager, and an
// invite link can carry a position that whoever joins with it starts in.
test("positions are free text, newcomers are asked for, and a position link places whoever joins", async () => {
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
    // 1 owner; 2 GM (Team access); 3 joins with the plain link; 4 joins as a bartender; 5 server, no Team access.
    for (let id = 1; id <= 5; id++) await db.query("insert into auth.users(id,email) values($1,$2)", [uid(id), `p${id}@osaka.test`]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    const asUser = (id: number) => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${uid(id)}',false);`);
    const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];
    const roleOf = async (rid: string, id: number) => (await one<{role: string}>("select role from public.schedule_team($1) where user_id = $2", [rid, uid(id)]))?.role;

    await db.exec("reset role");
    const rid = (await one<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Osaka Miami') returning id", [uid(1)])).id;
    await db.query("insert into public.restaurant_members(restaurant_id,user_id,access) values($1,$2,'{team}'),($1,$3,'{}')", [rid, uid(2), uid(5)]);

    // A GM makes the plain link and a bartender link; asking again keeps the same bartender link.
    await asUser(2);
    const plain = (await one<{t: string}>("select public.create_employee_invite($1) as t", [rid])).t;
    const bar = (await one<{t: string}>("select public.create_position_invite($1,'Bartender') as t", [rid])).t;
    assert.equal((await one<{t: string}>("select public.create_position_invite($1,' bartender ') as t", [rid])).t, bar, "the link already out there stays good");
    const host = (await one<{t: string}>("select public.create_position_invite($1,'Host') as t", [rid])).t;
    assert.notEqual(host, bar, "each position has its own link");
    await assert.rejects(db.query("select public.create_position_invite($1,'  ')", [rid]), /Choose a position/);
    await asUser(5);
    await assert.rejects(db.query("select public.create_position_invite($1,'Server')", [rid]), /access to the team/, "only Team access makes links");

    // Joining: the plain link places nobody; the bartender link makes a bartender.
    await asUser(3);
    await db.query("select public.join_restaurant($1)", [plain]);
    await asUser(4);
    await db.query("select public.join_restaurant($1)", [bar]);
    await asUser(2);
    assert.equal(await roleOf(rid, 4), "Bartender");
    const waiting = (await db.query<{u: string}>("select public.team_without_position($1) as u", [rid])).rows.map(r => r.u).sort();
    assert.deepEqual(waiting, [uid(2), uid(3), uid(5)], "everyone nobody placed, the plain-link newcomer included, never the owner");

    // Any job title saves now, and saving takes the person off the list.
    for (const title of ["Sommelier", "GM", "Captain"]) await db.query("select public.set_member_profile($1,$2,'',$3)", [rid, uid(3), title]);
    assert.equal(await roleOf(rid, 3), "Captain");
    await assert.rejects(db.query("select public.set_member_profile($1,$2,'',$3)", [rid, uid(5), "x".repeat(41)]), /check constraint/);
    await assert.rejects(db.query("select public.set_member_profile($1,$2,'','   ')", [rid, uid(5)]), /check constraint/);
    assert.deepEqual((await db.query<{u: string}>("select public.team_without_position($1) as u", [rid])).rows.map(r => r.u).sort(), [uid(2), uid(5)]);

    // Joining again with a position link never overrides what the manager chose.
    await asUser(3);
    await db.query("select public.join_restaurant($1)", [host]);
    await asUser(2);
    assert.equal(await roleOf(rid, 3), "Captain");

    // Replacing a position link switches off the old one.
    const fresh = (await one<{t: string}>("select public.create_position_invite($1,'Bartender',true) as t", [rid])).t;
    assert.notEqual(fresh, bar);
    await asUser(5);
    await assert.rejects(db.query("select public.join_restaurant($1)", [bar]), /invalid or expired/);
    await assert.rejects(db.query("select public.team_without_position($1)", [rid]), /access to the team/);
  } finally {
    await db.close();
  }
});
