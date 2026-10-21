// The week's schedule on paper: US Letter turned sideways, one row per person, one column per day,
// hours on the left and the day's totals along the bottom, the way it hangs by the time clock.
//
// The screen's colours don't come along. As on every HEAT sheet, paper says it in words: each shift
// prints its position, a draft says DRAFT, and time off says Time off, so a black-and-white copy
// reads the same. Everything arrives already formatted; this file only lays it out.
import { Pdf, Sheet, measure, wrap, type SheetHeader, type Weight } from "./pdf.ts";

export type ScheduleSheetShift = {time: string; detail: string; draft: boolean};
export type ScheduleSheetRow = {name: string; hours: string; overtime: boolean; days: {shifts: ScheduleSheetShift[]; notes: string[]}[]};
export type ScheduleSheetInput = {
  /** "Oct 15 – Oct 21". */
  week: string;
  /** The first day, "2026-10-15", for the file's name. */
  start: string;
  /** The seven column headings, in the restaurant's week order: "Thu Oct 15". */
  days: string[];
  rows: ScheduleSheetRow[];
  totals: {hours: string; people: number}[];
  total: string;
  /** How many shifts on the sheet aren't published yet (managers print drafts too). */
  drafts: number;
};

const NAME_W = 124;
const PAD = 4;
const HEAD_H = 20;
const TIME = 8.5;
const SMALL = 7;
const LINE_TIME = 10;
const LINE_SMALL = 8.6;
const GAP = 4;
const RULE = 0.72;
const SHADE = 0.95;
const BAND = 0.13;

type Run = {text: string; weight: Weight; size: number; gray: number; lead: number};

// What goes in one day for one person, line by line, wrapped to the column.
function cellRuns(day: ScheduleSheetRow["days"][number], width: number): Run[][] {
  const blocks: Run[][] = [];
  for (const shift of day.shifts) {
    const runs: Run[] = wrap(shift.time, "bold", TIME, width).map(text => ({text, weight: "bold", size: TIME, gray: 0, lead: LINE_TIME}));
    const detail = shift.draft ? `${shift.detail} · DRAFT` : shift.detail;
    if (detail) runs.push(...wrap(detail, "regular", SMALL, width).map(text => ({text, weight: "regular" as Weight, size: SMALL, gray: 0.3, lead: LINE_SMALL})));
    blocks.push(runs);
  }
  for (const note of day.notes) blocks.push(wrap(note, "oblique", SMALL, width).map(text => ({text, weight: "oblique" as Weight, size: SMALL, gray: 0.35, lead: LINE_SMALL})));
  return blocks;
}
const blocksHeight = (blocks: Run[][]) => blocks.reduce((sum, runs, i) => sum + runs.reduce((h, r) => h + r.lead, 0) + (i ? GAP : 0), 0);

export function plainScheduleSheet(input: ScheduleSheetInput, header: SheetHeader): Uint8Array {
  const sheet = new Sheet(header, new Pdf(792, 612));
  const pdf = sheet.pdf;
  const left = sheet.left;
  const width = sheet.right - left;
  const dayW = (width - NAME_W) / 7;
  const inner = dayW - 2 * PAD - 3;

  pdf.text(`Schedule · ${input.week}`, left, sheet.cursor + 12, "bold", 16, 0);
  sheet.gap(20);
  const lead = input.drafts
    ? `${input.total} scheduled. Includes ${input.drafts} ${input.drafts === 1 ? "shift" : "shifts"} not published yet, marked DRAFT.`
    : `${input.total} scheduled. Published shifts.`;
  pdf.text(lead, left, sheet.cursor + 8, "regular", 8, 0.3);
  sheet.gap(18);

  const head = () => {
    const y = sheet.cursor;
    pdf.fill(left, y, width, HEAD_H, BAND);
    pdf.text("TEAM", left + PAD + 2, y + 13, "bold", 7.5, 1, 0.8);
    input.days.forEach((label, i) => {
      const text = label.toUpperCase();
      pdf.text(text, left + NAME_W + i * dayW + PAD + 1, y + 13, "bold", 7.5, 1, 0.6);
    });
    sheet.gap(HEAD_H);
  };
  head();

  input.rows.forEach((row, index) => {
    const cells = row.days.map(day => cellRuns(day, inner));
    const nameLines = wrap(row.name, "bold", 9, NAME_W - 2 * PAD);
    const nameH = nameLines.length * 11 + 10;
    const height = Math.max(30, nameH + 2 * PAD, ...cells.map(blocks => blocksHeight(blocks) + 2 * PAD));
    const before = sheet.cursor;
    sheet.need(height);
    if (sheet.cursor < before) head();
    const y = sheet.cursor;
    if (index % 2) pdf.fill(left, y, width, height, SHADE);
    pdf.stroke(left, y, width, height, RULE, 0.5);
    for (let i = 0; i <= 7; i++) pdf.fill(left + NAME_W + i * dayW, y, 0.5, height, RULE);

    nameLines.forEach((line, i) => pdf.text(line, left + PAD + 2, y + PAD + 9 + i * 11, "bold", 9, 0));
    const hours = row.overtime ? `${row.hours} · OVERTIME` : row.hours;
    pdf.text(hours, left + PAD + 2, y + PAD + 9 + nameLines.length * 11, row.overtime ? "bold" : "regular", 7.5, row.overtime ? 0 : 0.35);

    cells.forEach((blocks, i) => {
      const x = left + NAME_W + i * dayW + PAD;
      let at = y + PAD;
      blocks.forEach((runs, b) => {
        if (b) at += GAP;
        const blockH = runs.reduce((h, r) => h + r.lead, 0);
        const isShift = runs[0]?.weight === "bold";
        // A bar beside each shift; a draft's is grey, as its border is dashed on screen.
        if (isShift) pdf.fill(x, at + 1, 1.6, blockH - 2, runs.some(r => r.text.endsWith("DRAFT")) ? 0.6 : 0);
        let line = at;
        for (const run of runs) {
          line += run.lead;
          pdf.text(run.text, x + (isShift ? 5 : 0), line - 2.5, run.weight, run.size, run.gray);
        }
        at += blockH;
      });
    });
    sheet.gap(height);
  });

  // The day's totals, under each column.
  const footH = 28;
  const before = sheet.cursor;
  sheet.need(footH);
  if (sheet.cursor < before) head();
  const y = sheet.cursor;
  pdf.fill(left, y, width, footH, 0.9);
  pdf.stroke(left, y, width, footH, RULE, 0.5);
  pdf.text("Hours", left + PAD + 2, y + 11, "bold", 7.5, 0);
  pdf.text(input.total, left + NAME_W - PAD - measure(input.total, "bold", 7.5), y + 11, "bold", 7.5, 0);
  pdf.text("People", left + PAD + 2, y + 22, "regular", 7.5, 0.3);
  const people = String(input.rows.filter(r => r.days.some(d => d.shifts.length)).length);
  pdf.text(people, left + NAME_W - PAD - measure(people, "regular", 7.5), y + 22, "regular", 7.5, 0.3);
  input.totals.forEach((t, i) => {
    const x = left + NAME_W + i * dayW + PAD + 1;
    pdf.fill(left + NAME_W + i * dayW, y, 0.5, footH, RULE);
    pdf.text(t.hours, x, y + 11, "bold", 7.5, 0);
    pdf.text(`${t.people} ${t.people === 1 ? "person" : "people"}`, x, y + 22, "regular", 7.5, 0.3);
  });
  sheet.gap(footH);

  return sheet.finish(`Schedule ${input.week}`);
}
