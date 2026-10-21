-- Run once, after 043. Schedule settings: the gear on the schedule, one row per restaurant.
--
--   * week_start: the day the restaurant's week begins (0 Sunday … 6 Saturday). Osaka runs Thursday
--     to Wednesday. The grid, Copy last week, publishing, weekly hours and overtime all follow it.
--   * position_colors: a colour name for each position ({"Bartender": "red", "Server": "blue"}).
--     Names, not hex codes, so the app keeps every colour readable in light and dark.
--   * overtime_weekly / overtime_daily: when hours count as overtime. Daily is for states that
--     count it per day (California: 8). Empty means no daily limit.
--   * shift_presets: quick shifts offered when adding one, e.g. Lunch 11:00–15:00, Dinner 17:00–23:00.
--     The first one is what a new shift starts with.
--   * team_sees_all: whether the team sees everyone's published shifts or only their own.
-- A restaurant without a row behaves exactly as before: Monday, 40 hours, no colours, 17:00–23:00,
-- everyone sees the team schedule.
--
-- The one change to something that exists: the policy "Team sees the published schedule" on
-- schedule_shifts is replaced by one that also honours team_sees_all. No shift is changed or deleted.
begin;

create table public.schedule_settings (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  week_start smallint not null default 1 check (week_start between 0 and 6),
  position_colors jsonb not null default '{}' check (jsonb_typeof(position_colors) = 'object'),
  overtime_weekly numeric(4,1) not null default 40 check (overtime_weekly between 1 and 100),
  overtime_daily numeric(4,1) check (overtime_daily is null or overtime_daily between 1 and 24),
  shift_presets jsonb not null default '[]' check (jsonb_typeof(shift_presets) = 'array' and jsonb_array_length(shift_presets) <= 12),
  team_sees_all boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null
);
alter table public.schedule_settings enable row level security;
create policy "Team reads schedule settings" on public.schedule_settings for select to authenticated
  using (public.can_read_restaurant(restaurant_id));
create policy "Schedulers create schedule settings" on public.schedule_settings for insert to authenticated
  with check (public.can_manage(restaurant_id, 'team'));
create policy "Schedulers change schedule settings" on public.schedule_settings for update to authenticated
  using (public.can_manage(restaurant_id, 'team')) with check (public.can_manage(restaurant_id, 'team'));
revoke all on public.schedule_settings from anon;
grant select, insert, update on public.schedule_settings to authenticated;

create or replace function public.schedule_settings_touch()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end $$;
create trigger schedule_settings_touched before update on public.schedule_settings
  for each row execute function public.schedule_settings_touch();

-- Whether this restaurant's team sees each other's shifts (yes unless a manager turned it off).
create or replace function public.team_sees_schedule(rid uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select s.team_sees_all from public.schedule_settings s where s.restaurant_id = rid), true);
$$;
revoke all on function public.team_sees_schedule(uuid) from public, anon;
grant execute on function public.team_sees_schedule(uuid) to authenticated;

drop policy "Team sees the published schedule" on public.schedule_shifts;
create policy "Team sees the published schedule" on public.schedule_shifts for select to authenticated
using (
  public.can_manage(restaurant_id, 'team')
  or (published and public.can_read_restaurant(restaurant_id)
      and (user_id = (select auth.uid()) or public.team_sees_schedule(restaurant_id)))
);

commit;
