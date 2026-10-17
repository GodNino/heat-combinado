import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// The dashboard numbers (036) read the same latest-result rules as Home and Team, and each one
// is only ever shown to the people allowed to see it.
test("dashboards count the team's latest results per library, by week and per location", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users(id uuid primary key,email text,raw_user_meta_data jsonb default '{}');
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
    for (let id = 1; id <= 4; id++) await db.query("insert into auth.users(id,email) values($1,$2)", [uid(id), `person${id}@example.test`]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    // Production has menu_items.details (wine region, producer, custom card fields), added by hand
    // before migrations were kept here; the quiz builder reads it.
    await db.exec("alter table public.menu_items add column if not exists details jsonb");
    const asUser = (id: number) => db.exec(`reset role; set role authenticated;
      select set_config('request.jwt.claim.sub','${uid(id)}',false);`);
    const rows = async <T>(sql: string, params: unknown[] = []) => (await db.query<T>(sql, params)).rows;

    // Owner 1: Miami (two dishes, one cocktail) and Chicago, in one brand. 2 and 3 serve in Miami.
    const restaurant = async (name: string) => (await rows<{id: string}>("insert into public.restaurants(owner_id,name) values($1,$2) returning id", [uid(1), name]))[0].id;
    const miami = await restaurant("Miami"), chicago = await restaurant("Chicago");
    const brand = (await rows<{id: string}>("insert into public.organizations(owner_id,name) values($1,'Osaka') returning id", [uid(1)]))[0].id;
    await db.query("update public.restaurants set organization_id=$1", [brand]);
    const item = async (rid: string, name: string, type = "food") => (await rows<{id: string}>(
      "insert into public.menu_items(restaurant_id,name,description,ingredients,content_type) values($1,$2,'Description',array['Lime'],$3) returning id", [rid, name, type]))[0].id;
    const tiradito = await item(miami, "Tiradito"), ceviche = await item(miami, "Ceviche"), sour = await item(miami, "Pisco Sour", "cocktails");
    await item(chicago, "Tiradito");
    for (const member of [2, 3]) await db.query("insert into public.restaurant_members(restaurant_id,user_id) values($1,$2)", [miami, uid(member)]);
    // Results carry the quiz they were taken on, so a current quiz is not "needs review".
    // Building that quiz checks who is asking, so these rows are written as the owner.
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [uid(1)]);
    const attempt = (learner: number, mid: string, correct: number, ago: string) => db.query(
      `insert into public.quiz_attempts(user_id,menu_item_id,menu_updated_at,answers,correct,total,questions,created_at)
       select $1,id,updated_at,array_fill(0,array[6]),$3,6,public.build_menu_quiz(id)->'questions',now()-$4::interval from public.menu_items where id=$2`,
      [uid(learner), mid, correct, ago]);
    await attempt(2, tiradito, 3, "20 days");   // an older, weaker try at the same dish...
    await attempt(2, tiradito, 6, "1 day");     // ...is replaced by the latest one
    await attempt(2, ceviche, 4, "2 days");     // below 80%: needs review
    await attempt(3, sour, 6, "10 days");       // not active in the last week
    await attempt(1, tiradito, 0, "1 day");     // the owner practising is not a learner

    // Manager: per library.
    await asUser(1);
    type Stats = {content_type: string; items: number; learners: number; taken: number; correct: number; total: number; needs_review: number; active_7d: number};
    const stats = await rows<Stats>("select * from public.location_summary($1)", [miami]);
    const food = stats.find(r => r.content_type === "food")!, drinks = stats.find(r => r.content_type === "cocktails")!;
    assert.deepEqual({...food}, {content_type: "food", items: 2, learners: 2, taken: 2, correct: 10, total: 12, needs_review: 1, active_7d: 1});
    assert.deepEqual([drinks.items, drinks.taken, drinks.correct, drinks.needs_review], [1, 1, 6, 0]);
    assert.equal(stats.find(r => r.content_type === "wine")!.items, 0, "every library has a row, empty or not");

    const weeks = await rows<{week_start: string; quizzes: number; learners: number}>("select * from public.location_activity($1,8)", [miami]);
    assert.equal(weeks.length, 8, "empty weeks are still there, so the chart's time axis is even");
    assert.equal(weeks.reduce((sum, w) => sum + w.quizzes, 0), 4, "every completed try by a learner counts as activity; the owner's practice does not");
    assert.ok(new Date(weeks[0].week_start) < new Date(weeks[7].week_start), "oldest week first");

    // Brand: one row per location, only for the brand's owner.
    const brandRows = await rows<{name: string; items: number; taken: number; quizzes_28d: number}>("select * from public.brand_summary($1)", [brand]);
    assert.deepEqual(brandRows.map(r => [r.name, r.items, r.taken, r.quizzes_28d]), [["Miami", 3, 3, 4], ["Chicago", 1, 0, 0]]);

    // A server sees only their own activity, and neither the team's nor the brand's numbers.
    await asUser(3);
    const mine = await rows<{quizzes: number}>("select * from public.my_activity($1,8)", [miami]);
    assert.equal(mine.reduce((sum, w) => sum + w.quizzes, 0), 1);
    await assert.rejects(db.query("select * from public.location_summary($1)", [miami]), /Manager access required/);
    await assert.rejects(db.query("select * from public.location_activity($1)", [miami]), /Manager access required/);
    await assert.rejects(db.query("select * from public.brand_summary($1)", [brand]), /Only the owner of the brand/);
    // And someone from outside sees nothing at all.
    await asUser(4);
    await assert.rejects(db.query("select * from public.my_activity($1)", [miami]), /Not a member/);
    await assert.rejects(db.query("select public.location_stats($1)", [miami]), /permission denied/);
  } finally {
    await db.close();
  }
});
