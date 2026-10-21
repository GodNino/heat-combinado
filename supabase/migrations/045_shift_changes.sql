-- Run once, after 044. Shift changes, stage 2 of replacing Sling: someone who can't work a published
-- shift releases it, offers it to a coworker, or swaps it for a coworker's.
--
-- The rules, all kept here in the database rather than on the screen:
--   * a manager (Team access) always approves; until then the shift stays with whoever had it;
--   * changes close a set number of hours before the shift (schedule_settings.change_cutoff_hours,
--     24 by default, 0 for any time before it starts);
--   * a released shift can only be taken by someone in the same position (bartender for bartender,
--     server for server). Offering or swapping with someone from another area is possible, but it is
--     marked other_area so the manager sees it plainly;
--   * nobody ends up on two shifts at once: overlaps are refused when asked, answered and approved.
--
-- How a change moves:  release:  open -> pending (someone took it) -> approved | denied
--                      offer / swap:  asked -> pending (the coworker said yes) | declined -> approved | denied
--                      and the person who asked can cancel until it's decided.
-- Changing or deleting a shift cancels any change still waiting on it.
--
-- Changes to things that exist: a new column on schedule_settings, and a new version of push_audience
-- (039/040) that knows these notifications; every event it knew is kept word for word.
begin;

alter table public.schedule_settings add column change_cutoff_hours smallint not null default 24
  check (change_cutoff_hours between 0 and 336);

create table public.shift_changes (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  kind text not null check (kind in ('release', 'offer', 'swap')),
  shift_id uuid not null references public.schedule_shifts(id) on delete cascade,
  requested_by uuid not null references auth.users(id) on delete cascade,
  -- Who would work shift_id: chosen for an offer or swap, whoever takes a release.
  taker_id uuid references auth.users(id) on delete cascade,
  -- In a swap, the coworker's shift that comes back to the person asking.
  swap_shift_id uuid references public.schedule_shifts(id) on delete cascade,
  other_area boolean not null default false,
  note text not null default '' check (char_length(note) <= 300),
  status text not null default 'open' check (status in ('open', 'asked', 'pending', 'approved', 'denied', 'declined', 'cancelled')),
  created_at timestamptz not null default now(),
  answered_at timestamptz,
  decided_at timestamptz,
  decided_by uuid references auth.users(id) on delete set null,
  check ((kind = 'swap') = (swap_shift_id is not null)),
  check (kind = 'release' or taker_id is not null),
  check (taker_id is null or taker_id <> requested_by)
);
create unique index shift_changes_one_live on public.shift_changes (shift_id) where status in ('open', 'asked', 'pending');
create unique index shift_changes_one_live_swap on public.shift_changes (swap_shift_id) where swap_shift_id is not null and status in ('asked', 'pending');
create index shift_changes_by_restaurant on public.shift_changes (restaurant_id, status);
alter table public.shift_changes enable row level security;
create policy "People involved and schedulers read shift changes" on public.shift_changes for select to authenticated
using (public.can_manage(restaurant_id, 'team') or requested_by = (select auth.uid()) or taker_id = (select auth.uid())
       or (status = 'open' and public.can_read_restaurant(restaurant_id)));
revoke all on public.shift_changes from public, anon, authenticated;
grant select on public.shift_changes to authenticated;

-- ── Helpers ──
-- Someone's position here, as the schedule shows it.
create or replace function public.person_area(rid uuid, uid uuid)
returns text language sql stable security definer set search_path = '' as $$
  select coalesce(
    (select p.role from public.member_profiles p where p.restaurant_id = rid and p.user_id = uid),
    case when exists (select 1 from public.restaurants r where r.id = rid and r.owner_id = uid) then 'Manager' else 'Server' end);
$$;
create or replace function public.same_area(a text, b text)
returns boolean language sql immutable set search_path = '' as $$
  select lower(btrim(coalesce(a, ''))) = lower(btrim(coalesce(b, '')));
