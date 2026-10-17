import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

test("pre-shift boards isolate restaurants, enforce constraints, and post atomically", async () => {
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
    await db.exec(await readFile(new URL("../supabase/migrations/001_heat.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/011_preshift_board.sql", import.meta.url), "utf8"));
    const asUser = async (id: number) => {
      await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-${String(id).padStart(12, "0")}', false);`);
    };
    const count = async (table: string) => (await db.query<{count: number}>(`select count(*)::int from ${table}`)).rows[0].count;
    const restaurant = async (name: string) => (await db.query<{id: string}>("insert into public.restaurants(name) values ($1) returning id", [name])).rows[0].id;
    const dish = async (rid: string) => (await db.query<{id: string}>("insert into public.menu_items(restaurant_id,name,description,ingredients,photo_path) values ($1,'Salmon','Citrus salmon',array['Salmon'],$2) returning id", [rid, `${rid}/dish.jpg`])).rows[0].id;
    await asUser(1);
    const rid = await restaurant("HEAT Kitchen"), item = await dish(rid);
    const otherOwned = await restaurant("Owner's second restaurant"), otherOwnedItem = await dish(otherOwned);
    const token = (await db.query<{token: string}>("select public.create_employee_invite($1) as token", [rid])).rows[0].token;
    await asUser(3);
    const foreignRid = await restaurant("Other restaurant"), foreignItem = await dish(foreignRid);
    const foreignBoard = (await db.query<{id: string}>("insert into public.shift_notes(restaurant_id,posted_by) values($1,auth.uid()) returning id", [foreignRid])).rows[0].id;
    await asUser(1);
    const board = (await db.query<{id: string}>("insert into public.shift_notes(restaurant_id,note,focus_item_id,posted_by) values($1,'Tonight', $2, auth.uid()) returning id", [rid,item])).rows[0].id;
    assert.equal((await db.query("update public.shift_notes set note='Updated' where id=$1 returning id", [board])).rows.length, 1);
    await db.query("insert into public.shift_board_entries(shift_note_id,menu_item_id,status,detail) values($1,$2,'low','Only two left')", [board,item]);
    assert.equal((await db.query("update public.shift_board_entries set status='86' where shift_note_id=$1 returning id", [board])).rows.length, 1);
    await assert.rejects(db.query("insert into public.shift_notes(restaurant_id,posted_by) values($1,auth.uid())", [rid]), /unique constraint/);
    await assert.rejects(db.query("update public.shift_board_entries set status='invalid' where shift_note_id=$1", [board]), /check constraint/);
    await assert.rejects(db.query("insert into public.shift_board_entries(shift_note_id,menu_item_id,status) values($1,$2,'new')", [board,item]), /unique constraint/);
    await assert.rejects(db.query("update public.shift_notes set note=repeat('x',2001) where id=$1", [board]), /check constraint/);
    await assert.rejects(db.query("update public.shift_board_entries set detail=repeat('x',201) where shift_note_id=$1", [board]), /check constraint/);
    for (const otherItem of [foreignItem, otherOwnedItem]) {
      await assert.rejects(db.query("update public.shift_notes set focus_item_id=$1 where id=$2", [otherItem,board]), /focus item must belong/);
      await assert.rejects(db.query("insert into public.shift_board_entries(shift_note_id,menu_item_id,status) values($1,$2,'low')", [board,otherItem]), /menu item must belong/);
      await assert.rejects(db.query("update public.shift_board_entries set menu_item_id=$1 where shift_note_id=$2", [otherItem,board]), /menu item must belong/);
    }
    await assert.rejects(db.query("update public.shift_notes set restaurant_id=$1 where id=$2", [otherOwned,board]), /cannot move/);
    await assert.rejects(db.query("update public.shift_notes set posted_by='00000000-0000-0000-0000-000000000002' where id=$1", [board]), /row-level security/);

    await asUser(2);
    await db.query("select public.join_restaurant($1)", [token]);
    assert.equal(await count("public.shift_notes"),1,"employee sees only their board");
    assert.equal(await count("public.shift_board_entries"),1,"employee can read entries");
    await assert.rejects(db.query("insert into public.shift_notes(restaurant_id,service_date,posted_by) values($1,current_date+1,auth.uid())", [rid]), /row-level security/);
    await assert.rejects(db.query("insert into public.shift_board_entries(shift_note_id,menu_item_id,status) values($1,$2,'low')", [board,item]), /row-level security/);
    assert.equal((await db.query("update public.shift_notes set note='Employee edit' where id=$1 returning id", [board])).rows.length,0);
    assert.equal((await db.query("delete from public.shift_notes where id=$1 returning id", [board])).rows.length,0);
    assert.equal((await db.query("update public.shift_board_entries set status='new' where shift_note_id=$1 returning id", [board])).rows.length,0);
    assert.equal((await db.query("delete from public.shift_board_entries where shift_note_id=$1 returning id", [board])).rows.length,0);
    await assert.rejects(db.query("select public.post_preshift_board($1,current_date,'Forged',null,'[]')", [rid]), /Only the restaurant manager/);

    await asUser(3);
    assert.equal((await db.query("select * from public.shift_notes where id=$1", [board])).rows.length,0);
    assert.equal((await db.query("select * from public.shift_board_entries where shift_note_id=$1", [board])).rows.length,0);
    await assert.rejects(db.query("insert into public.shift_notes(restaurant_id,service_date,posted_by) values($1,current_date+1,auth.uid())", [rid]), /row-level security/);
    await assert.rejects(db.query("insert into public.shift_board_entries(shift_note_id,menu_item_id,status) values($1,$2,'low')", [board,foreignItem]), /menu item must belong|row-level security/);
    assert.equal((await db.query("update public.shift_notes set note='Other restaurant' where id=$1 returning id", [board])).rows.length,0);
    assert.equal((await db.query("delete from public.shift_notes where id=$1 returning id", [board])).rows.length,0);
    assert.equal((await db.query("update public.shift_board_entries set status='new' where shift_note_id=$1 returning id", [board])).rows.length,0);
    assert.equal((await db.query("delete from public.shift_board_entries where shift_note_id=$1 returning id", [board])).rows.length,0);
    await assert.rejects(db.query("select public.post_preshift_board($1,current_date,'Forged',null,'[]')", [rid]), /Only the restaurant manager/);
    const hidden = (await db.query<{data:{board:unknown}}>("select public.get_preshift_board($1) as data", [rid])).rows[0].data;
    assert.equal(hidden.board,null);

    await asUser(1);
    await assert.rejects(db.query("update public.shift_board_entries set shift_note_id=$1 where shift_note_id=$2", [foreignBoard,board]), /menu item must belong|row-level security/);
    const post = async (note: string, entries: unknown[]) => db.query<{id: string}>("select public.post_preshift_board($1,current_date,$2,$3,$4::jsonb) as id", [rid,note,item,JSON.stringify(entries)]);
    assert.equal((await post("Service ready",[{menu_item_id:item,status:"change",detail:"New garnish"}])).rows[0].id,board,"posting upserts the same board");
    await assert.rejects(post("Must roll back",[{menu_item_id:item,status:"bad",detail:"Invalid"}]), /check constraint/);
    assert.equal((await db.query<{note:string}>("select note from public.shift_notes where id=$1", [board])).rows[0].note,"Service ready","failed entry does not replace note");
    assert.equal((await db.query<{status:string}>("select status from public.shift_board_entries where shift_note_id=$1", [board])).rows[0].status,"change","failed entry does not delete existing entries");
    await assert.rejects(post("Must roll back",[{menu_item_id:foreignItem,status:"86",detail:""}]), /menu item must belong/);
    await assert.rejects(db.query("select public.post_preshift_board($1,current_date-1,'Yesterday',null,'[]')", [rid]), /service day has changed/);
    await post("No shortages",[]);
    assert.equal(await count("public.shift_board_entries"),0,"empty list removes previous entries");
    await post("Ready",[{menu_item_id:item,status:"new",detail:"Try tonight"}]);
    await asUser(2);
    const response = (await db.query<{data:{service_date:string;board:{note:string;entries:{status:string}[]}}}>("select public.get_preshift_board($1) as data",[rid])).rows[0].data;
    assert.equal(response.board.note,"Ready");assert.equal(response.board.entries[0].status,"new");
    await asUser(1);
    assert.equal((await db.query("delete from public.shift_board_entries where shift_note_id=$1 returning id",[board])).rows.length,1);
    assert.equal((await db.query("delete from public.shift_notes where id=$1 returning id",[board])).rows.length,1);
    await db.query("insert into public.shift_notes(restaurant_id,service_date,note,posted_by) values($1,current_date-1,'Yesterday',auth.uid())",[rid]);
    assert.equal((await db.query<{data:{board:unknown}}>("select public.get_preshift_board($1) as data",[rid])).rows[0].data.board,null,"yesterday's board is not shown today");
    await post("Cascade",[{menu_item_id:item,status:"86",detail:""}]);
    await db.query("delete from public.shift_notes where restaurant_id=$1",[rid]);
    assert.equal(await count("public.shift_board_entries"),0,"deleting a board removes its entries");
    await db.exec("reset role; set role anon;");
    for (const table of ["public.shift_notes","public.shift_board_entries"]) await assert.rejects(db.query(`select * from ${table}`), /permission denied/);
    await assert.rejects(db.query("select public.get_preshift_board($1)",[rid]), /permission denied/);
    await assert.rejects(db.query("select public.post_preshift_board($1,current_date,'',null,'[]')",[rid]), /permission denied/);
  } finally {await db.close();}
});


