-- Run once, after 047. Front of house and kitchen each build their own schedule.
--
-- Two new access chips, handed out on the Team screen like the others:
--   * schedule_foh  "Schedule: front of house": a floor manager builds, publishes and decides changes
--                   and time off for front-of-house positions (servers, bartenders, hosts…);
--   * schedule_boh  "Schedule: kitchen": the head chef or sous chef does the same for the kitchen.
-- Team access (the GM) and the owner still do everything, and anyone with Team access can hand out
-- the two new chips. A position is kitchen when it's on the restaurant's list
-- (schedule_settings.kitchen_positions, set in the gear) or, until a list is saved, on the usual one:
-- Executive Chef, Head Chef, Sous Chef, Chef de Partie, Line Cook, Prep Cook, Pastry Chef, Sushi Chef,
-- Expo, Dishwasher, Kitchen Manager, Kitchen. Everything else is front of house.
--
-- Changes to things that exist (each replaced with the same rule plus the new schedulers; nothing
-- is deleted): the access check constraint, my_access, set_member_access, the schedule_shifts,
-- schedule_unavailability and time_off_requests policies, publish_schedule, decide_time_off,
-- decide_shift_change, shift_change_list and push_audience.
begin;

alter table public.restaurant_members drop constraint restaurant_members_access_valid;
alter table public.restaurant_members add constraint restaurant_members_access_valid
  check (access <@ array['library','words','standards','preshift','team','schedule_foh','schedule_boh']::text[]);
alter table public.schedule_settings add column kitchen_positions text[];

create or replace function public.my_access(rid uuid)
returns text[] language sql stable security definer set search_path = '' as $$
  select case
    when public.is_restaurant_owner(rid)
      then array['library','words','standards','preshift','team','schedule_foh','schedule_boh']::text[]
    else coalesce(
      (select access from public.restaurant_members
       where restaurant_id = rid and user_id = (select auth.uid())), '{}')
  end;
$$;

-- 030's rules, with one addition: Team access can also hand out the two schedule chips.
create or replace function public.set_member_access(rid uuid, learner_id uuid, new_access text[])
returns void language plpgsql security definer set search_path='' as $$
declare wanted text[]; mine text[];
begin
  if not public.can_manage(rid,'team') then
    raise exception 'You do not have access to the team.'; end if;
  if exists(select 1 from public.restaurants r where r.id=rid and r.owner_id=learner_id) then
    raise exception 'The restaurant owner always has full access.'; end if;
  if learner_id = (select auth.uid()) then
    raise exception 'You cannot change your own access. Ask the owner or a GM.'; end if;
  perform 1 from public.restaurant_members rm
    where rm.restaurant_id=rid and rm.user_id=learner_id for update;
  if not found then raise exception 'Team member unavailable'; end if;
  wanted := array_remove(coalesce(new_access, '{}'), null);
  mine := public.my_access(rid) || array['schedule_foh','schedule_boh']::text[];
  if not (wanted <@ mine) then
    raise exception 'You can only give access that you have yourself.'; end if;
  update public.restaurant_members set access = wanted
   where restaurant_id=rid and user_id=learner_id;
end $$;

-- ── Which side a position is on, and who may schedule it ──
create or replace function public.is_kitchen_position(rid uuid, job text)
returns boolean language sql stable security definer set search_path = '' as $$
  select lower(btrim(coalesce(job, ''))) = any(
    select lower(btrim(k)) from unnest(coalesce(
      (select s.kitchen_positions from public.schedule_settings s where s.restaurant_id = rid),
      array['Executive Chef','Head Chef','Sous Chef','Chef de Partie','Line Cook','Prep Cook','Pastry Chef','Sushi Chef','Expo','Dishwasher','Kitchen Manager','Kitchen']::text[])) k);
