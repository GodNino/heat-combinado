import { learningStatus, summarizeLearning } from './learning.ts';
// Binder-friendly print sheets: Helvetica, a spec-sheet layout, and the app's own palette: lime, charcoal and grays,
// with red, amber and green kept for warnings and results.
// Colour only ever backs up words that are already on the page, so a black-and-white copy still reads
// correctly. Only lime and amber print in colour; every other tone becomes black or white.
import { Pdf, measure, wrap, type Ink, type Jpeg, type Weight, type SheetHeader } from './pdf.ts';
import { dishDescription, serviceSummary } from './menu-summary.ts';
import { assessAllergies, isCC } from './allergies.ts';
import { timeLabel } from './detail-fields.ts';
import { cardEntries, hiddenCore, type CardFieldRow } from './card-fields.ts';
import type { QuizInput, PreshiftInput } from './sheets.ts';
import type { CustomTerm } from './glossary.ts';
import { contentTypeOf, CONTENT_LABELS } from './categories.ts';
import { categoryOf } from './categories.ts';
import { expandCrossContamination, type MenuItem } from './menu.ts';

type Tone = { color: readonly [number, number, number]; gray: number };
const tone = (r: number, g: number, b: number, gray: number): Tone => ({ color: [r / 255, g / 255, b / 255], gray });
const OLIVE = tone(18, 18, 18, 0.1);      // charcoal: rules, labels, outlines
const LIME = tone(199, 242, 58, 0.80);
const GREEN = tone(23, 128, 63, 0.3);
const MID = tone(106, 106, 102, 0.42);
const LIGHT = tone(206, 206, 202, 0.82);
const RED = tone(212, 42, 28, 0.2);       // allergens, do not serve, out tonight, to review
const AMBER = tone(240, 160, 75, 0.7);    // cross-contact, running low, needs practice
const YELLOW = LIGHT;  // ask the kitchen, changed
const CHARCOAL = tone(34, 34, 34, 0.13);   // neutral dark band
const SOFT_RED = tone(252, 232, 229, 0.94);
const SOFT_AMBER = tone(253, 238, 217, 0.92);
const SOFT_OLIVE = tone(238, 249, 196, 0.92);
const PALE = tone(237, 237, 237, 0.93);
const SAGE = tone(228, 246, 162, 0.86);      // category chips on the allergy sheet
const DARK_OLIVE = tone(18, 18, 18, 0.05);   // text on those chips
// Black and white, with two brand accents: lime and amber. Every other tone prints as black or white.
const paint = (value: Tone): Ink => (value === LIME || value === AMBER ? value.color : value.gray < 0.5 ? 0 : 1);
const WHITE: Ink = 1;
const BLACK: Ink = 0;
const MUTED: Ink = 0.3;
const HAIR: Ink = 0.62;

const SIZE = 11;
const LEAD = 15;
const LEFT = 48;
const WIDTH = 516;
const BOTTOM = 708;
const TITLE = 24;
const LABEL = 8.5;
const CELL = 14;
type Line = { text: string; weight: Weight };
const lines = (text: string, weight: Weight, width = WIDTH): Line[] =>
  wrap(text, weight, SIZE, width).map(text => ({ text, weight }));

/** One run of words on a line of a row: where it starts, how it is set. */
type Seg = { text: string; weight: Weight; ink: Ink; dx: number };
/** One piece of content in a row. With `k` it reads "Label: value". */
type Item = { k?: string; v: string; weight?: Weight; ink?: Ink };

function flow(items: Item[], width: number): Seg[][] {
  const out: Seg[][] = [];
  for (const item of items) {
    const weight = item.weight ?? 'regular';
    const ink = item.ink ?? BLACK;
    const paragraphs = (item.v ?? '').replace(/\r\n?/g, '\n').split('\n');
    let head = item.k ? `${item.k}:` : '';
    paragraphs.forEach(paragraph => {
      if (head) {
        const indent = measure(`${head} `, 'bold', SIZE);
        if (indent > width / 2) {
          out.push([{ text: head, weight: 'bold', ink: BLACK, dx: 0 }]);
          head = '';
        } else {
          const rows = wrap(paragraph, weight, SIZE, width - indent);
          const first: Seg[] = [{ text: head, weight: 'bold', ink: BLACK, dx: 0 }];
          if (rows[0]) first.push({ text: rows[0], weight, ink, dx: indent });
          out.push(first);
          // Reflow the rest at the full column width instead of keeping the inset.
          const rest = rows.slice(1).join(' ');
          if (rest) wrap(rest, weight, SIZE, width).forEach(text => out.push([{ text, weight, ink, dx: 0 }]));
          head = '';
          return;
        }
      }
      if (!paragraph.trim() && out.length) { out.push([]); return; }
      wrap(paragraph, weight, SIZE, width).forEach(text => out.push([{ text, weight, ink, dx: 0 }]));
    });
  }
  while (out.length && !out[out.length - 1].length) out.pop();
  return out;
}

class PlainSheet {
  readonly pdf = new Pdf();
  y = 0;
  top = 0;
  readonly header: SheetHeader;
  readonly identity: string;
  readonly employeeHeader: boolean;
  readonly safety: boolean;
  constructor(header: SheetHeader, identity: string, employeeHeader = false, safety = false) {
    this.employeeHeader = employeeHeader; this.header = header; this.identity = identity; this.safety = safety;
    this.page(false);
  }

  /** Text whose top edge sits at `top`. */
  put(text: string, x: number, top: number, weight: Weight, size: number, ink: Ink = BLACK, tracking = 0): void {
    this.pdf.text(text, x, top + size, weight, size, ink, tracking);
  }
  rect(x: number, y: number, w: number, h: number, ink: Ink): void { this.pdf.fill(x, y, w, h, ink); }
  /** A thin horizontal line. */
  hair(y: number, ink: Ink = HAIR, x = LEFT, w = WIDTH, thick = 0.5): void { this.pdf.fill(x, y, w, thick, ink); }
  /** Right-aligned text ending at `right`. */
  putRight(text: string, right: number, top: number, weight: Weight, size: number, ink: Ink = BLACK): void {
    this.put(text, right - measure(text, weight, size), top, weight, size, ink);
  }

  private page(continued: boolean): void {
    this.y = 32;
    const kind = this.header.kind.toUpperCase();
    const tag = measure(kind, 'bold', LABEL) + kind.length * 0.8 + 18;
    const restaurant = lines(`HEAT / ${this.header.restaurant}`, 'bold', WIDTH - tag - 24);
    // The sheet type sits in a coloured tag, so a stack of sheets in a binder is easy to leaf through.
    this.rect(LEFT + WIDTH - tag, 29, tag, 18, paint(LIME));
    this.pdf.stroke(LEFT + WIDTH - tag, 29, tag, 18, paint(OLIVE), 1.1);
    this.put(kind, LEFT + WIDTH - tag + 8.6, 32.55, 'bold', LABEL, BLACK, 0.8);
    for (const line of restaurant) {
      this.put(line.text, LEFT, this.y - 1, line.weight, SIZE);
      this.y += LEAD;
    }
    this.y = Math.max(this.y, 48) + 6;
    this.hair(this.y, HAIR);
    this.y += 12;
    if (this.employeeHeader && continued) { this.body(`${this.identity} / Employee summary`, 'bold'); this.y += 8; }
    else if (continued) { this.body(`${this.identity} (continued)`, 'bold'); this.y += 8; }
    this.top = this.y;
  }
  next(): void { this.pdf.newPage(); this.page(true); }
  need(height: number): void { if (this.y + height > BOTTOM) this.next(); }
  rule(): void {
    this.need(12);
    this.hair(this.y, HAIR);
    this.y += 12;
  }
  body(text: string, weight: Weight = 'regular', ink: Ink = BLACK): void {
    for (const line of lines(text, weight)) {
      this.need(LEAD);
      this.put(line.text, LEFT, this.y, line.weight, SIZE, ink);
      this.y += LEAD;
    }
  }
  /** A flat section heading: bold, olive, with a thin olive rule. Used on flowing sheets. */
  section(title: string): void {
    const height = lines(title, 'bold').length * LEAD;
    this.need(height + LEAD + 20);
    this.y += 12;
    this.body(title, 'bold', paint(OLIVE));
    this.hair(this.y + 1, paint(OLIVE), LEFT, WIDTH, 1);
    this.y += 8;
  }
  labelled(label: string, value: string): void {
    if (!value.trim()) return;
    // Keep labels and values together; wrap even unusually long custom labels.
    const labelText = `${label}:`;
    const indent = measure(`${labelText} `, 'bold', SIZE);
    if (indent > WIDTH / 2) {
      this.need(LEAD * 2);
      this.body(labelText, 'bold'); this.body(value); return;
    }
    const paragraphs = value.replace(/\r\n?/g, '\n').split('\n');
    const firstRows = wrap(paragraphs[0], 'regular', SIZE, WIDTH - indent);
    this.need(LEAD);
    this.put(labelText, LEFT, this.y, 'bold', SIZE);
    this.put(firstRows[0] ?? '', LEFT + indent, this.y, 'regular', SIZE);
    this.y += LEAD;
    // Reflow the remaining words at full width instead of retaining the inset.
    if (firstRows.length > 1) this.body(firstRows.slice(1).join(' '));
    for (const paragraph of paragraphs.slice(1)) this.body(paragraph);
  }

