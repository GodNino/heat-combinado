-- One-time categorization of the approved Osaka menu. Does not change recipe text.
begin;
do $$ begin
if (select count(*) from public.restaurants where name = 'Osaka - Miami') <> 1 then
raise exception 'Expected exactly one Osaka - Miami restaurant';
end if;
end $$;
update public.menu_items m set category = v.category
from (values
  ('Clasico Ceviche', 'Ceviches'),
  ('Wasabi Ceviche', 'Ceviches'),
  ('Kiiro Ceviche', 'Ceviches'),
  ('OSK Ceviche', 'Ceviches'),
  ('Kare Ceviche', 'Ceviches'),
  ('Moriawase Ceviche', 'Ceviches'),
  ('Akami Truffle', 'Tiraditos'),
  ('Otoro & Cecina Tiradito', 'Tiraditos'),
  ('Hotate Nissei', 'Tiraditos'),
  ('Peru', 'Tiraditos'),
  ('Carpassion', 'Tiraditos'),
  ('Inca', 'Nigiris'),
  ('Hamachi Brasa', 'Nigiris'),
  ('Katsu', 'Nigiris'),
  ('Hotate Truffle', 'Nigiris'),
  ('Ebi / Lobster Mentaiko', 'Nigiris'),
  ('Tuna Foie', 'Nigiris'),
  ('Miso Lobster', 'Nigiris'),
  ('Pisco Buta', 'Nigiris'),
  ('Veggie Brasa', 'Nigiris'),
  ('Niku', 'Nigiris'),
  ('Cecina Nigiri', 'Nigiris'),
  ('Kani TNT', 'Makis'),
  ('Veggie Truffle', 'Makis'),
  ('Tuna Tartare', 'Makis'),
  ('Nori Furai', 'Makis'),
  ('Nikkei', 'Makis'),
  ('Antiku', 'Makis'),
  ('Rocoto Aburi', 'Makis'),
  ('Nikkei Salad', 'Cold starters'),
  ('Crispy Rice', 'Cold starters'),
  ('Temaki OSK', 'Cold starters'),
  ('Kani Taco', 'Cold starters'),
  ('Toro Tartare', 'Cold starters'),
  ('Niku Tartare', 'Cold starters'),
  ('Ponzu Veggies', 'Hot starters'),
  ('Tumbo Shrimp', 'Hot starters'),
  ('Mariscos al Fuego', 'Hot starters'),
  ('Tako Anticucho', 'Hot starters'),
  ('Pisco Ribs', 'Hot starters'),
  ('Niku Gyoza', 'Hot starters'),
  ('Sea Bass Misoyaki', 'Main dishes'),
  ('Black Cod Criollo', 'Main dishes'),
  ('Shiromi Brasa', 'Main dishes'),
  ('Umi Meshi', 'Main dishes'),
  ('Pato Mochero', 'Main dishes'),
  ('Wagyu Chahan', 'Main dishes'),
  ('Niku / A5 Kabayaki', 'Main dishes'),
  ('Asado Gyudon', 'Main dishes'),
  ('Osaka Steak', 'Main dishes'),
  ('Aka Tiradito', 'Tiraditos'),
  ('Beet TNT', 'Nigiris'),
  ('Satsuma Nigiri', 'Nigiris'),
  ('Tomato Uchucuta Nigiri', 'Nigiris'),
  ('Kinoko Ceviche', 'Ceviches'),
  ('Yuba Maki', 'Makis'),
  ('Spicy Edamame', 'Hot starters'),
  ('Shishito Brasa', 'Hot starters'),
  ('Tumbo Karifawa', 'Hot starters'),
  ('Hongos Teppan', 'Hot starters'),
  ('Yasai Meshi', 'Main dishes')
) as v(name, category)
where m.name = v.name and m.restaurant_id = (select id from public.restaurants where name = 'Osaka - Miami');
select category, count(*) as dishes from public.menu_items where restaurant_id = (select id from public.restaurants where name = 'Osaka - Miami') group by category order by category;
commit;
