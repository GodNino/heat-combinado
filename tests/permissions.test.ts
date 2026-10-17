import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("restaurant, invite, menu, and photo policies isolate managers and employees", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1, '/') $$;
      alter table storage.objects enable row level security;
      grant usage on schema public, auth, storage to authenticated, anon;
      grant select, insert, delete on storage.objects to authenticated;
      insert into auth.users values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003');
    `);
    await db.exec(
      await readFile(
        new URL("../supabase/migrations/001_heat.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.exec(await readFile(new URL("../supabase/migrations/002_edit_menu_items.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/003_content_categories.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/004_food_cocktails.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/007_menu_service_details.sql", import.meta.url), "utf8"));
    const asUser = async (id: number) => {
      await db.exec(
        `reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-${String(id).padStart(12, "0")}', false);`,
      );
    };
    const count = async (table: string) =>
      (await db.query<{ count: number }>(`select count(*)::int from ${table}`))
        .rows[0].count;
    await asUser(1);
    const {
      rows: [restaurant],
    } = await db.query<{ id: string }>(
      "insert into public.restaurants(name) values ('HEAT Kitchen') returning id",
    );
    const rid = restaurant.id;
    assert.equal(
      await count("public.restaurants"),
      1,
      "manager sees own restaurant",
    );
    await assert.rejects(
      db.query(
        "insert into public.restaurants(name,owner_id) values ('Forged', '00000000-0000-0000-0000-000000000002')",
      ),
      /row-level security/,
    );
    await db.query(
      "insert into storage.objects(bucket_id,name) values ('menu-photos', $1)",
      [`${rid}/dish.jpg`],
    );
    await db.query(
      "insert into public.menu_items(restaurant_id,name,description,ingredients,allergens,photo_path) values ($1,'Salmon','Citrus salmon',array['Salmon'],array['Fish'],$2)",
      [rid, `${rid}/dish.jpg`],
    );
    const before = (await db.query<{updated_at: string}>("select updated_at::text from public.menu_items")).rows[0].updated_at;
    const updated = await db.query("update public.menu_items set description = 'Updated description' where updated_at = $1::timestamptz returning id", [before]);
    assert.equal(updated.rows.length, 1, "manager can edit own dish");
    const stale = await db.query("update public.menu_items set description = 'Stale overwrite' where updated_at = $1::timestamptz returning id", [before]);
    assert.equal(stale.rows.length, 0, "stale edits cannot overwrite newer data");
    await db.query("update public.menu_items set price=32,fire_minutes=10");
    await assert.rejects(db.query("update public.menu_items set price=-1"), /check constraint/);
    await assert.rejects(db.query("update public.menu_items set fire_minutes=0"), /check constraint/);
    await assert.rejects(db.query("update public.menu_items set restaurant_id = gen_random_uuid()"), /permission denied/);
    assert.equal((await db.query<{category: string}>("update public.menu_items set category = 'Ceviches' returning category")).rows[0].category, "Ceviches");
    await assert.rejects(db.query("update public.menu_items set category = 'Invalid'"), /check constraint/);
    assert.equal((await db.query<{content_type: string}>("update public.menu_items set content_type = 'cocktails', category = 'Pisco Experience' returning content_type")).rows[0].content_type, "cocktails");
    await db.query("update public.menu_items set content_type = 'food', category = 'Ceviches'");
    const token = (
      await db.query<{ token: string }>(
        "select public.create_employee_invite($1) as token",
        [rid],
      )
    ).rows[0].token;
    await asUser(2);
    assert.equal(await count("public.restaurants"), 0);
    assert.equal(await count("public.menu_items"), 0);
    assert.equal(await count("storage.objects"), 0);
    await assert.rejects(
      db.query("select public.create_employee_invite($1)", [rid]),
      /Only the restaurant manager/,
    );
    await assert.rejects(
      db.query("insert into public.restaurant_members values ($1,auth.uid())", [
        rid,
      ]),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select * from public.restaurant_invites"),
      /permission denied/,
    );
    await db.query("select public.join_restaurant($1)", [token]);
    await db.query("select public.join_restaurant($1)", [token]);
    assert.equal(
      await count("public.restaurant_members"),
      1,
      "join is idempotent",
    );
    assert.equal(await count("public.restaurants"), 1);
    assert.equal(await count("public.menu_items"), 1);
    assert.equal(await count("storage.objects"), 1);
    assert.equal((await db.query("update public.menu_items set price=1,fire_minutes=1 returning id")).rows.length,0,"employees cannot change service details");
    await assert.rejects(
      db.query(
        "insert into public.menu_items(restaurant_id,name,description,ingredients,photo_path) values ($1,'Bad','Bad',array['x'],$2)",
        [rid, `${rid}/bad.jpg`],
      ),
      /row-level security/,
    );
    await assert.rejects(
      db.query(
        "insert into storage.objects(bucket_id,name) values ('menu-photos',$1)",
        [`${rid}/bad.jpg`],
      ),
      /row-level security/,
    );
    assert.equal((await db.query("update public.menu_items set category = 'Nigiris' returning id")).rows.length, 0, "employee cannot change categories");
    assert.equal((await db.query<{category: string}>("select category from public.menu_items")).rows[0].category, "Ceviches");
    assert.equal((await db.query("update public.menu_items set content_type = 'cocktails' returning id")).rows.length, 0, "employee cannot move content between libraries");
    const employeeEdit = await db.query("update public.menu_items set description = 'Unauthorized edit' returning id");
    assert.equal(employeeEdit.rows.length, 0, "employee cannot edit dish");
    assert.equal((await db.query<{description: string}>("select description from public.menu_items")).rows[0].description, "Updated description");
    await db.query("delete from storage.objects where name = $1", [
      `${rid}/dish.jpg`,
    ]);
    assert.equal(
      await count("storage.objects"),
      1,
      "employee cannot delete photo",
    );
    await asUser(1);
    const newToken = (
      await db.query<{ token: string }>(
        "select public.create_employee_invite($1) as token",
        [rid],
      )
    ).rows[0].token;
    await asUser(3);
    await assert.rejects(
      db.query("select public.join_restaurant($1)", [token]),
      /invalid or expired/,
    );
    assert.equal(
      await count("public.menu_items"),
      0,
      "unrelated restaurant user cannot read menu",
    );
    await db.exec("reset role");
    await db.query(
      "update public.restaurant_invites set expires_at = now() - interval '1 second' where token = $1",
      [newToken],
    );
    await asUser(3);
    await assert.rejects(
      db.query("select public.join_restaurant($1)", [newToken]),
      /invalid or expired/,
    );
    await db.exec("reset role; set role anon;");
    await assert.rejects(
      db.query("select * from public.menu_items"),
      /permission denied/,
    );
    await assert.rejects(
      db.query("select public.join_restaurant($1)", [newToken]),
      /permission denied/,
    );
  } finally {
    await db.close();
  }
});
