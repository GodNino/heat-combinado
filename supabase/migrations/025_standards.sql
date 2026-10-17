-- Run once in the Supabase SQL editor BEFORE the app files that add the Standards tab.
-- Additive only: one new table. Nothing existing is touched.
--
-- “Standards” is what the team sees; “sops” is what the database calls it. Renaming the tab
-- later is then a change of one label rather than a migration.
--
-- The steps are an array on the row rather than a table of their own. A procedure is read and
-- written whole, never a step at a time, so a second table would buy nothing and cost a join —
-- and the steps renumber themselves for free.
--
-- Postgres can check how many steps there are but not how long each one is (a CHECK cannot
-- contain a subquery), so the 500-character limit on a single step lives in the form instead.
--
-- The policies are copied from glossary_terms: anyone who can read the restaurant can read the
-- standards, and only the owner can write them. That is what makes servers read-only.

begin;

create table public.sops (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  section text not null default '' check (char_length(section) <= 60),
  why text not null default '' check (char_length(why) <= 300),
  steps text[] not null default '{}' check (cardinality(steps) <= 40),
  photo_path text not null default '' check (char_length(photo_path) <= 300),
  sort_order integer not null default 0,
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id)
);

create unique index sops_one_per_name on public.sops (restaurant_id, lower(btrim(name)));
alter table public.sops enable row level security;

create policy "Members read standards" on public.sops for select to authenticated
using (public.can_read_restaurant(restaurant_id));
create policy "Owner adds standards" on public.sops for insert to authenticated
with check (public.is_restaurant_owner(restaurant_id) and created_by = (select auth.uid()));
create policy "Owner edits standards" on public.sops for update to authenticated
using (public.is_restaurant_owner(restaurant_id))
with check (public.is_restaurant_owner(restaurant_id));
create policy "Owner deletes standards" on public.sops for delete to authenticated
using (public.is_restaurant_owner(restaurant_id));

revoke all on public.sops from public, anon, authenticated;
grant select, insert, update, delete on public.sops to authenticated;

commit;
