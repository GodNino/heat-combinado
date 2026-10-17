-- 033_checklists.sql
-- Checklists: saved jobs, who is working today, who does which job, and the ticks.
--
-- Additive only. Four new tables and a handful of new functions. There is no
-- "drop" anywhere in this file and nothing that already exists is changed.
-- Safe to run today: until the Checklists screens ship, nothing in the app reads these.
--
-- Who can do what
--   * Everyone on the team can READ the posted shift (so each person sees the whole floor).
--   * Managing (saved jobs, who is working, assigning, posting) needs the existing
--     "Pre-shift" chip -- the same one that lets someone post the pre-shift board.
--     The owner always has it. No new chip, so nothing changes on the Team screen.
--   * Staff can only touch their OWN job, and only through the small functions at
--     the bottom: tick a step, mark the job done, leave a note.
--
-- Steps are copied onto each assignment when it is made. That way, editing a saved job
-- later never rewrites what happened on a past shift, and one-off jobs need no saved job.
begin;

-- ---------- Saved jobs (the library the manager builds once) ----------
create table public.checklist_jobs (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  group_name text not null default '' check (char_length(group_name) <= 60),
  steps text[] not null default '{}' check (cardinality(steps) <= 30),
  sort_order integer not null default 0,
  archived boolean not null default false,
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id)
);
create unique index checklist_jobs_one_per_name
  on public.checklist_jobs (restaurant_id, lower(btrim(name))) where not archived;

-- ---------- A shift: one service on one day ----------
create table public.checklist_shifts (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  shift_date date not null default current_date,
  label text not null default 'Service' check (char_length(btrim(label)) between 1 and 40),
  -- draft: the manager is still choosing. posted: the floor can see it. closed: finished.
  status text not null default 'draft' check (status in ('draft', 'posted', 'closed')),
  posted_at timestamptz,
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id),
  unique (restaurant_id, shift_date, label)
);

-- ---------- Who is working that shift ----------
create table public.checklist_floor (
  shift_id uuid not null references public.checklist_shifts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (shift_id, user_id)
);

-- ---------- Who does which job, and how far they got ----------
create table public.checklist_assignments (
  id uuid primary key default gen_random_uuid(),
  shift_id uuid not null references public.checklist_shifts(id) on delete cascade,
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  -- Empty for a one-off job made just for today.
  job_id uuid references public.checklist_jobs(id) on delete set null,
  title text not null check (char_length(btrim(title)) between 1 and 80),
  group_name text not null default '' check (char_length(group_name) <= 60),
  steps text[] not null default '{}' check (cardinality(steps) <= 30),
  user_id uuid references auth.users(id) on delete set null,
  -- The manager chose this name by hand, so "Shuffle again" must leave it alone.
  locked boolean not null default false,
  -- Positions (starting at 1) of the steps that have been ticked.
  steps_done integer[] not null default '{}',
  done_at timestamptz,
  note text not null default '' check (char_length(note) <= 300),
  sort_order integer not null default 0
);
create index checklist_assignments_by_shift on public.checklist_assignments (shift_id);
create index checklist_assignments_by_person on public.checklist_assignments (restaurant_id, user_id);

-- ---------- Locks ----------
alter table public.checklist_jobs enable row level security;
alter table public.checklist_shifts enable row level security;
alter table public.checklist_floor enable row level security;
alter table public.checklist_assignments enable row level security;

-- Saved jobs: managers see all; staff see the active ones.
create policy "Read saved jobs" on public.checklist_jobs for select to authenticated
using (public.can_manage(restaurant_id, 'preshift')
       or (public.can_read_restaurant(restaurant_id) and not archived));
create policy "Managers add saved jobs" on public.checklist_jobs for insert to authenticated
with check (public.can_manage(restaurant_id, 'preshift') and created_by = (select auth.uid()));
create policy "Managers edit saved jobs" on public.checklist_jobs for update to authenticated
using (public.can_manage(restaurant_id, 'preshift'))
with check (public.can_manage(restaurant_id, 'preshift'));
create policy "Managers delete saved jobs" on public.checklist_jobs for delete to authenticated
using (public.can_manage(restaurant_id, 'preshift'));

-- Shifts: managers see all; staff see a shift once it is posted.
create policy "Read shifts" on public.checklist_shifts for select to authenticated
using (public.can_manage(restaurant_id, 'preshift')
       or (public.can_read_restaurant(restaurant_id) and status <> 'draft'));
create policy "Managers add shifts" on public.checklist_shifts for insert to authenticated
with check (public.can_manage(restaurant_id, 'preshift') and created_by = (select auth.uid()));
create policy "Managers edit shifts" on public.checklist_shifts for update to authenticated
using (public.can_manage(restaurant_id, 'preshift'))
with check (public.can_manage(restaurant_id, 'preshift'));
create policy "Managers delete shifts" on public.checklist_shifts for delete to authenticated
using (public.can_manage(restaurant_id, 'preshift'));

