begin;
alter table public.menu_items add column content_type text not null default 'food' check (content_type in ('food','cocktails'));
grant update (content_type) on public.menu_items to authenticated;
alter table public.menu_items drop constraint menu_items_category_check;
alter table public.menu_items add constraint menu_items_category_check check (category in ('Ceviches','Tiraditos','Nigiris','Makimonos','Hiyashi Zensai','Yaki Zensai','Mains','Bejitarian','Pisco Experience','Kero Global','Native','Classic Kero Style','Alcohol-free','Other','Makis','Cold starters','Hot starters','Main dishes'));
update public.menu_items set category = case category when 'Makis' then 'Makimonos' when 'Cold starters' then 'Hiyashi Zensai' when 'Hot starters' then 'Yaki Zensai' when 'Main dishes' then 'Mains' else category end where category in ('Makis','Cold starters','Hot starters','Main dishes');
-- Names below belong to the Bejitarian section of the approved Osaka source menu.
-- This category name is not an allergen-free or vegetarian certification.
update public.menu_items set category = 'Bejitarian' where restaurant_id in (select id from public.restaurants where name = 'Osaka - Miami') and name in ('Aka Tiradito','Beet TNT','Satsuma Nigiri','Tomato Uchucuta Nigiri','Kinoko Ceviche','Yuba Maki','Spicy Edamame','Shishito Brasa','Tumbo Karifawa','Hongos Teppan','Yasai Meshi');
commit;
