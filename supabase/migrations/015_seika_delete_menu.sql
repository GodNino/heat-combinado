-- Run once before deploying the Seika and delete-card controls.
-- No existing menu items are changed or deleted by this migration.
begin;
alter table public.menu_items drop constraint menu_items_category_check;
alter table public.menu_items add constraint menu_items_category_check check (category in ('Ceviches','Tiraditos','Nigiris','Makimonos','Hiyashi Zensai','Yaki Zensai','Mains','Bejitarian','Gentei - Limited','Seika','Pisco Experience','Kero Global','Native','Classic Kero Style','Alcohol-free','Tokubetsu','Other','Makis','Cold starters','Hot starters','Main dishes'));
grant delete on public.menu_items to authenticated;
create policy "Owner deletes menu" on public.menu_items for delete to authenticated
using (public.is_restaurant_owner(restaurant_id));
commit;
