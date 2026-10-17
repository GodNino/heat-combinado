begin;
alter table public.menu_items add column category text not null default 'Other'
check (category in ('Ceviches','Tiraditos','Nigiris','Makis','Cold starters','Hot starters','Main dishes','Other'));
grant update (category) on public.menu_items to authenticated;
-- Existing owner-only UPDATE policy still enforces category changes.
commit;
