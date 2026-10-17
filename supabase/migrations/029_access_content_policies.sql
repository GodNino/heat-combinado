-- Applied by hand in Supabase on 29 September 2026, before this repository
-- kept a record of it. Recorded here so the schema can be rebuilt from this
-- folder. Issued at the time as `027_access_content.sql`; renumbered because those numbers
-- were later taken by other migrations.

-- 027_access_content.sql
-- Repoints every write rule from "are you the owner?" to "can you manage
-- this area?". You are the owner, so nothing changes for you. Nobody holds
-- a chip yet, so nothing changes for anyone else either -- chips cannot be
-- handed out until the Team screen ships. This is safe to run today.
--
-- Every drop in this file is "drop policy", immediately followed by a
-- "create policy" of the same name. A policy is a permission rule, not data.
-- No table, column or row is removed anywhere in this file.
--
-- Run 026_access.sql before this one.
begin;

-- ---------- CONTENT LIBRARY: dishes, and their allergens ----------
drop policy "Owner adds menu" on public.menu_items;
create policy "Owner adds menu" on public.menu_items for insert to authenticated
  with check (public.can_manage(restaurant_id, 'library'));

drop policy "Owner edits menu" on public.menu_items;
create policy "Owner edits menu" on public.menu_items for update to authenticated
  using (public.can_manage(restaurant_id, 'library'))
  with check (public.can_manage(restaurant_id, 'library'));

drop policy "Owner deletes menu" on public.menu_items;
create policy "Owner deletes menu" on public.menu_items for delete to authenticated
  using (public.can_manage(restaurant_id, 'library'));

drop policy "Owner writes sections" on public.menu_sections;
create policy "Owner writes sections" on public.menu_sections for all to authenticated
  using (public.can_manage(restaurant_id, 'library'))
  with check (public.can_manage(restaurant_id, 'library'));

drop policy "Owner writes categories" on public.menu_categories;
create policy "Owner writes categories" on public.menu_categories for all to authenticated
  using (public.can_manage(restaurant_id, 'library'))
  with check (public.can_manage(restaurant_id, 'library'));

-- ---------- WORDS & GUIDES ----------
drop policy "Owner adds words" on public.glossary_terms;
create policy "Owner adds words" on public.glossary_terms for insert to authenticated
  with check (public.can_manage(restaurant_id, 'words') and created_by = (select auth.uid()));

drop policy "Owner edits words" on public.glossary_terms;
create policy "Owner edits words" on public.glossary_terms for update to authenticated
  using (public.can_manage(restaurant_id, 'words'))
  with check (public.can_manage(restaurant_id, 'words'));

drop policy "Owner deletes words" on public.glossary_terms;
create policy "Owner deletes words" on public.glossary_terms for delete to authenticated
  using (public.can_manage(restaurant_id, 'words'));

-- ---------- STANDARDS ----------
drop policy "Owner adds standards" on public.sops;
create policy "Owner adds standards" on public.sops for insert to authenticated
  with check (public.can_manage(restaurant_id, 'standards') and created_by = (select auth.uid()));

drop policy "Owner edits standards" on public.sops;
create policy "Owner edits standards" on public.sops for update to authenticated
  using (public.can_manage(restaurant_id, 'standards'))
  with check (public.can_manage(restaurant_id, 'standards'));

drop policy "Owner deletes standards" on public.sops;
create policy "Owner deletes standards" on public.sops for delete to authenticated
  using (public.can_manage(restaurant_id, 'standards'));

-- ---------- PRE-SHIFT: the note ----------
drop policy "Owner adds shift notes" on public.shift_notes;
create policy "Owner adds shift notes" on public.shift_notes for insert to authenticated
  with check (public.can_manage(restaurant_id, 'preshift') and posted_by = (select auth.uid()));

drop policy "Owner edits shift notes" on public.shift_notes;
create policy "Owner edits shift notes" on public.shift_notes for update to authenticated
  using (public.can_manage(restaurant_id, 'preshift'))
  with check (public.can_manage(restaurant_id, 'preshift') and posted_by = (select auth.uid()));

