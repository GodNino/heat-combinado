-- Run once in the Supabase SQL editor BEFORE the app files that remove the built-in words.
-- What this does, in order:
--   1. Copies the 50 words HEAT shipped with into each restaurant's own glossary, so nothing
--      stops working on the cards. A word the restaurant already has is skipped, so your own
--      wording is never overwritten.
--   2. Removes the rows whose only job was to hide a built-in word. Those words are already
--      invisible to your team; after this they are simply gone, which is what hiding meant.
-- Step 2 is the only statement that removes anything, and it removes nothing you can see today.
begin;

with seed(term, say, means, note, also) as (values
  ('Katsuobushi', 'kat-soo-oh-BOO-shee', 'Dried, smoked and fermented skipjack tuna, shaved paper-thin. Sold as bonito flakes.', 'Contains fish.', array['bonito flakes','bonito']),
  ('Hondashi', 'hon-DA-shee', 'Japanese soup stock made from dried bonito and kelp. The savoury, smoky base of broths and sauces.', 'Contains fish.', array['hon dashi','dashi']),
  ('Nori', 'NOR-ee', 'The seaweed sheet used to wrap sushi. Dark green to black.', '', '{}'::text[]),
  ('Wasabi', 'wah-SAH-bee', 'The sharp green paste served with sushi and sashimi, made from a rare root vegetable.', '', '{}'::text[]),
  ('Togarashi', 'toh-ga-RA-shee', 'A seven-spice Japanese blend: red chilli, sancho pepper, toasted orange peel, black and white sesame, ginger, hemp seed and nori.', 'Contains sesame.', array['shichimi','shichimi togarashi']),
  ('Tofu', 'TOH-foo', 'Made by curdling soy milk and pressing the solids, much the way cheese is made from milk.', 'Contains soy.', '{}'::text[]),
  ('Gari', 'GAH-ree', 'Pickled ginger served alongside sushi to clear the palate between flavours.', '', '{}'::text[]),
  ('Shiitake', 'shee-TAH-keh', 'An edible mushroom native to East Asia, traditionally grown on the trunks of the shii tree.', '', array['shitake']),
  ('Furikake', 'foo-ree-KAH-keh', 'A dry Japanese seasoning sprinkled over rice: nori, katsuobushi, sesame and dried vegetables.', 'Contains fish and sesame.', '{}'::text[]),
  ('Ponzu', 'PON-zoo', 'A tart Japanese sauce of soy, citrus juice and hondashi, often finished with grated daikon and chilli.', 'Contains soy and fish.', '{}'::text[]),
  ('Tamari', 'tah-MAH-ree', 'A rich Japanese soy sauce made mostly from fermented soybeans, with little or no wheat.', 'Contains soy.', '{}'::text[]),
  ('Mirin', 'MEE-rin', 'Sweet, low-alcohol Japanese rice wine used for cooking rather than drinking.', '', '{}'::text[]),
  ('Panko', 'PAN-koh', 'Japanese breadcrumbs, flakier and lighter than ordinary ones, so the crust stays crisp.', 'Contains gluten.', '{}'::text[]),
  ('Kewpie', 'KEW-pee', 'Japanese mayonnaise, richer and tangier than the Western kind: egg yolks only, and rice vinegar.', 'Contains egg.', array['japanese mayo','japanese mayonnaise']),
  ('Miso', 'MEE-soh', 'Fermented soybean paste. Salty and deeply savoury; the lighter the colour, the milder the taste.', 'Contains soy.', '{}'::text[]),
  ('Shiso', 'SHEE-soh', 'A Japanese herb leaf between mint and basil, used fresh for a bright, slightly citrus finish.', '', array['perilla']),
  ('Korokke', 'koh-ROH-keh', 'A Japanese deep-fried croquette, descended from the French original.', '', '{}'::text[]),
  ('Matcha', 'MAH-cha', 'Finely ground green tea leaves, vivid green and grassy.', '', '{}'::text[]),
  ('Yuzu', 'YOO-zoo', 'A fragrant, sour East Asian citrus with a bumpy yellow-green rind.', '', '{}'::text[]),
  ('Wakamomo', 'wah-kah-MOH-moh', 'Young, unripe Japanese peaches: delicate, lightly sweet and slightly tart.', '', '{}'::text[]),
  ('Shishito pepper', 'shee-SHEE-toh', 'A small, thin-skinned Japanese pepper. Grassy and smoky, mild rather than hot.', '', array['shishito']),
  ('Hamachi', 'hah-MAH-chee', 'Young Japanese amberjack — yellowtail — prized for sushi and sashimi.', 'Contains fish.', '{}'::text[]),
  ('Ikura', 'ee-KOO-rah', 'Salmon roe, the large bright orange pearls, sometimes called red caviar.', 'Contains fish.', '{}'::text[]),
  ('Masago', 'mah-SAH-goh', 'Capelin roe, the smallest of the three roes used here. Deep orange unless dyed.', 'Contains fish.', '{}'::text[]),
  ('Tobiko', 'toh-BEE-koh', 'Flying fish roe. Bigger than masago, smaller than ikura; orange-red, crunchy, lightly smoky.', 'Contains fish.', '{}'::text[]),
  ('Leche de tigre', 'LEH-cheh deh TEE-greh', 'The citrus-based, milky-white marinade left over from making ceviche.', 'Contains fish.', array['tiger''s milk','tigers milk']),
  ('Aji amarillo', 'AH-hee ah-mah-REE-yoh', 'The yellow Peruvian chilli: fruity and warm rather than sharply hot. The backbone of Peruvian cooking.', 'Capsaicin.', array['aji','yellow peruvian pepper','peruvian yellow pepper']),
  ('Rocoto', 'roh-KOH-toh', 'A round red Peruvian chilli, hotter than aji amarillo, with a fresh, almost apple-like flavour.', 'Capsaicin.', '{}'::text[]),
  ('Huacatay', 'wah-kah-TIE', 'A strong Peruvian herb of the marigold family, tasting of sweet basil, tarragon, mint and lime.', '', array['black mint']),
  ('Choclo', 'CHOH-kloh', 'Large-kernel Andean corn. Chewy and starchy rather than sweet.', '', '{}'::text[]),
  ('Cancha', 'CAN-cha', 'Large dried corn kernels toasted in a pan with oil and salt. Crunchy, like corn nuts.', '', array['chulpe','chulpe corn','maiz chulpe']),
  ('Lulo', 'LOO-loh', 'A tart, citrus-like tropical fruit, also called naranjilla or "nectar of the gods". In the nightshade family.', '', array['naranjilla']),
  ('Lucuma', 'LOO-koo-mah', 'An egg-shaped Andean fruit, dry and starchy, tasting of maple syrup, sweet potato and caramel.', '', array['lúcuma']),
  ('Chirimoya', 'chee-ree-MOY-ah', 'A sweet, heart-shaped subtropical fruit with scaly green skin and creamy white flesh. The seeds are removed.', '', array['cherimoya']),
  ('Kumquat', 'KUM-kwat', 'A small East Asian citrus eaten whole, skin and all, or pressed into jams.', '', '{}'::text[]),
  ('Tiradito', 'tee-rah-DEE-toh', 'Raw fish sliced thin like sashimi and dressed just before serving. No onion, no marinating time — that is what separates it from ceviche.', '', '{}'::text[]),
  ('Kero', 'KEH-roh', 'A traditional Andean ceremonial drinking vessel, most associated with the Inca.', '', '{}'::text[]),
  ('Pisco', 'PEES-koh', 'Clear or amber grape brandy from the winemaking regions of Peru, distilled from fermented grape juice. Around 38-48% alcohol.', 'Contains alcohol.', '{}'::text[]),
  ('Matacuy', 'mah-tah-KOO-ee', 'A traditional Andean herbal digestif, drunk after a meal.', 'Contains alcohol.', '{}'::text[]),
  ('Luxardo Maraschino', 'lux-AR-doh mah-rah-SKEE-noh', 'A clear, bittersweet cherry liqueur distilled from sour Marasca cherries, pits and all. Made by Luxardo since 1821.', 'Contains alcohol.', array['luxardo','maraschino']),
  ('Yellow chartreuse', 'shar-TROOZ', 'A golden herbal liqueur made by Carthusian monks from 130 plants, flowers, bark and roots. Around 40-43% alcohol.', 'Contains alcohol.', array['chartreuse']),
  ('Angostura bitters', 'ang-oh-STOO-rah', 'A concentrated aromatic bitters used a few drops at a time, as seasoning for a cocktail.', 'Contains alcohol.', array['angostura']),
  ('Campari', 'kam-PAH-ree', 'A dark red Italian liqueur: bitter, lightly sweet and spiced, infused with herbs and bitter orange.', 'Contains alcohol.', '{}'::text[]),
  ('Rice shochu', 'SHOH-choo', 'A Japanese distilled spirit made from rice, water, yeast and koji.', 'Contains alcohol.', array['shochu']),
  ('Junmai', 'JOON-my', '"Pure rice" — sake made from nothing but rice, water, yeast and koji mould.', 'Contains alcohol.', '{}'::text[]),
  ('Umeshu', 'oo-MEH-shoo', 'A Japanese liqueur made by steeping unripe green ume fruit — closer to apricot than plum — in alcohol and sugar.', 'Contains alcohol.', '{}'::text[]),
  ('Zubrowka', 'zhoo-BROOF-kah', 'Polish vodka infused with bison grass. Herbal, with vanilla, almond, coconut and cut-hay notes.', 'Contains alcohol.', array['żubrówka','bison grass vodka']),
  ('Midori', 'mee-DOH-ree', 'Japanese for the colour green. Also the bright green melon liqueur, made from Japanese muskmelon and Yubari King.', '', '{}'::text[]),
  ('Elixir rose', 'ee-LEEK-seer rose', 'Raspberry and blueberry infused in Trivento white Malbec.', 'Contains alcohol.', '{}'::text[]),
  ('Shrub', 'SHRUB', 'Fruit preserved in vinegar and sugar, making a sweet-and-sour syrup for cocktails.', '', '{}'::text[])
)
insert into public.glossary_terms(restaurant_id, term, say, means, note, also, hidden, created_by)
select r.id, s.term, s.say, s.means, s.note, s.also, false, r.owner_id
from public.restaurants r cross join seed s
where not exists (
  select 1 from public.glossary_terms g
  where g.restaurant_id = r.id and lower(btrim(g.term)) = lower(btrim(s.term))
);

delete from public.glossary_terms where hidden;

commit;
