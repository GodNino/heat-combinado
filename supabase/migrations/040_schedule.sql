-- Run once, after 039. The schedule, stage 1 (replacing Sling): shifts, publishing, availability
-- and time off.
--
-- Who does what (no new access chip, so the Team screen doesn't change):
--   * whoever holds Team access (and the owner) builds the schedule, publishes it and decides time off;
--   * everyone on the team sees the published schedule, their own and their coworkers' shifts;
--   * each person keeps their own availability and asks for their own time off.
-- A shift is a draft until it's published. Changing a published shift turns it back into a draft,
-- so the team only ever sees what the manager meant to send, and publishing tells whoever it touches.
-- Additive, plus a new version of push_audience (039) that knows the schedule's events.
begin;

-- Someone who can be put on this restaurant's schedule: the owner or a member.
create or replace function public.is_on_team(rid uuid, uid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.restaurants r where r.id = rid and r.owner_id = uid)
      or exists (select 1 from public.restaurant_members m where m.restaurant_id = rid and m.user_id = uid);
$$;
revoke all on function public.is_on_team(uuid, uuid) from public, anon;
grant execute on function public.is_on_team(uuid, uuid) to authenticated;

-- ── Shifts ──
create table public.schedule_shifts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  position text not null default 'Server' check (char_length(btrim(position)) between 1 and 40),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  note text not null default '' check (char_length(note) <= 300),
  published boolean not null default false,
  created_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at and ends_at <= starts_at + interval '16 hours')
);
create index schedule_shifts_by_restaurant on public.schedule_shifts (restaurant_id, starts_at);
create index schedule_shifts_by_person on public.schedule_shifts (user_id, starts_at);
alter table public.schedule_shifts enable row level security;
create policy "Team sees the published schedule" on public.schedule_shifts for select to authenticated
using (public.can_manage(restaurant_id, 'team') or (published and public.can_read_restaurant(restaurant_id)));
create policy "Schedulers add shifts" on public.schedule_shifts for insert to authenticated
with check (public.can_manage(restaurant_id, 'team') and public.is_on_team(restaurant_id, user_id) and not published);
create policy "Schedulers change shifts" on public.schedule_shifts for update to authenticated
using (public.can_manage(restaurant_id, 'team'))
with check (public.can_manage(restaurant_id, 'team') and public.is_on_team(restaurant_id, user_id));
create policy "Schedulers remove shifts" on public.schedule_shifts for delete to authenticated
using (public.can_manage(restaurant_id, 'team'));
revoke all on public.schedule_shifts from public, anon, authenticated;
grant select, insert, update, delete on public.schedule_shifts to authenticated;

-- An edit to a published shift makes it a draft again, until the next publish.
create or replace function public.schedule_shift_edited()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (new.user_id, new.position, new.starts_at, new.ends_at, new.note, new.restaurant_id)
     is distinct from (old.user_id, old.position, old.starts_at, old.ends_at, old.note, old.restaurant_id) then
    new.published := false;
    new.updated_at := now();
  end if;
  return new;
end $$;
create trigger schedule_shift_edited before update on public.schedule_shifts
for each row execute function public.schedule_shift_edited();

-- ── Publishing ──
create table public.schedule_publications (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  shift_count integer not null,
  user_ids uuid[] not null default '{}',
  published_by uuid not null default auth.uid() references auth.users(id),
  published_at timestamptz not null default now()
);
alter table public.schedule_publications enable row level security;
create policy "Schedulers read publications" on public.schedule_publications for select to authenticated
using (public.can_manage(restaurant_id, 'team'));
revoke all on public.schedule_publications from public, anon, authenticated;
grant select on public.schedule_publications to authenticated;