  /** A full-width coloured band holding a short label, and optionally a count on the right. */
  band(label: string, fill: Tone, ink: Ink = WHITE, right = '', note = ''): void {
    this.need(18 + 6);
    this.rect(LEFT, this.y, WIDTH, 18, paint(fill));
    this.put(label, LEFT + 8, this.y + 2, 'bold', SIZE, ink);
    if (note) this.put(note, LEFT + 8 + measure(label, 'bold', SIZE) + 8, this.y + 2, 'regular', SIZE, ink);
    if (right) this.putRight(right, LEFT + WIDTH - 8, this.y + 2, 'bold', SIZE, ink);
    this.y += 18;
  }

  /** The strip under a title: a few short facts, each with a tiny label. Cells that do not fit are skipped. */
  glance(cells: { label: string; value: string; ink?: Ink }[], width = WIDTH, x = LEFT): string[] {
    let shown = cells.filter(cell => cell.value.trim());
    // A fact too long for its cell is left out of the strip (the caller prints it as a row instead).
    for (;;) {
      const w = width / Math.max(shown.length, 1);
      const keep = shown.filter(c => measure(c.value, 'bold', CELL) <= w - 14);
      if (keep.length === shown.length) break;
      shown = keep;
    }
    if (!shown.length) return [];
    const w = width / shown.length;
    this.need(34);
    this.pdf.stroke(x, this.y, width, 33, paint(OLIVE), 1.1);
    shown.forEach((c, i) => {
      const cx = x + i * w;
      if (i) this.pdf.fill(cx, this.y, 0.7, 33, paint(OLIVE));
      this.put(c.label.toUpperCase(), cx + 9, this.y + 4, 'bold', 7.5, paint(OLIVE), 0.7);
      this.put(c.value, cx + 9, this.y + 13, 'bold', CELL, c.ink ?? BLACK);
    });
    this.y += 33;
    return shown.map(c => c.label);
  }

  /** A label tab with a tinted box beside it: the allergen block. Always one line for the label. */
  tabRow(label: string, text: string, bg: Tone, fg: Ink, tint: Tone, bold: boolean, first = true): void {
    const tab = 144;
    const rows = lines(text, bold ? 'bold' : 'regular', WIDTH - tab - 20);
    const height = Math.max(22, rows.length * LEAD + 7);
    this.need(height + (first ? 0 : 0));
    this.rect(LEFT, this.y, WIDTH, height, paint(tint));
    this.rect(LEFT, this.y, tab, height, paint(bg));
    this.put(label, LEFT + 10, this.y + height / 2 - 5.45, 'bold', LABEL, fg, 0.8);
    rows.forEach((row, i) => this.put(row.text, LEFT + tab + 10, this.y + 3.5 + i * LEAD, row.weight, SIZE));
    this.pdf.stroke(LEFT, this.y, WIDTH, height, BLACK, 1);
    this.y += height;
  }

  /**
   * A spec-sheet row: a small olive label on the left, the content on the right, a hairline under it.
   * Long content runs onto the next page a line at a time, and the label is repeated there.
   */
  row(label: string, items: Item[], first = false): void {
    const vx = LEFT + 104;
    const rows = flow(items, WIDTH - 104);
    if (!rows.length) return;
    this.need(Math.min(rows.length, 2) * LEAD + 12);
    if (first) { this.hair(this.y, paint(OLIVE), LEFT, WIDTH, 1.6); this.y += 1.6; }
    const draw = () => this.put(label.toUpperCase(), LEFT, this.y + 2.5, 'bold', LABEL, paint(OLIVE), 0.8);
    this.y += 5;
    draw();
    rows.forEach(segs => {
      if (this.y + LEAD > BOTTOM) { this.next(); this.y += 5; draw(); }
      segs.forEach(seg => this.put(seg.text, vx + seg.dx, this.y, seg.weight, SIZE, seg.ink));
      this.y += LEAD;
    });
    this.y += 5;
    this.hair(this.y, HAIR);
    this.y += 0.5;
  }

  /** A tinted quote block with an olive bar on the left. For "What to say", summaries, one-liners. */
  quote(label: string, text: string, x = LEFT, width = WIDTH, size = 12, weight: Weight = 'oblique'): void {
    const inner = width - 26;
    const rows = wrap(text, weight, size, inner);
    const lead = size + 5;
    const height = 8 + (label ? 11 : 0) + rows.length * lead + 3;
    this.need(height);
    this.rect(x, this.y, width, height, paint(SOFT_OLIVE));
    this.rect(x, this.y, 3.5, height, paint(OLIVE));
    let top = this.y + 6;
    if (label) { this.put(label.toUpperCase(), x + 14, top, 'bold', 7.5, paint(OLIVE), 0.7); top += 11; }
    rows.forEach((row, i) => this.put(row, x + 14, top + i * lead, weight, size));
    this.y += height;
  }

  /** Name and date lines to write on. */
  signLines(left: string, right: string): void {
    this.need(30);
    const y = this.y + 16;
    this.hair(y, paint(OLIVE), LEFT, 300, 0.8);
    this.put(left, LEFT, y + 3, 'regular', 9, MUTED);
    this.hair(y, paint(OLIVE), LEFT + 330, 186, 0.8);
    this.put(right, LEFT + 330, y + 3, 'regular', 9, MUTED);
    this.y = y + 18;
  }

  /** A small tag whose words carry the meaning; colour backs it up. Returns the width used. */
  tag(text: string, right: number, top: number, fill: Tone, ink: Ink): void {
    const width = measure(text, 'bold', 8.5) + text.length * 0.5 + 14;
    this.rect(right - width, top, width, 14, paint(fill));
    this.put(text, right - width + 6.75, top + 1.55, 'bold', 8.5, ink, 0.5);
  }

  /** Title block: a big name, then a quiet line under it. */
  title(name: string, meta: string, width = WIDTH, x = LEFT): void {
    for (const row of wrap(name, 'bold', TITLE, width)) {
      this.need(TITLE + 6);
      this.put(row, x, this.y, 'bold', TITLE);
      this.y += TITLE + 4;
    }
    if (meta) {
      for (const row of wrap(meta, 'regular', SIZE, width)) {
        this.need(LEAD);
        this.put(row, x, this.y + 1, 'regular', SIZE, MUTED);
        this.y += LEAD - 1;
      }
    }
  }

  finish(title: string): Uint8Array {
    const total = this.pdf.pageCount;
    for (let index = 0; index < total; index++) {
      this.pdf.appendToPage(index, () => {
        if (this.safety) this.put('Records can be incomplete. Confirm with the kitchen before answering a guest about allergies.', LEFT, 714, 'oblique', 9, MUTED);
        this.pdf.fill(LEFT, 731, WIDTH, 0.5, HAIR);
        this.put(`Printed ${this.header.printed}`, LEFT, 738, 'regular', 9, MUTED);
        if (this.header.updated) this.put(`Content last updated ${this.header.updated}`, LEFT, 751, 'oblique', 9, MUTED);
        if (total > 1) {
          const number = `${index + 1} of ${total}`;
          this.putRight(number, LEFT + WIDTH, 738, 'regular', 9, MUTED);
        }
      });
    }
    return this.pdf.build(title);
  }
}

/* ------------------------------------------------------------------ helpers -- */

type Palette = { fill: Tone; ink: Ink; tint: Tone };
/** The pre-shift groups are named by the manager, so the colour follows what the name says. */
function groupPalette(label: string): Palette {
  const text = label.toLowerCase();
  if (/86|\bout\b|sold|unavailable|off the menu/.test(text)) return { fill: RED, ink: WHITE, tint: SOFT_RED };
  if (/low|limited|short|count|running/.test(text)) return { fill: AMBER, ink: BLACK, tint: SOFT_AMBER };
  if (/new|special|feature|added|launch/.test(text)) return { fill: LIME, ink: BLACK, tint: SOFT_OLIVE };
  if (/chang|updat|swap|substitut/.test(text)) return { fill: YELLOW, ink: BLACK, tint: PALE };
  return { fill: CHARCOAL, ink: WHITE, tint: PALE };
}

/** Text on a tinted panel, a page at a time, so a long note never runs off the paper. */
function panelText(sheet: PlainSheet, text: string, tint: Tone, edge: Tone | null, weight: Weight = 'regular'): void {
  const rows = lines(text, weight, WIDTH - 20);
  let index = 0;
  while (index < rows.length) {
    sheet.need(LEAD + 8);
    const room = Math.max(1, Math.floor((BOTTOM - sheet.y - 8) / LEAD));
    const chunk = rows.slice(index, index + room);
    const height = chunk.length * LEAD + 8;
    sheet.rect(LEFT, sheet.y, WIDTH, height, paint(tint));
    if (edge) sheet.pdf.stroke(LEFT, sheet.y, WIDTH, height, paint(edge), 0.8);
    chunk.forEach((row, i) => sheet.put(row.text, LEFT + 8, sheet.y + 4 + i * LEAD, row.weight, SIZE));
    sheet.y += height;
    index += chunk.length;
    if (index < rows.length) sheet.next();
  }
}

