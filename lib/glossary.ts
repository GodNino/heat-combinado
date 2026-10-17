// Words a server may not know, explained on the dish that uses them.
// Definitions come from the Osaka manager's own list; pronunciations drafted for the floor.
export type Term = {
  term: string;      // how it appears on the card
  say: string;       // how to pronounce it out loud
  means: string;     // one line, for someone standing at a table
  note?: string;     // allergen or dietary warning, when there is one
  also?: string[];   // other spellings that should match the same term
};

export const TERMS: Term[] = [
  // Japanese pantry
  {term: 'Katsuobushi', say: 'kat-soo-oh-BOO-shee', also: ['bonito flakes', 'bonito'],
   means: 'Dried, smoked and fermented skipjack tuna, shaved paper-thin. Sold as bonito flakes.', note: 'Contains fish.'},
  {term: 'Hondashi', say: 'hon-DA-shee', also: ['hon dashi', 'dashi'],
   means: 'Japanese soup stock made from dried bonito and kelp. The savoury, smoky base of broths and sauces.', note: 'Contains fish.'},
  {term: 'Nori', say: 'NOR-ee',
   means: 'The seaweed sheet used to wrap sushi. Dark green to black.'},
  {term: 'Wasabi', say: 'wah-SAH-bee',
   means: 'The sharp green paste served with sushi and sashimi, made from a rare root vegetable.'},
  {term: 'Togarashi', say: 'toh-ga-RA-shee', also: ['shichimi', 'shichimi togarashi'],
   means: 'A seven-spice Japanese blend: red chilli, sancho pepper, toasted orange peel, black and white sesame, ginger, hemp seed and nori.',
   note: 'Contains sesame.'},
  {term: 'Tofu', say: 'TOH-foo',
   means: 'Made by curdling soy milk and pressing the solids, much the way cheese is made from milk.', note: 'Contains soy.'},
  {term: 'Gari', say: 'GAH-ree',
   means: 'Pickled ginger served alongside sushi to clear the palate between flavours.'},
  {term: 'Shiitake', say: 'shee-TAH-keh', also: ['shitake'],
   means: 'An edible mushroom native to East Asia, traditionally grown on the trunks of the shii tree.'},
  {term: 'Furikake', say: 'foo-ree-KAH-keh',
   means: 'A dry Japanese seasoning sprinkled over rice: nori, katsuobushi, sesame and dried vegetables.',
   note: 'Contains fish and sesame.'},
  {term: 'Ponzu', say: 'PON-zoo',
   means: 'A tart Japanese sauce of soy, citrus juice and hondashi, often finished with grated daikon and chilli.',
   note: 'Contains soy and fish.'},
  {term: 'Tamari', say: 'tah-MAH-ree',
   means: 'A rich Japanese soy sauce made mostly from fermented soybeans, with little or no wheat.', note: 'Contains soy.'},
  {term: 'Mirin', say: 'MEE-rin',
   means: 'Sweet, low-alcohol Japanese rice wine used for cooking rather than drinking.'},
  {term: 'Panko', say: 'PAN-koh',
   means: 'Japanese breadcrumbs, flakier and lighter than ordinary ones, so the crust stays crisp.', note: 'Contains gluten.'},
  {term: 'Kewpie', say: 'KEW-pee', also: ['japanese mayo', 'japanese mayonnaise'],
   means: 'Japanese mayonnaise, richer and tangier than the Western kind: egg yolks only, and rice vinegar.', note: 'Contains egg.'},
  {term: 'Miso', say: 'MEE-soh',
   means: 'Fermented soybean paste. Salty and deeply savoury; the lighter the colour, the milder the taste.', note: 'Contains soy.'},
  {term: 'Shiso', say: 'SHEE-soh', also: ['perilla'],
   means: 'A Japanese herb leaf between mint and basil, used fresh for a bright, slightly citrus finish.'},
  {term: 'Korokke', say: 'koh-ROH-keh',
   means: 'A Japanese deep-fried croquette, descended from the French original.'},
  {term: 'Matcha', say: 'MAH-cha',
   means: 'Finely ground green tea leaves, vivid green and grassy.'},
  {term: 'Yuzu', say: 'YOO-zoo',
   means: 'A fragrant, sour East Asian citrus with a bumpy yellow-green rind.'},
  {term: 'Wakamomo', say: 'wah-kah-MOH-moh',
   means: 'Young, unripe Japanese peaches: delicate, lightly sweet and slightly tart.'},
  {term: 'Shishito pepper', say: 'shee-SHEE-toh', also: ['shishito'],
   means: 'A small, thin-skinned Japanese pepper. Grassy and smoky, mild rather than hot.'},

  // Fish and roe
  {term: 'Hamachi', say: 'hah-MAH-chee',
   means: 'Young Japanese amberjack — yellowtail — prized for sushi and sashimi.', note: 'Contains fish.'},
  {term: 'Ikura', say: 'ee-KOO-rah',
   means: 'Salmon roe, the large bright orange pearls, sometimes called red caviar.', note: 'Contains fish.'},
  {term: 'Masago', say: 'mah-SAH-goh',
   means: 'Capelin roe, the smallest of the three roes used here. Deep orange unless dyed.', note: 'Contains fish.'},
  {term: 'Tobiko', say: 'toh-BEE-koh',
   means: 'Flying fish roe. Bigger than masago, smaller than ikura; orange-red, crunchy, lightly smoky.', note: 'Contains fish.'},

  // Peru and the Andes
  {term: 'Leche de tigre', say: 'LEH-cheh deh TEE-greh', also: ["tiger's milk", 'tigers milk'],
   means: 'The citrus-based, milky-white marinade left over from making ceviche.', note: 'Contains fish.'},
  {term: 'Aji amarillo', say: 'AH-hee ah-mah-REE-yoh', also: ['aji', 'yellow peruvian pepper', 'peruvian yellow pepper'],
   means: 'The yellow Peruvian chilli: fruity and warm rather than sharply hot. The backbone of Peruvian cooking.', note: 'Capsaicin.'},
  {term: 'Rocoto', say: 'roh-KOH-toh',
   means: 'A round red Peruvian chilli, hotter than aji amarillo, with a fresh, almost apple-like flavour.', note: 'Capsaicin.'},
  {term: 'Huacatay', say: 'wah-kah-TIE', also: ['black mint'],
   means: 'A strong Peruvian herb of the marigold family, tasting of sweet basil, tarragon, mint and lime.'},
  {term: 'Choclo', say: 'CHOH-kloh',
   means: 'Large-kernel Andean corn. Chewy and starchy rather than sweet.'},
  {term: 'Cancha', say: 'CAN-cha', also: ['chulpe', 'chulpe corn', 'maiz chulpe'],
   means: 'Large dried corn kernels toasted in a pan with oil and salt. Crunchy, like corn nuts.'},
  {term: 'Lulo', say: 'LOO-loh', also: ['naranjilla'],
   means: 'A tart, citrus-like tropical fruit, also called naranjilla or "nectar of the gods". In the nightshade family.'},
  {term: 'Lucuma', say: 'LOO-koo-mah', also: ['lúcuma'],
   means: 'An egg-shaped Andean fruit, dry and starchy, tasting of maple syrup, sweet potato and caramel.'},
  {term: 'Chirimoya', say: 'chee-ree-MOY-ah', also: ['cherimoya'],
   means: 'A sweet, heart-shaped subtropical fruit with scaly green skin and creamy white flesh. The seeds are removed.'},
  {term: 'Kumquat', say: 'KUM-kwat',
   means: 'A small East Asian citrus eaten whole, skin and all, or pressed into jams.'},
  {term: 'Tiradito', say: 'tee-rah-DEE-toh',
   means: 'Raw fish sliced thin like sashimi and dressed just before serving. No onion, no marinating time — that is what separates it from ceviche.'},
  {term: 'Kero', say: 'KEH-roh',
   means: 'A traditional Andean ceremonial drinking vessel, most associated with the Inca.'},

  // Bar
  {term: 'Pisco', say: 'PEES-koh',
   means: 'Clear or amber grape brandy from the winemaking regions of Peru, distilled from fermented grape juice. Around 38-48% alcohol.',
   note: 'Contains alcohol.'},
  {term: 'Matacuy', say: 'mah-tah-KOO-ee',
   means: 'A traditional Andean herbal digestif, drunk after a meal.', note: 'Contains alcohol.'},
  {term: 'Luxardo Maraschino', say: 'lux-AR-doh mah-rah-SKEE-noh', also: ['luxardo', 'maraschino'],
   means: 'A clear, bittersweet cherry liqueur distilled from sour Marasca cherries, pits and all. Made by Luxardo since 1821.',
   note: 'Contains alcohol.'},
  {term: 'Yellow chartreuse', say: 'shar-TROOZ', also: ['chartreuse'],
   means: 'A golden herbal liqueur made by Carthusian monks from 130 plants, flowers, bark and roots. Around 40-43% alcohol.',
   note: 'Contains alcohol.'},
  {term: 'Angostura bitters', say: 'ang-oh-STOO-rah', also: ['angostura'],
   means: 'A concentrated aromatic bitters used a few drops at a time, as seasoning for a cocktail.', note: 'Contains alcohol.'},
  {term: 'Campari', say: 'kam-PAH-ree',
   means: 'A dark red Italian liqueur: bitter, lightly sweet and spiced, infused with herbs and bitter orange.',
   note: 'Contains alcohol.'},
  {term: 'Rice shochu', say: 'SHOH-choo', also: ['shochu'],
   means: 'A Japanese distilled spirit made from rice, water, yeast and koji.', note: 'Contains alcohol.'},
  {term: 'Junmai', say: 'JOON-my',
   means: '"Pure rice" — sake made from nothing but rice, water, yeast and koji mould.', note: 'Contains alcohol.'},
  {term: 'Umeshu', say: 'oo-MEH-shoo',
   means: 'A Japanese liqueur made by steeping unripe green ume fruit — closer to apricot than plum — in alcohol and sugar.',
   note: 'Contains alcohol.'},
  {term: 'Zubrowka', say: 'zhoo-BROOF-kah', also: ['żubrówka', 'bison grass vodka'],
   means: 'Polish vodka infused with bison grass. Herbal, with vanilla, almond, coconut and cut-hay notes.',
   note: 'Contains alcohol.'},
  {term: 'Midori', say: 'mee-DOH-ree',
   means: 'Japanese for the colour green. Also the bright green melon liqueur, made from Japanese muskmelon and Yubari King.'},
  {term: 'Elixir rose', say: 'ee-LEEK-seer rose',
   means: 'Raspberry and blueberry infused in Trivento white Malbec.', note: 'Contains alcohol.'},
  {term: 'Shrub', say: 'SHRUB',
   means: 'Fruit preserved in vinegar and sugar, making a sweet-and-sour syrup for cocktails.'},
];

