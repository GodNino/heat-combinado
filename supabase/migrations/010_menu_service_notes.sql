begin;
alter table public.menu_items
 add column table_setting text check (length(table_setting)<=2000),
 add column observations text check (length(observations)<=2000);
grant update(table_setting,observations) on public.menu_items to authenticated;
-- Existing owner-only menu policies and optimistic update timestamps also apply to these columns.
commit;