/* ----------------------------------------------------------- shift report -- */

export type ShiftReportSheetInput = {
  /** "Fri, Oct 23". */
  day: string;
  label: string;
  urgent: boolean;
  mood: string;
  covers: string;
  sales: string;
  issues: { kind: string; note: string; urgent: boolean }[];
  fromHeat: string[];
  lowStock: string;
  shoutouts: string;
  nextShift: string;
  notes: string;
  writtenBy: string;
  changedBy?: string | null;
  changedAt?: string | null;
};

/** The end-of-shift report on paper: who wrote it and who changed it last, problems first. */
export function plainShiftReportSheet(input: ShiftReportSheetInput, header: SheetHeader): Uint8Array {
  const sheet = new PlainSheet(header, `${input.label} report / ${input.day}`);
  const changed = input.changedBy ? ` / Last changed by ${input.changedBy}${input.changedAt ? `, ${input.changedAt}` : ''}` : '';
  sheet.title(`${input.label} report`, `${input.day} / Written by ${input.writtenBy}${changed}`);
  sheet.y += 10;
  if (input.urgent) { sheet.band('URGENT: allergy incident or injury reported', RED, WHITE); sheet.y += 8; }
  sheet.glance([{ label: 'Night', value: input.mood }, { label: 'Covers', value: input.covers }, { label: 'Sales', value: input.sales }]);
  sheet.y += 4;
  if (input.issues.length) {
    sheet.section('Issues');
    for (const issue of input.issues) {
      panelText(sheet, `${issue.kind}${issue.urgent ? ' (urgent)' : ''}: ${issue.note || 'no details'}`, issue.urgent ? SOFT_RED : PALE, issue.urgent ? RED : null, issue.urgent ? 'bold' : 'regular');
      sheet.y += 4;
    }
  }
  if (input.fromHeat.length) {
    sheet.section('From HEAT');
    for (const line of input.fromHeat) sheet.body(`- ${line}`);
  }
  const blocks: [string, string][] = [['Low stock / to order', input.lowStock], ['Shout-outs', input.shoutouts], ['For the next shift', input.nextShift], ['Notes', input.notes]];
  for (const [title, text] of blocks) {
    if (!text.trim()) continue;
    sheet.section(title);
    for (const paragraph of text.split(/\r?\n/)) sheet.body(paragraph);
  }
  if (!input.issues.length && !input.fromHeat.length && blocks.every(([, text]) => !text.trim())) {
    sheet.y += 8;
    sheet.body('Nothing else was added to this report.', 'regular', MUTED);
  }
  return sheet.finish(`${input.label} report - ${input.day}`);
}

/* --------------------------------------------------------------- pre-shift -- */

export function plainPreshiftSheet(input: PreshiftInput, date: string, header: SheetHeader): Uint8Array {
  const sheet = new PlainSheet(header, `Pre-shift / ${date || 'Tonight'}`);
  sheet.title(date || 'Tonight', input.postedBy ? `Posted by ${input.postedBy}` : '');
  sheet.y += 8;
  if (input.note?.trim()) {
    sheet.band('From the manager', SOFT_OLIVE, BLACK);
    panelText(sheet, input.note.trim(), SOFT_OLIVE, OLIVE);
    sheet.y += 8;
  }
  if (input.focus.length) {
    // Focus dishes run along the line like a list of names, wrapping like text would.
    const pieces = input.focus.map((name, index) => `${index + 1}. ${name}`);
    const rows: string[][] = [[]];
    let used = 0;
    for (const piece of pieces) {
      const width = measure(piece, 'bold', SIZE);
      if (rows[rows.length - 1].length && used + 22 + width > WIDTH - 20) { rows.push([]); used = 0; }
      used += (rows[rows.length - 1].length ? 22 : 0) + width;
      rows[rows.length - 1].push(piece);
    }
    sheet.need(18 + rows.length * LEAD + 8);
    sheet.band("Tonight's focus", CHARCOAL);
    sheet.pdf.stroke(LEFT, sheet.y, WIDTH, rows.length * LEAD + 8, paint(CHARCOAL), 1);
    rows.forEach((row, rowIndex) => {
      let x = LEFT + 8;
      row.forEach(piece => {
        sheet.put(piece, x, sheet.y + 4 + rowIndex * LEAD, 'bold', SIZE);
        x += measure(piece, 'bold', SIZE) + 22;
      });
    });
    sheet.y += rows.length * LEAD + 8 + 8;
  }
  for (const group of input.groups) {
    if (!group.entries.length) continue;
    const palette = groupPalette(group.label);
    const open = (continued: boolean) => {
      sheet.need(18 + LEAD * 2 + 12);
      sheet.band(continued ? `${group.label} (continued)` : group.label, palette.fill, palette.ink, String(group.entries.length));
    };
    open(false);
    for (const entry of group.entries) {
      const names = lines(entry.name, 'bold', 142);
      const details = entry.detail?.trim() ? lines(entry.detail.trim(), 'regular', WIDTH - 166) : [];
      const total = Math.max(names.length, details.length, 1);
      let done = 0;
      while (done < total) {
        if (sheet.y + Math.min(total - done, 2) * LEAD + 6 > BOTTOM) { sheet.next(); open(true); }
        const room = Math.max(1, Math.floor((BOTTOM - sheet.y - 6) / LEAD));
        const chunk = Math.min(room, total - done);
        const height = chunk * LEAD + 6;
        sheet.rect(LEFT, sheet.y, WIDTH, height, paint(palette.tint));
        sheet.rect(LEFT, sheet.y + height, WIDTH, 1, WHITE);
        for (let i = 0; i < chunk; i++) {
          const name = names[done + i]; const detail = details[done + i];
          if (name) sheet.put(name.text, LEFT + 8, sheet.y + 3 + i * LEAD, 'bold', SIZE);
          if (detail) sheet.put(detail.text, LEFT + 158, sheet.y + 3 + i * LEAD, 'regular', SIZE);
        }
        sheet.y += height + 1;
        done += chunk;
        if (done < total) { sheet.next(); open(true); }
      }
    }
    sheet.y += 10;
  }
  if (!input.note?.trim() && !input.focus.length && !input.groups.some(group => group.entries.length)) {
    sheet.body('Nothing is on the board for this service.');
  }
  return sheet.finish(`Pre-shift board - ${date}`);
}

/* ---------------------------------------------------------- dish / drink card -- */

const BOXES = [164, 140, 118, 100];

function glanceId(label: string): string {
  return label === 'Glass' ? 'glassware' : label === 'Serve' ? 'serve' : label === 'Vintage' ? 'vintage' : '';
}