const flatten = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// A term matches only as a whole word, so "aji" never lights up inside "ajillo".
function mentioned(text: string, term: Term) {
  return [term.term, ...(term.also ?? [])].some(word =>
    new RegExp(`(^|[^a-z0-9])${escape(flatten(word))}(s)?([^a-z0-9]|$)`).test(text));
}

export function termsFor(parts: string[], list: Term[] = []): Term[] {
  const text = flatten(parts.join(' \n '));
  if (!text.trim()) return [];
  return list.filter(term => mentioned(text, term));
}

// A restaurant's own word. Every word on the cards is one of these: the app no longer
// ships a word list of its own, so a restaurant sees exactly what it wrote.
// `story` is the long write-up a manager can add: where it comes from, how it compares
// to what sits next to it on the menu. A word that has one is what HEAT calls a Guide.
// `photo_path` is where its photo lives in Supabase Storage, empty until one is added.
export type CustomTerm = { id: string; term: string; say: string; means: string; note: string; also: string[]; hidden: boolean; story: string; photo_path: string };
export const sameWord = (a: string, b: string) => flatten(a.trim()) === flatten(b.trim());
const fromCustom = (c: CustomTerm): Term => ({
  term: c.term.trim(), say: c.say.trim(), means: c.means.trim(),
  note: c.note.trim() || undefined, also: c.also.length ? c.also : undefined,
});
export function mergeTerms(custom: CustomTerm[]): Term[] {
  return custom.filter(c => !c.hidden).map(fromCustom);
}
