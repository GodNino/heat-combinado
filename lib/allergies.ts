import type { MenuItem } from './menu.ts';

// Conservative text matching, not a certification of ingredients or preparation.
// This is the ONE allergen list in HEAT: the Allergy check and the badges on the
// menu cards both read it, so a card and the Allergy check can't disagree.
const definitions: [string, RegExp][] = [
  ['Tree nuts', /\b(tree[ -]?nuts?|almonds?|cashews?|walnuts?|pecans?|pistachios?|hazelnuts?|macadamias?|brazil nuts?|pine nuts?)\b/i],
  ['Peanuts', /\b(peanuts?|groundnuts?)\b/i],
  ['Fish', /\b(fin ?fish|fish|whitefish|salmon|tuna|hamachi|hondashi|bonito|anchov\w*|sea bass|black cod)\b/i],
  ['Shellfish', /\b(shellfish|shrimp|prawns?|lobster|crab|scallops?|clams?|mussels?|oysters?|squid|octopus)\b/i],
  ['Dairy', /\b(dairy|milk|butter|cream|cheese|yogurt)\b/i],
  ['Egg', /\b(eggs?|mayonnaise|mayo|kewpie)\b/i],
  ['Gluten', /\b(gluten|wheat|barley|rye|flour|panko)\b/i],
  ['Soy', /\b(soy|soya|soybeans?|tofu|edamame|miso|tamari)\b/i],
  ['Sesame', /\b(sesame|tahini)\b/i],
  ['Allium', /\b(allium|garlic|onions?|scallions?|chives?|shallots?|leeks?|negi)\b/i],
  // Garlic and Onion stay specific. A note that only says "allium" is handled by
  // genericAllium below, the same way "nuts" is handled for tree nuts vs peanuts.
  ['Garlic', /\bgarlic\b/i],
  ['Onion', /\b(onions?|scallions?|shallots?|leeks?|negi)\b/i],
  ['Mushroom / truffle', /\b(mushrooms?|truffles?|shiitake|shitake)\b/i],
  ['Sunflower', /\bsunflower\b/i],
  ['Coconut', /\bcoconut\b/i],
  ['Mustard', /\bmustard\b/i],
  ['Avocado', /\bavocado\b/i],
  ['Cilantro', /\bcilantro\b/i],
  ['Ginger', /\bginger\b/i],
  ['Nightshade', /\bnightshades?\b/i],
  // "pepper" on its own is ambiguous: black, white, pink and Sichuan peppercorns
  // carry no capsaicin, and they appear in most of the base sauces. Match the
  // chilli sources this menu actually uses instead.
  ['Capsaicin / peppers', /\b(capsaicin|chill?ies|chill?i|chiles?|rocoto|aji|fresno|shishito|togarashi|jalape\w*|habanero|serrano|cayenne|ancho|piquillo|padr[oó]n|peruvian yellow pepper|yellow peruvian pepper|hot peppers?|bell peppers?)\b/i],
  ['Spice', /\bspic(?:e|es|y)\b/i],
  ['Pork', /\b(pork|bacon|pancetta)\b/i],
  ['Pineapple', /\bpineapples?\b/i],
  ['Cucumber', /\bcucumbers?\b/i],
  ['Honey', /\bhoney\b/i],
  ['Cinnamon', /\bcinnamon\b/i],
  // Wine and sake: almost all of it contains sulfites, so it gets its own tag.
  ['Sulfites', /\b(sulfites?|sulphites?|sulfur dioxide|so2)\b/i],
];
// Three-letter codes for the card badges. When a note names several allergens, the
// first in this order wins (the card shows the full note on tap).
const CODES: [string, string][] = [
  ['Shellfish', 'SHL'], ['Fish', 'FSH'], ['Gluten', 'GLU'], ['Allium', 'ALL'], ['Garlic', 'ALL'], ['Onion', 'ALL'],
  ['Sesame', 'SES'], ['Peanuts', 'PNT'], ['Tree nuts', 'NUT'], ['Egg', 'EGG'], ['Dairy', 'DAI'], ['Soy', 'SOY'],
  ['Pork', 'PRK'], ['Mushroom / truffle', 'MSH'], ['Sunflower', 'SUN'], ['Cilantro', 'CIL'], ['Mustard', 'MUS'],
  ['Avocado', 'AVO'], ['Spice', 'SPI'], ['Coconut', 'COC'], ['Ginger', 'GNG'], ['Capsaicin / peppers', 'CAP'],
  ['Nightshade', 'NSH'], ['Pineapple', 'PIN'], ['Cucumber', 'CUC'], ['Honey', 'HON'], ['Cinnamon', 'CIN'], ['Sulfites', 'SUL'],
];
const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
// A note marked (CC) means shared equipment, not a recorded ingredient.
export const isCC = (s: string) => /\bCC\b|cross[ -](?:contamination|contact)/i.test(s);
// "modifiable" arrived with the imported menu notes and means nothing on the floor. Strip the word, keep the rest of the note.
const tidy = (s: string) => s.replace(/\s*[,;]?\s*\bmodifiable\b\s*[,;]?\s*/gi, ' ').replace(/\(\s*\)/g, '').replace(/\s+([),.])/g, '$1').replace(/\s{2,}/g, ' ').trim();
const genericNuts = (s: string) => /\bnuts?\b/i.test(s) && !/\btree[ -]?nuts?\b/i.test(s);
// "Allium" without saying which one: treat like "nuts" — block, but say it is unspecified.
const genericAllium = (s: string) => /\ballium\b/i.test(s) && !/\b(garlic|onions?|scallions?|chives?|shallots?|leeks?|negi)\b/i.test(s);
// Bar descriptions (cocktails, wine tasting notes) talk about flavour — "honey", "butter" — not ingredients.
const recipeText = (item: MenuItem) => [...item.ingredients, ...(item.content_type === 'cocktails' || item.content_type === 'wine' ? [] : [item.description])].join('\n');
function matches(text: string, allergy: string) {
  const pattern = definitions.find(([name]) => name === allergy)?.[1];
  return pattern ? pattern.test(normalize(text)) : normalize(text).includes(normalize(allergy));
}
// The badge code for one allergen note, from the same list the Allergy check uses.
export function allergenCode(note: string): string {
  if (/^\s*(none|no allergens?)\s*$/i.test(note)) return 'NONE';
  const text = normalize(note);
  for (const [name, code] of CODES) if (definitions.find(([label]) => label === name)![1].test(text)) return code;
  return genericNuts(note) ? 'NUT' : 'NOTE';
}
export function menuAllergies(items: MenuItem[]): string[] {
  const labels = new Set<string>();
  for (const item of items) {
    for (const note of item.allergens) {
      const found = definitions.filter(([,pattern]) => pattern.test(normalize(note)));
      found.forEach(([name]) => labels.add(name));
      if (genericNuts(note)) { labels.add('Tree nuts'); labels.add('Peanuts'); }
      if (!found.length && !genericNuts(note)) {
        const custom = note.replace(/\([^)]*\)/g, '').replace(/\bCC\b/gi, '').trim();
        if (custom && !/^(none|unknown|not provided|n\/a)$/i.test(custom)) labels.add(custom.charAt(0).toUpperCase() + custom.slice(1));
      }
    }
    // Explicit recipe mentions also appear as filter choices, even if notes omit them.
    for (const [name, pattern] of definitions) if (pattern.test(normalize(recipeText(item)))) labels.add(name);
  }
  return [...labels].sort((a,b) => a.localeCompare(b));
}
export type AllergyResult = { status: 'avoid' | 'cross-contact' | 'unknown' | 'no-match'; reasons: string[] };
export function assessAllergy(item: MenuItem, allergy: string): AllergyResult {
  if (item.content_type === 'wine' && !item.allergens.length) return {status: 'unknown', reasons: ['Allergens for this wine or sake have not been entered. Wines usually contain sulfites and some are fined with egg or fish — ask the bar team before offering.']};
  if (item.content_type === 'cocktails' && !item.allergens.length) return {status: 'unknown', reasons: ['Cocktail allergens have not been entered by the manager. Ask the bar team to verify ingredients and preparation for every selected allergy.']};
  // ingredient: the allergen is actually in the dish. cross-contact: shared equipment only.
  let ingredient = false;
  const reasons: string[] = [];
  for (const note of item.allergens) if (matches(note, allergy)) { reasons.push(tidy(note)); if (!isCC(note)) ingredient = true; }
  if (allergy === 'Tree nuts' || allergy === 'Peanuts') {
    const ambiguous = item.allergens.filter(genericNuts);
    for (const note of ambiguous) if (!reasons.includes(tidy(note))) { reasons.push(`${tidy(note)} — nut type unspecified`); if (!isCC(note)) ingredient = true; }
  }
  if (allergy === 'Garlic' || allergy === 'Onion') {
    const ambiguous = item.allergens.filter(genericAllium);
    for (const note of ambiguous) if (!reasons.includes(tidy(note))) { reasons.push(`${tidy(note)} — allium recorded without saying which one; confirm with the kitchen`); if (!isCC(note)) ingredient = true; }
  }
  if (matches(recipeText(item), allergy)) { reasons.push(`Possible ${allergy.toLowerCase()} source in the recorded ingredients or recipe; confirm the exact component with the kitchen.`); ingredient = true; }
  if ((allergy === 'Tree nuts' || allergy === 'Peanuts') && genericNuts(recipeText(item))) { reasons.push('Recipe mentions nuts; nut type needs confirmation.'); ingredient = true; }
  if (reasons.length && ingredient) return { status: 'avoid', reasons };
  // A manager ticking "No allergens" writes an explicit note. That is a checked record, not a blank one.
  const cleared = item.allergens.some(n => /^\s*(none|no allergens?)\s*$/i.test(n));
  const incomplete = !cleared && (!item.allergens.length || !item.ingredients.length || /not provided|unknown|not available|missing/i.test(item.ingredients.join(' ')) || item.allergens.some(n => /unknown|not provided|not available|missing/i.test(n)));
  // An incomplete record outranks a known cross-contact note: we cannot see what else is in the dish.
  if (incomplete) {
    return { status: 'unknown', reasons: ['Allergen or ingredient information is incomplete. Ask the kitchen before offering this dish.'] };
  }
  if (reasons.length) return { status: 'cross-contact', reasons };
  if (cleared) return { status: 'no-match', reasons: [`Recorded as having no allergens. Confirm preparation with the ${item.content_type === 'cocktails' || item.content_type === 'wine' ? 'bar' : 'kitchen'} before offering.`] };
  return { status: 'no-match', reasons: [`No ${allergy.toLowerCase()} match in the recorded notes or checked recipe terms. This does not establish that the dish is safe.`] };
}