function cardSheet(item: MenuItem, photo: Jpeg | null | undefined, header: SheetHeader, box: number, cardRows: readonly CardFieldRow[]): PlainSheet {
  const type = contentTypeOf(item);
  const label = CONTENT_LABELS[type].short;
  const sheet = new PlainSheet(header, item.name || `${label} card`, false, true);
  const parsed = type === 'food' ? dishDescription(item.description || '') : { intro: item.description || '', recipes: [] as { name: string; details: string }[], observation: '', source: '' };
  const entries = cardEntries(type, item.details, cardRows, 'card');
  // The built-in extras a restaurant has hidden stay off the paper, as they stay off the card.
  const off = hiddenCore(type, cardRows);
  const detail = (id: string) => entries.find(entry => entry.field.id === id)?.value ?? '';
  const notes = (item.allergens ?? []).filter(Boolean);
  const contains = notes.filter(note => !isCC(note)).map(expandCrossContamination);
  const cross = notes.filter(isCC).map(expandCrossContamination);
  const price = serviceSummary({ price_label: off.has('price_label') ? null : item.price_label, price: off.has('price') ? null : item.price });
  const time = item.fire_minutes != null && !off.has('fire') ? `${item.fire_minutes} min` : '';
  const meta = item.category ? `${label} / ${item.category}` : label;
  const cells = type === 'food'
    ? [{ label: 'Price', value: price }, { label: timeLabel(type), value: time }, { label: 'Allergens', value: contains.length ? `${contains.length} contained` : notes.length ? 'Cross-contamination' : 'Not recorded', ink: paint(RED) }]
    : type === 'cocktails'
      ? [{ label: 'Price', value: price }, { label: timeLabel(type), value: time }, { label: 'Glass', value: detail('glassware') }]
      : [{ label: 'Price', value: price }, { label: 'Serve', value: detail('serve') }, { label: 'Vintage', value: detail('vintage') }];
  const quoteText = detail('tasting');

  const hasPhoto = !!photo && photo.width > 0 && photo.height > 0;
  let shown: string[] = [];
  let remainder = '';
  if (hasPhoto && photo) {
    const maxW = type === 'wine' ? Math.round(box * 0.82) : box;
    const maxH = type === 'wine' ? Math.round(box * 1.25) : box;
    const scale = Math.min(maxW / photo.width, maxH / photo.height);
    const drawnW = photo.width * scale; const drawnH = photo.height * scale;
    sheet.need(drawnH + 8);
    const top = sheet.y;
    sheet.pdf.image(photo, LEFT, top, drawnW, drawnH);
    sheet.pdf.stroke(LEFT, top, drawnW, drawnH, 0.7, 0.6);
    const x = LEFT + drawnW + 16;
    const width = WIDTH - drawnW - 16;
    sheet.title(item.name || `${label} card`, meta, width, x);
    sheet.y += 4;
    shown = sheet.glance(cells.filter(c => c.value), width, x);
    sheet.y += 8;
    if (quoteText) { sheet.quote('What to say', quoteText, x, width, 11, 'oblique'); sheet.y += 8; }
    if (parsed.intro.trim()) {
      const rows = wrap(parsed.intro, 'regular', SIZE, width);
      const room = Math.max(0, Math.floor((top + drawnH - sheet.y + 2) / LEAD));
      rows.slice(0, room).forEach(row => { sheet.put(row, x, sheet.y, 'regular', SIZE); sheet.y += LEAD; });
      remainder = rows.slice(room).map(row => row || '\n').join(' ').replace(/ ?\n ?/g, '\n').trim();
    }
    sheet.y = Math.max(sheet.y, top + drawnH) + 12;
    if (remainder) { sheet.body(remainder); sheet.y += 6; }
  } else {
    sheet.title(item.name || `${label} card`, meta);
    sheet.y += 4;
    shown = sheet.glance(cells.filter(c => c.value));
    if (quoteText) { sheet.y += 8; sheet.quote('What to say', quoteText); }
    sheet.y += 10;
  }

  if (!notes.length) {
    sheet.tabRow('ALLERGENS', type === 'food'
      ? 'Nothing recorded. This is not the same as safe.\nPlease ask the kitchen before answering a guest.'
      : 'None recorded.\nPlease ask the bar before answering a guest.', RED, WHITE, SOFT_RED, true);
  } else {
    if (contains.length) sheet.tabRow('ALLERGENS', contains.join(', '), RED, WHITE, SOFT_RED, true);
    if (cross.length) sheet.tabRow('CROSS-CONTAMINATION', cross.join(', '), AMBER, BLACK, SOFT_AMBER, false, !contains.length);
  }
  sheet.y += 10;

  // Facts that already sit in the strip under the name are not printed again below.
  const used = new Set(shown.map(glanceId).filter(Boolean));
  used.add('tasting');
  const priority = type === 'cocktails' ? ['spec', 'method', 'glassware', 'classification'] : ['tasting', 'pairs', 'region', 'vintage', 'grade', 'serve'];
  const ordered = entries.filter(entry => !used.has(entry.field.id)).sort((a, b) => {
    const rank = (id: string) => priority.includes(id) ? priority.indexOf(id) : priority.length;
    return rank(a.field.id) - rank(b.field.id);
  });
  let first = true;
  const add = (name: string, items: Item[]) => {
    if (!items.some(item => item.v.trim())) return;
    sheet.row(name, items.filter(item => item.v.trim()), first); first = false;
  };
  if (!hasPhoto && parsed.intro.trim()) add('Description', [{ v: parsed.intro }]);
  for (const cell of cells) if (cell.value && !shown.includes(cell.label) && (cell.label === 'Price' || cell.label === timeLabel(type))) add(cell.label, [{ v: cell.value }]);
  for (const entry of ordered) add(entry.field.label, [{ v: entry.value }]);
  const observations = [item.observations, parsed.observation].filter((v, i, all) => !off.has('observations') && v?.trim() && all.indexOf(v) === i);
  add('Service', [
    ...(item.table_setting && !off.has('table_setting') ? [{ k: 'Table setting', v: item.table_setting }] : []),
    ...observations.map(note => ({ k: 'Observations', v: note! })),
  ]);
  if (item.ingredients?.length) add('Ingredients', [{ v: item.ingredients.join(', ') }]);
  if (parsed.recipes.length && !off.has('sauce')) add('Sauces', parsed.recipes.map(recipe => ({ k: recipe.name, v: recipe.details })));
  if (parsed.source) { sheet.y += 8; sheet.body(`Source: ${parsed.source}`, 'oblique', MUTED); }
  return sheet;
}

export function plainMenuCard(item: MenuItem, photo: Jpeg | null | undefined, header: SheetHeader, cardRows: readonly CardFieldRow[] = []): Uint8Array {
  const hasPhoto = !!photo && photo.width > 0 && photo.height > 0;
  // The photo starts as large as the page allows, and steps down only if the words would otherwise
  // spill onto a second sheet. A card that is long still keeps a photo you can recognise the dish from.
  const sizes = hasPhoto ? BOXES : [BOXES[0]];
  let sheet = cardSheet(item, photo, header, sizes[0], cardRows);
  for (const size of sizes) {
    sheet = cardSheet(item, photo, header, size, cardRows);
    if (sheet.pdf.pageCount === 1) break;
  }
  return sheet.finish(`${item.name} — card`);
}

/* ------------------------------------------------------------ allergy sheet -- */

type Bucket = { key: string; label: string; note: string; palette: Palette; items: MenuItem[] };
type Block = { title: string; names: string[][]; height: number };
/**
 * How tightly the lists are set. The sheet tries the roomiest setting first and steps down, adding
 * columns as the text shrinks, until the whole list fits on one page.
 */
type Density = { size: number; lead: number; cols: number; colW: number; gutter: number; pad: number; small: boolean };
const columnsOf = (cols: number, gutter: number) => (WIDTH - (cols - 1) * gutter) / cols;
const DENSITIES: Density[] = [
  { size: 11,  lead: 14,   cols: 4, colW: columnsOf(4, 12), gutter: 12, pad: 6,   small: false },
  { size: 9.5, lead: 11.5, cols: 4, colW: columnsOf(4, 12), gutter: 12, pad: 5,   small: true },
  { size: 8.5, lead: 10.2, cols: 5, colW: columnsOf(5, 10), gutter: 10, pad: 4,   small: true },
  { size: 7.6, lead: 9,    cols: 6, colW: columnsOf(6, 8),  gutter: 8,  pad: 3.5, small: true },
  { size: 6.8, lead: 8,    cols: 7, colW: columnsOf(7, 6),  gutter: 6,  pad: 3,   small: true },
];
const BAND_HEIGHT = 18;
const chipText = (d: Density) => d.colW - 14;
const gapAfter = (d: Density) => Math.round(d.lead * 0.65);

function blocks(items: MenuItem[], d: Density, order?: readonly string[]): Block[] {
  const grouped = new Map<string, MenuItem[]>();
  for (const item of items) {
    const category = categoryOf(item);
    const group = grouped.get(category) ?? [];
    group.push(item); grouped.set(category, group);
  }
  const categories = [...new Set([...(order ?? []), ...grouped.keys()])].filter(category => grouped.has(category));
  return categories.map(title => {
    const names = grouped.get(title)!.map(item => wrap(item.name || 'Unnamed item', 'regular', d.size, d.colW));
    const height = (wrap(title, 'bold', d.size, chipText(d)).length + names.flat().length) * d.lead + gapAfter(d) + 3 + d.pad;
    return { title, names, height };
  });
}

/** Balance whole categories; never deduplicate dishes by display name. */
function balanced(groups: Block[], d: Density): Block[][] {
  // A very large single category must be allowed to use more than one column.
  const target = Math.max(120, Math.min(480, groups.reduce((sum, block) => sum + block.height, 0) / d.cols));
  const head = (title: string) => wrap(title, 'bold', d.size, chipText(d)).length * d.lead + gapAfter(d) + 3 + d.pad;
  const pieces: Block[] = [];
  for (const block of groups) {
    let names: string[][] = [];
    let height = head(block.title);
    let continued = false;
    const flush = () => {
      pieces.push({title: block.title + (continued ? ' (cont.)' : ''), names, height});
      continued = true; names = [];
      height = head(block.title + ' (cont.)');
    };
    for (const name of block.names) {
      if (names.length && height + name.length * d.lead > target && block.height > target) flush();
      names.push(name); height += name.length * d.lead;
    }
    if (names.length) flush();
  }
  const columns: {index: number; block: Block}[][] = Array.from({length: d.cols}, () => []);
  const heights: number[] = Array.from({length: d.cols}, () => 0);
  pieces.map((block, index) => ({block, index})).sort((a, b) => b.block.height - a.block.height || a.index - b.index).forEach(entry => {
    const col = heights.indexOf(Math.min(...heights));
    columns[col].push(entry); heights[col] += entry.block.height;
  });
  return columns.map(column => column.sort((a, b) => a.index - b.index).map(entry => entry.block));
}

