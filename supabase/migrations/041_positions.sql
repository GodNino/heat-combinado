-- Run once, after 040. Positions: who does which job.
--
-- Three things, all for the manager on the Team screen:
--   1. A position can be anything the restaurant calls the job (1 to 40 characters). Until now the
--      database only took Server, Bartender, Host, Runner, Busser, Kitchen and Manager, so Sommelier,
--      GM, Barback, Bar Manager, Server assistant and anything typed under "Other" failed to save.
--   2. Someone who joined and whose position nobody has chosen yet can be listed, so the Team screen
--      can ask for it instead of quietly treating everyone as a Server.
--   3. An invite link can carry a position: "Invite a bartender". Whoever joins with it starts as a
--      Bartender. The plain invite link keeps working exactly as before.
--
-- The one change to something that exists: "drop constraint member_profiles_role_check" replaces the
-- seven-word list with the length rule in (1). No profile, member or invite is deleted by it.
begin;

-- ── 1. Any position ──
alter table public.member_profiles drop constraint member_profiles_role_check;
alter table public.member_profiles add constraint member_profiles_role_check check (char_length(btrim(role)) between 1 and 40);

-- ── 2. Who still needs a position ──
-- A member with no profile row: nobody has saved their name and position on the Team screen, and
-- they didn't join with a position link. The owner is never on the list.
create or replace function public.team_without_position(rid uuid)
returns setof uuid language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage(rid, 'team') then raise exception 'You do not have access to the team.'; end if;
  return query
  select rm.user_id from public.restaurant_members rm
  where rm.restaurant_id = rid
    and not exists (select 1 from public.member_profiles p where p.restaurant_id = rid and p.user_id = rm.user_id)
    and rm.user_id <> (select r.owner_id from public.restaurants r where r.id = rid);
end $$;

-- ── 3. Invite links for one position ──
-- One live link per restaurant and position, so "Invite a bartender" doesn't switch off the link
-- already sent to the hosts. Only the functions below read or write this table.
create table public.position_invites (
  token uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  role text not null check (char_length(btrim(role)) between 1 and 40),
  expires_at timestamptz not null default now() + interval '7 days',
  created_by uuid not null default auth.uid() references auth.users(id)
);
create unique index position_invites_one_per_role on public.position_invites (restaurant_id, lower(btrim(role)));
alter table public.position_invites enable row level security;
revoke all on public.position_invites from public, anon, authenticated;

-- The link for this position: the one already out there while it's still good, or a new one when
-- `fresh` is asked for (the manager pressed Replace) or the old one expired.
create or replace function public.create_position_invite(rid uuid, member_role text, fresh boolean default false)
returns uuid language plpgsql security definer set search_path = '' as $$
declare found_token uuid; clean text := btrim(coalesce(member_role, ''));
begin
  if not public.can_manage(rid, 'team') then raise exception 'You do not have access to the team.'; end if;
  if char_length(clean) not between 1 and 40 then raise exception 'Choose a position for this link.'; end if;
  if not fresh then
    select token into found_token from public.position_invites
    where restaurant_id = rid and lower(btrim(role)) = lower(clean) and expires_at > now();
    if found_token is not null then return found_token; end if;
  end if;
  insert into public.position_invites(restaurant_id, role) values (rid, clean)
  on conflict (restaurant_id, lower(btrim(role))) do update
    set token = gen_random_uuid(), role = excluded.role, expires_at = now() + interval '7 days', created_by = auth.uid()
  returning token into found_token;
  return found_token;
end $$;

-- Joining: the plain link as before, or a position link, which also sets the position, unless this
-- person already has one here (joining again never overwrites what the manager chose).
create or replace function public.join_restaurant(invite_token uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare rid uuid; job text;
begin
  if auth.uid() is null then raise exception 'Please sign in first.'; end if;
  select restaurant_id into rid from public.restaurant_invites where token = invite_token and expires_at > now();
  if rid is null then
    select restaurant_id, role into rid, job from public.position_invites where token = invite_token and expires_at > now();
  end if;
  if rid is null then raise exception 'This invite is invalid or expired. Ask your manager for a new link.'; end if;
  insert into public.restaurant_members(restaurant_id, user_id) values (rid, auth.uid()) on conflict do nothing;
  if job is not null and not exists (select 1 from public.restaurants r where r.id = rid and r.owner_id = auth.uid()) then
    insert into public.member_profiles(restaurant_id, user_id, display_name, role) values (rid, auth.uid(), '', job)
    on conflict (restaurant_id, user_id) do nothing;
  end if;
  return rid;
end $$;

revoke all on function public.team_without_position(uuid), public.create_position_invite(uuid, text, boolean), public.join_restaurant(uuid) from public, anon;
grant execute on function public.team_without_position(uuid), public.create_position_invite(uuid, text, boolean), public.join_restaurant(uuid) to authenticated;

commit;