$$;
create or replace function public.can_schedule(rid uuid, job text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_manage(rid, 'team')
      or case when public.is_kitchen_position(rid, job) then public.can_manage(rid, 'schedule_boh') else public.can_manage(rid, 'schedule_foh') end;
$$;
create or replace function public.can_schedule_any(rid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.can_manage(rid, 'team') or public.can_manage(rid, 'schedule_foh') or public.can_manage(rid, 'schedule_boh');
$$;

-- ── Shifts: each scheduler builds their side; every scheduler sees the whole published week ──
drop policy "Schedulers add shifts" on public.schedule_shifts;
create policy "Schedulers add shifts" on public.schedule_shifts for insert to authenticated
with check (public.can_schedule(restaurant_id, position) and public.is_on_team(restaurant_id, user_id) and not published);
drop policy "Schedulers change shifts" on public.schedule_shifts;
create policy "Schedulers change shifts" on public.schedule_shifts for update to authenticated
using (public.can_schedule(restaurant_id, position))
with check (public.can_schedule(restaurant_id, position) and public.is_on_team(restaurant_id, user_id));
drop policy "Schedulers remove shifts" on public.schedule_shifts;
create policy "Schedulers remove shifts" on public.schedule_shifts for delete to authenticated
using (public.can_schedule(restaurant_id, position));
drop policy "Team sees the published schedule" on public.schedule_shifts;
create policy "Team sees the published schedule" on public.schedule_shifts for select to authenticated
using (
  public.can_schedule(restaurant_id, position)
  or (published and public.can_read_restaurant(restaurant_id)
      and (user_id = (select auth.uid()) or public.team_sees_schedule(restaurant_id) or public.can_schedule_any(restaurant_id)))
);

-- ── Availability and time off: every scheduler reads them while building ──
drop policy "People and schedulers read availability" on public.schedule_unavailability;
create policy "People and schedulers read availability" on public.schedule_unavailability for select to authenticated
using (user_id = (select auth.uid()) or public.can_schedule_any(restaurant_id));
drop policy "People and schedulers set availability" on public.schedule_unavailability;
create policy "People and schedulers set availability" on public.schedule_unavailability for insert to authenticated
with check (public.is_on_team(restaurant_id, user_id)
  and ((user_id = (select auth.uid()) and public.can_read_restaurant(restaurant_id)) or public.can_schedule_any(restaurant_id)));
drop policy "People and schedulers clear availability" on public.schedule_unavailability;
create policy "People and schedulers clear availability" on public.schedule_unavailability for delete to authenticated
using (user_id = (select auth.uid()) or public.can_schedule_any(restaurant_id));
drop policy "People and schedulers read time off" on public.time_off_requests;
create policy "People and schedulers read time off" on public.time_off_requests for select to authenticated
using (user_id = (select auth.uid()) or public.can_schedule_any(restaurant_id));

-- Time off is decided by whoever schedules that person's side.
create or replace function public.decide_time_off(request_id uuid, approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare rid uuid; who uuid;
begin
  select t.restaurant_id, t.user_id into rid, who from public.time_off_requests t where t.id = request_id;
  if rid is null or not public.can_schedule(rid, public.person_area(rid, who)) then
    raise exception 'You need Team access, or the schedule chip for their side, to decide this time off.' using errcode = '42501';
  end if;
  update public.time_off_requests
  set status = case when approve then 'approved' else 'denied' end, decided_by = (select auth.uid()), decided_at = now()
  where id = request_id and status = 'pending';
  if not found then raise exception 'That request was already decided.' using errcode = '22023'; end if;
end $$;

-- Publishing: each scheduler publishes the drafts of their own side (040, otherwise unchanged).
create or replace function public.publish_schedule(rid uuid, from_ts timestamptz, to_ts timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  touched uuid[];
  shifts integer;
  saved uuid;
begin
  if not public.can_schedule_any(rid) then
    raise exception 'You need Team access to publish the schedule.' using errcode = '42501';
  end if;
  if to_ts <= from_ts or to_ts - from_ts > interval '15 days' then
    raise exception 'Publish one or two weeks at a time.' using errcode = '22023';
  end if;
  with done as (
    update public.schedule_shifts set published = true
    where restaurant_id = rid and not published and starts_at >= from_ts and starts_at < to_ts
      and public.can_schedule(rid, position)
    returning user_id
  )
  select coalesce(array_agg(distinct user_id), '{}'), count(*) into touched, shifts from done;
  insert into public.schedule_publications(restaurant_id, starts_at, ends_at, shift_count, user_ids)
  values (rid, from_ts, to_ts, shifts, touched) returning id into saved;
  return jsonb_build_object('id', saved, 'shifts', shifts, 'people', cardinality(touched));
end $$;

-- Shift changes: decided by whoever schedules the shift's side (both shifts' sides in a swap).
create or replace function public.decide_shift_change(change uuid, approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.shift_changes; s public.schedule_shifts; back public.schedule_shifts;
begin
  select * into c from public.shift_changes where id = change for update;
  if c.id is not null then
    select * into s from public.schedule_shifts where id = c.shift_id;
    select * into back from public.schedule_shifts where id = c.swap_shift_id;
  end if;
  if c.id is null or not public.can_schedule(c.restaurant_id, s.position)
     or (back.id is not null and not public.can_schedule(c.restaurant_id, back.position)) then
    raise exception 'You need Team access, or the schedule chip for this side, to decide shift changes.' using errcode = '42501';
  end if;
  if c.status <> 'pending' then raise exception 'This change isn''t waiting for a decision.' using errcode = '22023'; end if;
  if approve then
    if s.user_id <> c.requested_by then raise exception 'This shift has changed hands since. Deny it and ask again.' using errcode = '22023'; end if;
    if s.starts_at <= now() then raise exception 'This shift has already started.' using errcode = '22023'; end if;
    if c.kind = 'swap' then
      if back.user_id <> c.taker_id then raise exception 'Their shift has changed hands since. Deny it and ask again.' using errcode = '22023'; end if;
      if public.busy_then(c.restaurant_id, c.requested_by, back.starts_at, back.ends_at, array[c.shift_id]) then raise exception 'That would double-book %.', public.poster_name(c.restaurant_id, c.requested_by) using errcode = '22023'; end if;
    end if;
    if public.busy_then(c.restaurant_id, c.taker_id, s.starts_at, s.ends_at, case when c.swap_shift_id is null then '{}'::uuid[] else array[c.swap_shift_id] end) then
      raise exception 'That would double-book %.', public.poster_name(c.restaurant_id, c.taker_id) using errcode = '22023';
    end if;
    update public.shift_changes set status = 'approved', decided_at = now(), decided_by = (select auth.uid()) where id = change;
    update public.schedule_shifts set user_id = c.taker_id where id = c.shift_id;
    if c.kind = 'swap' then update public.schedule_shifts set user_id = c.requested_by where id = c.swap_shift_id; end if;
    update public.schedule_shifts set published = true where id in (c.shift_id, coalesce(c.swap_shift_id, c.shift_id));
  else
    update public.shift_changes set status = 'denied', decided_at = now(), decided_by = (select auth.uid()) where id = change;
  end if;
end $$;

-- 047's list; a side's scheduler sees every change on their side as Team access does.
create or replace function public.shift_change_list(rid uuid)
returns table(id uuid, kind text, status text, other_area boolean, note text, created_at timestamptz, decided_at timestamptz,
  requested_by uuid, requester_name text, taker_id uuid, taker_name text,
  shift_id uuid, shift_position text, shift_starts timestamptz, shift_ends timestamptz,
  swap_shift_id uuid, swap_position text, swap_starts timestamptz, swap_ends timestamptz,
  taker_hours numeric, taker_overtime boolean, requester_hours numeric, requester_overtime boolean)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid());
begin
  if not public.can_read_restaurant(rid) then raise exception 'You do not have access to this restaurant.' using errcode = '42501'; end if;
  return query
  select c.id, c.kind, c.status, c.other_area, c.note, c.created_at, c.decided_at,
    c.requested_by, public.poster_name(rid, c.requested_by), c.taker_id, case when c.taker_id is null then null else public.poster_name(rid, c.taker_id) end,
    s.id, s.position, s.starts_at, s.ends_at, b.id, b.position, b.starts_at, b.ends_at,
    case when c.taker_id is null then null else public.hours_after(rid, c.taker_id, s.starts_at, s.ends_at, array_remove(array[c.swap_shift_id], null)) end,
    case when c.taker_id is null then null else public.would_overtime(rid, c.taker_id, s.starts_at, s.ends_at, array_remove(array[c.swap_shift_id], null)) end,
    case when b.id is null then null else public.hours_after(rid, c.requested_by, b.starts_at, b.ends_at, array[c.shift_id]) end,
    case when b.id is null then null else public.would_overtime(rid, c.requested_by, b.starts_at, b.ends_at, array[c.shift_id]) end
  from public.shift_changes c
  join public.schedule_shifts s on s.id = c.shift_id
  left join public.schedule_shifts b on b.id = c.swap_shift_id
  where c.restaurant_id = rid
    and (c.status in ('open', 'asked', 'pending') or coalesce(c.decided_at, c.answered_at, c.created_at) > now() - interval '14 days')
    and (public.can_schedule(rid, s.position) or (b.id is not null and public.can_schedule(rid, b.position))
         or c.requested_by = me or c.taker_id = me
         or (c.status = 'open' and public.same_area(s.position, public.person_area(rid, me))
             and not public.would_overtime(rid, me, s.starts_at, s.ends_at, '{}')))
  order by case c.status when 'pending' then 0 when 'asked' then 1 when 'open' then 2 else 3 end, s.starts_at;
end $$;

-- ── Phone notifications: 047's push_audience; time off and shift changes also reach that side's scheduler ──
create or replace function public.push_audience(event text, ref uuid, target uuid default null)
returns table(restaurant_name text, user_ids uuid[])
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  rid uuid;
  people uuid[];
  c public.shift_changes;
begin
  if me is null then raise exception 'Sign in first.' using errcode = '42501'; end if;
  if event = 'preshift_posted' then
    select n.restaurant_id into rid from public.shift_notes n where n.id = ref;
    if rid is null or not public.can_manage(rid, 'preshift') then raise exception 'Not your board' using errcode = '42501'; end if;
    select coalesce(array_agg(r.user_id), '{}') into people from public.shift_note_recipients r where r.shift_note_id = ref;
    if cardinality(people) = 0 then
      select coalesce(array_agg(m.user_id), '{}') into people from public.restaurant_members m where m.restaurant_id = rid;
    end if;
  elsif event = 'study_assigned' then
    rid := ref;
    if not public.can_manage(rid, 'team') then raise exception 'Not your team' using errcode = '42501'; end if;
    if not exists (select 1 from public.restaurant_members m where m.restaurant_id = rid and m.user_id = target) then
      raise exception 'Team member unavailable' using errcode = '42501';
    end if;
    people := array[target];
  elsif event = 'urgent_report' then
    select s.restaurant_id into rid from public.shift_reports s where s.id = ref and s.urgent and (s.submitted_by = me or s.updated_by = me);
    if rid is null then raise exception 'Not an urgent report of yours' using errcode = '42501'; end if;
    select array_agg(distinct who) into people from (
      select r.owner_id as who from public.restaurants r where r.id = rid
      union all select o.owner_id from public.restaurants r join public.organizations o on o.id = r.organization_id where r.id = rid
      union all select m.user_id from public.restaurant_members m where m.restaurant_id = rid and m.access && array['preshift', 'team']::text[]
    ) found;
  elsif event = 'retake_requested' then
    select m.restaurant_id into rid from public.quiz_permissions p join public.menu_items m on m.id = p.menu_item_id
    where p.menu_item_id = ref and p.user_id = me and p.requested;
    if rid is null then raise exception 'No request to announce' using errcode = '42501'; end if;
    select array_agg(distinct who) into people from (
      select r.owner_id as who from public.restaurants r where r.id = rid
      union all select o.owner_id from public.restaurants r join public.organizations o on o.id = r.organization_id where r.id = rid
    ) found;
  elsif event = 'schedule_published' then
    select p.restaurant_id, p.user_ids into rid, people from public.schedule_publications p where p.id = ref and p.published_by = me;
    if rid is null then raise exception 'Not a schedule you published' using errcode = '42501'; end if;
  elsif event = 'time_off_requested' then
    select t.restaurant_id into rid from public.time_off_requests t where t.id = ref and t.user_id = me and t.status = 'pending';
    if rid is null then raise exception 'No request to announce' using errcode = '42501'; end if;
    -- The owner, Team access, and whoever schedules this person's side.
    select array_agg(distinct who) into people from (
      select r.owner_id as who from public.restaurants r where r.id = rid
      union all select m.user_id from public.restaurant_members m where m.restaurant_id = rid
        and ('team' = any(m.access)
             or (case when public.is_kitchen_position(rid, public.person_area(rid, me)) then 'schedule_boh' else 'schedule_foh' end) = any(m.access))
    ) found;
  elsif event = 'time_off_decided' then
    select t.restaurant_id, array[t.user_id] into rid, people from public.time_off_requests t where t.id = ref and t.decided_by = me;
    if rid is null then raise exception 'Not a request you decided' using errcode = '42501'; end if;
  elsif event in ('shift_released', 'shift_offered', 'shift_change_pending', 'shift_change_declined', 'shift_change_decided') then
    select * into c from public.shift_changes where id = ref;
    if c.id is null then raise exception 'No shift change to announce' using errcode = '42501'; end if;
    rid := c.restaurant_id;
    if event = 'shift_released' and c.requested_by = me and c.status = 'open' then
      -- Everyone in the shift's position who'd stay under overtime with it.
      select coalesce(array_agg(t.user_id), '{}') into people from public.schedule_team(rid) t
      join public.schedule_shifts s on s.id = c.shift_id
      where public.same_area(t.role, s.position) and t.user_id <> c.requested_by
        and not public.would_overtime(rid, t.user_id, s.starts_at, s.ends_at, '{}');
    elsif event = 'shift_offered' and c.requested_by = me and c.status = 'asked' then
      people := array[c.taker_id];
    elsif event = 'shift_change_pending' and c.taker_id = me and c.status = 'pending' then
      -- The owner, Team access, whoever schedules the shift's side, and the person who asked.
      select array_agg(distinct who) into people from (
        select r.owner_id as who from public.restaurants r where r.id = rid
        union all select m.user_id from public.restaurant_members m where m.restaurant_id = rid
          and ('team' = any(m.access)
               or (case when public.is_kitchen_position(rid, (select s.position from public.schedule_shifts s where s.id = c.shift_id)) then 'schedule_boh' else 'schedule_foh' end) = any(m.access))
        union all select c.requested_by
      ) found;
    elsif event = 'shift_change_declined' and c.taker_id = me and c.status = 'declined' then
      people := array[c.requested_by];
    elsif event = 'shift_change_decided' and c.decided_by = me and c.status in ('approved', 'denied') then
      people := array_remove(array[c.requested_by, c.taker_id], null);
    else
      raise exception 'Not a shift change you can announce' using errcode = '42501';
    end if;
  else
    raise exception 'Unknown event' using errcode = '22023';
  end if;
  return query select (select r.name from public.restaurants r where r.id = rid), coalesce(array_remove(people, me), '{}');
end $$;

revoke all on function public.is_kitchen_position(uuid, text), public.can_schedule(uuid, text), public.can_schedule_any(uuid) from public, anon;
grant execute on function public.is_kitchen_position(uuid, text), public.can_schedule(uuid, text), public.can_schedule_any(uuid) to authenticated;
revoke all on function public.my_access(uuid), public.set_member_access(uuid, uuid, text[]), public.decide_time_off(uuid, boolean),
  public.publish_schedule(uuid, timestamptz, timestamptz), public.decide_shift_change(uuid, boolean), public.shift_change_list(uuid),
  public.push_audience(text, uuid, uuid) from public, anon;
grant execute on function public.my_access(uuid), public.set_member_access(uuid, uuid, text[]), public.decide_time_off(uuid, boolean),
  public.publish_schedule(uuid, timestamptz, timestamptz), public.decide_shift_change(uuid, boolean), public.shift_change_list(uuid),
  public.push_audience(text, uuid, uuid) to authenticated;

commit;