$$;
-- Whether changes are still open for a shift that starts then.
create or replace function public.change_window_open(rid uuid, starts timestamptz)
returns boolean language sql stable security definer set search_path = '' as $$
  select starts > now() + make_interval(hours => coalesce((select s.change_cutoff_hours from public.schedule_settings s where s.restaurant_id = rid), 24));
$$;
-- Whether this person already works some of that time, leaving out the shifts the change hands over.
create or replace function public.busy_then(rid uuid, uid uuid, starts timestamptz, ends timestamptz, leaving uuid[])
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.schedule_shifts s where s.restaurant_id = rid and s.user_id = uid
    and not (s.id = any(coalesce(leaving, '{}'))) and s.starts_at < ends and s.ends_at > starts);
$$;

-- ── Asking ──
create or replace function public.release_shift(shift uuid, note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); s public.schedule_shifts; made uuid;
begin
  select * into s from public.schedule_shifts where id = shift and user_id = me and published;
  if s.id is null then raise exception 'This isn''t one of your published shifts.' using errcode = '42501'; end if;
  if not public.change_window_open(s.restaurant_id, s.starts_at) then raise exception 'It''s too close to the shift to change it here. Talk to your manager.' using errcode = '22023'; end if;
  if exists (select 1 from public.shift_changes c where c.swap_shift_id = shift and c.status in ('asked', 'pending')) then
    raise exception 'Someone asked to swap for this shift. Answer that first.' using errcode = '22023';
  end if;
  insert into public.shift_changes(restaurant_id, kind, shift_id, requested_by, note, status)
  values (s.restaurant_id, 'release', shift, me, btrim(coalesce(note, '')), 'open') returning id into made;
  return made;
exception when unique_violation then raise exception 'This shift already has a change waiting.' using errcode = '23505';
end $$;

create or replace function public.offer_shift(shift uuid, to_user uuid, note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); s public.schedule_shifts; made uuid;
begin
  select * into s from public.schedule_shifts where id = shift and user_id = me and published;
  if s.id is null then raise exception 'This isn''t one of your published shifts.' using errcode = '42501'; end if;
  if not public.change_window_open(s.restaurant_id, s.starts_at) then raise exception 'It''s too close to the shift to change it here. Talk to your manager.' using errcode = '22023'; end if;
  if to_user is null or to_user = me or not public.is_on_team(s.restaurant_id, to_user) then raise exception 'Choose someone on your team.' using errcode = '22023'; end if;
  if public.busy_then(s.restaurant_id, to_user, s.starts_at, s.ends_at, '{}') then raise exception 'They already work during that shift.' using errcode = '22023'; end if;
  insert into public.shift_changes(restaurant_id, kind, shift_id, requested_by, taker_id, other_area, note, status)
  values (s.restaurant_id, 'offer', shift, me, to_user, not public.same_area(s.position, public.person_area(s.restaurant_id, to_user)),
          btrim(coalesce(note, '')), 'asked') returning id into made;
  return made;
exception when unique_violation then raise exception 'This shift already has a change waiting.' using errcode = '23505';
end $$;

