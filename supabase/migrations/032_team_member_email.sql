-- 032_team_member_email.sql
-- A manager who can manage the team can read the sign-in email of one person
-- on that team, so they can tell someone which email they signed up with.
-- Nothing else about auth.users is exposed, and nobody else can call it.

begin;

create or replace function public.team_member_email(rid uuid, learner_id uuid)
returns text
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.can_manage(rid,'team') then
    raise exception 'You do not have access to the team.';
  end if;
  if not exists (select 1 from public.restaurants r where r.id=rid and r.owner_id=learner_id)
     and not exists (select 1 from public.restaurant_members m where m.restaurant_id=rid and m.user_id=learner_id) then
    raise exception 'Team member unavailable';
  end if;
  return (select u.email::text from auth.users u where u.id=learner_id);
end $$;

revoke all on function public.team_member_email(uuid, uuid) from public, anon;
grant execute on function public.team_member_email(uuid, uuid) to authenticated;

commit;