-- Publishes every draft shift in a window (a week, from the manager's own calendar) and records who
-- it touched, so they can be told. Returns {id, shifts, people}.
create or replace function public.publish_schedule(rid uuid, from_ts timestamptz, to_ts timestamptz)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  touched uuid[];
  shifts integer;
  saved uuid;
begin
  if not public.can_manage(rid, 'team') then
    raise exception 'You need Team access to publish the schedule.' using errcode = '42501';
  end if;
  if to_ts <= from_ts or to_ts - from_ts > interval '15 days' then
    raise exception 'Publish one or two weeks at a time.' using errcode = '22023';
  end if;
  with done as (
    update public.schedule_shifts set published = true
    where restaurant_id = rid and not published and starts_at >= from_ts and starts_at < to_ts
    returning user_id
  )
  select coalesce(array_agg(distinct user_id), '{}'), count(*) into touched, shifts from done;
  insert into public.schedule_publications(restaurant_id, starts_at, ends_at, shift_count, user_ids)
  values (rid, from_ts, to_ts, shifts, touched) returning id into saved;
  return jsonb_build_object('id', saved, 'shifts', shifts, 'people', cardinality(touched));
end $$;

-- The team as the schedule shows it: name and position, for everyone on the team to read.
create or replace function public.schedule_team(rid uuid)
returns table(user_id uuid, name text, role text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_read_restaurant(rid) then
    raise exception 'You do not have access to this restaurant.' using errcode = '42501';
  end if;
  return query
  with members as (
    select r.owner_id as uid from public.restaurants r where r.id = rid
    union select rm.user_id from public.restaurant_members rm where rm.restaurant_id = rid
  )
  select u.id,
    coalesce(nullif(trim(p.display_name), ''), nullif(trim(u.raw_user_meta_data->>'display_name'), ''), nullif(split_part(u.email::text, '@', 1), ''), 'Team member'),
    coalesce(p.role, case when u.id = (select r.owner_id from public.restaurants r where r.id = rid) then 'Manager' else 'Server' end)
  from members m
  join auth.users u on u.id = m.uid
  left join public.member_profiles p on p.restaurant_id = rid and p.user_id = u.id
  order by 2, 1;
end $$;

-- ── Availability: when someone can't work, every week ──
create table public.schedule_unavailability (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  weekday smallint not null check (weekday between 0 and 6), -- 0 is Sunday
  starts time,  -- both empty: the whole day
  ends time,
  note text not null default '' check (char_length(note) <= 200),
  check ((starts is null) = (ends is null) and (starts is null or ends > starts))
);
create index schedule_unavailability_by_restaurant on public.schedule_unavailability (restaurant_id, user_id);
alter table public.schedule_unavailability enable row level security;
create policy "People and schedulers read availability" on public.schedule_unavailability for select to authenticated
using (user_id = (select auth.uid()) or public.can_manage(restaurant_id, 'team'));
create policy "People and schedulers set availability" on public.schedule_unavailability for insert to authenticated
with check (public.is_on_team(restaurant_id, user_id)
  and ((user_id = (select auth.uid()) and public.can_read_restaurant(restaurant_id)) or public.can_manage(restaurant_id, 'team')));
create policy "People and schedulers clear availability" on public.schedule_unavailability for delete to authenticated
using (user_id = (select auth.uid()) or public.can_manage(restaurant_id, 'team'));
revoke all on public.schedule_unavailability from public, anon, authenticated;
grant select, insert, delete on public.schedule_unavailability to authenticated;

-- ── Time off ──
create table public.time_off_requests (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  starts_on date not null,
  ends_on date not null,
  note text not null default '' check (char_length(note) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'denied')),
  decided_by uuid references auth.users(id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (ends_on >= starts_on and ends_on <= starts_on + 60)
);
create index time_off_by_restaurant on public.time_off_requests (restaurant_id, starts_on);
alter table public.time_off_requests enable row level security;
create policy "People and schedulers read time off" on public.time_off_requests for select to authenticated
using (user_id = (select auth.uid()) or public.can_manage(restaurant_id, 'team'));
create policy "People ask for time off" on public.time_off_requests for insert to authenticated
with check (user_id = (select auth.uid()) and status = 'pending' and decided_by is null
  and public.is_on_team(restaurant_id, user_id) and starts_on >= current_date - 1);
create policy "People withdraw a pending request" on public.time_off_requests for delete to authenticated
using (user_id = (select auth.uid()) and status = 'pending');
revoke all on public.time_off_requests from public, anon, authenticated;
grant select, insert, delete on public.time_off_requests to authenticated;

create or replace function public.decide_time_off(request_id uuid, approve boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare rid uuid;
begin
  select t.restaurant_id into rid from public.time_off_requests t where t.id = request_id;
  if rid is null or not public.can_manage(rid, 'team') then
    raise exception 'You need Team access to decide time off.' using errcode = '42501';
  end if;
  update public.time_off_requests
  set status = case when approve then 'approved' else 'denied' end, decided_by = (select auth.uid()), decided_at = now()
  where id = request_id and status = 'pending';
  if not found then raise exception 'That request was already decided.' using errcode = '22023'; end if;
end $$;

-- ── Notifications: the schedule's events, added to 039's ──
create or replace function public.push_audience(event text, ref uuid, target uuid default null)
returns table(restaurant_name text, user_ids uuid[])
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  rid uuid;
  people uuid[];
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
    select s.restaurant_id into rid from public.shift_reports s where s.id = ref and s.urgent and s.submitted_by = me;
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
  else
    raise exception 'Unknown event' using errcode = '22023';
  end if;
  return query select (select r.name from public.restaurants r where r.id = rid), coalesce(array_remove(people, me), '{}');
end $$;

revoke all on function public.publish_schedule(uuid, timestamptz, timestamptz), public.schedule_team(uuid),
  public.decide_time_off(uuid, boolean), public.push_audience(text, uuid, uuid) from public, anon;
grant execute on function public.publish_schedule(uuid, timestamptz, timestamptz), public.schedule_team(uuid),
  public.decide_time_off(uuid, boolean), public.push_audience(text, uuid, uuid) to authenticated;

commit;