type AllergyInput = { allergies: string[]; items: MenuItem[]; sections?: readonly string[] };

function buildAllergySheet(input: AllergyInput, header: SheetHeader, first: Density, rest: Density): { bytes: Uint8Array; pages: number } {
  let d = first;
  const asked = input.allergies.filter(Boolean);
  const identity = asked.join(' + ') || 'Allergy';
  const sheet = new PlainSheet(header, identity, false, true);
  sheet.title(identity, `Allergy sheet · ${input.items.length} ${input.items.length === 1 ? 'item' : 'items'} checked`);
  sheet.y += d.small ? 6 : 10;
  panelText(sheet, 'Confirm current ingredients, sauces and preparation with the kitchen before answering a guest.', SOFT_OLIVE, OLIVE, 'bold');
  sheet.y += d.small ? 6 : 10;
  // The status is the one thing here that has to carry across a room, so it is set in a band whose
  // darkness follows the risk, and the four counts are repeated in a strip at the top.
  const buckets: Bucket[] = [
    {key: 'avoid', label: 'DO NOT SERVE', note: 'The selected allergen is recorded in the item.', palette: {fill: RED, ink: WHITE, tint: SOFT_RED}, items: []},
    {key: 'cross-contact', label: 'CROSS-CONTAMINATION', note: 'Confirm preparation with the kitchen before offering.', palette: {fill: AMBER, ink: BLACK, tint: SOFT_AMBER}, items: []},
    {key: 'unknown', label: 'ASK THE KITCHEN', note: 'Incomplete records. Do not offer until confirmed.', palette: {fill: MID, ink: WHITE, tint: PALE}, items: []},
    {key: 'no-match', label: 'NO ALLERGEN FOUND', note: '', palette: {fill: LIME, ink: BLACK, tint: PALE}, items: []},
  ];
  for (const item of [...input.items].sort((a, b) => a.name.localeCompare(b.name))) {
    const status = assessAllergies(item, asked).status;
    buckets.find(bucket => bucket.key === status)!.items.push(item);
  }
  if (!input.items.length) sheet.body('No menu items to print.');
  else {
    const cell = WIDTH / 4;
    sheet.need(42);
    sheet.pdf.stroke(LEFT, sheet.y, WIDTH, 40, paint(OLIVE), 1.1);
    buckets.forEach((bucket, i) => {
      const x = LEFT + i * cell;
      sheet.rect(x, sheet.y, cell, 14, paint(bucket.palette.fill));
      sheet.put(bucket.label, x + 8, sheet.y + 2.2, 'bold', 7.5, bucket.palette.ink, 0.5);
      sheet.put(String(bucket.items.length), x + 8, sheet.y + 16.7, 'bold', 16, BLACK);
      if (i) sheet.pdf.fill(x, sheet.y, 0.7, 40, paint(OLIVE));
    });
    sheet.y += 40 + 4;
  }
  for (const bucket of buckets) {
    if (!bucket.items.length) continue;
    // Every list on the sheet is set in the same size.
    d = bucket.key === 'no-match' ? rest : first;
    const band = d.small ? 16 : BAND_HEIGHT;
    const heading = `${bucket.label} / ${bucket.items.length} ITEMS`;
    const columns = balanced(blocks(bucket.items, d, input.sections), d);
    const noteHeight = !bucket.note ? 0 : d.small ? 11 : lines(bucket.note, 'regular').length * LEAD;
    const headingHeight = band + 6 + noteHeight + 10;
    const tallest = Math.max(...columns.map(column => column.reduce((sum, block) => sum + block.height, 0)));
    // A section that would fit on a fresh page starts there only when little of this page is
    // left. Otherwise it fills the page and continues, instead of leaving a big blank gap.
    if (sheet.y + headingHeight + tallest > BOTTOM && headingHeight + tallest <= BOTTOM - sheet.top && BOTTOM - sheet.y < 170) sheet.next();
    sheet.need(headingHeight + d.lead * 3);
    sheet.y += d.small ? 3 : 6;
    const drawBand = (continued = false) => {
      const title = heading + (continued ? ' (continued)' : '');
      sheet.need(band + 6);
      sheet.rect(LEFT, sheet.y, WIDTH, band, paint(bucket.palette.fill));
      if (bucket.key === 'no-match') sheet.pdf.stroke(LEFT, sheet.y, WIDTH, band, paint(OLIVE), 1.1);
      sheet.put(title, LEFT + 8, sheet.y + (d.small ? 2.5 : 2), 'bold', d.small ? 9.5 : SIZE, bucket.palette.ink);
      sheet.y += band + (d.small ? 3 : 6);
      if (!bucket.note) sheet.y += 2;
      else if (d.small) { sheet.put(bucket.note, LEFT, sheet.y, 'regular', 8.5, MUTED); sheet.y += 11 + 4; }
      else { sheet.body(bucket.note, 'regular', MUTED); sheet.y += 6; }
    };
    drawBand();
    // Each column has its own queue. On a new page, repeat both the status and
    // any split category, so no item is separated from its allergy meaning.
    const queues = columns.map(column => column.map(block => ({...block, names: block.names.map(rows => [...rows]), continued: false})));
    let more = true;
    while (more) {
      const top = sheet.y;
      let deepest = top;
      for (let col = 0; col < d.cols; col++) {
        let y = top;
        const x = LEFT + col * (d.colW + d.gutter);
        const queue = queues[col];
        while (queue.length) {
          const block = queue[0];
          const title = wrap(block.title + (block.continued && !block.title.endsWith(' (cont.)') ? ' (cont.)' : ''), 'bold', d.size, chipText(d));
          const titleHeight = title.length * d.lead + d.pad + 3;
          const remainingHeight = titleHeight + block.names.flat().length * d.lead + gapAfter(d);
          // Keep a category whole when it fits on a fresh page.
          if (y > top && y + remainingHeight > BOTTOM) break;
          if (y + titleHeight + d.lead > BOTTOM) break;
          const chip = title.length * d.lead + d.pad;
          sheet.rect(x, y, d.colW, chip, paint(SAGE));
          sheet.rect(x, y, 4, chip, paint(OLIVE));
          title.forEach((row, i) => sheet.put(row, x + 10, y + d.pad / 2 + i * d.lead, 'bold', d.size, paint(DARK_OLIVE)));
          y += chip + 3;
          while (block.names.length) {
            const name = block.names[0];
            if (y + name.length * d.lead > BOTTOM && name.length * d.lead <= BOTTOM - sheet.top - headingHeight - titleHeight) break;
            while (name.length && y + d.lead <= BOTTOM) {
              sheet.put(name.shift()!, x, y, 'regular', d.size); y += d.lead;
            }
            if (name.length) break;
            block.names.shift();
          }
          if (block.names.length) { block.continued = true; break; }
          queue.shift(); y += gapAfter(d);
        }
        deepest = Math.max(deepest, y);
      }
      for (let col = 1; col < d.cols; col++) sheet.rect(LEFT + col * (d.colW + d.gutter) - d.gutter / 2, top, 0.5, Math.max(0, deepest - top - 6), HAIR);
      sheet.y = deepest;
      more = queues.some(queue => queue.length);
      if (more) { sheet.next(); drawBand(true); }
    }
    sheet.y += d.small ? 3 : 6;
  }
  const pages = sheet.pdf.pageCount;
  return { bytes: sheet.finish(`Allergy sheet - ${asked.join(', ')}`), pages };
}

/** One size for every list, as large as will still fit on one page. Only an extremely long menu runs on to a second page. */
export function plainAllergySheet(input: AllergyInput, header: SheetHeader): Uint8Array {
  const [roomy, snug, tight, tighter, tightest] = DENSITIES;
  const tries: [Density, Density][] = [
    [roomy, roomy], [snug, snug], [tight, tight], [tighter, tighter], [tightest, tightest],
  ];
  for (const [first, rest] of tries) {
    const built = buildAllergySheet(input, header, first, rest);
    if (built.pages === 1) return built.bytes;
  }
  return buildAllergySheet(input, header, tightest, tightest).bytes;
}

/* --------------------------------------------------------------- words, guides -- */

/** Draw a photo inside a box without stretching or cropping. Returns what was actually drawn. */
function drawPhoto(sheet: PlainSheet, photo: Jpeg, maxW: number, maxH: number): { w: number; h: number; top: number } {
  const scale = Math.min(maxW / photo.width, maxH / photo.height);
  const w = photo.width * scale; const h = photo.height * scale;
  sheet.need(h + 8);
  const top = sheet.y;
  sheet.pdf.image(photo, LEFT, top, w, h);
  sheet.pdf.stroke(LEFT, top, w, h, 0.7, 0.6);
  return { w, h, top };
}

