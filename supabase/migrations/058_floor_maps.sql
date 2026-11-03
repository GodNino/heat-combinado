-- Run once, after 057. The restaurant's floor map, for drawing tonight's sections on it (Side work >
-- Tonight > Sections). One map per restaurant, a small JSON document:
--   {width, height, walls: [svg path], labels: [{x, y, text}], tables: [{id, label, x, y, shape, group}],
--    spots: [[x, y]]}   -- spots are free places where a section's name tag can sit.
-- The sections themselves are saved in floor_plans (050): each row gets the section's number, its
-- server and S.A.s, and now also the tables it covers (rows[].tables, rows[].where), so My shift
-- shows them without any change to that table. Managers with Pre-shift access edit the map; the
-- whole team reads it. No existing table or function is changed.
begin;

create table public.floor_maps (
  restaurant_id uuid primary key references public.restaurants(id) on delete cascade,
  layout jsonb not null default '{}' check (jsonb_typeof(layout) = 'object' and pg_column_size(layout) < 200000),
  updated_by uuid default auth.uid() references auth.users(id),
  updated_at timestamptz not null default now()
);
alter table public.floor_maps enable row level security;

create policy "Team reads the floor map" on public.floor_maps for select to authenticated
using (public.can_read_restaurant(restaurant_id));
create policy "Managers add the floor map" on public.floor_maps for insert to authenticated
with check (public.can_manage(restaurant_id, 'preshift'));
create policy "Managers edit the floor map" on public.floor_maps for update to authenticated
using (public.can_manage(restaurant_id, 'preshift')) with check (public.can_manage(restaurant_id, 'preshift'));
create policy "Managers delete the floor map" on public.floor_maps for delete to authenticated
using (public.can_manage(restaurant_id, 'preshift'));

revoke all on public.floor_maps from public, anon, authenticated;
grant select, insert, update, delete on public.floor_maps to authenticated;

commit;
