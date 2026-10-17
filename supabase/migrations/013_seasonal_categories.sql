-- Keep every existing category and allow the two seasonal sections.
-- No menu items are inserted or changed.
begin;
alter table public.menu_items drop constraint menu_items_category_check;
alter table public.menu_items add constraint menu_items_category_check check (category in ('Ceviches','Tiraditos','Nigiris','Makimonos','Hiyashi Zensai','Yaki Zensai','Mains','Bejitarian','Gentei - Limited','Pisco Experience','Kero Global','Native','Classic Kero Style','Alcohol-free','Tokubetsu','Other','Makis','Cold starters','Hot starters','Main dishes'));
commit;
