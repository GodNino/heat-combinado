// Tonight's sections on paper, to pin up on the floor: US Letter turned sideways, the floor map on the
// left with every table and its number, and the list on the right the way managers write it by hand --
// the servers by section, then the S.A.s with the sections they cover ("1/2") and the runners.
//
// Paper has no colour: a table in a section is shaded and carries its section's number in a black
// dot, and each section's server is written next to its tables. Everything arrives already worked out
// (where each name goes is the same spot as on screen); this file only lays it out.
import { Pdf, Sheet, measure, wrap, type SheetHeader } from "./pdf.ts";

// fixture: the bar or the host stand, drawn for reference with its name.
export type SectionsSheetTable = {label: string; x: number; y: number; round: boolean; hw: number; hh: number; section: number | null; fixture?: boolean};
export type SectionsSheetInput = {
  /** "Tuesday, November 3 · Dinner". */
  title: string;
  /** "2026-11-03", for the file's name. */
  day: string;
  service: string;
  /** The map's own size; the sheet scales it to fit. */
  width: number;
  height: number;
  tables: SectionsSheetTable[];
  /** Each section's name tag on the map, where the screen shows it. */
  tags: {n: number; name: string; x: number; y: number}[];
  sections: {n: number; server: string; sas: string[]; where: string}[];
  /** The S.A.s and what they cover: "1/2", "Hot runner". */
  helpers: {name: string; covers: string}[];
};

const LIST_W = 190;
const GAP = 18;
const SHADE = 0.86;
const LINE = 0.15;

export function plainSectionsSheet(input: SectionsSheetInput, header: SheetHeader): Uint8Array {
  const sheet = new Sheet(header, new Pdf(792, 612));
  const pdf = sheet.pdf;
  const left = sheet.left;
  const right = sheet.right;

  pdf.text(`Sections · ${input.title}`, left, sheet.cursor + 12, "bold", 16, 0);
  sheet.gap(28);
  const top = sheet.cursor;
  const bottom = pdf.height - 64;

  // The map, cut to where the tables are and scaled to the room left of the list.
  const boxW = right - left - LIST_W - GAP, boxH = bottom - top;
  const xs = input.tables.flatMap(t => [t.x - t.hw, t.x + t.hw]), ys = input.tables.flatMap(t => [t.y - t.hh - 8, t.y + t.hh]);
  const minX = xs.length ? Math.min(...xs) : 0, minY = ys.length ? Math.min(...ys) : 0;
  const spanX = xs.length ? Math.max(...xs) - minX : input.width, spanY = ys.length ? Math.max(...ys) - minY : input.height;
  const scale = Math.min(boxW / spanX, boxH / spanY);
  const X = (x: number) => left + (x - minX) * scale, Y = (y: number) => top + 4 + (y - minY) * scale;

  for (const t of input.tables) {
    if (t.fixture) {
      pdf.fill(X(t.x - t.hw), Y(t.y - t.hh), 2 * t.hw * scale, 2 * t.hh * scale, 0.93);
      pdf.stroke(X(t.x - t.hw), Y(t.y - t.hh), 2 * t.hw * scale, 2 * t.hh * scale, 0.35, 1);
      const size = 7, name = t.label.toUpperCase();
      if (t.hw >= t.hh || measure(name, "bold", size) < 2 * t.hw * scale) pdf.text(name, X(t.x) - measure(name, "bold", size) / 2, Y(t.y) + 2.5, "bold", size, 0.35, 0.6);
      continue;
    }
    const shade = t.section ? SHADE : 1;
    if (t.round) pdf.circle(X(t.x), Y(t.y), t.hw * scale, shade, LINE, 1.2);
    else { pdf.fill(X(t.x - t.hw), Y(t.y - t.hh), 2 * t.hw * scale, 2 * t.hh * scale, shade); pdf.stroke(X(t.x - t.hw), Y(t.y - t.hh), 2 * t.hw * scale, 2 * t.hh * scale, LINE, 1.2); }
    if (t.label) {
      const size = Math.min(9, Math.max(5.5, t.hw * scale * 0.55));
      pdf.text(t.label, X(t.x) - measure(t.label, "bold", size) / 2, Y(t.y) + size * 0.35, "bold", size, 0);
    }
    if (t.section) {
      const c = t.round ? 0.7 : 1, bx = X(t.x + t.hw * c), by = Y(t.y - t.hh * c), r = 6;
      pdf.circle(bx, by, r, 0, 1, 1);
      const n = String(t.section);
      pdf.text(n, bx - measure(n, "bold", 7) / 2, by + 2.5, "bold", 7, 1);
    }
  }
  for (const tag of input.tags) {
    const label = `${tag.n} · ${tag.name}`;
    const w = measure(label, "bold", 9) + 12;
    pdf.fill(X(tag.x) - w / 2, Y(tag.y) - 8, w, 16, 1);
    pdf.stroke(X(tag.x) - w / 2, Y(tag.y) - 8, w, 16, 0, 0.8);
    pdf.text(label, X(tag.x) - w / 2 + 6, Y(tag.y) + 3.2, "bold", 9, 0);
  }

  // The list, like the paper one: servers by section, then the S.A.s.
  const lx = right - LIST_W;
  let y = top;
  const heading = (text: string) => { pdf.text(text, lx, y + 8, "bold", 7.5, 0.2, 0.8); y += 14; pdf.fill(lx, y - 3, LIST_W, 0.6, 0.6); y += 6; };
  heading("SERVERS");
  if (!input.sections.length) { pdf.text("No sections yet.", lx, y + 8, "regular", 9, 0.35); y += 16; }
  for (const s of input.sections) {
    const n = String(s.n);
    pdf.circle(lx + 7, y + 5, 7, 0);
    pdf.text(n, lx + 7 - measure(n, "bold", 8) / 2, y + 7.8, "bold", 8, 1);
    pdf.text(s.server, lx + 20, y + 8.5, "bold", 10, 0);
    y += 14;
    for (const line of wrap(s.where, "regular", 7.5, LIST_W - 20).slice(0, 2)) { pdf.text(line, lx + 20, y + 6, "regular", 7.5, 0.35); y += 9.5; }
    y += 6;
    if (y > bottom - 60) break;
  }
  y += 8;
  heading("SERVER ASSISTANTS");
  if (!input.helpers.length) { pdf.text("No S.A.s yet.", lx, y + 8, "regular", 9, 0.35); y += 16; }
  for (const h of input.helpers) {
    pdf.text(h.name, lx, y + 8.5, "bold", 10, 0);
    pdf.text(h.covers, right - measure(h.covers, "regular", 9.5), y + 8.5, "regular", 9.5, 0.2);
    y += 16;
    if (y > bottom) break;
  }
  return sheet.finish(`Sections · ${input.title}`);
}
