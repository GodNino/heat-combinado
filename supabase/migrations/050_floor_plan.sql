-- Run once, after 049. The floor plan: for one service, each server's SA, section and running side
-- work, the jobs a server keeps an eye on during the shift (trays, coffee station, wine glasses...).
--
--   * running_sidework_lists: saved lists of those jobs, one per kind of night ("Saturday · 7
--     servers"). The first server gets the first job, the second the second, and so on down.
--   * floor_plans: one per restaurant, day and service (Lunch or Dinner). Its rows are a small JSON
--     list: [{server_id, server_name, sa: [{id, name}], section, task}]. Names are copied in, so the
--     plan reads the same to everyone and later name changes don't rewrite a night that happened.
--   * floor_plan_people(rid, day): who has a published shift that day, with their position and
--     start, so the plan can start from the schedule.
-- Managers with Pre-shift access (the same as side work) build it; the whole team reads it. Nothing
-- is marked done: being assigned is the point. No existing table or function is changed.
begin;

create table public.running_sidework_lists (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  tasks text[] not null default '{}' check (cardinality(tasks) <= 40),
  updated_at timestamptz not null default now(),
  created_by uuid not null default auth.uid() references auth.users(id)
);
create index running_sidework_lists_by_restaurant on public.running_sidework_lists (restaurant_id);
alter table public.running_sidework_lists enable row level security;

create table public.floor_plans (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  service_date date not null,
  service text not null check (service in ('Lunch', 'Dinner')),
  list_id uuid references public.running_sidework_lists(id) on delete set null,
  rows jsonb not null default '[]' check (jsonb_typeof(rows) = 'array' and jsonb_array_length(rows) <= 60),
  updated_by uuid not null default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now(),
  unique (restaurant_id, service_date, service)
);
alter table public.floor_plans enable row level security;

create policy "Team reads running side work" on public.running_sidework_lists for select to authenticated
using (public.can_read_restaurant(restaurant_id));
create policy "Managers add running side work" on public.running_sidework_lists for insert to authenticated
with check (public.can_manage(restaurant_id, 'preshift') and created_by = (select auth.uid()));
create policy "Managers edit running side work" on public.running_sidework_lists for update to authenticated
using (public.can_manage(restaurant_id, 'preshift')) with check (public.can_manage(restaurant_id, 'preshift'));
create policy "Managers delete running side work" on public.running_sidework_lists for delete to authenticated
using (public.can_manage(restaurant_id, 'preshift'));

create policy "Team reads the floor plan" on public.floor_plans for select to authenticated
using (public.can_read_restaurant(restaurant_id));
create policy "Managers add a floor plan" on public.floor_plans for insert to authenticated
with check (public.can_manage(restaurant_id, 'preshift') and updated_by = (select auth.uid()));
create policy "Managers edit a floor plan" on public.floor_plans for update to authenticated
using (public.can_manage(restaurant_id, 'preshift'))
with check (public.can_manage(restaurant_id, 'preshift') and updated_by = (select auth.uid()));
create policy "Managers delete a floor plan" on public.floor_plans for delete to authenticated
using (public.can_manage(restaurant_id, 'preshift'));

revoke all on public.running_sidework_lists, public.floor_plans from public, anon;
grant select, insert, update, delete on public.running_sidework_lists, public.floor_plans to authenticated;

-- Who works that day, from the published schedule, in the restaurant's own time zone.
create or replace function public.floor_plan_people(rid uuid, day date)
returns table(user_id uuid, name text, shift_position text, starts_at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
declare tz text;
begin
  if not public.can_manage(rid, 'preshift') then raise exception 'Manager access required' using errcode = '42501'; end if;
  select coalesce(s.time_zone, 'America/New_York') into tz
  from (select 1) one left join public.schedule_settings s on s.restaurant_id = rid;
  begin
    perform now() at time zone tz;
  exception when others then
    tz := 'America/New_York';
  end;
  return query
  select s.user_id, public.poster_name(rid, s.user_id), s.position, s.starts_at
  from public.schedule_shifts s
  where s.restaurant_id = rid and s.published
    and s.starts_at >= day::timestamp at time zone tz
    and s.starts_at < (day + 1)::timestamp at time zone tz
  order by s.starts_at, 2;
end $$;
revoke all on function public.floor_plan_people(uuid, date) from public, anon;
grant execute on function public.floor_plan_people(uuid, date) to authenticated;
commit;
