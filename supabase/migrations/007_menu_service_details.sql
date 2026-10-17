begin;
alter table public.menu_items add column price_label text check(length(price_label)<=40), add column price numeric(10,2) check (price >= 0 and price <= 999999.99), add column fire_minutes integer check (fire_minutes between 1 and 240);
grant update(price,fire_minutes,price_label) on public.menu_items to authenticated;
commit;