export function plainWordsSheet(words: CustomTerm[], header: SheetHeader): Uint8Array {
  const sheet = new PlainSheet(header, 'All words');
  const visible = words.filter(word => !word.hidden).sort((a, b) => a.term.localeCompare(b.term));
  sheet.title('All words', `${visible.length} ${visible.length === 1 ? 'entry' : 'entries'} · A to Z`);
  sheet.y += 8;
  if (!visible.length) sheet.body('No words to print.');
  // Two columns, filled top to bottom and then onto the next page, with a bar at each new letter.
  const COLW = 247;
  const COLGAP = 22;
  let col = 0;
  let colTop = sheet.y;
  let y = colTop;
  let letter = '';
  const advance = () => {
    if (col === 0) { col = 1; y = colTop; }
    else { sheet.next(); col = 0; colTop = sheet.top; y = colTop; }
  };
  type Op = { h: number; draw: (x: number, y: number) => void };
  const place = (ops: Op[]) => {
    const whole = ops.reduce((sum, op) => sum + op.h, 0);
    if (y + whole > BOTTOM && whole <= BOTTOM - colTop) advance();
    for (const op of ops) {
      if (y + op.h > BOTTOM) advance();
      op.draw(LEFT + col * (COLW + COLGAP), y);
      y += op.h;
    }
  };
  for (const word of visible) {
    const ops: Op[] = [];
    const first = (word.term.trim()[0] ?? '#').toUpperCase();
    if (first !== letter) {
      letter = first;
      ops.push({ h: 21, draw: (x, top) => { sheet.put(first, x, top, 'bold', 13, BLACK); sheet.hair(top + 17, BLACK, x, COLW, 1.1); } });
    }
    const term = word.term;
    const say = word.say?.trim() ?? '';
    const sameLine = say && measure(term, 'bold', 12) + 8 + measure(say, 'oblique', SIZE) <= COLW;
    ops.push({ h: LEAD + 1, draw: (x, top) => {
      sheet.put(term, x, top, 'bold', 12);
      if (sameLine) sheet.put(say, x + measure(term, 'bold', 12) + 8, top + 1, 'oblique', SIZE, MUTED);
    } });
    if (say && !sameLine) ops.push({ h: LEAD, draw: (x, top) => sheet.put(say, x, top, 'oblique', SIZE, MUTED) });
    for (const row of lines(word.means || '', 'regular', COLW)) ops.push({ h: LEAD, draw: (x, top) => sheet.put(row.text, x, top, 'regular', SIZE) });
    const extra = (label: string, value: string, tint: Tone | null) => {
      const rows = flow([{ k: label, v: value }], COLW);
      ops.push({ h: rows.length * LEAD + 4, draw: (x, top) => {
        if (tint) sheet.rect(x, top + 1, COLW, rows.length * LEAD + 2, paint(tint));
        rows.forEach((segs, i) => segs.forEach(seg => sheet.put(seg.text, x + seg.dx, top + 2 + i * LEAD, seg.weight, SIZE, seg.ink)));
      } });
    };
    if (word.note?.trim()) extra('Allergens', word.note, SOFT_RED);
    if (word.also?.length) extra('Other spellings', word.also.join(', '), null);
    ops.push({ h: 10, draw: (x, top) => sheet.hair(top + 3, HAIR, x, COLW) });
    place(ops);
  }
  return sheet.finish('All words');
}

export function plainGuideSheet(word: CustomTerm, photo: Jpeg | null | undefined, header: SheetHeader): Uint8Array {
  const sheet = new PlainSheet(header, word.term || 'Guide');
  const hasPhoto = !!photo && photo.width > 0 && photo.height > 0;
  if (hasPhoto && photo) {
    const shot = drawPhoto(sheet, photo, 164, 164);
    const x = LEFT + shot.w + 16; const width = WIDTH - shot.w - 16;
    sheet.title(word.term || 'Guide', word.say?.trim() ? `Say: ${word.say.trim()}` : 'Guide', width, x);
    sheet.y += 8;
    if (word.means?.trim()) sheet.quote('Means', word.means.trim(), x, width, 12, 'oblique');
    sheet.y = Math.max(sheet.y, shot.top + shot.h) + 12;
  } else {
    sheet.title(word.term || 'Guide', word.say?.trim() ? `Say: ${word.say.trim()}` : 'Guide');
    sheet.y += 8;
    if (word.means?.trim()) sheet.quote('Means', word.means.trim());
    sheet.y += 12;
  }
  if (word.note?.trim()) { sheet.tabRow('ALLERGENS', word.note.trim(), RED, WHITE, SOFT_RED, true); sheet.y += 8; }
  if (word.also?.length) { sheet.row('Other spellings', [{ v: word.also.join(', ') }], true); sheet.y += 4; }
  sheet.section('The full guide');
  for (const paragraph of (word.story || '').split(/\n+/).filter(part => part.trim())) {
    sheet.body(paragraph.trim()); sheet.y += 8;
  }
  return sheet.finish(`${word.term} - guide`);
}

/* ------------------------------------------------------------------ standards -- */

export function plainStandardSheet(input: {title: string; summary?: string | null; steps: string[]; section?: string | null}, header: SheetHeader): Uint8Array {
  const sheet = new PlainSheet(header, input.title || 'Standard');
  sheet.title(input.title || 'Standard', input.section || 'How we do it here');
  sheet.y += 8;
  if (input.summary?.trim()) { sheet.quote('', input.summary.trim(), LEFT, WIDTH, 12, 'regular'); sheet.y += 10; }
  if (!input.steps.length) sheet.body('This standard has no steps yet.');
  const TEXT_X = LEFT + 36;
  input.steps.forEach((step, index) => {
    const rows = lines(step, 'regular', WIDTH - 36 - 30);
    sheet.need(Math.min(rows.length, 2) * LEAD + 12);
    let drawn = 0;
    if (index === 0) { sheet.hair(sheet.y, paint(OLIVE), LEFT, WIDTH, 1.6); sheet.y += 1.6; }
    sheet.y += 6;
    const badge = () => {
      sheet.rect(LEFT, sheet.y, 24, 24, paint(LIME));
      sheet.pdf.stroke(LEFT, sheet.y, 24, 24, paint(OLIVE), 1.1);
      const label = String(index + 1);
      sheet.put(label, LEFT + 12 - measure(label, 'bold', 12) / 2, sheet.y + 4.3, 'bold', 12, BLACK);
      sheet.pdf.stroke(LEFT + WIDTH - 16, sheet.y + 5.5, 13, 13, paint(OLIVE), 1.1);
    };
    badge();
    while (drawn < rows.length) {
      if (sheet.y + LEAD > BOTTOM) { sheet.next(); sheet.y += 6; }
      sheet.put(rows[drawn].text, TEXT_X, sheet.y + (rows.length === 1 ? 4.5 : 0), 'regular', SIZE);
      sheet.y += rows.length === 1 ? 24 : LEAD;
      drawn += 1;
    }
    sheet.y += 6;
    sheet.hair(sheet.y, HAIR);
    sheet.y += 0.5;
  });
  if (input.steps.length) { sheet.y += 14; sheet.signLines('Trained by', 'Date'); }
  return sheet.finish(`${input.title} - standard`);
}

/* ----------------------------------------------------------------------- quiz -- */

export function plainQuizSheet(input: QuizInput, withAnswers: boolean, header: SheetHeader): Uint8Array {
  const sheet = new PlainSheet(header, input.itemName || 'Quiz');
  sheet.title(input.itemName || 'Quiz', withAnswers ? "Quiz / trainer's copy" : 'Quiz');
  sheet.y += 8;
  if (withAnswers) { panelText(sheet, "Trainer's copy - answers marked. Keep this copy; do not hand it out.", SOFT_OLIVE, OLIVE); sheet.y += 6; }
  else {
    sheet.body('Tick one answer for each question.');
    sheet.y += 4;
    sheet.signLines('Name', 'Date');
  }
  input.questions.forEach((q, index) => {
    const validAnswer = Number.isInteger(q.correct) && q.correct! >= 0 && q.correct! < q.options.length;
    type Op = { h: number; draw: (top: number) => void };
    const ops: Op[] = [];
    if (q.topic) ops.push({ h: 12, draw: top => sheet.put(q.topic!.toUpperCase(), LEFT, top, 'bold', 7.5, paint(OLIVE), 0.7) });
    for (const row of lines(`${index + 1}. ${q.prompt}`, 'bold')) ops.push({ h: LEAD, draw: top => sheet.put(row.text, LEFT, top, 'bold', SIZE) });
    ops.push({ h: 3, draw: () => {} });
    q.options.forEach((option, choice) => {
      const right = withAnswers && validAnswer && q.correct === choice;
      const rows = lines(`${String.fromCharCode(65 + choice)}. ${option}${right ? ' - correct' : ''}`, right ? 'bold' : 'regular', WIDTH - 26);
      ops.push({ h: rows.length * LEAD + 1, draw: top => {
        if (right) sheet.rect(LEFT, top - 1, WIDTH, rows.length * LEAD + 1, paint(SOFT_OLIVE));
        sheet.pdf.stroke(LEFT + 4, top + 2, 10, 10, paint(OLIVE), 1.1);
        if (right) sheet.rect(LEFT + 6.5, top + 4.5, 5, 5, paint(OLIVE));
        rows.forEach((row, i) => sheet.put(row.text, LEFT + 24, top + i * LEAD, row.weight, SIZE));
      } });
    });
    if (withAnswers) {
      if (!validAnswer) ops.push({ h: LEAD + 3, draw: top => sheet.put('Answer not recorded.', LEFT, top + 3, 'oblique', SIZE) });
      else if (q.explanation) {
        const rows = lines(`Explanation: ${q.explanation}`, 'regular');
        rows.forEach((row, i) => ops.push({ h: LEAD + (i === 0 ? 3 : 0), draw: top => sheet.put(row.text, LEFT, top + (i === 0 ? 3 : 0), 'regular', SIZE, MUTED) }));
      }
    }
    const whole = ops.reduce((sum, op) => sum + op.h, 0) + 12;
    sheet.need(Math.min(whole, BOTTOM - sheet.top));
    sheet.y += 8;
    sheet.hair(sheet.y, paint(OLIVE), LEFT, WIDTH, 1.2);
    sheet.y += 6;
    for (const op of ops) {
      if (sheet.y + op.h > BOTTOM) {
        sheet.next(); sheet.body(`Question ${index + 1} (continued)`, 'bold'); sheet.y += 6;
      }
      op.draw(sheet.y);
      sheet.y += op.h;
    }
    sheet.y += 4;
  });
  if (!input.questions.length) sheet.body('No questions to print.');
  if (!withAnswers) {
    sheet.y += 8; sheet.rule();
    sheet.body('Marked by hand - not recorded in HEAT. To have a score counted, take the quiz in the app.', 'oblique', MUTED);
  }
  return sheet.finish(`${input.itemName} - quiz`);
}

