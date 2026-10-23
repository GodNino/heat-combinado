-- Run once, after 046. Shift changes respect overtime.
--
--   * A released shift is only seen, and only taken, by someone in the same position who would not
--     go into overtime by working it. Their phones are the only ones told about it.
--   * "Someone covers" and "Swap" list the same position first, people who'd stay under overtime
--     before those who'd go over, and say how many hours each would have that week.
--   * The manager sees, on every request, how many hours the person taking the shift would have,
--     and whether that's overtime (in a swap, for both people).
-- Overtime follows the gear (044): the weekly limit, the daily one if set, and the restaurant's own
-- week, counted in its own time zone (new: schedule_settings.time_zone, saved from the manager's
-- device; Miami's until then). Every shift on the schedule counts, drafts included.
--
-- Changes to things that exist: a column on schedule_settings; new versions of shift_change_list,
-- shift_change_people, shift_swap_choices (they now return more columns, so they are dropped and
-- recreated), take_released_shift and push_audience (everything else in it is 046's, word for word).
-- No shift or request is changed by running this.
begin;

alter table public.schedule_settings add column time_zone text check (time_zone is null or char_length(time_zone) between 1 and 64);

-- Hours this person has in the restaurant's week (or day) holding `at`, leaving out some shifts.
create or replace function public.scheduled_hours(rid uuid, uid uuid, at timestamptz, leaving uuid[], whole_week boolean)
returns numeric language plpgsql stable security definer set search_path = '' as $$
declare tz text; ws integer; local_day date; first_day date; span integer; from_ts timestamptz; to_ts timestamptz; total numeric;
begin
  select coalesce(s.time_zone, 'America/New_York'), coalesce(s.week_start, 1) into tz, ws
  from (select 1) one left join public.schedule_settings s on s.restaurant_id = rid;
  begin
    local_day := (at at time zone tz)::date;
  exception when others then
    tz := 'America/New_York';
    local_day := (at at time zone tz)::date;
  end;
  if whole_week then
    first_day := local_day - ((extract(dow from local_day)::integer - ws + 7) % 7);
    span := 7;
  else
    first_day := local_day;
    span := 1;
  end if;
  from_ts := first_day::timestamp at time zone tz;
  to_ts := (first_day + span)::timestamp at time zone tz;
  select coalesce(sum(extract(epoch from (s.ends_at - s.starts_at)) / 3600), 0) into total
  from public.schedule_shifts s
  where s.restaurant_id = rid and s.user_id = uid and s.starts_at >= from_ts and s.starts_at < to_ts
    and not (s.id = any(coalesce(leaving, '{}')));
  return round(total, 2);
end $$;

-- Hours this person would have that week with the shift added (and `leaving` taken away).
create or replace function public.hours_after(rid uuid, uid uuid, starts timestamptz, ends timestamptz, leaving uuid[])
returns numeric language sql stable security definer set search_path = '' as $$
  select public.scheduled_hours(rid, uid, starts, leaving, true) + round(extract(epoch from (ends - starts)) / 3600, 2);
$$;

-- Whether working that shift would put this person into overtime, by the week or by the day.
create or replace function public.would_overtime(rid uuid, uid uuid, starts timestamptz, ends timestamptz, leaving uuid[])
returns boolean language sql stable security definer set search_path = '' as $$
  select public.hours_after(rid, uid, starts, ends, leaving)
           > coalesce((select s.overtime_weekly from public.schedule_settings s where s.restaurant_id = rid), 40)
      or coalesce(
           public.scheduled_hours(rid, uid, starts, leaving, false) + extract(epoch from (ends - starts)) / 3600
             > (select s.overtime_daily from public.schedule_settings s where s.restaurant_id = rid),
           false);
$$;

-- A released shift is for someone in the same position who isn't working then and stays under overtime.
create or replace function public.take_released_shift(change uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.shift_changes; s public.schedule_shifts;
begin
  select * into c from public.shift_changes where id = change and status = 'open' for update;
  if c.id is null then raise exception 'Someone else took this shift already.' using errcode = '22023'; end if;
  select * into s from public.schedule_shifts where id = c.shift_id;
  if me = c.requested_by or not public.is_on_team(c.restaurant_id, me) then raise exception 'This shift isn''t yours to take.' using errcode = '42501'; end if;
  if not public.same_area(s.position, public.person_area(c.restaurant_id, me)) then
    raise exception 'This shift is for a %. Ask your manager if you want to cover it.', btrim(s.position) using errcode = '42501';
  end if;
  if s.starts_at <= now() then raise exception 'This shift has already started.' using errcode = '22023'; end if;
  if public.busy_then(c.restaurant_id, me, s.starts_at, s.ends_at, '{}') then raise exception 'You already work during that shift.' using errcode = '22023'; end if;
  if public.would_overtime(c.restaurant_id, me, s.starts_at, s.ends_at, '{}') then
    raise exception 'Taking this shift would put you into overtime. Ask your manager.' using errcode = '22023';
  end if;
  update public.shift_changes set taker_id = me, status = 'pending', answered_at = now() where id = change;
end $$;

-- The list (045), plus what each change does to hours: how many the person taking the shift would
-- have that week and whether that's overtime, and in a swap the same for whoever asked.
-- Released shifts reach only those in the same position who'd stay under overtime.
drop function public.shift_change_list(uuid);
create function public.shift_change_list(rid uuid)
returns table(id uuid, kind text, status text, other_area boolean, note text, created_at timestamptz, decided_at timestamptz,
  requested_by uuid, requester_name text, taker_id uuid, taker_name text,
  shift_id uuid, shift_position text, shift_starts timestamptz, shift_ends timestamptz,
  swap_shift_id uuid, swap_position text, swap_starts timestamptz, swap_ends timestamptz,
  taker_hours numeric, taker_overtime boolean, requester_hours numeric, requester_overtime boolean)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); boss boolean;
begin
  if not public.can_read_restaurant(rid) then raise exception 'You do not have access to this restaurant.' using errcode = '42501'; end if;
  boss := public.can_manage(rid, 'team');
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
    and (boss or c.requested_by = me or c.taker_id = me
         or (c.status = 'open' and public.same_area(s.position, public.person_area(rid, me))
             and not public.would_overtime(rid, me, s.starts_at, s.ends_at, '{}')))
  order by case c.status when 'pending' then 0 when 'asked' then 1 when 'open' then 2 else 3 end, s.starts_at;
end $$;

-- Who a shift can go to (045), plus the hours each would have that week and whether that's overtime.
-- Same position first, then under overtime before over, then by name.
drop function public.shift_change_people(uuid);
create function public.shift_change_people(shift uuid)
returns table(user_id uuid, name text, role text, same_area boolean, busy boolean, hours numeric, overtime boolean)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); s public.schedule_shifts;
begin
  select * into s from public.schedule_shifts x where x.id = shift and x.user_id = me;
  if s.id is null then raise exception 'This isn''t one of your shifts.' using errcode = '42501'; end if;
  return query
  select t.user_id, t.name, t.role, public.same_area(s.position, t.role),
    public.busy_then(s.restaurant_id, t.user_id, s.starts_at, s.ends_at, '{}'),
    public.hours_after(s.restaurant_id, t.user_id, s.starts_at, s.ends_at, '{}'),
    public.would_overtime(s.restaurant_id, t.user_id, s.starts_at, s.ends_at, '{}')
  from public.schedule_team(s.restaurant_id) t where t.user_id <> me
  order by 4 desc, 7 asc, 5 asc, 2;
end $$;

-- Shifts to swap for (045), plus the hours the coworker would have with this shift instead of theirs.
drop function public.shift_swap_choices(uuid);
create function public.shift_swap_choices(shift uuid)
returns table(shift_id uuid, user_id uuid, name text, role text, shift_position text, starts_at timestamptz, ends_at timestamptz, same_area boolean, hours numeric, overtime boolean)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); s public.schedule_shifts;
begin
  select * into s from public.schedule_shifts x where x.id = shift and x.user_id = me;
  if s.id is null then raise exception 'This isn''t one of your shifts.' using errcode = '42501'; end if;
  return query
  select o.id, o.user_id, t.name, t.role, o.position, o.starts_at, o.ends_at, public.same_area(o.position, s.position),
    public.hours_after(s.restaurant_id, o.user_id, s.starts_at, s.ends_at, array[o.id]),
    public.would_overtime(s.restaurant_id, o.user_id, s.starts_at, s.ends_at, array[o.id])
  from public.schedule_shifts o join public.schedule_team(s.restaurant_id) t on t.user_id = o.user_id
  where o.restaurant_id = s.restaurant_id and o.published and o.user_id <> me
    and public.change_window_open(s.restaurant_id, o.starts_at) and o.starts_at < now() + interval '28 days'
    and not exists (select 1 from public.shift_changes c where (c.shift_id = o.id or c.swap_shift_id = o.id) and c.status in ('open', 'asked', 'pending'))
  order by 8 desc, 10 asc, o.starts_at;
end $$;

-- ── Phone notifications: 046's push_audience; a released shift reaches only those who'd stay under overtime ──
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
    select array_agg(distinct who) into people from (
      select r.owner_id as who from public.restaurants r where r.id = rid
      union all select m.user_id from public.restaurant_members m where m.restaurant_id = rid and 'team' = any(m.access)
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
      select array_agg(distinct who) into people from (
        select r.owner_id as who from public.restaurants r where r.id = rid
        union all select m.user_id from public.restaurant_members m where m.restaurant_id = rid and 'team' = any(m.access)
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

revoke all on function public.scheduled_hours(uuid, uuid, timestamptz, uuid[], boolean), public.hours_after(uuid, uuid, timestamptz, timestamptz, uuid[]),
  public.would_overtime(uuid, uuid, timestamptz, timestamptz, uuid[]), public.take_released_shift(uuid), public.shift_change_list(uuid),
  public.shift_change_people(uuid), public.shift_swap_choices(uuid), public.push_audience(text, uuid, uuid) from public, anon;
grant execute on function public.take_released_shift(uuid), public.shift_change_list(uuid), public.shift_change_people(uuid),
  public.shift_swap_choices(uuid), public.push_audience(text, uuid, uuid) to authenticated;

commit;
