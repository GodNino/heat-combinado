-- Run once after 001_heat.sql. Allows managers to edit dish content only.
begin;
alter table public.menu_items add column updated_at timestamptz not null default now();
create function public.set_menu_item_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at = clock_timestamp();
  return new;
end;
$$;
revoke all on function public.set_menu_item_updated_at() from public, anon, authenticated;
create trigger menu_item_updated_at before update on public.menu_items
for each row execute function public.set_menu_item_updated_at();
grant update (name, description, ingredients, allergens, photo_path) on public.menu_items to authenticated;
create policy "Owner edits menu" on public.menu_items for update to authenticated
using (public.is_restaurant_owner(restaurant_id))
with check (public.is_restaurant_owner(restaurant_id));
commit;
