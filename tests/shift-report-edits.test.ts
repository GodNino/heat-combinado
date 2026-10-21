import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Shift report edits (046): past reports can be corrected and deleted, and each one keeps who wrote it
// and who changed it last.
test("past shift reports can be corrected and deleted by the right people, and remember who did it", async () => {
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
    // 1 owner; 2 floor manager (Pre-shift); 3 another floor manager (Pre-shift); 4 GM (Team); 5 server.
    for (let id = 1; id <= 5; id++) await db.query("insert into auth.users(id,email) values($1,$2)", [uid(id), `p${id}@osaka.test`]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    const asUser = (id: number) => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${uid(id)}',false);`);
    const one = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows[0];

    await db.exec("reset role");
    const rid = (await one<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Osaka Miami') returning id", [uid(1)])).id;
    await db.query("insert into public.restaurant_members(restaurant_id,user_id,access) values($1,$2,'{preshift}'),($1,$3,'{preshift}'),($1,$4,'{team}'),($1,$5,'{}')", [rid, uid(2), uid(3), uid(4), uid(5)]);
    const report = (over: Record<string, unknown> = {}) => JSON.stringify({service_date: new Date().toISOString().slice(0, 10), label: "Dinner", mood: "ok", covers: "120", issues: [], notes: "Quiet", ...over});
    const row = async (id: string) => one<{submitted_by: string; updated_by: string | null; updated_at: string | null; mood: string; label: string; urgent: boolean; notes: string}>(
      "select submitted_by, updated_by, updated_at, mood, label, urgent, notes from public.shift_reports where id = $1", [id]);

    // Written by 2; sending again by 3 keeps 2 as the writer and records 3 as the last change.
    await asUser(2);
    const id = (await one<{id: string}>("select public.submit_shift_report($1, $2::jsonb) as id", [rid, report()])).id;
    assert.equal((await row(id)).updated_by, null);
    await asUser(3);
    await db.query("select public.submit_shift_report($1, $2::jsonb)", [rid, report({mood: "great"})]);
    let saved = await row(id);
    assert.equal(saved.submitted_by, uid(2), "the writer stays");
    assert.equal(saved.updated_by, uid(3));
    assert.ok(saved.updated_at);

    // Correcting a past report: the GM fixes it, and an allergy issue makes it urgent.
    await asUser(4);
    const urgent = (await one<{u: boolean}>("select public.update_shift_report($1, $2::jsonb) as u", [id, report({mood: "rough", notes: "Corrected", issues: [{kind: "allergy", note: "Sesame at table 12"}]})])).u;
    assert.equal(urgent, true);
    saved = await row(id);
    assert.deepEqual([saved.mood, saved.notes, saved.urgent, saved.updated_by, saved.submitted_by], ["rough", "Corrected", true, uid(4), uid(2)]);
    await assert.rejects(db.query("select public.update_shift_report($1, $2::jsonb)", [id, report({mood: "meh"})]), /how the night went/);
    assert.deepEqual(await one("select * from public.shift_report_names($1)", [id]), {written_by: "p2@osaka.test", changed_by: "p4@osaka.test"});

    // Renaming it onto another report of the same day is refused plainly.
    await asUser(2);
    await db.query("select public.submit_shift_report($1, $2::jsonb)", [rid, report({label: "Lunch"})]);
    await assert.rejects(db.query("select public.update_shift_report($1, $2::jsonb)", [id, report({label: "Lunch"})]), /already a Lunch report/);

    // A server can't correct or delete; another floor manager can correct but not delete someone else's.
    await asUser(5);
    await assert.rejects(db.query("select public.update_shift_report($1, $2::jsonb)", [id, report()]), /can't change this report/);
    await assert.rejects(db.query("select public.delete_shift_report($1)", [id]), /Only someone with Team access/);
    await assert.rejects(db.query("update public.shift_reports set notes = 'x' where id = $1", [id]), /permission denied/);
    await asUser(3);
    await assert.rejects(db.query("select public.delete_shift_report($1)", [id]), /Only someone with Team access/);
    // Whoever wrote it can delete it; so can Team access.
    await asUser(2);
    await db.query("select public.delete_shift_report($1)", [id]);
    assert.equal((await db.query("select id from public.shift_reports where id = $1", [id])).rows.length, 0);
    const lunch = (await one<{id: string}>("select id from public.shift_reports where label = 'Lunch'")).id;
    await asUser(4);
    await db.query("select public.delete_shift_report($1)", [lunch]);

    // Whoever changed an urgent report last can tell managers' phones about it.
    await asUser(2);
    const late = (await one<{id: string}>("select public.submit_shift_report($1, $2::jsonb) as id", [rid, report({label: "Late night"})])).id;
    await asUser(3);
    await db.query("select public.update_shift_report($1, $2::jsonb)", [late, report({label: "Late night", issues: [{kind: "injury", note: "Cut finger"}]})]);
    const audience = await one<{user_ids: string[]}>("select * from public.push_audience('urgent_report', $1)", [late]);
    assert.ok(audience.user_ids.includes(uid(4)), "the GM hears about it");
  } finally {
    await db.close();
  }
});