test("pre-shift recipients restrict boards and entries while empty means everyone", async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated;
      create schema auth; create schema storage;
      create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb default '{}'::jsonb);
      create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
      create table storage.objects (id uuid default gen_random_uuid(), bucket_id text, name text);
      create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1, '/') $$;
      alter table storage.objects enable row level security;
      grant usage on schema public, auth, storage to authenticated, anon;
      grant select, insert, delete on storage.objects to authenticated;
      insert into auth.users(id) values ('00000000-0000-0000-0000-000000000001'), ('00000000-0000-0000-0000-000000000002'), ('00000000-0000-0000-0000-000000000003'), ('00000000-0000-0000-0000-000000000004');
      update auth.users set email=id::text || '@example.com';
      update auth.users set raw_user_meta_data='{"display_name":"Ana"}'::jsonb where id='00000000-0000-0000-0000-000000000002';
    `);
    await db.exec(await readFile(new URL("../supabase/migrations/001_heat.sql", import.meta.url), "utf8"));
    await db.exec(await readFile(new URL("../supabase/migrations/011_preshift_board.sql", import.meta.url), "utf8"));
    const policies = "select * from pg_policies where policyname not in ('Members read shift notes','Members read shift entries') order by schemaname,tablename,policyname";
    const before = (await db.query(policies)).rows;
    await db.exec(await readFile(new URL("../supabase/migrations/014_preshift_recipients.sql", import.meta.url), "utf8"));
    assert.deepEqual((await db.query(policies)).rows,before,"all other policies stay unchanged");
    const uid = (id: number) => `00000000-0000-0000-0000-${String(id).padStart(12,"0")}`;
    const asUser = async (id: number) => {
      await db.exec(`reset role; set role authenticated; select set_config('request.jwt.claim.sub', '${uid(id)}', false);`);
    };
    await asUser(1);
    const rid = (await db.query<{id:string}>("insert into public.restaurants(name) values('Kitchen') returning id")).rows[0].id;
    const item = (await db.query<{id:string}>("insert into public.menu_items(restaurant_id,name,description,ingredients,photo_path) values($1,'Fish','Citrus',array['Fish'],$2) returning id",[rid,`${rid}/fish.jpg`])).rows[0].id;
    const board = (await db.query<{id:string}>("select public.post_preshift_board($1,current_date,'Tonight',null,$2::jsonb) as id",[rid,JSON.stringify([{menu_item_id:item,status:'86',detail:'Sold out'}])])).rows[0].id;
    const token = (await db.query<{token:string}>("select public.create_employee_invite($1) as token",[rid])).rows[0].token;
    for (const id of [2,4]) {await asUser(id);await db.query("select public.join_restaurant($1)",[token]);}
    await asUser(3);
    await db.query("insert into public.restaurants(name) values('Elsewhere')");
    const visible = async (expected: number) => {
      assert.equal((await db.query("select * from public.shift_notes where id=$1",[board])).rows.length,expected);
      assert.equal((await db.query("select * from public.shift_board_entries where shift_note_id=$1",[board])).rows.length,expected);
      const data = (await db.query<{data:{board:unknown}}>("select public.get_preshift_board($1) as data",[rid])).rows[0].data;
      assert.equal(data.board !== null,expected === 1,"employee query hides unassigned boards without an error");
      assert.equal((await db.query<{ok:boolean}>("select public.can_read_shift_note($1) as ok",[board])).rows[0].ok,expected === 1);
    };
    for(const id of [1,2,4]) {await asUser(id);await visible(1);}
    await asUser(3);await visible(0);
    for(const id of [2,3,4]) {
      await asUser(id);
      await assert.rejects(db.query("select public.set_shift_recipients($1,$2::uuid[])",[board,[uid(2)]]),/Manager access required/);
      await assert.rejects(db.query("select * from public.shift_team_options($1)",[rid]),/Manager access required/);
      await assert.rejects(db.query("select * from public.shift_recipients($1)",[board]),/Manager access required/);
      await assert.rejects(db.query("select * from public.shift_note_recipients"),/permission denied/);
    }
    await asUser(1);
    const options = (await db.query<{user_id:string;name:string}>("select * from public.shift_team_options($1)",[rid])).rows;
    assert.deepEqual(options.map(p=>p.user_id).sort(),[uid(1),uid(2),uid(4)]);
    assert.equal(options.find(p=>p.user_id===uid(2))?.name,'Ana');
    await db.query("select public.set_shift_recipients($1,$2::uuid[])",[board,[uid(2),uid(2)]]);
    assert.equal((await db.query("select * from public.shift_recipients($1)",[board])).rows.length,1,"duplicates deduplicated");
    for(const id of [1,2]) {await asUser(id);await visible(1);}
    for(const id of [3,4]) {await asUser(id);await visible(0);}
    await asUser(4);
    assert.equal((await db.query("update public.shift_notes set note='No' where id=$1 returning id",[board])).rows.length,0);
    assert.equal((await db.query("delete from public.shift_board_entries where shift_note_id=$1 returning id",[board])).rows.length,0);
    await asUser(1);
    for(const bad of [[uid(3)],[uid(2),null]]) await assert.rejects(db.query("select public.set_shift_recipients($1,$2::uuid[])",[board,bad]),/That person is not on this team/);
    assert.deepEqual((await db.query<{user_id:string}>("select user_id from public.shift_recipients($1)",[board])).rows.map(r=>r.user_id),[uid(2)],"failed replacement retains previous audience");
    await db.query("select public.set_shift_recipients($1,$2::uuid[])",[board,[uid(1)]]);
    await visible(1);
    await db.query("select public.set_shift_recipients($1,'{}'::uuid[])",[board]);
    assert.equal((await db.query("select * from public.shift_recipients($1)",[board])).rows.length,0);
    for(const id of [1,2,4]) {await asUser(id);await visible(1);}
    await asUser(3);await visible(0);
    assert.equal((await db.query<{ok:boolean}>("select public.can_read_shift_note(gen_random_uuid()) as ok")).rows[0].ok,false);
    await db.exec("reset role; set role anon;");
    await assert.rejects(db.query("select public.can_read_shift_note($1)",[board]),/permission denied/);
    await assert.rejects(db.query("select * from public.shift_note_recipients"),/permission denied/);
  } finally {await db.close();}
});
