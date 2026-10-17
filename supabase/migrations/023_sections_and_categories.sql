-- Run once in the Supabase SQL editor. Step 1 of taking the menu sections out of the app's code.
--
-- After this, every restaurant owns its own section names and category names, seeded with exactly
-- what it has today, in the same order. Nothing on screen changes until the app files are updated,
-- and nothing here touches a dish, a photo, a quiz, a score, a word or a team member.
--
-- One statement changes something that exists, and it is the point of the whole migration:
--   * "drop constraint menu_items_category_check" removes the rule that only allowed Osaka's
--     category names. That rule is why no other restaurant can file a dish. It is replaced two
--     lines later with a rule that accepts any sensible name. No data is deleted by either line.
begin;

-- The three libraries. Fixed set of three, but every word a restaurant shows is its own.
create table public.menu_sections (
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  content_type text not null check (content_type in ('food','cocktails','wine')),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  heading text not null default '' check (char_length(heading) <= 60),
  about text not null default '' check (char_length(about) <= 600),
  item_one text not null default 'item' check (char_length(btrim(item_one)) between 1 and 30),
  item_many text not null default 'items' check (char_length(btrim(item_many)) between 1 and 30),
  updated_at timestamptz not null default now(),
  primary key (restaurant_id, content_type)
);

-- The sections inside a library: Ceviches, Tiraditos, Happy Hour, whatever the restaurant uses.
create table public.menu_categories (
  id uuid primary key default gen_random_uuid(),
  restaurant_id uuid not null references public.restaurants(id) on delete cascade,
  content_type text not null check (content_type in ('food','cocktails','wine')),
  name text not null check (char_length(btrim(name)) between 1 and 40),
  sort_order integer not null default 0,
  archived boolean not null default false,
  created_at timestamptz not null default now()
);
create unique index menu_categories_one_per_name
  on public.menu_categories (restaurant_id, content_type, lower(btrim(name)));
create index menu_categories_by_restaurant on public.menu_categories (restaurant_id, content_type, sort_order);

alter table public.menu_sections enable row level security;
alter table public.menu_categories enable row level security;

create policy "Members read sections" on public.menu_sections for select to authenticated
using (public.can_read_restaurant(restaurant_id));
create policy "Owner writes sections" on public.menu_sections for all to authenticated
using (public.is_restaurant_owner(restaurant_id)) with check (public.is_restaurant_owner(restaurant_id));

create policy "Members read categories" on public.menu_categories for select to authenticated
using (public.can_read_restaurant(restaurant_id));
create policy "Owner writes categories" on public.menu_categories for all to authenticated
using (public.is_restaurant_owner(restaurant_id)) with check (public.is_restaurant_owner(restaurant_id));

revoke all on public.menu_sections, public.menu_categories from public, anon, authenticated;
grant select, insert, update, delete on public.menu_sections, public.menu_categories to authenticated;

-- Seed every existing restaurant with the words the app shows it today.
insert into public.menu_sections(restaurant_id, content_type, name, heading, about, item_one, item_many)
select r.id, s.content_type, s.name, s.heading, s.about, s.item_one, s.item_many
from public.restaurants r
cross join (values
  ('food','Food','Kitchen · Food','','dish','dishes'),
  ('cocktails','Cocktails','Kero Bar · Cocktails','The Nikkei world in a liquid form: inspiration from the culture and rituals of Japan and Peru, combined with their diversity of ingredients, to create a cocktail program that activates the senses.','cocktail','cocktails'),
  ('wine','Wine & Sake','Wine & Sake','','wine','wines and sakes')
) as s(content_type, name, heading, about, item_one, item_many)
on conflict do nothing;

insert into public.menu_categories(restaurant_id, content_type, name, sort_order)
select r.id, c.content_type, c.name, c.sort_order
from public.restaurants r
cross join (values
  ('food','Ceviches',1),('food','Tiraditos',2),('food','Nigiris',3),('food','Makimonos',4),
  ('food','Hiyashi Zensai',5),('food','Yaki Zensai',6),('food','Mains',7),('food','Bejitarian',8),
  ('food','Gentei - Limited',9),('food','Seika',10),('food','Other',11),
  ('cocktails','Pisco Experience',1),('cocktails','Kero Global',2),('cocktails','Native',3),
  ('cocktails','Classic Kero Style',4),('cocktails','Alcohol-free',5),('cocktails','Tokubetsu',6),
  ('cocktails','Other',7),
  ('wine','Sparkling',1),('wine','White',2),('wine','Rosé',3),('wine','Red',4),('wine','Orange',5),
  ('wine','Dessert',6),('wine','Sake',7),('wine','Other',8)
) as c(content_type, name, sort_order)
on conflict do nothing;

-- Any category a restaurant is already using that the seed above did not cover keeps working:
-- it is added at the end of its library rather than being lost.
insert into public.menu_categories(restaurant_id, content_type, name, sort_order)
select distinct m.restaurant_id, m.content_type, btrim(m.category), 900
from public.menu_items m
where btrim(coalesce(m.category,'')) <> ''
on conflict do nothing;

-- The rule that only allowed Osaka's names, replaced by one that accepts any sensible name.
alter table public.menu_items drop constraint menu_items_category_check;
alter table public.menu_items add constraint menu_items_category_check
  check (char_length(btrim(category)) between 1 and 40);

commit;