create or replace function public.swap_shift(shift uuid, their_shift uuid, note text default '')
returns uuid language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); mine public.schedule_shifts; theirs public.schedule_shifts; made uuid;
begin
  select * into mine from public.schedule_shifts where id = shift and user_id = me and published;
  if mine.id is null then raise exception 'This isn''t one of your published shifts.' using errcode = '42501'; end if;
  select * into theirs from public.schedule_shifts where id = their_shift and restaurant_id = mine.restaurant_id and published and user_id <> me;
  if theirs.id is null then raise exception 'Choose a published shift of a coworker.' using errcode = '22023'; end if;
  if not public.change_window_open(mine.restaurant_id, least(mine.starts_at, theirs.starts_at)) then
    raise exception 'It''s too close to the shift to change it here. Talk to your manager.' using errcode = '22023';
  end if;
  if public.busy_then(mine.restaurant_id, theirs.user_id, mine.starts_at, mine.ends_at, array[theirs.id]) then raise exception 'They already work during your shift.' using errcode = '22023'; end if;
  if public.busy_then(mine.restaurant_id, me, theirs.starts_at, theirs.ends_at, array[mine.id]) then raise exception 'You already work during their shift.' using errcode = '22023'; end if;
  if exists (select 1 from public.shift_changes c where c.shift_id = their_shift and c.status in ('open', 'asked', 'pending')) then
    raise exception 'That shift already has a change waiting.' using errcode = '22023';
  end if;
  insert into public.shift_changes(restaurant_id, kind, shift_id, requested_by, taker_id, swap_shift_id, other_area, note, status)
  values (mine.restaurant_id, 'swap', shift, me, theirs.user_id, their_shift,
          not public.same_area(mine.position, public.person_area(mine.restaurant_id, theirs.user_id))
          or not public.same_area(theirs.position, public.person_area(mine.restaurant_id, me)),
          btrim(coalesce(note, '')), 'asked') returning id into made;
  return made;
exception when unique_violation then raise exception 'One of these shifts already has a change waiting.' using errcode = '23505';
end $$;

-- ── Answering ──
-- A released shift is for someone in the same position, who isn't working then.
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
  update public.shift_changes set taker_id = me, status = 'pending', answered_at = now() where id = change;
end $$;

create or replace function public.answer_shift_change(change uuid, accept boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); c public.shift_changes; s public.schedule_shifts; back public.schedule_shifts;
begin
  select * into c from public.shift_changes where id = change and status = 'asked' and taker_id = me for update;
  if c.id is null then raise exception 'This request is no longer waiting for you.' using errcode = '22023'; end if;
  if accept then
    select * into s from public.schedule_shifts where id = c.shift_id;
    if s.starts_at <= now() then raise exception 'This shift has already started.' using errcode = '22023'; end if;
    if public.busy_then(c.restaurant_id, me, s.starts_at, s.ends_at, case when c.swap_shift_id is null then '{}'::uuid[] else array[c.swap_shift_id] end) then
      raise exception 'You already work during that shift.' using errcode = '22023';
    end if;
    if c.kind = 'swap' then
      select * into back from public.schedule_shifts where id = c.swap_shift_id;
      if public.busy_then(c.restaurant_id, c.requested_by, back.starts_at, back.ends_at, array[c.shift_id]) then
        raise exception 'They already work during your shift now.' using errcode = '22023';
      end if;
    end if;
  end if;
  update public.shift_changes set status = case when accept then 'pending' else 'declined' end, answered_at = now() where id = change;
end $$;