export function assessAllergies(item: MenuItem, allergies: string[]): AllergyResult {
  if (!allergies.length) return {status: 'unknown', reasons: ['Select at least one allergy to check this dish.']};
  const checks = [...new Set(allergies)].map(allergy => ({allergy, ...assessAllergy(item, allergy)}));
  const blocked = checks.filter(check => check.status === 'avoid');
  // When one allergy blocks outright, still surface the cross-contact ones —
  // the server needs every reason, not just the worst one.
  if (blocked.length) return {status: 'avoid', reasons: [...blocked, ...checks.filter(check => check.status === 'cross-contact')].flatMap(check => check.reasons.map(reason => `${check.allergy}: ${reason}`))};
  if (checks.some(check => check.status === 'unknown')) return {status: 'unknown', reasons: ['Allergen or ingredient information is incomplete. Ask the kitchen to check every selected allergy before offering this dish.']};
  const contact = checks.filter(check => check.status === 'cross-contact');
  if (contact.length) return {status: 'cross-contact', reasons: contact.flatMap(check => check.reasons.map(reason => `${check.allergy}: ${reason}`))};
  return {status: 'no-match', reasons: [`No recorded match for any selected allergy (${allergies.join(', ')}). Confirm all selected allergies and preparation with the kitchen before offering.`]};
}
