import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// End-of-shift reports (038): pre-filled from what HEAT knows, written by whoever runs service,
// read by the location's managers and the brand owner, and emailed to the right people.
test("shift reports are pre-filled, kept to managers, and reach the right inboxes", async () => {
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
    // 1 owns the brand and Miami; 2 is a floor manager (Pre-shift); 3 is the GM (Team); 4 a server; 5 an outsider.
    const people = ["owner@osaka.test", "floor@osaka.test", "gm@osaka.test", "server@osaka.test", "outsider@example.test"];
    for (const [i, email] of people.entries()) await db.query("insert into auth.users(id,email) values($1,$2)", [uid(i + 1), email]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    await db.exec("alter table public.menu_items add column if not exists details jsonb");
    const asUser = (id: number) => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${uid(id)}',false);`);
    const rows = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

    await db.exec("reset role");
    const miami = (await rows<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Osaka Miami') returning id", [uid(1)]))[0].id;
    const brand = (await rows<{id: string}>("insert into public.organizations(owner_id,name) values($1,'Osaka') returning id", [uid(1)]))[0].id;
    await db.query("update public.restaurants set organization_id=$1 where id=$2", [brand, miami]);
    for (const [user, access] of [[2, "{preshift}"], [3, "{team}"], [4, "{}"]] as const) {
      await db.query("insert into public.restaurant_members(restaurant_id,user_id,access) values($1,$2,$3)", [miami, uid(user), access]);
    }
    // Tonight's board: one dish 86'd. A posted checklist shift with one of two jobs done.
    const dish = (await rows<{id: string}>("insert into public.menu_items(restaurant_id,name,description,ingredients) values($1,'Black Cod','Miso',array['Cod']) returning id", [miami]))[0].id;
    const note = (await rows<{id: string}>("insert into public.shift_notes(restaurant_id,posted_by) values($1,$2) returning id", [miami, uid(1)]))[0].id;
    await db.query("insert into public.shift_board_entries(shift_note_id,menu_item_id,status) values($1,$2,'86')", [note, dish]);
    const shift = (await rows<{id: string}>("insert into public.checklist_shifts(restaurant_id,status,created_by) values($1,'posted',$2) returning id", [miami, uid(1)]))[0].id;
    await db.query("insert into public.checklist_floor(shift_id,restaurant_id,user_id) values($1,$2,$3)", [shift, miami, uid(4)]);
    await db.query("insert into public.checklist_assignments(shift_id,restaurant_id,title,done_at) values($1,$2,'Close the bar',now()),($1,$2,'Mop the kitchen',null)", [shift, miami]);
    await db.query("insert into public.shift_report_recipients(restaurant_id,email,added_by) values($1,'investor@osaka.test',$2)", [miami, uid(1)]);

    // The floor manager sees what HEAT already knows, and submits.
    await asUser(2);
    const draft = (await rows<{d: {eighty_six: {name: string}[]; checklists: {done: number; total: number; missing: string[]}; quizzes: number}}>("select public.shift_report_draft($1) as d", [miami]))[0].d;
    assert.deepEqual(draft.eighty_six.map(e => e.name), ["Black Cod"]);
    assert.deepEqual(draft.checklists, {total: 2, done: 1, missing: ["Mop the kitchen"]});
    await assert.rejects(db.query("select public.shift_report_draft($1, current_date - 5)", [miami]), /today's service/, "a report is for tonight, not last week");
    await assert.rejects(db.query("select public.submit_shift_report($1,$2)", [miami, {label: "Dinner"}]), /how the night went/);
    await assert.rejects(db.query("select public.submit_shift_report($1,$2)", [miami, {mood: "ok", issues: [{kind: "aliens", note: "?"}]}]), /known kind/);
    const report = {label: "Dinner", mood: "rough", covers: 182, sales: 14250.5, notes: "Busy night.",
      issues: [{kind: "allergy", note: "Guest with sesame allergy got the wrong sauce; no reaction, comped."}, {kind: "equipment", note: "Fryer 2 down"}],
      next_shift: "Call the fryer technician at 9am."};
    const id = (await rows<{id: string}>("select public.submit_shift_report($1,$2) as id", [miami, report]))[0].id;
    const saved = (await rows<{urgent: boolean; covers: number; from_heat: {eighty_six: unknown[]}}>("select urgent,covers,from_heat from public.shift_reports where id=$1", [id]))[0];
    assert.equal(saved.urgent, true, "an allergy incident makes the report urgent");
    assert.equal(saved.covers, 182);
    assert.equal(saved.from_heat.eighty_six.length, 1, "what HEAT knew is captured by the database");
    // Sending it again replaces tonight's Dinner report rather than adding a second one.
    await db.query("select public.submit_shift_report($1,$2)", [miami, {...report, mood: "ok", issues: []}]);
    assert.deepEqual((await rows<{mood: string; urgent: boolean}>("select mood,urgent from public.shift_reports")).map(r => [r.mood, r.urgent]), [["ok", false]]);
    await assert.rejects(db.query("update public.shift_reports set covers=1"), /permission denied/, "the table is only written through submit");

    // Recipients: owner (also the brand owner), the floor manager, the GM and the extra address. Not the server.
    const inbox = (await rows<{email: string}>("select email from public.shift_report_recipients($1) order by email", [id])).map(r => r.email);
    assert.deepEqual(inbox, ["floor@osaka.test", "gm@osaka.test", "investor@osaka.test", "owner@osaka.test"]);

    // The GM reads it; the server and an outsider can't, and can't write one.
    await asUser(3);
    assert.equal((await rows("select id from public.shift_reports")).length, 1);
    await assert.rejects(db.query("select public.submit_shift_report($1,$2)", [miami, report]), /pre-shift access/);
    for (const user of [4, 5]) {
      await asUser(user);
      assert.equal((await rows("select id from public.shift_reports")).length, 0);
      await assert.rejects(db.query("select public.shift_report_recipients($1)", [id]), /Report unavailable/);
      await assert.rejects(db.query("select public.shift_report_draft($1)", [miami]), /pre-shift access/);
    }
    // The brand owner gets the whole brand's feed; nobody else does.
    await asUser(1);
    assert.equal((await rows("select * from public.brand_shift_reports($1,14)", [brand])).length, 1);
    await asUser(3);
    await assert.rejects(db.query("select * from public.brand_shift_reports($1,14)", [brand]), /owner of the brand/);
  } finally {
    await db.close();
  }
});