create or replace function public.cancel_shift_change(change uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  update public.shift_changes set status = 'cancelled', answered_at = coalesce(answered_at, now())
  where id = change and requested_by = (select auth.uid()) and status in ('open', 'asked', 'pending');
  if not found then raise exception 'This request can''t be cancelled any more.' using errcode = '22023'; end if;
end $$;

-- ── Deciding ──
-- The manager's yes moves the shift (both shifts in a swap), still published, to whoever takes it.
create or replace function public.decide_shift_change(change uuid, approve boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare c public.shift_changes; s public.schedule_shifts; back public.schedule_shifts;
begin
  select * into c from public.shift_changes where id = change for update;
  if c.id is null or not public.can_manage(c.restaurant_id, 'team') then raise exception 'You need Team access to decide shift changes.' using errcode = '42501'; end if;
  if c.status <> 'pending' then raise exception 'This change isn''t waiting for a decision.' using errcode = '22023'; end if;
  if approve then
    select * into s from public.schedule_shifts where id = c.shift_id;
    if s.user_id <> c.requested_by then raise exception 'This shift has changed hands since. Deny it and ask again.' using errcode = '22023'; end if;
    if s.starts_at <= now() then raise exception 'This shift has already started.' using errcode = '22023'; end if;
    if c.kind = 'swap' then
      select * into back from public.schedule_shifts where id = c.swap_shift_id;
      if back.user_id <> c.taker_id then raise exception 'Their shift has changed hands since. Deny it and ask again.' using errcode = '22023'; end if;
      if public.busy_then(c.restaurant_id, c.requested_by, back.starts_at, back.ends_at, array[c.shift_id]) then raise exception 'That would double-book %.', public.poster_name(c.restaurant_id, c.requested_by) using errcode = '22023'; end if;
    end if;
    if public.busy_then(c.restaurant_id, c.taker_id, s.starts_at, s.ends_at, case when c.swap_shift_id is null then '{}'::uuid[] else array[c.swap_shift_id] end) then
      raise exception 'That would double-book %.', public.poster_name(c.restaurant_id, c.taker_id) using errcode = '22023';
    end if;
    -- Decided first, so moving the shifts doesn't cancel this very change.
    update public.shift_changes set status = 'approved', decided_at = now(), decided_by = (select auth.uid()) where id = change;
    update public.schedule_shifts set user_id = c.taker_id where id = c.shift_id;
    if c.kind = 'swap' then update public.schedule_shifts set user_id = c.requested_by where id = c.swap_shift_id; end if;
    -- Moving a shift makes it a draft (040); an approved change stays published.
    update public.schedule_shifts set published = true where id in (c.shift_id, coalesce(c.swap_shift_id, c.shift_id));
  else
    update public.shift_changes set status = 'denied', decided_at = now(), decided_by = (select auth.uid()) where id = change;
  end if;
end $$;

-- A shift that's edited or moved by hand no longer matches what people agreed to: drop what's waiting on it.
create or replace function public.shift_changes_follow_shift()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.user_id, new.position, new.starts_at, new.ends_at) is distinct from (old.user_id, old.position, old.starts_at, old.ends_at) then
    update public.shift_changes set status = 'cancelled', answered_at = coalesce(answered_at, now())
    where status in ('open', 'asked', 'pending') and (shift_id = new.id or swap_shift_id = new.id);
  end if;
  return new;
end $$;
create trigger shift_changes_follow_shift after update on public.schedule_shifts
for each row execute function public.shift_changes_follow_shift();

-- ── Reading ──
-- Everything about the changes a person may see, with names and times, in one list:
-- managers see the whole restaurant; everyone else sees their own, the ones asked of them,
-- and released shifts in their position.
create or replace function public.shift_change_list(rid uuid)
returns table(id uuid, kind text, status text, other_area boolean, note text, created_at timestamptz, decided_at timestamptz,
  requested_by uuid, requester_name text, taker_id uuid, taker_name text,
  shift_id uuid, shift_position text, shift_starts timestamptz, shift_ends timestamptz,
  swap_shift_id uuid, swap_position text, swap_starts timestamptz, swap_ends timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); boss boolean;
begin
  if not public.can_read_restaurant(rid) then raise exception 'You do not have access to this restaurant.' using errcode = '42501'; end if;
  boss := public.can_manage(rid, 'team');
  return query
  select c.id, c.kind, c.status, c.other_area, c.note, c.created_at, c.decided_at,
    c.requested_by, public.poster_name(rid, c.requested_by), c.taker_id, case when c.taker_id is null then null else public.poster_name(rid, c.taker_id) end,
    s.id, s.position, s.starts_at, s.ends_at, b.id, b.position, b.starts_at, b.ends_at
  from public.shift_changes c
  join public.schedule_shifts s on s.id = c.shift_id
  left join public.schedule_shifts b on b.id = c.swap_shift_id
  where c.restaurant_id = rid
    and (c.status in ('open', 'asked', 'pending') or coalesce(c.decided_at, c.answered_at, c.created_at) > now() - interval '14 days')
    and (boss or c.requested_by = me or c.taker_id = me
         or (c.status = 'open' and public.same_area(s.position, public.person_area(rid, me))))
  order by case c.status when 'pending' then 0 when 'asked' then 1 when 'open' then 2 else 3 end, s.starts_at;
end $$;

-- Who a shift can go to: the team with their position, whether they're in the same area, and
-- whether they already work then. For swaps, their published shifts coming up.
create or replace function public.shift_change_people(shift uuid)
returns table(user_id uuid, name text, role text, same_area boolean, busy boolean)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); s public.schedule_shifts;
begin
  select * into s from public.schedule_shifts x where x.id = shift and x.user_id = me;
  if s.id is null then raise exception 'This isn''t one of your shifts.' using errcode = '42501'; end if;
  return query
  select t.user_id, t.name, t.role, public.same_area(s.position, t.role), public.busy_then(s.restaurant_id, t.user_id, s.starts_at, s.ends_at, '{}')
  from public.schedule_team(s.restaurant_id) t where t.user_id <> me order by 4 desc, 2;
