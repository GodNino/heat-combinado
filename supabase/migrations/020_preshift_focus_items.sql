-- Run once in the Supabase SQL editor BEFORE the app files that post more than one focus item.
-- Additive only: nothing is dropped or removed. The old single-focus column and the old
-- posting function both stay exactly as they are, so the app can be rolled back at any time.
begin;

create table public.shift_focus_items (
  shift_note_id uuid not null references public.shift_notes(id) on delete cascade,
  menu_item_id uuid not null references public.menu_items(id) on delete cascade,
  sort_order smallint not null check (sort_order between 1 and 10),
  primary key (shift_note_id, menu_item_id)
);
create index on public.shift_focus_items(menu_item_id);
alter table public.shift_focus_items enable row level security;

create policy "Members read shift focus" on public.shift_focus_items for select to authenticated
using (exists (select 1 from public.shift_notes n where n.id = shift_note_id and public.can_read_restaurant(n.restaurant_id)));
create policy "Owner adds shift focus" on public.shift_focus_items for insert to authenticated
with check (exists (select 1 from public.shift_notes n where n.id = shift_note_id and public.is_restaurant_owner(n.restaurant_id)));
create policy "Owner edits shift focus" on public.shift_focus_items for update to authenticated
using (exists (select 1 from public.shift_notes n where n.id = shift_note_id and public.is_restaurant_owner(n.restaurant_id)))
with check (exists (select 1 from public.shift_notes n where n.id = shift_note_id and public.is_restaurant_owner(n.restaurant_id)));
create policy "Owner deletes shift focus" on public.shift_focus_items for delete to authenticated
using (exists (select 1 from public.shift_notes n where n.id = shift_note_id and public.is_restaurant_owner(n.restaurant_id)));

revoke all on public.shift_focus_items from public, anon, authenticated;
grant select, insert, update, delete on public.shift_focus_items to authenticated;

-- Same guard the 86 board rows already have: a focus item must belong to this restaurant.
create function public.check_shift_focus_item() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (
    select 1 from public.shift_notes n join public.menu_items m on m.restaurant_id = n.restaurant_id
    where n.id = new.shift_note_id and m.id = new.menu_item_id
  ) then
    raise exception 'A focus item must belong to the board restaurant.' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger check_shift_focus_item before insert or update on public.shift_focus_items
for each row execute function public.check_shift_focus_item();
revoke all on function public.check_shift_focus_item() from public, anon, authenticated;

-- Carry every focus item already posted into the new list, so no board loses its dish.
insert into public.shift_focus_items(shift_note_id, menu_item_id, sort_order)
select n.id, n.focus_item_id, 1 from public.shift_notes n where n.focus_item_id is not null
on conflict do nothing;

-- The read snapshot now carries the whole list. Same name and arguments, so this updates
-- the existing function in place rather than removing anything.
create or replace function public.get_preshift_board(rid uuid) returns jsonb
language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object(
    'service_date', current_date,
    'board', (select to_jsonb(n) || jsonb_build_object(
      'focus_item_ids', (
        select coalesce(jsonb_agg(f.menu_item_id order by f.sort_order, f.menu_item_id), '[]'::jsonb)
        from public.shift_focus_items f where f.shift_note_id = n.id
      ),
      'entries', (
        select coalesce(jsonb_agg(to_jsonb(e) order by e.created_at, e.id), '[]'::jsonb)
        from public.shift_board_entries e where e.shift_note_id = n.id
      )
    ) from public.shift_notes n where n.restaurant_id = rid and n.service_date = current_date)
  );
$$;

-- Posting a board with a list of focus items. New name, so the old posting function is
-- untouched and still works if the app is rolled back.
-- One transaction: a failed row rolls back the note, the focus list and the 86 board together.
-- This is NOT a security-definer function; every write is subject to RLS.
create function public.save_preshift_board(
  rid uuid, board_date date, board_note text, focus_ids uuid[], board_entries jsonb
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
  if coalesce(array_length(focus_ids, 1), 0) > 10 then
    raise exception 'A board can hold up to 10 focus items.' using errcode = '23514';
  end if;

  -- The first focus item also fills the old single-focus column, so anything still
  -- reading that column keeps showing a sensible answer.
  insert into public.shift_notes(restaurant_id, service_date, note, focus_item_id, posted_by)
  values(rid, current_date, board_note, focus_ids[1], auth.uid())
  on conflict (restaurant_id, service_date) do update
  set note = excluded.note, focus_item_id = excluded.focus_item_id, posted_by = excluded.posted_by
  returning id into board_id;

  delete from public.shift_focus_items where shift_note_id = board_id;
  insert into public.shift_focus_items(shift_note_id, menu_item_id, sort_order)
  select board_id, f.id, min(f.ord)::smallint
  from unnest(focus_ids) with ordinality as f(id, ord)
  where f.id is not null
  group by f.id;

  delete from public.shift_board_entries where shift_note_id = board_id;
  insert into public.shift_board_entries(shift_note_id, menu_item_id, status, detail)
  select board_id, e.menu_item_id, e.status, coalesce(e.detail, '')
  from jsonb_to_recordset(board_entries) as e(menu_item_id uuid, status text, detail text);
  return board_id;
end;
$$;
revoke all on function public.save_preshift_board(uuid,date,text,uuid[],jsonb) from public, anon;
grant execute on function public.save_preshift_board(uuid,date,text,uuid[],jsonb) to authenticated;
commit;
