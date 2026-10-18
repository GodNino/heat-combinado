-- Run once, after 037. The end-of-shift report: what used to be a free-text message to the GM,
-- operations manager, managers and owners, now a short structured form that HEAT pre-fills.
--
-- Who does what (no new access chip, so the Team screen doesn't change):
--   * whoever holds Pre-shift (they run service) writes tonight's report;
--   * whoever holds Pre-shift or Team at the location reads its reports, and so do the owner and
--     the brand owner (is_restaurant_owner), who also get the whole brand's feed.
-- Extra people who should get the email without using HEAT go in shift_report_recipients.
--
-- What HEAT already knows (tonight's 86 list, the checklists, who was on the floor, quizzes taken)
-- is captured by the database when the report is submitted, so it can't be edited after the fact.
-- Additive only: two new tables and new functions. Nothing existing changes.
begin;

create table public.shift_reports (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  service_date date not null default current_date,
  label text not null default 'Dinner' check (char_length(btrim(label)) between 1 and 30),
  mood text not null check (mood in ('great', 'ok', 'rough')),
  covers integer check (covers between 0 and 100000),
  sales numeric(12,2) check (sales between 0 and 100000000),
  -- Each issue: {kind, note}. Kinds: complaint, allergy, injury, equipment, staff, other.
  issues jsonb not null default '[]' check (jsonb_typeof(issues) = 'array' and jsonb_array_length(issues) <= 30),
  urgent boolean not null default false,
  low_stock text not null default '' check (char_length(low_stock) <= 1000),
  shoutouts text not null default '' check (char_length(shoutouts) <= 1000),
  next_shift text not null default '' check (char_length(next_shift) <= 1000),
  notes text not null default '' check (char_length(notes) <= 4000),
  -- Snapshot taken by the database at submit time: {eighty_six:[...], checklists:{...}, on_floor:[...], quizzes:n}
  from_heat jsonb not null default '{}',
  submitted_by uuid not null references auth.users(id),
  submitted_at timestamptz not null default now(),
  unique (restaurant_id, service_date, label)
);
create index shift_reports_by_restaurant on public.shift_reports (restaurant_id, service_date desc);
alter table public.shift_reports enable row level security;
create policy "Managers read shift reports" on public.shift_reports for select to authenticated
using (public.can_manage(restaurant_id, 'preshift') or public.can_manage(restaurant_id, 'team'));
-- Written only through submit_shift_report below, so the snapshot is always the database's own.
revoke all on public.shift_reports from public, anon, authenticated;
grant select on public.shift_reports to authenticated;

create table public.shift_report_recipients (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  email text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' and char_length(email) <= 254),
  added_by uuid not null default auth.uid() references auth.users(id),
  primary key (restaurant_id, email)
);
alter table public.shift_report_recipients enable row level security;
create policy "Team managers read report recipients" on public.shift_report_recipients for select to authenticated
using (public.can_manage(restaurant_id, 'team'));
create policy "Team managers add report recipients" on public.shift_report_recipients for insert to authenticated
with check (public.can_manage(restaurant_id, 'team') and added_by = (select auth.uid()));
create policy "Team managers remove report recipients" on public.shift_report_recipients for delete to authenticated
using (public.can_manage(restaurant_id, 'team'));
revoke all on public.shift_report_recipients from public, anon, authenticated;
grant select, insert, delete on public.shift_report_recipients to authenticated;

-- What HEAT already knows about one service day at this location.
-- The day comes from the manager's device, not the database clock: the database runs on UTC, so a
-- Miami dinner report sent after 8 pm would otherwise land on tomorrow and find no pre-shift at all.
-- It may be at most a day either side of the database's date.
create or replace function public.shift_report_draft(rid uuid, day date default current_date)
returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.can_manage(rid, 'preshift') then
    raise exception 'You need pre-shift access to write the shift report.' using errcode = '42501';
  end if;
  if day is null or day not between current_date - 1 and current_date + 1 then
    raise exception 'A shift report is for today''s service.' using errcode = '22023';
  end if;
  return jsonb_build_object(
    'eighty_six', coalesce((
      select jsonb_agg(jsonb_build_object('name', m.name, 'status', e.status, 'detail', e.detail) order by e.status, m.name)
      from public.shift_notes n
      join public.shift_board_entries e on e.shift_note_id = n.id
      join public.menu_items m on m.id = e.menu_item_id
      where n.restaurant_id = rid and n.service_date = day and e.status in ('86', 'low')
    ), '[]'::jsonb),
    'checklists', (
      select jsonb_build_object(
        'total', count(a.id),
        'done', count(a.id) filter (where a.done_at is not null),
        'missing', coalesce(jsonb_agg(a.title order by a.sort_order, a.title) filter (where a.done_at is null), '[]'::jsonb))
      from public.checklist_shifts s
      join public.checklist_assignments a on a.shift_id = s.id
      where s.restaurant_id = rid and s.shift_date = day and s.status <> 'draft'
    ),
    'on_floor', coalesce((
      select jsonb_agg(distinct names.name)
      from public.checklist_shifts s
      join public.checklist_floor f on f.shift_id = s.id
      join public.checklist_names(rid) names on names.user_id = f.user_id
      where s.restaurant_id = rid and s.shift_date = day and s.status <> 'draft'
    ), '[]'::jsonb),
    'quizzes', (
      select count(*) from public.quiz_attempts a join public.menu_items m on m.id = a.menu_item_id
      where m.restaurant_id = rid and a.total > 0 and a.created_at > now() - interval '18 hours'
    )
  );
end $$;

-- Saves tonight's report (one per location, day and service; sending it again replaces it).
-- The service day comes from the manager's device, as in shift_report_draft.
-- Allergy and injury issues always make the report urgent.
create or replace function public.submit_shift_report(rid uuid, report jsonb)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  kinds constant text[] := array['complaint', 'allergy', 'injury', 'equipment', 'staff', 'other'];
  saved uuid;
  issue jsonb;
  day date := coalesce(nullif(report->>'service_date', '')::date, current_date);
begin
  if not public.can_manage(rid, 'preshift') then
    raise exception 'You need pre-shift access to write the shift report.' using errcode = '42501';
  end if;
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
    submitted_by = excluded.submitted_by, submitted_at = now()
  returning id into saved;
  return saved;
end $$;

-- Who gets the email: everyone who manages this location in HEAT (owner, brand owner, Pre-shift or
-- Team access), plus the extra addresses. Only someone who can read the report can ask.
create or replace function public.shift_report_recipients(report_id uuid)
returns table(email text)
language plpgsql stable security definer set search_path = '' as $$
declare rid uuid;
begin
  select r.restaurant_id into rid from public.shift_reports r where r.id = report_id;
  if rid is null or not (public.can_manage(rid, 'preshift') or public.can_manage(rid, 'team')) then
    raise exception 'Report unavailable' using errcode = '42501';
  end if;
  return query
  select distinct lower(found.email) from (
    select u.email::text as email from public.restaurants r join auth.users u on u.id = r.owner_id where r.id = rid
    union all
    select u.email::text from public.restaurants r join public.organizations o on o.id = r.organization_id
      join auth.users u on u.id = o.owner_id where r.id = rid
    union all
    select u.email::text from public.restaurant_members m join auth.users u on u.id = m.user_id
      where m.restaurant_id = rid and m.access && array['preshift', 'team']::text[]
    union all
    select x.email from public.shift_report_recipients x where x.restaurant_id = rid
  ) found
  where found.email is not null and found.email <> '';
end $$;

-- The brand's feed: every location's reports for the last N days, for the brand owner.
create or replace function public.brand_shift_reports(oid uuid, days integer default 14)
returns setof public.shift_reports
language plpgsql stable security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.organizations o where o.id = oid and o.owner_id = (select auth.uid())) then
    raise exception 'Only the owner of the brand can see every location''s reports.' using errcode = '42501';
  end if;
  return query
  select s.* from public.shift_reports s join public.restaurants r on r.id = s.restaurant_id
  where r.organization_id = oid and s.service_date >= current_date - greatest(1, least(days, 90))
  order by s.service_date desc, s.submitted_at desc;
end $$;

revoke all on function public.shift_report_draft(uuid, date), public.submit_shift_report(uuid, jsonb),
  public.shift_report_recipients(uuid), public.brand_shift_reports(uuid, integer) from public, anon;
grant execute on function public.shift_report_draft(uuid, date), public.submit_shift_report(uuid, jsonb),
  public.shift_report_recipients(uuid), public.brand_shift_reports(uuid, integer) to authenticated;

commit;
