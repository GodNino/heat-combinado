-- Run once, after 045. Past shift reports can be corrected and deleted, and every report says who
-- wrote it and who changed it last.
--
--   * submitted_by keeps meaning "who wrote it": sending tonight's report again no longer replaces
--     the writer. The new updated_by / updated_at say who changed it last, and when.
--   * update_shift_report: a manager who can read the report (Pre-shift or Team access) corrects what
--     was typed: service, the night, covers, sales, issues, low stock, shout-outs, next shift, notes.
--     What HEAT recorded at submit time (from_heat) and the service day stay as they were.
--   * delete_shift_report: Team access (and the owner), or whoever wrote it.
--   * push_audience: an urgent report can be announced by whoever wrote it or changed it last
--     (everything else is 045's version, word for word).
--
-- Changes to things that exist: two columns on shift_reports, and new versions of
-- submit_shift_report and push_audience. No report is changed or deleted by running this.
begin;

alter table public.shift_reports
  add column updated_by uuid references auth.users(id) on delete set null,
  add column updated_at timestamptz;

-- The checks every report goes through, written once for sending and for correcting.
create or replace function public.shift_report_check(report jsonb)
returns void language plpgsql immutable set search_path = '' as $$
declare
  kinds constant text[] := array['complaint', 'allergy', 'injury', 'equipment', 'staff', 'other'];
  issue jsonb;
begin
  if coalesce(report->>'mood', '') not in ('great', 'ok', 'rough') then
    raise exception 'Choose how the night went.' using errcode = '23514';
  end if;
  if jsonb_typeof(coalesce(report->'issues', '[]'::jsonb)) <> 'array' then
    raise exception 'Issues must be a list.' using errcode = '23514';
  end if;
  for issue in select value from jsonb_array_elements(coalesce(report->'issues', '[]'::jsonb)) loop
    if not (issue->>'kind' = any(kinds)) or char_length(coalesce(issue->>'note', '')) > 1000 then
      raise exception 'Each issue needs a known kind and a note under 1000 characters.' using errcode = '23514';
    end if;
  end loop;
end $$;

-- 038's submit, except that sending again keeps who wrote it and records who changed it.
create or replace function public.submit_shift_report(rid uuid, report jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  saved uuid;
  day date := coalesce(nullif(report->>'service_date', '')::date, current_date);
begin
  if not public.can_manage(rid, 'preshift') then
    raise exception 'You need pre-shift access to write the shift report.' using errcode = '42501';
  end if;
  perform public.shift_report_check(report);
  insert into public.shift_reports(restaurant_id, service_date, label, mood, covers, sales, issues, urgent,
    low_stock, shoutouts, next_shift, notes, from_heat, submitted_by)
  values (rid, day,
    coalesce(nullif(btrim(report->>'label'), ''), 'Dinner'),
    report->>'mood',
    nullif(report->>'covers', '')::integer,
    nullif(report->>'sales', '')::numeric,
    coalesce(report->'issues', '[]'::jsonb),
    exists (select 1 from jsonb_array_elements(coalesce(report->'issues', '[]'::jsonb)) i where i->>'kind' in ('allergy', 'injury')),
    coalesce(btrim(report->>'low_stock'), ''),
    coalesce(btrim(report->>'shoutouts'), ''),
    coalesce(btrim(report->>'next_shift'), ''),
    coalesce(btrim(report->>'notes'), ''),
    public.shift_report_draft(rid, day),
    (select auth.uid()))
  on conflict (restaurant_id, service_date, label) do update set
    mood = excluded.mood, covers = excluded.covers, sales = excluded.sales, issues = excluded.issues,
    urgent = excluded.urgent, low_stock = excluded.low_stock, shoutouts = excluded.shoutouts,
    next_shift = excluded.next_shift, notes = excluded.notes, from_heat = excluded.from_heat,
    updated_by = (select auth.uid()), updated_at = now()
  returning id into saved;
  return saved;
end $$;

-- Correcting a past report. Returns whether it is urgent now, so the screen knows to tell phones.
create or replace function public.update_shift_report(report_id uuid, report jsonb)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare r public.shift_reports; now_urgent boolean;
begin
  select * into r from public.shift_reports where id = report_id for update;
  if r.id is null or not (public.can_manage(r.restaurant_id, 'preshift') or public.can_manage(r.restaurant_id, 'team')) then
    raise exception 'You can''t change this report.' using errcode = '42501';
  end if;
  perform public.shift_report_check(report);
  now_urgent := exists (select 1 from jsonb_array_elements(coalesce(report->'issues', '[]'::jsonb)) i where i->>'kind' in ('allergy', 'injury'));
  update public.shift_reports set
    label = coalesce(nullif(btrim(report->>'label'), ''), r.label),
    mood = report->>'mood',
    covers = nullif(report->>'covers', '')::integer,
    sales = nullif(report->>'sales', '')::numeric,
    issues = coalesce(report->'issues', '[]'::jsonb),
    urgent = now_urgent,
    low_stock = coalesce(btrim(report->>'low_stock'), ''),
    shoutouts = coalesce(btrim(report->>'shoutouts'), ''),
    next_shift = coalesce(btrim(report->>'next_shift'), ''),
    notes = coalesce(btrim(report->>'notes'), ''),
    updated_by = (select auth.uid()), updated_at = now()
  where id = report_id;
  return now_urgent;
exception when unique_violation then
  raise exception 'There''s already a % report for that day.', btrim(report->>'label') using errcode = '23505';
end $$;

create or replace function public.delete_shift_report(report_id uuid)
returns void
language plpgsql security definer set search_path = '' as $$
declare r public.shift_reports;
begin
  select * into r from public.shift_reports where id = report_id;
  if r.id is null or not (public.can_manage(r.restaurant_id, 'team')
     or (r.submitted_by = (select auth.uid()) and public.can_manage(r.restaurant_id, 'preshift'))) then
    raise exception 'Only someone with Team access, or whoever wrote it, can delete this report.' using errcode = '42501';
  end if;
  delete from public.shift_reports where id = report_id;
end $$;

-- The names behind a report, for the screen and the printed copy.
create or replace function public.shift_report_names(report_id uuid)
returns table(written_by text, changed_by text)
language plpgsql stable security definer set search_path = '' as $$
declare r public.shift_reports;
begin
  select * into r from public.shift_reports where id = report_id;
  if r.id is null or not (public.can_manage(r.restaurant_id, 'preshift') or public.can_manage(r.restaurant_id, 'team')
     or exists (select 1 from public.restaurants x join public.organizations o on o.id = x.organization_id
                where x.id = r.restaurant_id and o.owner_id = (select auth.uid()))) then
    raise exception 'Report unavailable' using errcode = '42501';
  end if;
  return query select
    coalesce(public.poster_name(r.restaurant_id, r.submitted_by), 'Team member'),
    case when r.updated_by is null then null else coalesce(public.poster_name(r.restaurant_id, r.updated_by), 'Team member') end;
end $$;

-- ── Phone notifications (045's push_audience; an urgent report may be announced by whoever wrote it or changed it last) ──
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

revoke all on function public.shift_report_check(jsonb), public.update_shift_report(uuid, jsonb), public.delete_shift_report(uuid),
  public.shift_report_names(uuid), public.submit_shift_report(uuid, jsonb), public.push_audience(text, uuid, uuid) from public, anon;
grant execute on function public.update_shift_report(uuid, jsonb), public.delete_shift_report(uuid), public.shift_report_names(uuid),
  public.submit_shift_report(uuid, jsonb), public.push_audience(text, uuid, uuid) to authenticated;

commit;
