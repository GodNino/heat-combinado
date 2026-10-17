-- Applied by hand in Supabase on 29 September 2026, before this repository
-- kept a record of it. Recorded here so the schema can be rebuilt from this
-- folder. Issued at the time as `028_access_team.sql`; renumbered because those numbers
-- were later taken by other migrations.

-- 028_access_team.sql
-- The team side. Eight existing functions stop asking "are you the owner?"
-- and start asking "can you manage the team?", plus two new ones: reading
-- everyone's chips, and setting them.
--
-- There is no "drop" anywhere in this file.
-- Run 026_access.sql and 027_access_content.sql before this one.
begin;

-- ---------- Inviting ----------
create or replace function public.create_employee_invite(rid uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare new_token uuid;
begin
  if not public.can_manage(rid, 'team') then raise exception 'You do not have access to the team.'; end if;
  insert into public.restaurant_invites(restaurant_id) values(rid)
  on conflict (restaurant_id) do update set token = gen_random_uuid(), expires_at = now() + interval '7 days'
  returning token into new_token;
  return new_token;
end;
$$;

-- ---------- Reading the team ----------
create or replace function public.team_roster(rid uuid)
returns table(user_id uuid,name text,role text,is_owner boolean,items_taken integer,correct_sum integer,total_sum integer,needs_review integer,last_attempt_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_manage(rid,'team') then raise exception 'You do not have access to the team.'; end if;
 return query
 with members as (
  select r.owner_id as uid from public.restaurants r where r.id=rid
  union select rm.user_id from public.restaurant_members rm where rm.restaurant_id=rid
 )
 select u.id,coalesce(nullif(trim(p.display_name),''),nullif(trim(u.raw_user_meta_data->>'display_name'),''),u.email::text,u.id::text),
 coalesce(p.role,case when u.id=r.owner_id then 'Manager' else 'Server' end),u.id=r.owner_id,
 s.items_taken,s.correct_sum,s.total_sum,s.needs_review,s.last_attempt_at
 from members mm join auth.users u on u.id=mm.uid join public.restaurants r on r.id=rid
 left join public.member_profiles p on p.restaurant_id=rid and p.user_id=u.id
 cross join lateral (
  select count(*)::integer as items_taken,coalesce(sum(a.correct),0)::integer as correct_sum,
  coalesce(sum(a.total),0)::integer as total_sum,count(*) filter(where a.correct::numeric/a.total<0.8)::integer as needs_review,
  max(a.created_at) as last_attempt_at
  from (
   select distinct on (a.menu_item_id) a.correct,a.total,a.created_at
   from public.quiz_attempts a join public.menu_items m on m.id=a.menu_item_id
   where a.user_id=u.id and m.restaurant_id=rid and a.menu_updated_at=m.updated_at
   order by a.menu_item_id,a.created_at desc,a.id desc
  ) a
 ) s
 order by (u.id=r.owner_id) desc,2,u.id;
end $$;

create or replace function public.team_member_detail(rid uuid,learner_id uuid)
returns table(menu_item_id uuid,item_name text,correct integer,total integer,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_manage(rid,'team') then raise exception 'You do not have access to the team.'; end if;
 if not exists(select 1 from public.restaurants r where r.id=rid and r.owner_id=learner_id)
 and not exists(select 1 from public.restaurant_members rm where rm.restaurant_id=rid and rm.user_id=learner_id) then raise exception 'Team member unavailable'; end if;
 return query select distinct on (a.menu_item_id) a.menu_item_id,m.name,a.correct,a.total,a.created_at
 from public.quiz_attempts a join public.menu_items m on m.id=a.menu_item_id
 where a.user_id=learner_id and m.restaurant_id=rid and a.menu_updated_at=m.updated_at
 order by a.menu_item_id,a.created_at desc,a.id desc;
end $$;

create or replace function public.team_member_assignments(rid uuid,learner_id uuid)
returns table(id uuid,menu_item_id uuid,item_name text,note text,due_on date,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.can_manage(rid,'team') then raise exception 'You do not have access to the team.'; end if;
 if not exists(select 1 from public.restaurants r where r.id=rid and r.owner_id=learner_id)
 and not exists(select 1 from public.restaurant_members rm where rm.restaurant_id=rid and rm.user_id=learner_id) then raise exception 'Team member unavailable'; end if;
 return query select a.id,a.menu_item_id,m.name,a.note,a.due_on,a.created_at
 from public.assignments a join public.menu_items m on m.id=a.menu_item_id and m.restaurant_id=rid
 where a.restaurant_id=rid and a.user_id=learner_id order by a.due_on nulls last,a.created_at,a.id;
end $$;

-- ---------- Changing the team ----------
create or replace function public.set_member_profile(rid uuid,learner_id uuid,name text,member_role text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.can_manage(rid,'team') then raise exception 'You do not have access to the team.'; end if;
 perform 1 from public.restaurant_members rm where rm.restaurant_id=rid and rm.user_id=learner_id for update;
 if not found and not exists(select 1 from public.restaurants r where r.id=rid and r.owner_id=learner_id) then raise exception 'Team member unavailable'; end if;
 insert into public.member_profiles(restaurant_id,user_id,display_name,role) values(rid,learner_id,trim(name),member_role)
 on conflict(restaurant_id,user_id) do update set display_name=excluded.display_name,role=excluded.role,updated_at=clock_timestamp();
end $$;

create or replace function public.assign_menu_items(rid uuid,learner_id uuid,mids uuid[],note text default '',due date default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.can_manage(rid,'team') then raise exception 'You do not have access to the team.'; end if;
 perform 1 from public.restaurant_members rm where rm.restaurant_id=rid and rm.user_id=learner_id for update;
 if not found and not exists(select 1 from public.restaurants r where r.id=rid and r.owner_id=learner_id) then raise exception 'Team member unavailable'; end if;
 if mids is null or cardinality(mids)=0 then raise exception 'Choose at least one menu item'; end if;
 if exists(select 1 from unnest(mids) as wanted(mid) where not exists(select 1 from public.menu_items m where m.id=wanted.mid and m.restaurant_id=rid)) then raise exception 'Every menu item must belong to this restaurant'; end if;
 insert into public.assignments(restaurant_id,user_id,menu_item_id,note,due_on,assigned_by)
 select rid,learner_id,wanted.mid,assign_menu_items.note,due,auth.uid() from (select distinct unnest(mids) as mid) wanted
 on conflict(user_id,menu_item_id) do update set note=excluded.note,due_on=excluded.due_on,assigned_by=excluded.assigned_by;
end $$;

create or replace function public.remove_assignment(assignment_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.can_manage((select a.restaurant_id from public.assignments a where a.id=assignment_id),'team') then raise exception 'You do not have access to the team.'; end if;
 delete from public.assignments where id=assignment_id;
end $$;

create or replace function public.remove_team_member(rid uuid,learner_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.can_manage(rid,'team') then raise exception 'You do not have access to the team.'; end if;
 if exists(select 1 from public.restaurants r where r.id=rid and r.owner_id=learner_id) then raise exception 'The restaurant owner cannot be removed'; end if;
 delete from public.restaurant_members where restaurant_id=rid and user_id=learner_id;
 if not found then raise exception 'Team member unavailable'; end if;
end $$;

-- ---------- NEW: reading everyone's chips ----------
create or replace function public.team_access(rid uuid)
returns table(user_id uuid, access text[])
language plpgsql stable security definer set search_path='' as $$
begin
  if not public.can_manage(rid,'team') then raise exception 'You do not have access to the team.'; end if;
  return query select rm.user_id, rm.access from public.restaurant_members rm where rm.restaurant_id = rid;
end $$;
revoke all on function public.team_access(uuid) from public, anon;
grant execute on function public.team_access(uuid) to authenticated;

-- ---------- NEW: setting somebody's chips ----------
-- Four refusals, in order. Read these as the rules of the system.
create or replace function public.set_member_access(rid uuid, learner_id uuid, new_access text[])
returns void language plpgsql security definer set search_path='' as $$
declare wanted text[]; mine text[];
begin
  -- 1. You need the team chip to be here at all.
  if not public.can_manage(rid,'team') then
    raise exception 'You do not have access to the team.'; end if;

  -- 2. The owner's access is not a setting. Nobody edits it, including the owner.
  if exists(select 1 from public.restaurants r where r.id=rid and r.owner_id=learner_id) then
    raise exception 'The restaurant owner always has full access.'; end if;

  -- 3. Nobody edits their own chips -- otherwise the team chip is a promotion to everything.
  if learner_id = (select auth.uid()) then
    raise exception 'You cannot change your own access. Ask the owner or a GM.'; end if;

  perform 1 from public.restaurant_members rm
    where rm.restaurant_id=rid and rm.user_id=learner_id for update;
  if not found then raise exception 'Team member unavailable'; end if;

  wanted := array_remove(coalesce(new_access, '{}'), null);
  mine := public.my_access(rid);

  -- 4. You can only hand out what you hold yourself.
  if not (wanted <@ mine) then
    raise exception 'You can only give access that you have yourself.'; end if;

  update public.restaurant_members set access = wanted
   where restaurant_id=rid and user_id=learner_id;
end $$;
revoke all on function public.set_member_access(uuid, uuid, text[]) from public, anon;
grant execute on function public.set_member_access(uuid, uuid, text[]) to authenticated;

commit;
