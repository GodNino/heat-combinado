import type { ContentType } from './categories.ts';

// Which extra fields a kind of menu item has, and what they are called.
//
// The values live in menu_items.details, keyed by `id`. The id is what is
// stored, so renaming a label here never orphans data. Adding a field is a line
// in this file — no database migration, and every item that does not have it
// simply has nothing stored.
//
// Keep ids lower case and stable. Never let a manager invent a field from the
// form: if three cocktails end up with "Glass", "Glassware" and "glass type",
// none of them can be searched or compared.
export type DetailField = {
  id: string;
  label: string;
  // 'line' is a single-line input, 'text' is a textarea.
  kind: 'line' | 'text';
  max: number;
  hint?: string;
};

const COCKTAIL_FIELDS: DetailField[] = [
  // The build, with amounts. Shown behind a fold on the card: a bartender opens it every
  // time and a server never has to scroll past it. The ingredients field stays the list of
  // what is in the drink -- that is what the Allergy check reads, not this.
  {id: 'spec', label: 'Spec', kind: 'text', max: 600, hint: '2 oz Pisco\n1 oz lime\n0.75 oz cardamom syrup\n1 oz egg white'},
  {id: 'classification', label: 'Classification', kind: 'line', max: 80, hint: 'Aperitive, digestive, long drink…'},
  {id: 'method', label: 'Method', kind: 'line', max: 80, hint: 'Shaken, stirred, built…'},
  {id: 'glassware', label: 'Glassware', kind: 'line', max: 80},
  {id: 'notes', label: 'Notes', kind: 'text', max: 600},
  {id: 'meaning', label: 'Meaning', kind: 'text', max: 600, hint: 'Where the name comes from — what a server tells the guest'},
  {id: 'extra_fact', label: 'Extra fact', kind: 'text', max: 600},
];

// Wine and sake share one card; sake-only fields are simply left blank for wines.
const WINE_FIELDS: DetailField[] = [
  {id: 'producer', label: 'Producer', kind: 'line', max: 120},
  {id: 'region', label: 'Region', kind: 'line', max: 120, hint: 'Mendoza, Argentina · Niigata, Japan'},
  {id: 'vintage', label: 'Vintage', kind: 'line', max: 20, hint: '2021, or NV'},
  {id: 'grade', label: 'Sake grade', kind: 'line', max: 80, hint: 'Sake only: Junmai, Ginjo, Daiginjo…'},
  {id: 'polish', label: 'Rice polish', kind: 'line', max: 40, hint: 'Sake only: 50%'},
  {id: 'style', label: 'Dry or sweet', kind: 'line', max: 80, hint: 'Bone dry, off-dry, sweet…'},
  {id: 'body', label: 'Body', kind: 'line', max: 40, hint: 'Light, medium, full'},
  {id: 'serve', label: 'Serve', kind: 'line', max: 80, hint: 'Well chilled, cellar temperature, warm (sake)…'},
  {id: 'tasting', label: 'Tasting notes', kind: 'text', max: 600, hint: 'A few words a server can say at the table'},
  {id: 'pairs', label: 'Pairs with', kind: 'text', max: 600, hint: 'Dishes from the menu'},
  {id: 'extra_fact', label: 'Extra fact', kind: 'text', max: 600},
];

// Dishes keep their existing description and sauce breakdown. Nothing here.
const FOOD_FIELDS: DetailField[] = [];

export function detailFields(contentType: ContentType): DetailField[] {
  return contentType === 'cocktails' ? COCKTAIL_FIELDS : contentType === 'wine' ? WINE_FIELDS : FOOD_FIELDS;
}

export type Details = Record<string, string>;

// What to show on a card: template order, blanks left out.
export function detailEntries(contentType: ContentType, details?: Details | null) {
  const stored = details ?? {};
  return detailFields(contentType)
    .map(field => ({field, value: (stored[field.id] ?? '').trim()}))
    .filter(entry => entry.value !== '');
}

// What to save from the form. Trimmed, capped, and blanks dropped so an
// untouched field stores nothing rather than an empty string.
export function detailsFromForm(contentType: ContentType, read: (id: string) => string | null): Details {
  const details: Details = {};
  for (const field of detailFields(contentType)) {
    const value = (read(field.id) ?? '').trim().slice(0, field.max);
    if (value) details[field.id] = value;
  }
  return details;
}

// The same number means different things behind the pass and behind the bar.
export function timeLabel(contentType: ContentType): string {
  return contentType === 'cocktails' ? 'Elaboration time' : 'Fire time';
}
