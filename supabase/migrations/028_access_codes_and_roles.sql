-- Applied by hand in Supabase on 29 September 2026, before this repository
-- kept a record of it. Recorded here so the schema can be rebuilt from this
-- folder. Issued at the time as `026_access.sql`; renumbered because those numbers
-- were later taken by other migrations.

-- 026_access.sql
-- Per-person access. This migration changes NO behaviour on its own.
-- can_manage() is true for the owner, and the owner is the only person
-- who can change anything today, so after this runs HEAT works exactly
-- as it does now. The switch happens in 027.
--
-- There is no "drop" anywhere in this file.
begin;

-- 1. Where a person's chips are stored. Empty for everyone, which is
--    read-only -- what every member has today.
alter table public.restaurant_members
  add column if not exists access text[] not null default '{}';

-- 2. Only these five words are ever allowed in that column. A typo
--    is rejected by the database rather than quietly granting nothing.
alter table public.restaurant_members
  add constraint restaurant_members_access_valid
  check (access <@ array['library','words','standards','preshift','team']::text[]);

-- 3. The one question every permission in HEAT will ask from now on.
--    Owner: always yes. Everyone else: yes if they hold that chip.
create or replace function public.can_manage(rid uuid, area text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_restaurant_owner(rid) or exists (
    select 1 from public.restaurant_members
    where restaurant_id = rid
      and user_id = (select auth.uid())
      and area = any(access)
  );
$$;
revoke all on function public.can_manage(uuid, text) from public, anon;
grant execute on function public.can_manage(uuid, text) to authenticated;

-- 4. What the signed-in person holds, so the app knows which tabs to draw.
create or replace function public.my_access(rid uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select case
    when public.is_restaurant_owner(rid)
      then array['library','words','standards','preshift','team']::text[]
    else coalesce(
      (select access from public.restaurant_members
       where restaurant_id = rid and user_id = (select auth.uid())), '{}')
  end;
$$;
revoke all on function public.my_access(uuid) from public, anon;
grant execute on function public.my_access(uuid) to authenticated;

commit;
