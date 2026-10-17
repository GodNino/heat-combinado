-- Run once in the Supabase SQL editor. Step 1 of letting managers choose the fields on each card.
--
-- After this, every restaurant can keep its own settings for the extra fields on its Food, Cocktail
-- and Wine & Sake cards: hide a field the app ships with, add fields of its own, and delete a field
-- it made. Nothing on screen changes until the app files are updated, and nothing here touches a
-- dish, a photo, a quiz, a score, a word or a team member. No existing row is changed or removed.
--
-- How it works, in plain words:
--   * A restaurant with no rows here sees exactly the fields it sees today. A row only exists
--     once a manager changes something, so a brand-new restaurant needs no setup.
--   * What staff typed into a field stays on each dish (menu_items.details), under the field's
--     key. Hiding a field never touches it, so "Show again" brings every answer back.
--   * Fields the app ships with ("custom" = false) can be hidden or shown, never deleted: the
--     quiz builder reads some of them (method, glassware, region, producer).
--   * Fields a manager makes ("custom" = true) get a key that starts with "x_", so they can never
--     collide with a built-in one. The key is what is stored, so renaming a label never loses data.
--   * Deleting is only possible for a custom field that is already hidden, and it goes through
--     delete_card_field() below, which erases the field and its answers together or not at all.
begin;

create table public.card_fields (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  content_type text not null check (content_type in ('food','cocktails','wine')),
  field_key text not null check (field_key ~ '^[a-z][a-z0-9_]{0,39}$'),
  custom boolean not null default false,
  label text check (label is null or char_length(btrim(label)) between 1 and 40),
  kind text not null default 'line' check (kind in ('line','text')),
  hidden boolean not null default false,
  on_card boolean not null default true,
  show_team boolean not null default true,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, content_type, field_key),
  -- a field a manager made needs a name and an "x_" key; one the app ships with has neither
  check (custom = (field_key like 'x\_%')),
  check (not custom or label is not null)
);

alter table public.card_fields enable row level security;

create policy "Members read card fields" on public.card_fields for select to authenticated
  using (public.can_read_restaurant(restaurant_id));
create policy "Managers write card fields" on public.card_fields for all to authenticated
  using (public.can_manage(restaurant_id, 'library'))
  with check (public.can_manage(restaurant_id, 'library'));

revoke all on public.card_fields from public, anon, authenticated;
grant select, insert, update, delete on public.card_fields to authenticated;

-- Deleting a field you made, for good: the field and its answers on every dish, together.
-- Runs as the signed-in person, so the policies above still apply; the first check is the
-- friendly error message, not the lock. Returns how many dishes had an answer erased.
create or replace function public.delete_card_field(rid uuid, ctype text, fkey text)
returns integer
language plpgsql security invoker set search_path = '' as $$
declare cleaned integer;
begin
  if not public.can_manage(rid, 'library') then
    raise exception 'You do not have access to the content library.' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.card_fields f
    where f.restaurant_id = rid and f.content_type = ctype and f.field_key = fkey
      and f.custom and f.hidden
  ) then
    raise exception 'Only a hidden field you created can be deleted.' using errcode = '23514';
  end if;

  update public.menu_items m
  set details = m.details - fkey
  where m.restaurant_id = rid and m.content_type = ctype and m.details ? fkey;
  get diagnostics cleaned = row_count;

  delete from public.card_fields f
  where f.restaurant_id = rid and f.content_type = ctype and f.field_key = fkey;

  return cleaned;
end;
$$;

revoke all on function public.delete_card_field(uuid, text, text) from public, anon;
grant execute on function public.delete_card_field(uuid, text, text) to authenticated;

commit;