/* ------------------------------------------------------------ employee summary -- */

export type EmployeeSheetInput = {
  name: string;
  role: string;
  owner: boolean;
  access: string[];
  items: MenuItem[];
  results: {menu_item_id: string; item_name: string; correct: number; total: number; created_at: string; needs_review?: boolean; attempt_count?: number}[];
  assignments: {menu_item_id: string; item_name: string; note: string; due_on: string | null}[];
};

/** The words and colour a learning status prints with. The words are what carry the meaning. */
function statusTag(status: string): { text: string; fill: Tone; ink: Ink } {
  if (status === 'At target') return { text: 'Passed', fill: GREEN, ink: WHITE };
  if (status === 'Needs practice') return { text: status, fill: AMBER, ink: BLACK };
  if (status === 'Not completed') return { text: 'Not done', fill: AMBER, ink: BLACK };
  return { text: /review/i.test(status) ? 'Review needed' : status, fill: RED, ink: WHITE };
}

export function plainEmployeeSheet(input: EmployeeSheetInput, header: SheetHeader): Uint8Array {
  const sheet = new PlainSheet(header, input.name || 'Employee', true);
  // Only current menu items count toward the current training summary.
  const ids = new Set(input.items.map(item => item.id));
  const results = input.results.filter(row => ids.has(row.menu_item_id) && row.total > 0);
  const score = (row: typeof results[number]) => `${row.correct}/${row.total} (${Math.round(row.correct / row.total * 100)}%)`;
  const byId = new Map(results.map(row => [row.menu_item_id, row]));
  const review = results.filter(row => learningStatus(row) !== 'At target');
  const pending = input.items.filter(item => !byId.has(item.id));
  const last = results.map(row => row.created_at).sort().at(-1);
  const shortDate = (value: string) => value.slice(0, 10);
  const passedAssignments = input.assignments.filter(a => learningStatus(byId.get(a.menu_item_id)) === 'At target').length;
  const summary = summarizeLearning(input.items, results);
  const {correct, answered: total} = summary;
  const SMALL = 9.5; const ROW = 17;
  const fit = (text: string, width: number, weight: Weight = 'regular', size = SMALL) => {
    if (measure(text, weight, size) <= width) return text;
    let cut = text;
    while (cut.length > 1 && measure(`${cut}...`, weight, size) > width) cut = cut.slice(0, -1);
    return `${cut.trimEnd()}...`;
  };
  const small = (text: string, x: number, top: number, weight: Weight = 'regular', ink: Ink = BLACK) => sheet.put(text, x, top, weight, SMALL, ink);
  const cap = (text: string, x: number, top: number) => sheet.put(text.toUpperCase(), x, top, 'bold', 7.5, paint(OLIVE), 0.7);
  const heading = (title: string, note = '') => {
    sheet.need(ROW * 3);
    sheet.y += 8;
    sheet.put(title.toUpperCase(), LEFT, sheet.y, 'bold', 9, paint(OLIVE), 0.8);
    if (note) sheet.putRight(note, LEFT + WIDTH, sheet.y + 0.5, 'regular', 8.5, MUTED);
    sheet.y += 13;
    sheet.hair(sheet.y - 2, paint(OLIVE), LEFT, WIDTH, 1);
    sheet.y += 4;
  };
  // Table columns: item / score / status / taken / last done.
  const COL = {score: LEFT + 214, status: LEFT + 300, taken: LEFT + 416, date: LEFT + WIDTH};
  const tableHead = () => {
    cap('Item', LEFT, sheet.y); cap('Score', COL.score, sheet.y); cap('Status', COL.status, sheet.y); cap('Taken', COL.taken, sheet.y);
    sheet.put('LAST DONE', COL.date - measure('LAST DONE', 'bold', 7.5) - 5, sheet.y, 'bold', 7.5, paint(OLIVE), 0.7);
    sheet.y += 11; sheet.hair(sheet.y - 2, HAIR); sheet.y += 2;
  };
  const resultRow = (row: typeof results[number]) => {
    if (sheet.y + ROW > BOTTOM) { sheet.next(); tableHead(); }
    const status = statusTag(learningStatus(row));
    small(fit(row.item_name, COL.score - LEFT - 10, 'bold'), LEFT, sheet.y + 2, 'bold');
    small(`${row.needs_review ? 'Was ' : ''}${score(row)}`, COL.score, sheet.y + 2);
    sheet.tag(status.text, COL.status + measure(status.text, 'bold', 8.5) + status.text.length * 0.5 + 14, sheet.y, status.fill, status.ink);
    small(row.attempt_count != null ? `${row.attempt_count}x` : '-', COL.taken, sheet.y + 2, 'regular', MUTED);
    small(shortDate(row.created_at), COL.date - measure(shortDate(row.created_at), 'regular', SMALL), sheet.y + 2, 'regular', MUTED);
    sheet.y += ROW; sheet.hair(sheet.y - 1.5, 0.85);
  };
  // Names in three columns, 10 pt, filled top to bottom. A name wraps inside its column instead of running
  // into the next one; `boxes` adds a tick box so the page can be marked up. A long list carries on to the next page.
  const LIST = 10; const LIST_LEAD = 14; const COLS = 3; const GAP = 16;
  const colWidth = (WIDTH - GAP * (COLS - 1)) / COLS;
  const columnList = (label: string, names: string[], boxes: boolean) => {
    const indent = boxes ? 15 : 0;
    const cells = names.map(name => wrap(name, 'regular', LIST, colWidth - indent));
    let queue = cells;
    let continued = false;
    while (queue.length) {
      const head = LIST + 7;
      sheet.need(head + LIST_LEAD * 3 + 6);
      sheet.put(continued ? `${label} (continued)` : label, LEFT, sheet.y, 'bold', LIST + 0.5, BLACK);
      sheet.y += head;
      const avail = BOTTOM - sheet.y;
      const total = queue.reduce((sum, cell) => sum + cell.length * LIST_LEAD, 0);
      const tallestCell = Math.max(...queue.map(cell => cell.length * LIST_LEAD));
      const top = sheet.y;
      const target = top + Math.min(avail, total / COLS + tallestCell);
      let deepest = top;
      for (let col = 0; col < COLS && queue.length; col++) {
        let y = top;
        const x = LEFT + col * (colWidth + GAP);
        while (queue.length && (y === top || y + queue[0].length * LIST_LEAD <= target) && y + queue[0].length * LIST_LEAD <= BOTTOM) {
          const cell = queue.shift()!;
          if (boxes) sheet.pdf.stroke(x, y + 2.4, 8, 8, paint(OLIVE), 0.9);
          cell.forEach((row, i) => sheet.put(row, x + indent, y + i * LIST_LEAD, 'regular', LIST));
          y += cell.length * LIST_LEAD;
        }
        deepest = Math.max(deepest, y);
      }
      sheet.y = deepest + 6;
      if (queue.length) { sheet.next(); continued = true; }
    }
  };

  // Name, role and the one line of context, with the initials badge.
  const initials = (input.name || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0].toUpperCase()).join('') || '?';
  sheet.need(44);
  sheet.rect(LEFT, sheet.y, 38, 38, paint(LIME));
  sheet.pdf.stroke(LEFT, sheet.y, 38, 38, paint(OLIVE), 1.1);
  sheet.put(initials, LEFT + 19 - measure(initials, 'bold', 13) / 2, sheet.y + 10.7, 'bold', 13, BLACK);
  sheet.put(input.name || 'Employee', LEFT + 50, sheet.y - 1, 'bold', 20);
  const context = [`${input.role || 'Not recorded'}${input.owner ? ' / Owner' : ''}`, `Editing: ${input.access.join(', ') || 'Read only'}`, `Last quiz ${last ? shortDate(last) : 'none yet'}`].join('   /   ');
  sheet.put(fit(context, WIDTH - 50, 'regular', 9.5), LEFT + 50, sheet.y + 24, 'regular', 9.5, MUTED);
  sheet.y += 46;
  sheet.glance([
    {label: 'Completed', value: `${results.length} of ${input.items.length}`},
    {label: 'Accuracy', value: total ? `${Math.round(correct / total * 100)}%` : 'None yet'},
    {label: 'To review', value: String(review.length), ink: review.length ? paint(RED) : BLACK},
    {label: 'Assignments', value: `${passedAssignments} of ${input.assignments.length} passed`},
  ]);
  sheet.y += 4;
  const libs = (['food', 'cocktails', 'wine'] as const).map(type => {
    const items = input.items.filter(item => contentTypeOf(item) === type);
    const done = results.filter(row => items.some(item => item.id === row.menu_item_id));
    const lib = summarizeLearning(items, done);
    return {label: type === 'wine' ? 'Wine & sake' : CONTENT_LABELS[type].short, value: `${done.length}/${items.length}`, pct: lib.answered ? `${Math.round(lib.correct / lib.answered * 100)}%` : '', count: items.length};
  }).filter(lib => lib.count);
  if (libs.length) {
    const top = sheet.y;
    sheet.glance(libs);
    // Say what the two numbers are, beside the numbers themselves.
    const cellW = WIDTH / libs.length;
    libs.forEach((lib, i) => {
      let x = LEFT + i * cellW + 9 + measure(lib.value, 'bold', CELL) + 5;
      sheet.put('quizzed', x, top + 18.5, 'regular', 8.5, MUTED);
      if (!lib.pct) return;
      x += measure('quizzed', 'regular', 8.5) + 12;
      sheet.put(lib.pct, x, top + 13, 'bold', CELL);
      x += measure(lib.pct, 'bold', CELL) + 5;
      sheet.put('right', x, top + 18.5, 'regular', 8.5, MUTED);
    });
  }

  // Only what needs attention gets a row of its own; everything at target is listed further down.
  const shown = review;
  if (results.length) {
    heading('Needs attention', `${review.length} below target`);
    if (shown.length) {
      tableHead();
      for (const row of [...shown].sort((a, b) => a.item_name.localeCompare(b.item_name))) resultRow(row);
    } else sheet.body('Everything completed is at target.', 'regular', MUTED);
  }
  if (input.assignments.length) {
    heading('Assigned training', `${passedAssignments} of ${input.assignments.length} passed`);
    for (const assignment of input.assignments) {
      const row = byId.get(assignment.menu_item_id);
      const status = statusTag(learningStatus(row));
      const note = assignment.note ? wrap(assignment.note, 'regular', 9, WIDTH - 12) : [];
      const height = ROW + note.length * 11.5;
      if (sheet.y + height > BOTTOM) sheet.next();
      small(fit(assignment.item_name, COL.score - LEFT - 10, 'bold'), LEFT, sheet.y + 2, 'bold');
      small(row ? `${row.needs_review ? 'Was ' : ''}${score(row)}` : 'No quiz yet', COL.score, sheet.y + 2);
      sheet.tag(status.text, COL.status + measure(status.text, 'bold', 8.5) + status.text.length * 0.5 + 14, sheet.y, status.fill, status.ink);
      if (assignment.due_on) { const due = `Due ${shortDate(assignment.due_on)}`; small(due, COL.date - measure(due, 'regular', SMALL), sheet.y + 2, 'regular', MUTED); }
      sheet.y += ROW;
      note.forEach(line => { sheet.put(line, LEFT + 12, sheet.y - 3, 'oblique', 9, MUTED); sheet.y += 11.5; });
      sheet.hair(sheet.y - 1.5, 0.85);
    }
  }
  heading('Coaching notes');
  for (let i = 0; i < 3; i++) { sheet.need(24); sheet.y += 22; sheet.hair(sheet.y, 0.7); }
  sheet.y += 6;
  if (results.some(row => row.needs_review)) {
    sheet.need(12);
    sheet.put('Scores marked "Was" are previous scores that need review because the questions changed.', LEFT, sheet.y, 'oblique', 8.5, MUTED);
    sheet.y += 12;
  }
  // The long lists follow, filling the rest of the page and carrying on to the next one.
  const atTarget = results.filter(row => learningStatus(row) === 'At target').map(row => row.item_name).sort((a, b) => a.localeCompare(b));
  if (atTarget.length) {
    heading('At target', `${atTarget.length}`);
    columnList(`Quizzes passed (${atTarget.length})`, atTarget, false);
  }
  if (pending.length) {
    heading('Quizzes not yet completed', `${pending.length}`);
    for (const type of ['food', 'cocktails', 'wine'] as const) {
      const list = pending.filter(item => contentTypeOf(item) === type).map(item => item.name).sort((a, b) => a.localeCompare(b));
      if (list.length) columnList(`${type === 'wine' ? 'Wine & sake' : CONTENT_LABELS[type].short} (${list.length})`, list, true);
    }
  }
  return sheet.finish(`${input.name} - training summary`);
}

