// The Labor screen on paper: US Letter, portrait. The dates up top, the figures, then either the hours by
// position (everyone) or the list of shifts (one person), and what to keep an eye on in words.
//
// As on every HEAT sheet, paper says it in words, not colour. Everything arrives already formatted;
// this file only lays it out.
import { Pdf, Sheet, measure, wrap, type SheetHeader } from "./pdf.ts";

export type LaborSheetInput = {
  /** "Oct 22 – Oct 28" or "Thu, Oct 22". */
  range: string;
  /** First and last day, "2026-10-22", for the file's name. */
  start: string;
  end: string;
  /** Set when the sheet is about one person. */
  person?: string;
  /** The big figures: "42h" / "Scheduled hours", with the comparison note under it when there is one. */
  figures: {value: string; label: string; note?: string}[];
  /** One line each: "All clear", "2 in overtime (past 40h a week)". */
  notes: string[];
  /** Everyone: hours by position. */
  positions: {position: string; hours: string; people: number}[];
  /** One person: their shifts. */
  shifts: {day: string; detail: string; hours: string}[];
  /** Everyone: who is over, in words. */
  overtime: {name: string; detail: string}[];
};

const ROW_H = 20;
const RULE = 0.78;

export function plainLaborSheet(input: LaborSheetInput, header: SheetHeader): Uint8Array {
  const sheet = new Sheet(header, new Pdf());
  const pdf = sheet.pdf;
  const left = sheet.left;
  const right = sheet.right;

  sheet.h1(input.person ? `${input.person} · ${input.range}` : input.range);
  sheet.gap(6);

  // The figures sit side by side, one column each.
  const col = (right - left) / Math.max(1, input.figures.length);
  sheet.need(52);
  const top = sheet.cursor;
  input.figures.forEach((figure, i) => {
    const x = left + i * col;
    pdf.text(figure.value, x, top + 20, "bold", 20, 0);
    pdf.text(figure.label, x, top + 34, "bold", 8.5, 0.2);
    if (figure.note) pdf.text(figure.note, x, top + 45, "regular", 8, 0.4);
  });
  sheet.gap(figureHeight(input));
  for (const note of input.notes) sheet.body(note, {size: 9, gray: 0.2});

  if (input.person) {
    sheet.section("Shifts");
    if (!input.shifts.length) sheet.body(`${input.person} has no shifts in these dates.`, {gray: 0.4});
    else for (const row of input.shifts) {
      const detail = wrap(row.detail, "regular", 8.5, right - left - 190);
      const height = Math.max(ROW_H, detail.length * 11 + 9);
      sheet.need(height);
      const y = sheet.cursor;
      pdf.fill(left, y + height - 0.5, right - left, 0.5, RULE);
      pdf.text(row.day, left, y + 13, "bold", 9.5, 0);
      detail.forEach((line, i) => pdf.text(line, left + 130, y + 13 + i * 11, "regular", 8.5, 0.25));
      pdf.text(row.hours, right - measure(row.hours, "bold", 9.5), y + 13, "bold", 9.5, 0);
      sheet.gap(height);
    }
    return sheet.finish(`Labor ${input.range}`);
  }

  sheet.section("Hours by position");
  if (!input.positions.length) sheet.body("No shifts in these dates.", {gray: 0.4});
  else {
    const head = () => {
      sheet.need(ROW_H);
      const y = sheet.cursor;
      pdf.fill(left, y, right - left, ROW_H, 0.13);
      pdf.text("POSITION", left + 6, y + 13, "bold", 7.5, 1, 0.8);
      for (const [label, edge] of [["PEOPLE", right - 6], ["HOURS", right - 86]] as const) {
        pdf.text(label, edge - measure(label, "bold", 7.5) - 0.8 * label.length, y + 13, "bold", 7.5, 1, 0.8);
      }
      sheet.gap(ROW_H);
    };
    head();
    input.positions.forEach((row, index) => {
      const before = sheet.cursor;
      sheet.need(ROW_H);
      if (sheet.cursor < before) head();
      const y = sheet.cursor;
      if (index % 2) pdf.fill(left, y, right - left, ROW_H, 0.95);
      pdf.text(row.position, left + 6, y + 13, "bold", 9.5, 0);
      const people = String(row.people);
      pdf.text(row.hours, right - 86 - measure(row.hours, "regular", 9.5), y + 13, "regular", 9.5, 0);
      pdf.text(people, right - 6 - measure(people, "regular", 9.5), y + 13, "regular", 9.5, 0);
      sheet.gap(ROW_H);
    });
    pdf.fill(left, sheet.cursor, right - left, 0.9, RULE);
  }

  if (input.overtime.length) {
    sheet.section("Keep an eye on");
    for (const row of input.overtime) sheet.body(`${row.name} · ${row.detail}`, {size: 9.5});
  }
  return sheet.finish(`Labor ${input.range}`);
}

function figureHeight(input: LaborSheetInput): number {
  return (input.figures.some(f => f.note) ? 45 : 36) + 10;
}
