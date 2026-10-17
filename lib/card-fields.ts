import type { ContentType } from './categories.ts';
import { detailFields, timeLabel, type DetailField, type Details } from './detail-fields.ts';

// Which extra fields each library's cards show, per restaurant.
//
// The app ships a starting set of fields per library (lib/detail-fields.ts). A restaurant changes
// that set by saving rows in the card_fields table (supabase/migrations/031_card_fields.sql):
//   * hide or show a field the app ships with  -> a row with hidden true/false
//   * add a field of its own                    -> a row with custom true and a label
//   * delete a field it made                    -> only once hidden, through delete_card_field()
// No row means "exactly as shipped", so a restaurant that never touches this sees no change.
//
// What staff type is stored on each dish under the field's key (menu_items.details), never under its
// label, so renaming a field never loses an answer and hiding one never erases it.

export type CardFieldRow = {
  content_type: ContentType;
  field_key: string;
  custom: boolean;
  label: string | null;
  kind: 'line' | 'text';
  hidden: boolean;
  on_card: boolean;
  show_team: boolean;
  sort_order: number;
};

export type CardField = DetailField & {
  custom: boolean;
  hidden: boolean;
  // Prints on the card and the printed sheets.
  onCard: boolean;
  // Shown to the team when they open the card in the app.
  showTeam: boolean;
};

export const MAX_CUSTOM_FIELDS = 12;
export const MAX_LABEL = 40;
export const CUSTOM_MAX: Record<'line' | 'text', number> = {line: 120, text: 600};

export const isCustomKey = (key: string) => key.startsWith('x_');

// A new field's key: stable, lower case, and never the same as one the app ships with.
export function newFieldKey(random: () => number = Math.random): string {
  let id = '';
  while (id.length < 8) id += Math.floor(random() * 16).toString(16);
  return `x_${id}`;
}

// Every field of a library, hidden ones included, in the order the form shows them: the app's own
// fields first (in the app's order), then the restaurant's own fields in the order they were saved.
export function cardFields(contentType: ContentType, rows: readonly CardFieldRow[] = []): CardField[] {
  const mine = rows.filter(row => row.content_type === contentType);
  const byKey = new Map(mine.map(row => [row.field_key, row]));
  const shipped = detailFields(contentType).map((field): CardField => {
    const row = byKey.get(field.id);
    return {...field, custom: false, hidden: row?.hidden ?? false, onCard: row?.on_card ?? true, showTeam: row?.show_team ?? true};
  });
  const own = mine
    .filter(row => row.custom && isCustomKey(row.field_key) && (row.label ?? '').trim() !== '')
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((row): CardField => ({
      id: row.field_key,
      label: (row.label ?? '').trim(),
      kind: row.kind,
      max: CUSTOM_MAX[row.kind],
      custom: true,
      hidden: row.hidden,
      onCard: row.on_card,
      showTeam: row.show_team,
    }));
  return [...shipped, ...own];
}

export const shownFields = (contentType: ContentType, rows: readonly CardFieldRow[] = []) =>
  cardFields(contentType, rows).filter(field => !field.hidden);

export const hiddenFields = (contentType: ContentType, rows: readonly CardFieldRow[] = []) =>
  cardFields(contentType, rows).filter(field => field.hidden);

// The optional parts of the form that are stored on the item itself, not in details: they can be
// hidden the same way, but the item keeps whatever it holds. Name, category, photo, description,
// ingredients and allergens are never on this list: the Allergy check, search and the quizzes read them.
export type CoreFieldId = 'price' | 'fire' | 'price_label' | 'table_setting' | 'observations' | 'sauce';
const CORE_FIELDS: {id: CoreFieldId; label: (contentType: ContentType) => string; skip?: ContentType}[] = [
  {id: 'price', label: () => 'Price'},
  {id: 'fire', label: contentType => timeLabel(contentType), skip: 'wine'},
  {id: 'price_label', label: () => 'Alternative price label'},
  {id: 'table_setting', label: () => 'Table setting'},
  {id: 'observations', label: () => 'Observations'},
  {id: 'sauce', label: () => 'Sauce breakdown', skip: 'wine'},
];

// The built-in extras of a library, each with whether it is hidden. Wines have no fire time or sauces.
export function coreFields(contentType: ContentType, rows: readonly CardFieldRow[] = []): CardField[] {
  const byKey = new Map(rows.filter(row => row.content_type === contentType).map(row => [row.field_key, row]));
  return CORE_FIELDS.filter(field => field.skip !== contentType).map((field): CardField => ({
    id: field.id,
    label: field.label(contentType),
    kind: 'line',
    max: 0,
    custom: false,
    hidden: byKey.get(field.id)?.hidden ?? false,
    onCard: true,
    showTeam: true,
  }));
}

