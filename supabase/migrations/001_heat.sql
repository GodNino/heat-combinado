-- Run once in a new Supabase project's SQL editor.
begin;
create table public.restaurants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id),
  name text not null check (char_length(trim(name)) between 1 and 100),
  created_at timestamptz not null default now()
);
create table public.restaurant_members (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (restaurant_id, user_id)
);
create table public.menu_items (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 100),
  description text not null check (char_length(trim(description)) between 1 and 2000),
  ingredients text[] not null check (cardinality(ingredients) between 1 and 50),
  allergens text[] not null default '{}' check (cardinality(allergens) <= 30),
  photo_path text not null,
  created_at timestamptz not null default now(),
  check (split_part(photo_path, '/', 1) = restaurant_id::text)
);
create index on public.menu_items(restaurant_id);
create index on public.restaurant_members(user_id);
create table public.restaurant_invites (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  token uuid unique not null default gen_random_uuid(),
  expires_at timestamptz not null default now() + interval '7 days'
);
alter table public.restaurants enable row level security;
alter table public.restaurant_members enable row level security;
alter table public.menu_items enable row level security;
alter table public.restaurant_invites enable row level security;

-- These helpers avoid recursive policies. Identity always comes from Supabase Auth.
create function public.is_restaurant_owner(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.restaurants where id = rid and owner_id = (select auth.uid()));
$$;
create function public.can_read_restaurant(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_restaurant_owner(rid) or exists (
    select 1 from public.restaurant_members where restaurant_id = rid and user_id = (select auth.uid())
  );
$$;
revoke all on function public.is_restaurant_owner(uuid), public.can_read_restaurant(uuid) from public, anon;
grant execute on function public.is_restaurant_owner(uuid), public.can_read_restaurant(uuid) to authenticated;
create policy "Members read their restaurant" on public.restaurants for select to authenticated using (owner_id = (select auth.uid()) or public.can_read_restaurant(id));
create policy "Users create their own restaurant" on public.restaurants for insert to authenticated with check (owner_id = (select auth.uid()));
create policy "Members read own membership" on public.restaurant_members for select to authenticated using (user_id = (select auth.uid()) or public.is_restaurant_owner(restaurant_id));
create policy "Members read menu" on public.menu_items for select to authenticated using (public.can_read_restaurant(restaurant_id));
create policy "Owner adds menu" on public.menu_items for insert to authenticated with check (public.is_restaurant_owner(restaurant_id));
-- No client writes to memberships or invites: only the narrowly scoped functions below.
revoke all on public.restaurants, public.restaurant_members, public.menu_items, public.restaurant_invites from anon, authenticated;
grant select, insert on public.restaurants, public.menu_items to authenticated;
grant select on public.restaurant_members to authenticated;

create function public.create_employee_invite(rid uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_token uuid;
begin
  if not public.is_restaurant_owner(rid) then raise exception 'Only the restaurant manager can invite employees.'; end if;
  insert into public.restaurant_invites(restaurant_id) values(rid)
  on conflict (restaurant_id) do update set token = gen_random_uuid(), expires_at = now() + interval '7 days'
  returning token into new_token;
  return new_token;
end;
$$;
create function public.join_restaurant(invite_token uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select restaurant_id into rid from public.restaurant_invites where token = invite_token and expires_at > now();
  if rid is null then raise exception 'This invite is invalid or expired. Ask your manager for a new link.'; end if;
  insert into public.restaurant_members(restaurant_id,user_id) values(rid,auth.uid()) on conflict do nothing;
  return rid;
end;
$$;
revoke all on function public.create_employee_invite(uuid), public.join_restaurant(uuid) from public, anon;
grant execute on function public.create_employee_invite(uuid), public.join_restaurant(uuid) to authenticated;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('menu-photos', 'menu-photos', false, 5242880, array['image/jpeg','image/png','image/webp']);
create policy "Members view restaurant photos" on storage.objects for select to authenticated
using (bucket_id = 'menu-photos' and exists (
  select 1 from public.restaurants r where r.id::text = (storage.foldername(storage.objects.name))[1] and public.can_read_restaurant(r.id)
));
create policy "Managers upload restaurant photos" on storage.objects for insert to authenticated
with check (bucket_id = 'menu-photos' and exists (
  select 1 from public.restaurants r where r.id::text = (storage.foldername(storage.objects.name))[1] and public.is_restaurant_owner(r.id)
));
create policy "Managers clean up uploads" on storage.objects for delete to authenticated
using (bucket_id = 'menu-photos' and exists (
  select 1 from public.restaurants r where r.id::text = (storage.foldername(storage.objects.name))[1] and public.is_restaurant_owner(r.id)
));
commit;
