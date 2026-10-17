-- Run once, after 033, BEFORE deploying the version of HEAT with the public site (/, /demo, /trial).
-- It adds two ways in besides an access code:
--   * a free trial: anyone with a confirmed account can create one restaurant that runs 14 days;
--   * the demo kitchen: one restaurant marked is_demo that visitors join, read-only, without an account.
--
-- Nothing is dropped or rewritten. Every existing restaurant keeps trial_ends_at empty (a full account)
-- and is_demo false. create_restaurant_with_code keeps working exactly as before.
begin;

-- Empty means a full account. A date means a trial that ends then.
alter table public.restaurants add column if not exists trial_ends_at timestamptz;
-- The demo kitchen. Only the SQL editor sets this (supabase/demo-seed.sql); the app never writes it.
alter table public.restaurants add column if not exists is_demo boolean not null default false;
create unique index if not exists restaurants_one_demo on public.restaurants (is_demo) where is_demo;

-- A free trial restaurant, without an access code. One per account, so a trial can't be renewed
-- by creating another, and never for an anonymous demo visitor.
create or replace function public.start_trial_restaurant(restaurant_name text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if coalesce((select auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception 'Create an account to start a free trial.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(restaurant_name, ''))) = 0 then
    raise exception 'Give the restaurant a name.' using errcode = '23514';
  end if;
  if exists (select 1 from public.restaurants r where r.owner_id = (select auth.uid()) and r.trial_ends_at is not null) then
    raise exception 'This account has already started a free trial. Contact HEAT to add another restaurant.' using errcode = '42501';
  end if;

  insert into public.restaurants(owner_id, name, trial_ends_at)
  values ((select auth.uid()), btrim(restaurant_name), now() + interval '14 days')
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.start_trial_restaurant(text) from public, anon;
grant execute on function public.start_trial_restaurant(text) to authenticated;

-- A demo visitor joins the demo kitchen as an ordinary member with no access areas, which in HEAT
-- means read-only: they can read the menu, use the allergy check and take quizzes, and change nothing.
create or replace function public.join_demo()
returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  select id into rid from public.restaurants where is_demo;
  if rid is null then
    raise exception 'The demo kitchen is not set up.' using errcode = 'P0002';
  end if;
  insert into public.restaurant_members(restaurant_id, user_id) values (rid, (select auth.uid()))
  on conflict do nothing;
  return rid;
end $$;
revoke all on function public.join_demo() from public, anon;
grant execute on function public.join_demo() to authenticated;

commit;