/* ----------------------------------------------------------------- our story -- */

export type StoryTopicInput = { title: string; body: string; section?: string | null };

const storyParagraphs = (body: string): string[] => body.replace(/\r\n?/g, '\n').split('\n').map(part => part.trim()).filter(Boolean);

/** One topic (with its photo, if it has one) or every topic, grouped the way the screen groups them. */
export function plainStorySheet(input: { topics: StoryTopicInput[]; photo?: Jpeg | null }, header: SheetHeader): Uint8Array {
  const topics = input.topics;
  const single = topics.length === 1;
  const sheet = new PlainSheet(header, single ? topics[0].title || 'Our story' : 'Our story');
  if (single) {
    const topic = topics[0];
    const photo = input.photo;
    const hasPhoto = !!photo && photo.width > 0 && photo.height > 0;
    const meta = topic.section?.trim() || 'Our story';
    if (hasPhoto && photo) {
      const shot = drawPhoto(sheet, photo, 164, 164);
      const x = LEFT + shot.w + 16; const width = WIDTH - shot.w - 16;
      sheet.title(topic.title || 'Our story', meta, width, x);
      sheet.y = Math.max(sheet.y, shot.top + shot.h) + 12;
    } else {
      sheet.title(topic.title || 'Our story', meta);
      sheet.y += 10;
    }
    const paragraphs = storyParagraphs(topic.body);
    if (!paragraphs.length) sheet.body('Nothing has been written here yet.');
    for (const paragraph of paragraphs) { sheet.body(paragraph); sheet.y += 8; }
    return sheet.finish(`${topic.title || 'Our story'} - our story`);
  }
  sheet.title('Our story', `${topics.length} ${topics.length === 1 ? 'topic' : 'topics'}`);
  sheet.y += 8;
  if (!topics.length) sheet.body('Nothing has been written here yet.');
  // Groups in the order they first appear; topics with no group go last, under "More" once any group exists.
  const names: string[] = [];
  for (const topic of topics) { const name = topic.section?.trim() ?? ''; if (name && !names.some(n => n.toLowerCase() === name.toLowerCase())) names.push(name); }
  const grouped: [string, StoryTopicInput[]][] = !names.length
    ? [['', topics]]
    : [...names.map(name => [name, topics.filter(t => (t.section?.trim() ?? '').toLowerCase() === name.toLowerCase())] as [string, StoryTopicInput[]]),
       ...(topics.some(t => !t.section?.trim()) ? [['More', topics.filter(t => !t.section?.trim())] as [string, StoryTopicInput[]]] : [])];
  for (const [group, list] of grouped) {
    if (group) sheet.section(group);
    for (const topic of list) {
      const rows = lines(topic.title || 'Untitled', 'bold', WIDTH - 20);
      sheet.need(rows.length * LEAD + 6 + LEAD * 2);
      sheet.rect(LEFT, sheet.y, WIDTH, rows.length * LEAD + 6, paint(SAGE));
      sheet.rect(LEFT, sheet.y, 4, rows.length * LEAD + 6, paint(OLIVE));
      rows.forEach((row, i) => sheet.put(row.text, LEFT + 12, sheet.y + 3 + i * LEAD, 'bold', SIZE, paint(DARK_OLIVE)));
      sheet.y += rows.length * LEAD + 6 + 6;
      for (const paragraph of storyParagraphs(topic.body)) { sheet.body(paragraph); sheet.y += 6; }
      sheet.y += 8;
    }
  }
  return sheet.finish('Our story');
}