// The ids of the built-in extras a library has hidden. The form, the card and the print all ask this.
export function hiddenCore(contentType: ContentType, rows: readonly CardFieldRow[] = []): Set<string> {
  return new Set(coreFields(contentType, rows).filter(field => field.hidden).map(field => field.id));
}

// Delete is only for a field the restaurant made, and only after it has been hidden.
export const canDeleteField = (field: Pick<CardField, 'custom' | 'hidden'>) => field.custom && field.hidden;

// What a card shows: the shown fields in order, blanks left out. `where` picks the card and the
// printed sheets ('card') or the team's screen ('team').
export function cardEntries(
  contentType: ContentType,
  details: Details | null | undefined,
  rows: readonly CardFieldRow[] = [],
  where: 'card' | 'team' = 'team',
) {
  const stored = details ?? {};
  return shownFields(contentType, rows)
    .filter(field => (where === 'card' ? field.onCard : field.showTeam))
    .map(field => ({field, value: (stored[field.id] ?? '').trim()}))
    .filter(entry => entry.value !== '');
}

// What to save from the edit form. Shown fields are read from the form (trimmed, capped, blanks
// dropped). A hidden field keeps what the dish already holds, so "Show again" brings it back.
// Anything else the dish held is dropped, as it always was.
export function detailsToSave(
  contentType: ContentType,
  read: (id: string) => string | null,
  current: Details | null | undefined,
  rows: readonly CardFieldRow[] = [],
): Details {
  const stored = current ?? {};
  const details: Details = {};
  for (const field of cardFields(contentType, rows)) {
    if (field.hidden) {
      const kept = (stored[field.id] ?? '').trim();
      if (kept) details[field.id] = kept;
      continue;
    }
    const value = (read(field.id) ?? '').trim().slice(0, field.max);
    if (value) details[field.id] = value;
  }
  return details;
}

// How many dishes in a library have an answer for a field. Used for the warning before a delete.
export function answerCount(items: readonly {content_type?: string; details?: Details | null}[], contentType: ContentType, key: string): number {
  return items.filter(item => (item.content_type ?? 'food') === contentType && (item.details?.[key] ?? '').trim() !== '').length;
}

// Whether a new field can be added. Returns the sentence to show, or null when it is fine.
export function checkNewField(contentType: ContentType, rows: readonly CardFieldRow[], label: string): string | null {
  const name = label.trim().replace(/\s+/g, ' ');
  if (!name) return 'Give the field a name.';
  if (name.length > MAX_LABEL) return `Keep the name under ${MAX_LABEL} characters.`;
  const all = cardFields(contentType, rows);
  if (all.filter(field => field.custom).length >= MAX_CUSTOM_FIELDS) return `A library can have up to ${MAX_CUSTOM_FIELDS} fields of your own. Delete one you no longer use first.`;
  const same = all.find(field => field.label.toLowerCase() === name.toLowerCase());
  if (same) return same.hidden ? `“${same.label}” already exists and is hidden. Show it again instead.` : `“${same.label}” is already a field.`;
  return null;
}

// The row to save for a new field of the restaurant's own.
export function newFieldRow(
  contentType: ContentType,
  rows: readonly CardFieldRow[],
  input: {label: string; kind: 'line' | 'text'; onCard: boolean; showTeam: boolean},
  random: () => number = Math.random,
): CardFieldRow {
  const taken = new Set(rows.map(row => row.field_key));
  let key = newFieldKey(random);
  while (taken.has(key)) key = newFieldKey(random);
  const last = Math.max(0, ...rows.filter(row => row.content_type === contentType).map(row => row.sort_order));
  return {
    content_type: contentType,
    field_key: key,
    custom: true,
    label: input.label.trim().replace(/\s+/g, ' '),
    kind: input.kind,
    hidden: false,
    on_card: input.onCard,
    show_team: input.showTeam,
    sort_order: last + 1,
  };
}

// The row to save when a field is hidden or shown again. Works for shipped and custom fields.
export function withHidden(contentType: ContentType, rows: readonly CardFieldRow[], key: string, hidden: boolean): CardFieldRow {
  const found = rows.find(row => row.content_type === contentType && row.field_key === key);
  if (found) return {...found, hidden};
  return {content_type: contentType, field_key: key, custom: false, label: null, kind: 'line', hidden, on_card: true, show_team: true, sort_order: 0};
}