end $$;

create or replace function public.shift_swap_choices(shift uuid)
returns table(shift_id uuid, user_id uuid, name text, role text, shift_position text, starts_at timestamptz, ends_at timestamptz, same_area boolean)
language plpgsql stable security definer set search_path = '' as $$
declare me uuid := (select auth.uid()); s public.schedule_shifts;
begin
  select * into s from public.schedule_shifts x where x.id = shift and x.user_id = me;
  if s.id is null then raise exception 'This isn''t one of your shifts.' using errcode = '42501'; end if;
  return query
  select o.id, o.user_id, t.name, t.role, o.position, o.starts_at, o.ends_at, public.same_area(o.position, s.position)
  from public.schedule_shifts o join public.schedule_team(s.restaurant_id) t on t.user_id = o.user_id
  where o.restaurant_id = s.restaurant_id and o.published and o.user_id <> me
    and public.change_window_open(s.restaurant_id, o.starts_at) and o.starts_at < now() + interval '28 days'
    and not exists (select 1 from public.shift_changes c where (c.shift_id = o.id or c.swap_shift_id = o.id) and c.status in ('open', 'asked', 'pending'))
  order by 8 desc, o.starts_at;
end $$;

-- ── Phone notifications: push_audience (040) plus the shift-change events ──
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
  elsif event in ('shift_released', 'shift_offered', 'shift_change_pending', 'shift_change_declined', 'shift_change_decided') then
    select * into c from public.shift_changes where id = ref;
    if c.id is null then raise exception 'No shift change to announce' using errcode = '42501'; end if;
    rid := c.restaurant_id;
    if event = 'shift_released' and c.requested_by = me and c.status = 'open' then
      -- Everyone in the shift's position.
      select coalesce(array_agg(t.user_id), '{}') into people from public.schedule_team(rid) t
      where public.same_area(t.role, (select s.position from public.schedule_shifts s where s.id = c.shift_id));
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

revoke all on function public.person_area(uuid, uuid), public.change_window_open(uuid, timestamptz), public.busy_then(uuid, uuid, timestamptz, timestamptz, uuid[]),
  public.release_shift(uuid, text), public.offer_shift(uuid, uuid, text), public.swap_shift(uuid, uuid, text),
  public.take_released_shift(uuid), public.answer_shift_change(uuid, boolean), public.cancel_shift_change(uuid), public.decide_shift_change(uuid, boolean),
  public.shift_change_list(uuid), public.shift_change_people(uuid), public.shift_swap_choices(uuid), public.push_audience(text, uuid, uuid) from public, anon;
grant execute on function public.release_shift(uuid, text), public.offer_shift(uuid, uuid, text), public.swap_shift(uuid, uuid, text),
  public.take_released_shift(uuid), public.answer_shift_change(uuid, boolean), public.cancel_shift_change(uuid), public.decide_shift_change(uuid, boolean),
  public.shift_change_list(uuid), public.shift_change_people(uuid), public.shift_swap_choices(uuid), public.push_audience(text, uuid, uuid) to authenticated;

commit;
