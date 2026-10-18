import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

// Phone notifications (039): each event reaches the right people, never the one who caused it,
// and nobody can make HEAT notify a team they don't run.
test("notifications go to the right people, and only on a manager's say-so", async () => {
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
    // 1 owner; 2 floor manager (Pre-shift); 3 and 4 servers; 5 outsider.
    for (let id = 1; id <= 5; id++) await db.query("insert into auth.users(id,email) values($1,$2)", [uid(id), `p${id}@osaka.test`]);
    const dir = new URL("../supabase/migrations/", import.meta.url);
    for (const file of (await readdir(dir)).filter(name => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(file, dir), "utf8"));
    }
    await db.exec("alter table public.menu_items add column if not exists details jsonb");
    const asUser = (id: number) => db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub','${uid(id)}',false);`);
    const audience = async (event: string, ref: string, target: string | null = null) => {
      const row = (await db.query<{restaurant_name: string; user_ids: string[]}>("select * from public.push_audience($1,$2,$3)", [event, ref, target])).rows[0];
      return {name: row.restaurant_name, people: [...row.user_ids].sort()};
    };

    await db.exec("reset role");
    const miami = (await db.query<{id: string}>("insert into public.restaurants(owner_id,name) values($1,'Osaka Miami') returning id", [uid(1)])).rows[0].id;
    for (const [user, access] of [[2, "{preshift}"], [3, "{}"], [4, "{}"]] as const) {
      await db.query("insert into public.restaurant_members(restaurant_id,user_id,access) values($1,$2,$3)", [miami, uid(user), access]);
    }
    const dish = (await db.query<{id: string}>("insert into public.menu_items(restaurant_id,name,description,ingredients) values($1,'Black Cod','Miso',array['Cod']) returning id", [miami])).rows[0].id;
    const board = (await db.query<{id: string}>("insert into public.shift_notes(restaurant_id,posted_by) values($1,$2) returning id", [miami, uid(2)])).rows[0].id;

    // A device is saved for its owner only, and turning it on again updates it.
    await asUser(3);
    await db.query("select public.save_push_subscription('https://push.example/abc','key','auth','es')");
    await db.query("select public.save_push_subscription('https://push.example/abc','key2','auth2','en')");
    assert.deepEqual((await db.query<{lang: string; p256dh: string}>("select lang,p256dh from public.push_subscriptions")).rows, [{lang: "en", p256dh: "key2"}]);
    await asUser(4);
    assert.equal((await db.query("select * from public.push_subscriptions")).rows.length, 0, "nobody sees another person's devices");

    // Pre-shift: the whole team except whoever posted it; or only the chosen recipients.
    await asUser(2);
    assert.deepEqual(await audience("preshift_posted", board), {name: "Osaka Miami", people: [uid(3), uid(4)]});
    await db.exec("reset role");
    await db.query("insert into public.shift_note_recipients(shift_note_id,user_id) values($1,$2)", [board, uid(4)]);
    await asUser(2);
    assert.deepEqual((await audience("preshift_posted", board)).people, [uid(4)]);

    // Study: only the person assigned, and only by someone who runs the team.
    await asUser(1);
    assert.deepEqual((await audience("study_assigned", miami, uid(3))).people, [uid(3)]);
    await assert.rejects(audience("study_assigned", miami, uid(5)), /Team member unavailable/);
    await asUser(2);
    await assert.rejects(audience("study_assigned", miami, uid(3)), /Not your team/, "Pre-shift access isn't Team access");

    // Urgent report: managers and owner, never the writer; only for a report that is urgent and theirs.
    const report = (await db.query<{id: string}>("select public.submit_shift_report($1,$2) as id", [miami, {mood: "rough", issues: [{kind: "injury", note: "Cut finger"}]}])).rows[0].id;
    assert.deepEqual((await audience("urgent_report", report)).people, [uid(1)]);
    await asUser(1);
    await assert.rejects(audience("urgent_report", report), /urgent report of yours/);

    // Retake request: the owner, who approves it.
    await asUser(3);
    await assert.rejects(audience("retake_requested", dish), /No request/);
    await db.query("select public.request_quiz_retake($1)", [dish]);
    assert.deepEqual((await audience("retake_requested", dish)).people, [uid(1)]);

    // An outsider and a server can't announce anything to this team.
    for (const user of [5, 3]) {
      await asUser(user);
      await assert.rejects(audience("preshift_posted", board), /Not your board/);
    }
    await assert.rejects(audience("party", board), /Unknown event/);
  } finally {
    await db.close();
  }
});
