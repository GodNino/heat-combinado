-- Run once in the Supabase SQL editor BEFORE the app files that ask for an access code.
-- Creating a restaurant becomes invite-only: one code, one restaurant, used once.
--
-- Two statements here change something that already exists, and both are explained:
--   * "drop policy \"Users create their own restaurant\"" removes the rule that let any signed-in
--     person insert a restaurant row directly. That rule is exactly the open door we are closing.
--     Nothing is deleted by it: no restaurant, no menu item, no member. Policies are permissions.
--   * "revoke insert on public.restaurants" takes the matching permission away for the same reason.
-- From then on a restaurant can only be created through create_restaurant_with_code below,
-- which checks the code first. Everything else about your data is untouched.
begin;

create table public.access_codes (
  code text primary key check (char_length(btrim(code)) between 4 and 40),
  label text not null default '' check (char_length(label) <= 120),
  created_by uuid not null references auth.users(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  used_at timestamptz,
  used_by uuid references auth.users(id),
  restaurant_id uuid references public.restaurants(id) on delete set null
);
create unique index access_codes_one_per_word on public.access_codes (lower(btrim(code)));
alter table public.access_codes enable row level security;
-- No one reads or writes this table from the app. Only the function below touches it,
-- and only you touch it from the SQL editor. That is why there are no policies.
revoke all on public.access_codes from public, anon, authenticated;

-- Closing the open door. See the note at the top.
drop policy "Users create their own restaurant" on public.restaurants;
revoke insert on public.restaurants from authenticated;

-- The only way to create a restaurant. Security definer, so it can write the row itself
-- after the code checks out; the code and the restaurant are created in one transaction,
-- so a failure leaves neither behind.
create function public.create_restaurant_with_code(access_code text, restaurant_name text)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare wanted text := lower(btrim(coalesce(access_code, '')));
declare found public.access_codes%rowtype;
declare new_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in first.' using errcode = '42501';
  end if;
  if char_length(btrim(coalesce(restaurant_name, ''))) = 0 then
    raise exception 'Give the restaurant a name.' using errcode = '23514';
  end if;

  select * into found from public.access_codes a
  where lower(btrim(a.code)) = wanted for update;

  if not found.code is not null then
    raise exception 'That access code is not valid. Check it with the person who invited you.' using errcode = '42501';
  end if;
  if found.used_at is not null then
    raise exception 'That access code has already been used.' using errcode = '42501';
  end if;
  if found.expires_at is not null and found.expires_at < now() then
    raise exception 'That access code has expired. Ask for a new one.' using errcode = '42501';
  end if;

  insert into public.restaurants(owner_id, name)
  values ((select auth.uid()), btrim(restaurant_name))
  returning id into new_id;

  update public.access_codes
  set used_at = now(), used_by = (select auth.uid()), restaurant_id = new_id
  where public.access_codes.code = found.code;

  return new_id;
end $$;
revoke all on function public.create_restaurant_with_code(text,text) from public, anon;
grant execute on function public.create_restaurant_with_code(text,text) to authenticated;
commit;
