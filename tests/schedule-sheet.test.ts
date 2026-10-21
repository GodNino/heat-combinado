import { test } from "node:test";
import assert from "node:assert/strict";
import { scheduleSheet } from "../lib/sheets.ts";
import type { ScheduleSheetInput } from "../lib/schedule-sheet.ts";

const ctx = {restaurant: "Osaka - Miami", printed: new Date("2026-10-21T12:00:00Z")};
const text = (bytes: Uint8Array) => { let out = ""; for (const b of bytes) out += String.fromCharCode(b); return out; };
const pages = (bytes: Uint8Array) => Number(/\/Type \/Pages \/Count (\d+)/.exec(text(bytes))![1]);
const days = ["Thu Oct 15", "Fri Oct 16", "Sat Oct 17", "Sun Oct 18", "Mon Oct 19", "Tue Oct 20", "Wed Oct 21"];
const empty = (): ScheduleSheetInput["rows"][number]["days"] => days.map(() => ({shifts: [], notes: []}));
const week = (rows: ScheduleSheetInput["rows"], drafts = 0): ScheduleSheetInput => ({
  week: "Oct 15 – Oct 21", start: "2026-10-15", days, rows, drafts, total: "35h",
  totals: days.map((_, i) => ({hours: i === 4 ? "21h" : "0h", people: i === 4 ? 3 : 0})),
});

test("the week prints sideways, says what colour can't, and names its file", () => {
  const diego = {name: "Diego", hours: "42h", overtime: true, days: empty()};
  diego.days[4] = {shifts: [{time: "4p–11p", detail: "Server · Patio", draft: false}, {time: "11:30p–1a", detail: "Bartender", draft: true}], notes: []};
  diego.days[0] = {shifts: [], notes: ["Time off · All day"]};
  const sheet = scheduleSheet(week([diego, {name: "Gabs", hours: "7h", overtime: false, days: empty()}], 1), ctx);
  const body = text(sheet.bytes);
  assert.equal(sheet.filename, "osaka-miami-schedule-2026-10-15.pdf");
  assert.match(body, /\/MediaBox \[0 0 792 612\]/, "US Letter, landscape");
  for (const words of ["THU OCT 15", "WED OCT 21", "Server \\267 Patio", "Bartender \\267 DRAFT", "42h \\267 OVERTIME", "Time off \\267 All day", "not published yet"]) {
    assert.ok(body.includes(words), `missing "${words}"`);
  }
  assert.equal(pages(sheet.bytes), 1);
});

test("a big team carries on over pages, with the days repeated on each", () => {
  const rows = Array.from({length: 40}, (_, i) => {
    const row = {name: `Team member ${i + 1} with a rather long name`, hours: "30h", overtime: false, days: empty()};
    row.days[i % 7] = {shifts: [{time: "5p–11p", detail: "Server", draft: false}, {time: "11a–3p", detail: "Host · Private party upstairs", draft: false}], notes: []};
    return row;
  });
  const bytes = scheduleSheet(week(rows), ctx).bytes;
  const body = text(bytes);
  assert.ok(pages(bytes) > 1);
  assert.equal((body.match(/THU OCT 15/g) || []).length, pages(bytes), "the day headings repeat on every page");
  assert.equal((body.match(/Team member \d+/g) || []).length >= 40, true, "nobody is dropped");
  assert.ok(!body.includes("not published yet"), "a published week doesn't mention drafts");
});
