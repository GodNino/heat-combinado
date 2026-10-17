-- The demo kitchen behind /demo. Run once in the Supabase SQL editor, after 034_trial_and_demo.sql.
--
-- Before running: replace YOUR-ADMIN-EMAIL below with the email of an existing HEAT account.
-- That account owns the demo kitchen, so it is the one that can edit the sample menu later
-- from the app. Visitors join it read-only.
--
-- Every dish here is invented for the demo. It is not any real restaurant's menu, recipe or
-- allergen record, and it has no photos. Quizzes are generated from these records automatically.
-- Running it a second time stops with an error instead of creating a second demo kitchen.
begin;

do $$
declare
  owner uuid := (select id from auth.users where email = 'YOUR-ADMIN-EMAIL');
  rid uuid;
begin
  if owner is null then
    raise exception 'No account with that email. Replace YOUR-ADMIN-EMAIL with an existing HEAT account.';
  end if;
  if exists (select 1 from public.restaurants where is_demo) then
    raise exception 'The demo kitchen already exists.';
  end if;

  insert into public.restaurants(owner_id, name, is_demo)
  values (owner, 'HEAT Demo Kitchen', true)
  returning id into rid;

  insert into public.menu_sections(restaurant_id, content_type, name, heading, item_one, item_many) values
    (rid, 'food', 'Food', 'Food', 'dish', 'dishes'),
    (rid, 'cocktails', 'Cocktails', 'Cocktails', 'cocktail', 'cocktails'),
    (rid, 'wine', 'Wine', 'Wine', 'wine', 'wines');

  insert into public.menu_categories(restaurant_id, content_type, name, sort_order) values
    (rid, 'food', 'Raw bar', 1), (rid, 'food', 'Small plates', 2), (rid, 'food', 'Mains', 3), (rid, 'food', 'Desserts', 4),
    (rid, 'cocktails', 'Signature', 1), (rid, 'cocktails', 'Alcohol-free', 2),
    (rid, 'wine', 'Sparkling', 1), (rid, 'wine', 'White', 2), (rid, 'wine', 'Red', 3);

  insert into public.menu_items(restaurant_id, content_type, category, name, description, ingredients, allergens, price, fire_minutes, table_setting, observations) values
    (rid, 'food', 'Raw bar', 'Yellowtail Tiradito',
     'Thin-sliced yellowtail dressed at the pass with citrus soy, sliced chili and cilantro, finished with toasted sesame.',
     array['Yellowtail','Soy sauce','Lime','Yuzu','Red chili','Cilantro','Toasted sesame'],
     array['Fish','Soy','Gluten','Sesame (CC)'], 24, 8, 'Chopsticks and a small spoon for the dressing.', 'Served cold. Recommend it as the first dish for the table.'),
    (rid, 'food', 'Raw bar', 'Salmon Crudo',
     'Salmon slices over a light ponzu with pickled shallot, chives and a drizzle of olive oil.',
     array['Salmon','Ponzu','Shallot','Rice vinegar','Chives','Olive oil'],
     array['Fish','Soy','Gluten','Allium'], 21, 7, 'Chopsticks.', null),
    (rid, 'food', 'Raw bar', 'Tuna Tartare',
     'Diced tuna with avocado, cucumber, sesame dressing and crisp wonton chips on the side.',
     array['Tuna','Avocado','Cucumber','Sesame oil','Soy sauce','Wonton chips'],
     array['Fish','Sesame','Soy','Gluten','Egg'], 23, 8, 'Small fork and a share plate.', 'Wonton chips are fried in the shared fryer.'),
    (rid, 'food', 'Small plates', 'Crispy Rice',
     'Pressed rice seared until crisp, topped with spicy tuna, jalapeño and sweet soy glaze.',
     array['Sushi rice','Tuna','Spicy mayo','Jalapeño','Sweet soy glaze'],
     array['Fish','Egg','Soy','Gluten'], 18, 10, 'Share plate.', null),
    (rid, 'food', 'Small plates', 'Shishito Peppers',
     'Blistered shishito peppers with flaky salt, lime and bonito flakes.',
     array['Shishito peppers','Sea salt','Lime','Bonito flakes'],
     array['Fish'], 12, 6, null, 'Ask for no bonito to make it vegetarian.'),
    (rid, 'food', 'Small plates', 'Chicken Karaage',
     'Marinated chicken thigh, fried crisp, served with lemon and a yuzu kosho mayo.',
     array['Chicken thigh','Ginger','Garlic','Soy sauce','Potato starch','Yuzu kosho mayo','Lemon'],
     array['Soy','Gluten','Egg','Allium'], 16, 12, 'Share plate and lemon wedge.', null),
    (rid, 'food', 'Mains', 'Miso Black Cod',
     'Black cod marinated in sweet white miso for two days, roasted and served with pickled ginger.',
     array['Black cod','White miso','Mirin','Sake','Sugar','Pickled ginger'],
     array['Fish','Soy'], 42, 18, 'Fish knife and fork.', 'Allow 18 minutes. Mention the timing when the table orders.'),
    (rid, 'food', 'Mains', 'Grilled Ribeye',
     'Ribeye grilled over charcoal, sliced, with a garlic soy butter and shiso chimichurri.',
     array['Ribeye','Garlic','Soy sauce','Butter','Shiso','Parsley','Olive oil'],
     array['Soy','Gluten','Milk','Allium'], 58, 20, 'Steak knife.', 'Ask for the temperature. Cooked to order.'),
    (rid, 'food', 'Mains', 'Mushroom Fried Rice',
     'Wok-fried rice with mixed mushrooms, egg, scallion and a touch of soy.',
     array['Rice','Shiitake','Oyster mushroom','Egg','Scallion','Soy sauce'],
     array['Egg','Soy','Gluten','Allium'], 19, 10, 'Serving spoon.', null),
    (rid, 'food', 'Desserts', 'Matcha Cheesecake',
     'Baked matcha cheesecake on a sesame crumb, with whipped cream.',
     array['Cream cheese','Matcha','Sugar','Egg','Sesame crumb','Cream'],
     array['Milk','Egg','Gluten','Sesame'], 13, 4, 'Dessert fork.', null),
    (rid, 'cocktails', 'Signature', 'Yuzu Sour',
     'Gin shaken with yuzu, lemon and egg white. Served up in a coupe.',
     array['Gin','Yuzu juice','Lemon juice','Simple syrup','Egg white'],
     array['Egg'], 16, null, null, 'Ask for no egg white for a vegan version.'),
    (rid, 'cocktails', 'Signature', 'Smoked Old Fashioned',
     'Japanese whisky stirred with demerara and bitters, served over a large cube with orange peel.',
     array['Japanese whisky','Demerara syrup','Angostura bitters','Orange peel'],
     array[]::text[], 18, null, null, null),
    (rid, 'cocktails', 'Signature', 'Lychee Spritz',
     'Lychee and elderflower topped with sparkling wine and soda, over ice.',
     array['Lychee purée','Elderflower liqueur','Sparkling wine','Soda'],
     array['Sulfites'], 15, null, null, null),
    (rid, 'cocktails', 'Alcohol-free', 'Cucumber Cooler',
     'Cucumber, mint and lime, shaken and topped with soda.',
     array['Cucumber','Mint','Lime juice','Simple syrup','Soda'],
     array[]::text[], 9, null, null, null),
    (rid, 'wine', 'Sparkling', 'Brut Cava',
     'Dry, crisp sparkling wine with green apple and citrus. Good with the raw bar.',
     array['Macabeo','Parellada','Xarel·lo'],
     array['Sulfites'], 14, null, null, null),
    (rid, 'wine', 'White', 'Albariño',
     'Bright and saline, with peach and lemon. Pairs with fish and crudo.',
     array['Albariño'],
     array['Sulfites'], 15, null, null, null),
    (rid, 'wine', 'Red', 'Pinot Noir',
     'Light-bodied, red cherry and earth. Works with the black cod as well as the ribeye.',
     array['Pinot Noir'],
     array['Sulfites'], 17, null, null, null);
end $$;

commit;
