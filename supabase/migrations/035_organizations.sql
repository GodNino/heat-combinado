-- Run once, after 034. Groups restaurants under a brand: one organization (Osaka) with
-- several locations (Miami, Chicago...). Each location keeps its own menu, team and pre-shift.
--
-- What changes:
--   * a new organizations table, and restaurants.organization_id (empty for every existing restaurant);
--   * is_restaurant_owner() also answers yes for the organization's owner, so the brand's owner can run
--     every location without being added to each one. Every existing rule that asks "is this the owner?"
--     keeps asking exactly that; nothing changes for a restaurant that is not in an organization;
--   * functions to start an organization, add a restaurant to it, open a new location in it, and
--     copy chosen dishes from one location to another.
--
-- Nothing is dropped. No menu item, member, score or photo is changed by running this file.
begin;

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  name text not null check (char_length(btrim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
alter table public.organizations enable row level security;
revoke all on public.organizations from anon, authenticated;
grant select on public.organizations to authenticated;

alter table public.restaurants
  add column if not exists organization_id uuid references public.organizations(id) on delete set null;
create index if not exists restaurants_organization on public.restaurants (organization_id);

-- The owner of a restaurant, or the owner of the organization it belongs to.
create or replace function public.is_restaurant_owner(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(
    select 1 from public.restaurants r
    left join public.organizations o on o.id = r.organization_id
    where r.id = rid and (r.owner_id = (select auth.uid()) or o.owner_id = (select auth.uid()))
  );
$$;

-- The brand's name is visible to its owner and to anyone who can open one of its locations.
create policy "Members read their organization" on public.organizations for select to authenticated
using (owner_id = (select auth.uid()) or exists (
  select 1 from public.restaurants r where r.organization_id = organizations.id and public.can_read_restaurant(r.id)
));

create or replace function public.is_anonymous() returns boolean
language sql stable set search_path = '' as $$
  select coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false);
$$;

-- Start a brand around a restaurant you own yourself.
create or replace function public.create_organization(org_name text, rid uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if (select auth.uid()) is null or public.is_anonymous() then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(org_name, ''))) = 0 then
    raise exception 'Give the brand a name.' using errcode = '23514';
  end if;
  perform 1 from public.restaurants r
  where r.id = rid and r.owner_id = (select auth.uid()) and r.organization_id is null and not r.is_demo
  for update;
  if not found then
    raise exception 'Only the owner of a restaurant that is not in a brand yet can start one from it.' using errcode = '42501';
  end if;
  insert into public.organizations(owner_id, name) values ((select auth.uid()), btrim(org_name)) returning id into new_id;
  update public.restaurants set organization_id = new_id where id = rid;
  return new_id;
end $$;

-- Bring another restaurant you own into your brand.
create or replace function public.add_restaurant_to_organization(oid uuid, rid uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organizations o where o.id = oid and o.owner_id = (select auth.uid())) then
    raise exception 'Only the owner of the brand can add locations to it.' using errcode = '42501';
  end if;
  update public.restaurants set organization_id = oid
  where id = rid and owner_id = (select auth.uid()) and organization_id is null and not is_demo;
  if not found then
    raise exception 'That restaurant is not yours to add, or it already belongs to a brand.' using errcode = '42501';
  end if;
end $$;

-- Open a new location inside the brand. It starts empty: its own menu, team and pre-shift.
-- Only a brand with at least one full (not trial) location can open more, so a trial cannot be
-- stretched into several restaurants.
create or replace function public.create_location(oid uuid, location_name text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if not exists (select 1 from public.organizations o where o.id = oid and o.owner_id = (select auth.uid())) then
    raise exception 'Only the owner of the brand can open a new location.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(location_name, ''))) = 0 then
    raise exception 'Give the location a name.' using errcode = '23514';
  end if;
  if not exists (select 1 from public.restaurants r where r.organization_id = oid and r.trial_ends_at is null and not r.is_demo) then
    raise exception 'Opening more locations needs a full account. Contact HEAT to upgrade from the trial.' using errcode = '42501';
  end if;
  insert into public.restaurants(owner_id, name, organization_id)
  values ((select auth.uid()), btrim(location_name), oid)
  returning id into new_id;
  return new_id;
end $$;

-- Copy the chosen dishes, drinks and wines from one location of a brand into another.
-- Each copy is the target location's own from then on: changing it never touches the original.
-- A dish whose name is already in the target's library (same library, any capitalisation) is skipped.
-- Its category is created in the target when missing, and a custom quiz comes with it.
-- Photos live in storage, which SQL cannot copy, so each copy starts without one and the
-- source photo's path is returned for the app to copy across.
create or replace function public.import_menu_items(source_rid uuid, target_rid uuid, item_ids uuid[])
returns table(new_id uuid, source_id uuid, source_photo text)
language plpgsql security definer set search_path = '' as $$
declare
  src public.menu_items%rowtype;
  copy_id uuid;
begin
  if source_rid = target_rid then
    raise exception 'Choose a different location to import from.' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.restaurants s join public.restaurants t on t.organization_id = s.organization_id
    where s.id = source_rid and t.id = target_rid and s.organization_id is not null
  ) then
    raise exception 'Dishes can only be imported between locations of the same brand.' using errcode = '42501';
  end if;
  if not public.can_read_restaurant(source_rid) or not public.can_manage(target_rid, 'library') then
    raise exception 'You need menu access in both locations to import dishes.' using errcode = '42501';
  end if;

  for src in
    select m.* from public.menu_items m
    where m.restaurant_id = source_rid and m.id = any(coalesce(item_ids, '{}'))
    order by m.created_at
  loop
    continue when exists (
      select 1 from public.menu_items t
      where t.restaurant_id = target_rid and t.content_type = src.content_type
        and lower(btrim(t.name)) = lower(btrim(src.name))
    );

    insert into public.menu_categories(restaurant_id, content_type, name, sort_order)
    select target_rid, src.content_type, btrim(src.category),
           coalesce((select c.sort_order from public.menu_categories c
                     where c.restaurant_id = source_rid and c.content_type = src.content_type
                       and lower(btrim(c.name)) = lower(btrim(src.category)) limit 1), 900)
    where not exists (
      select 1 from public.menu_categories c
      where c.restaurant_id = target_rid and c.content_type = src.content_type
        and lower(btrim(c.name)) = lower(btrim(src.category))
    );

    -- Every column the dish has, including ones added outside these migrations, except who and when.
    copy_id := gen_random_uuid();
    insert into public.menu_items
    select * from jsonb_populate_record(null::public.menu_items, to_jsonb(src) || jsonb_build_object(
      'id', copy_id, 'restaurant_id', target_rid, 'photo_path', null,
      'created_at', now(), 'updated_at', now()));

    insert into public.menu_quiz_edits(menu_item_id, questions)
    select copy_id, q.questions from public.menu_quiz_edits q where q.menu_item_id = src.id;

    new_id := copy_id; source_id := src.id; source_photo := src.photo_path;
    return next;
  end loop;
end $$;

revoke all on function public.is_anonymous(), public.create_organization(text, uuid),
  public.add_restaurant_to_organization(uuid, uuid), public.create_location(uuid, text),
  public.import_menu_items(uuid, uuid, uuid[]) from public, anon;
grant execute on function public.is_anonymous(), public.create_organization(text, uuid),
  public.add_restaurant_to_organization(uuid, uuid), public.create_location(uuid, text),
  public.import_menu_items(uuid, uuid, uuid[]) to authenticated;

commit;
