import { test } from "node:test";
import assert from "node:assert/strict";
import { laborSheet } from "../lib/sheets.ts";
import type { LaborSheetInput } from "../lib/labor-sheet.ts";

const ctx = {restaurant: "Osaka - Miami", printed: new Date("2026-10-21T12:00:00Z")};
const text = (bytes: Uint8Array) => { let out = ""; for (const b of bytes) out += String.fromCharCode(b); return out; };
const pages = (bytes: Uint8Array) => Number(/\/Type \/Pages \/Count (\d+)/.exec(text(bytes))![1]);
const everyone: LaborSheetInput = {
  range: "Oct 22 – Oct 28", start: "2026-10-22", end: "2026-10-28", person: undefined,
  figures: [{value: "42h", label: "Scheduled hours", note: "−36% vs last week"}, {value: "5", label: "People scheduled"}],
  notes: ["1 in overtime (past 40h a week)"],
  positions: [{position: "Manager", hours: "18h", people: 2}, {position: "Server", hours: "12h", people: 1}],
  shifts: [], overtime: [{name: "Diego", detail: "42h in a week"}],
};

test("everyone: the dates, figures, positions and who is over, in words, named for its dates", () => {
  const sheet = laborSheet(everyone, ctx);
  const body = text(sheet.bytes);
  assert.equal(sheet.filename, "osaka-miami-labor-2026-10-22-to-2026-10-28.pdf");
  for (const words of ["Scheduled hours", "People scheduled", "Hours by position", "Manager", "Server", "Keep an eye on", "42h in a week", "1 in overtime"]) {
    assert.ok(body.includes(words) || body.includes(words.replace(/ /g, " ")), `missing "${words}"`);
  }
  assert.equal(pages(sheet.bytes), 1);
});

test("one person: their shifts and their name in the file", () => {
  const sheet = laborSheet({...everyone, person: "Gaby", positions: [], overtime: [], start: "2026-10-22", end: "2026-10-22", range: "Thu, Oct 22",
    figures: [{value: "6h", label: "Hours"}, {value: "1", label: "Shifts"}, {value: "0h", label: "Overtime"}], notes: ["Under the 40h weekly limit"],
    shifts: [{day: "Thu, Oct 22", detail: "4p–10p · Server", hours: "6h"}]}, ctx);
  const body = text(sheet.bytes);
  assert.equal(sheet.filename, "osaka-miami-labor-gaby-2026-10-22.pdf");
  assert.ok(body.includes("4p") && body.includes("Server") && body.includes("Under the 40h weekly limit"));
});

test("a long list of positions carries over pages without losing anyone", () => {
  const positions = Array.from({length: 80}, (_, i) => ({position: `Position number ${i + 1}`, hours: "8h", people: 1}));
  const bytes = laborSheet({...everyone, positions}, ctx).bytes;
  assert.ok(pages(bytes) > 1);
  assert.ok((text(bytes).match(/Position number \d+/g) || []).length >= 80);
});
