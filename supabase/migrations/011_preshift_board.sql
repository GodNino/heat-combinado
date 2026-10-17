-- Run once in the Supabase SQL editor BEFORE uploading the Pre-shift app files.
-- Additive only: existing tables, functions and policies are unchanged.
begin;

create table public.shift_notes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  service_date date not null default current_date,
  note text not null default '' check (char_length(note) <= 2000),
  focus_item_id uuid references public.menu_items(id) on delete set null,
  posted_by uuid not null references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, service_date)
);
create table public.shift_board_entries (
  id uuid primary key default gen_random_uuid(),
  shift_note_id uuid not null references public.shift_notes(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  status text not null check (status in ('86', 'low', 'change', 'new')),
  detail text not null default '' check (char_length(detail) <= 200),
  created_at timestamptz not null default now(),
  unique (shift_note_id, menu_item_id)
);
create index on public.shift_board_entries(menu_item_id);
create index on public.shift_notes(focus_item_id);
alter table public.shift_notes enable row level security;
alter table public.shift_board_entries enable row level security;

create policy "Members read shift notes" on public.shift_notes for select to authenticated
using (public.can_read_restaurant(restaurant_id));
create policy "Owner adds shift notes" on public.shift_notes for insert to authenticated
with check (public.is_restaurant_owner(restaurant_id) and posted_by = (select auth.uid()));
create policy "Owner edits shift notes" on public.shift_notes for update to authenticated
using (public.is_restaurant_owner(restaurant_id))
with check (public.is_restaurant_owner(restaurant_id) and posted_by = (select auth.uid()));
create policy "Owner deletes shift notes" on public.shift_notes for delete to authenticated
using (public.is_restaurant_owner(restaurant_id));

create policy "Members read shift entries" on public.shift_board_entries for select to authenticated
using (exists (select 1 from public.shift_notes n where n.id = shift_note_id and public.can_read_restaurant(n.restaurant_id)));
create policy "Owner adds shift entries" on public.shift_board_entries for insert to authenticated
with check (exists (select 1 from public.shift_notes n where n.id = shift_note_id and public.is_restaurant_owner(n.restaurant_id)));
create policy "Owner edits shift entries" on public.shift_board_entries for update to authenticated
using (exists (select 1 from public.shift_notes n where n.id = shift_note_id and public.is_restaurant_owner(n.restaurant_id)))
with check (exists (select 1 from public.shift_notes n where n.id = shift_note_id and public.is_restaurant_owner(n.restaurant_id)));
create policy "Owner deletes shift entries" on public.shift_board_entries for delete to authenticated
using (exists (select 1 from public.shift_notes n where n.id = shift_note_id and public.is_restaurant_owner(n.restaurant_id)));

revoke all on public.shift_notes, public.shift_board_entries from public, anon, authenticated;
grant select, insert, update, delete on public.shift_notes, public.shift_board_entries to authenticated;

-- Cross-table constraints use triggers on the NEW tables only.
-- Invoker rights preserve RLS; a hidden item cannot pass these checks.
create function public.check_shift_note() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.restaurant_id is distinct from old.restaurant_id then
    raise exception 'A board cannot move to another restaurant.' using errcode = '23514';
  end if;
  if new.focus_item_id is not null and not exists (
    select 1 from public.menu_items m where m.id = new.focus_item_id and m.restaurant_id = new.restaurant_id
  ) then
    raise exception 'The focus item must belong to the board restaurant.' using errcode = '23514';
  end if;
  new.updated_at := clock_timestamp();
  return new;
end;
$$;
create trigger check_shift_note before insert or update on public.shift_notes
for each row execute function public.check_shift_note();

create function public.check_shift_board_entry() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.shift_notes n join public.menu_items m on m.restaurant_id = n.restaurant_id
    where n.id = new.shift_note_id and m.id = new.menu_item_id
  ) then
    raise exception 'The menu item must belong to the board restaurant.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger check_shift_board_entry before insert or update on public.shift_board_entries
for each row execute function public.check_shift_board_entry();
revoke all on function public.check_shift_note(), public.check_shift_board_entry() from public, anon, authenticated;

-- One read snapshot, with the database's current_date used on both screens.
create function public.get_preshift_board(rid uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'service_date', current_date,
    'board', (select to_jsonb(n) || jsonb_build_object('entries', (
      select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at, e.id), '[]'::jsonb)
      from public.shift_board_entries e where e.shift_note_id = n.id
    )) from public.shift_notes n where n.restaurant_id = rid and n.service_date = current_date)
  );
$$;

-- One transaction: a failed entry rolls back the note and all entry changes.
-- This is NOT a security-definer function; every write is subject to RLS.
create function public.post_preshift_board(
  rid uuid, board_date date, board_note text, focus_id uuid, board_entries jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare board_id uuid;
begin
  if not public.is_restaurant_owner(rid) then
    raise exception 'Only the restaurant manager can post a pre-shift board.' using errcode = '42501';
  end if;
  if board_date is distinct from current_date then
    raise exception 'The service day has changed. Reload today''s board before posting.';
  end if;
  if board_entries is null or jsonb_typeof(board_entries) <> 'array' then
    raise exception 'Board entries must be a list.' using errcode = '23514';
  end if;
  insert into public.shift_notes(restaurant_id, service_date, note, focus_item_id, posted_by)
  values(rid, current_date, board_note, focus_id, auth.uid())
  on conflict (restaurant_id, service_date) do update
  set note = excluded.note, focus_item_id = excluded.focus_item_id, posted_by = excluded.posted_by
  returning id into board_id;

  delete from public.shift_board_entries where shift_note_id = board_id;
  insert into public.shift_board_entries(shift_note_id, menu_item_id, status, detail)
  select board_id, e.menu_item_id, e.status, coalesce(e.detail, '')
  from jsonb_to_recordset(board_entries) as e(menu_item_id uuid, status text, detail text);
  return board_id;
end;
$$;
revoke all on function public.get_preshift_board(uuid), public.post_preshift_board(uuid,date,text,uuid,jsonb) from public, anon;
grant execute on function public.get_preshift_board(uuid), public.post_preshift_board(uuid,date,text,uuid,jsonb) to authenticated;
commit;
