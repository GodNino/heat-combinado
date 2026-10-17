-- Run once BEFORE deploying the Team workspace app files.
begin;
create table public.member_profiles (
 restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 display_name text not null default '' check(char_length(display_name)<=80),
 role text not null default 'Server' check(role in ('Server','Bartender','Host','Runner','Busser','Kitchen','Manager')),
 updated_at timestamptz not null default now(),
 primary key(restaurant_id,user_id)
);
create table public.assignments (
 id uuid primary key default gen_random_uuid(),
 restaurant_id uuid not null references public.restaurants(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade,
 menu_item_id uuid not null references public.menu_items(id) on delete cascade,
 note text not null default '' check(char_length(note)<=200),
 due_on date,
 assigned_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(),
 unique(user_id,menu_item_id)
);
create index on public.assignments(restaurant_id,user_id);
create index on public.assignments(menu_item_id);
alter table public.member_profiles enable row level security;
alter table public.assignments enable row level security;
revoke all on public.member_profiles, public.assignments from public, anon, authenticated;
-- No direct client access and no changes to existing policies. Only the guarded RPCs below.

create function public.team_roster(rid uuid)
returns table(user_id uuid,name text,role text,is_owner boolean,items_taken integer,correct_sum integer,total_sum integer,needs_review integer,last_attempt_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_restaurant_owner(rid) then raise exception 'Manager access required'; end if;
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

create function public.team_member_detail(rid uuid,learner_id uuid)
returns table(menu_item_id uuid,item_name text,correct integer,total integer,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_restaurant_owner(rid) then raise exception 'Manager access required'; end if;
 if not exists(select 1 from public.restaurants r where r.id=rid and r.owner_id=learner_id)
 and not exists(select 1 from public.restaurant_members rm where rm.restaurant_id=rid and rm.user_id=learner_id) then raise exception 'Team member unavailable'; end if;
 return query select distinct on (a.menu_item_id) a.menu_item_id,m.name,a.correct,a.total,a.created_at
 from public.quiz_attempts a join public.menu_items m on m.id=a.menu_item_id
 where a.user_id=learner_id and m.restaurant_id=rid and a.menu_updated_at=m.updated_at
 order by a.menu_item_id,a.created_at desc,a.id desc;
end $$;

create function public.set_member_profile(rid uuid,learner_id uuid,name text,member_role text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_restaurant_owner(rid) then raise exception 'Manager access required'; end if;
 perform 1 from public.restaurant_members rm where rm.restaurant_id=rid and rm.user_id=learner_id for update;
 if not found and not exists(select 1 from public.restaurants r where r.id=rid and r.owner_id=learner_id) then raise exception 'Team member unavailable'; end if;
 insert into public.member_profiles(restaurant_id,user_id,display_name,role) values(rid,learner_id,trim(name),member_role)
 on conflict(restaurant_id,user_id) do update set display_name=excluded.display_name,role=excluded.role,updated_at=clock_timestamp();
end $$;

create function public.assign_menu_items(rid uuid,learner_id uuid,mids uuid[],note text default '',due date default null) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_restaurant_owner(rid) then raise exception 'Manager access required'; end if;
 perform 1 from public.restaurant_members rm where rm.restaurant_id=rid and rm.user_id=learner_id for update;
 if not found and not exists(select 1 from public.restaurants r where r.id=rid and r.owner_id=learner_id) then raise exception 'Team member unavailable'; end if;
 if mids is null or cardinality(mids)=0 then raise exception 'Choose at least one menu item'; end if;
 if exists(select 1 from unnest(mids) as wanted(mid) where not exists(select 1 from public.menu_items m where m.id=wanted.mid and m.restaurant_id=rid)) then raise exception 'Every menu item must belong to this restaurant'; end if;
 insert into public.assignments(restaurant_id,user_id,menu_item_id,note,due_on,assigned_by)
 select rid,learner_id,wanted.mid,assign_menu_items.note,due,auth.uid() from (select distinct unnest(mids) as mid) wanted
 on conflict(user_id,menu_item_id) do update set note=excluded.note,due_on=excluded.due_on,assigned_by=excluded.assigned_by;
end $$;

-- Additional read RPC for the manager's assignment list. No table grants needed.
create function public.team_member_assignments(rid uuid,learner_id uuid)
returns table(id uuid,menu_item_id uuid,item_name text,note text,due_on date,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_restaurant_owner(rid) then raise exception 'Manager access required'; end if;
 if not exists(select 1 from public.restaurants r where r.id=rid and r.owner_id=learner_id)
 and not exists(select 1 from public.restaurant_members rm where rm.restaurant_id=rid and rm.user_id=learner_id) then raise exception 'Team member unavailable'; end if;
 return query select a.id,a.menu_item_id,m.name,a.note,a.due_on,a.created_at
 from public.assignments a join public.menu_items m on m.id=a.menu_item_id and m.restaurant_id=rid
 where a.restaurant_id=rid and a.user_id=learner_id order by a.due_on nulls last,a.created_at,a.id;
end $$;

create function public.remove_assignment(assignment_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_restaurant_owner((select a.restaurant_id from public.assignments a where a.id=assignment_id)) then raise exception 'Manager access required'; end if;
 delete from public.assignments where id=assignment_id;
end $$;

create function public.my_assignments(rid uuid)
returns table(id uuid,menu_item_id uuid,item_name text,note text,due_on date,created_at timestamptz)
language plpgsql stable security definer set search_path='' as $$
begin
 return query select a.id,a.menu_item_id,m.name,a.note,a.due_on,a.created_at
 from public.assignments a join public.menu_items m on m.id=a.menu_item_id and m.restaurant_id=rid
 where a.restaurant_id=rid and a.user_id=(select auth.uid()) and public.can_read_restaurant(rid)
 order by a.due_on nulls last,a.created_at,a.id;
end $$;

create function public.remove_team_member(rid uuid,learner_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_restaurant_owner(rid) then raise exception 'Manager access required'; end if;
 if exists(select 1 from public.restaurants r where r.id=rid and r.owner_id=learner_id) then raise exception 'The restaurant owner cannot be removed'; end if;
 delete from public.restaurant_members where restaurant_id=rid and user_id=learner_id;
 if not found then raise exception 'Team member unavailable'; end if;
end $$;

revoke all on function public.team_roster(uuid),public.team_member_detail(uuid,uuid),public.set_member_profile(uuid,uuid,text,text),public.assign_menu_items(uuid,uuid,uuid[],text,date),public.team_member_assignments(uuid,uuid),public.remove_assignment(uuid),public.my_assignments(uuid),public.remove_team_member(uuid,uuid) from public,anon,authenticated;
grant execute on function public.team_roster(uuid),public.team_member_detail(uuid,uuid),public.set_member_profile(uuid,uuid,text,text),public.assign_menu_items(uuid,uuid,uuid[],text,date),public.team_member_assignments(uuid,uuid),public.remove_assignment(uuid),public.my_assignments(uuid),public.remove_team_member(uuid,uuid) to authenticated;
commit;