-- Who is working: same rule as the shift it belongs to.
create policy "Read the floor" on public.checklist_floor for select to authenticated
using (public.can_manage(restaurant_id, 'preshift')
       or (public.can_read_restaurant(restaurant_id) and exists (
            select 1 from public.checklist_shifts s
            where s.id = shift_id and s.status <> 'draft')));
create policy "Managers add to the floor" on public.checklist_floor for insert to authenticated
with check (public.can_manage(restaurant_id, 'preshift'));
create policy "Managers edit the floor" on public.checklist_floor for update to authenticated
using (public.can_manage(restaurant_id, 'preshift'))
with check (public.can_manage(restaurant_id, 'preshift'));
create policy "Managers remove from the floor" on public.checklist_floor for delete to authenticated
using (public.can_manage(restaurant_id, 'preshift'));

-- Assignments: same rule. Staff never write here directly (see the functions below).
create policy "Read assignments" on public.checklist_assignments for select to authenticated
using (public.can_manage(restaurant_id, 'preshift')
       or (public.can_read_restaurant(restaurant_id) and exists (
            select 1 from public.checklist_shifts s
            where s.id = shift_id and s.status <> 'draft')));
create policy "Managers add assignments" on public.checklist_assignments for insert to authenticated
with check (public.can_manage(restaurant_id, 'preshift'));
create policy "Managers edit assignments" on public.checklist_assignments for update to authenticated
using (public.can_manage(restaurant_id, 'preshift'))
with check (public.can_manage(restaurant_id, 'preshift'));
create policy "Managers delete assignments" on public.checklist_assignments for delete to authenticated
using (public.can_manage(restaurant_id, 'preshift'));

revoke all on public.checklist_jobs, public.checklist_shifts,
  public.checklist_floor, public.checklist_assignments from public, anon, authenticated;
grant select, insert, update, delete on public.checklist_jobs, public.checklist_shifts,
  public.checklist_floor, public.checklist_assignments to authenticated;

-- ---------- Names for the floor ----------
-- Everyone on the team can see who is who on a posted shift, but the normal team list is
-- for managers only. This returns just a first name-level label for each person -- no
-- email, no quiz results.
create or replace function public.checklist_names(rid uuid)
returns table(user_id uuid, name text)
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
    coalesce(nullif(trim(p.display_name), ''),
             nullif(trim(u.raw_user_meta_data->>'display_name'), ''),
             split_part(u.email::text, '@', 1))
  from members m
  join auth.users u on u.id = m.uid
  left join public.member_profiles p on p.restaurant_id = rid and p.user_id = u.id
  order by 2, 1;
end $$;
revoke all on function public.checklist_names(uuid) from public, anon;
grant execute on function public.checklist_names(uuid) to authenticated;

-- ---------- What staff can do to their own job ----------
-- Tick or untick one step of the job that is assigned to me, on a posted shift.
create or replace function public.checklist_tick_step(aid uuid, step integer, ticked boolean)
returns void
language plpgsql security definer set search_path = '' as $$
declare a public.checklist_assignments; s public.checklist_shifts;
begin
  select * into a from public.checklist_assignments where id = aid;
  if not found or a.user_id is distinct from (select auth.uid()) then
    raise exception 'That job is not yours.' using errcode = '42501';
  end if;
  select * into s from public.checklist_shifts where id = a.shift_id;
  if s.status <> 'posted' then raise exception 'This shift is not open.'; end if;
  if a.done_at is not null then raise exception 'This job is already done.'; end if;
  if step < 1 or step > cardinality(a.steps) then raise exception 'There is no such step.'; end if;
  update public.checklist_assignments
  set steps_done = case
    when ticked then (select coalesce(array_agg(distinct x order by x), '{}') from unnest(steps_done || step) x)
    else array_remove(steps_done, step) end
  where id = aid;
end $$;
revoke all on function public.checklist_tick_step(uuid, integer, boolean) from public, anon;
grant execute on function public.checklist_tick_step(uuid, integer, boolean) to authenticated;

-- Mark my job done (or take it back), with an optional note for the manager.
create or replace function public.checklist_finish_job(aid uuid, finished boolean, job_note text default '')
returns timestamptz
language plpgsql security definer set search_path = '' as $$
declare a public.checklist_assignments; s public.checklist_shifts; stamp timestamptz;
begin
  select * into a from public.checklist_assignments where id = aid;
  if not found or a.user_id is distinct from (select auth.uid()) then
    raise exception 'That job is not yours.' using errcode = '42501';
  end if;
  select * into s from public.checklist_shifts where id = a.shift_id;
  if s.status <> 'posted' then raise exception 'This shift is not open.'; end if;
  stamp := case when finished then now() else null end;
  update public.checklist_assignments
  set done_at = stamp,
      note = left(coalesce(btrim(job_note), ''), 300)
  where id = aid;
  return stamp;
end $$;
revoke all on function public.checklist_finish_job(uuid, boolean, text) from public, anon;
grant execute on function public.checklist_finish_job(uuid, boolean, text) to authenticated;

commit;