drop policy "Owner deletes shift notes" on public.shift_notes;
create policy "Owner deletes shift notes" on public.shift_notes for delete to authenticated
  using (public.can_manage(restaurant_id, 'preshift'));

-- ---------- PRE-SHIFT: the 86 board ----------
drop policy "Owner adds shift entries" on public.shift_board_entries;
create policy "Owner adds shift entries" on public.shift_board_entries for insert to authenticated
  with check (exists (select 1 from public.shift_notes n
    where n.id = shift_note_id and public.can_manage(n.restaurant_id, 'preshift')));

drop policy "Owner edits shift entries" on public.shift_board_entries;
create policy "Owner edits shift entries" on public.shift_board_entries for update to authenticated
  using (exists (select 1 from public.shift_notes n
    where n.id = shift_note_id and public.can_manage(n.restaurant_id, 'preshift')))
  with check (exists (select 1 from public.shift_notes n
    where n.id = shift_note_id and public.can_manage(n.restaurant_id, 'preshift')));

drop policy "Owner deletes shift entries" on public.shift_board_entries;
create policy "Owner deletes shift entries" on public.shift_board_entries for delete to authenticated
  using (exists (select 1 from public.shift_notes n
    where n.id = shift_note_id and public.can_manage(n.restaurant_id, 'preshift')));

-- ---------- PRE-SHIFT: the focus items ----------
drop policy "Owner adds shift focus" on public.shift_focus_items;
create policy "Owner adds shift focus" on public.shift_focus_items for insert to authenticated
  with check (exists (select 1 from public.shift_notes n
    where n.id = shift_note_id and public.can_manage(n.restaurant_id, 'preshift')));

drop policy "Owner edits shift focus" on public.shift_focus_items;
create policy "Owner edits shift focus" on public.shift_focus_items for update to authenticated
  using (exists (select 1 from public.shift_notes n
    where n.id = shift_note_id and public.can_manage(n.restaurant_id, 'preshift')))
  with check (exists (select 1 from public.shift_notes n
    where n.id = shift_note_id and public.can_manage(n.restaurant_id, 'preshift')));

drop policy "Owner deletes shift focus" on public.shift_focus_items;
create policy "Owner deletes shift focus" on public.shift_focus_items for delete to authenticated
  using (exists (select 1 from public.shift_notes n
    where n.id = shift_note_id and public.can_manage(n.restaurant_id, 'preshift')));

-- ---------- PHOTOS ----------
-- One bucket serves dish photos and guide photos, so either chip may upload.
drop policy "Managers upload restaurant photos" on storage.objects;
create policy "Managers upload restaurant photos" on storage.objects for insert to authenticated
with check (bucket_id = 'menu-photos' and exists (
  select 1 from public.restaurants r
  where r.id::text = (storage.foldername(storage.objects.name))[1]
    and (public.can_manage(r.id, 'library') or public.can_manage(r.id, 'words'))
));

drop policy "Managers clean up uploads" on storage.objects;
create policy "Managers clean up uploads" on storage.objects for delete to authenticated
using (bucket_id = 'menu-photos' and exists (
  select 1 from public.restaurants r
  where r.id::text = (storage.foldername(storage.objects.name))[1]
    and (public.can_manage(r.id, 'library') or public.can_manage(r.id, 'words'))
));

-- ---------- The posting function ----------
-- Unchanged except the first check. This function does not bypass security
-- (it runs as the signed-in person), so the line below is the friendly error
-- message, not the lock -- the real lock is the policies above.
create or replace function public.save_preshift_board(
  rid uuid, board_date date, board_note text, focus_ids uuid[], board_entries jsonb
) returns uuid
language plpgsql security invoker set search_path = '' as $$
declare board_id uuid;
begin
  if not public.can_manage(rid, 'preshift') then
    raise exception 'You do not have access to the pre-shift board.' using errcode = '42501';
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

commit;
