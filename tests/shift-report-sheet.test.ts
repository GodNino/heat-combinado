import { test } from "node:test";
import assert from "node:assert/strict";
import { shiftReportSheet } from "../lib/sheets.ts";

const text = (bytes: Uint8Array) => { let out = ""; for (const b of bytes) out += String.fromCharCode(b); return out; };
const base = {
  serviceDate: "2026-10-20", day: "Tue, Oct 20", label: "Dinner", urgent: false, mood: "Great", covers: "180", sales: "$14,250",
  issues: [], fromHeat: [], lowStock: "", shoutouts: "", nextShift: "", notes: "", writtenBy: "Diego",
};

test("a printed shift report says who wrote it, who changed it, and puts problems first", () => {
  const sheet = shiftReportSheet({...base, urgent: true, issues: [{kind: "Allergy incident", note: "Sesame at table 12", urgent: true}],
    nextShift: "Call the supplier.\nCheck the walk-in.", changedBy: "Nino", changedAt: "Oct 21, 10:14 AM"}, {restaurant: "Osaka - Miami"});
  const body = text(sheet.bytes);
  assert.equal(sheet.filename, "dinner-report-2026-10-20.pdf");
  for (const words of ["Dinner report", "Written by Diego", "Last changed by Nino, Oct 21, 10:14 AM", "URGENT", "Allergy incident \\(urgent\\): Sesame at table 12", "Call the supplier.", "Check the walk-in."]) {
    assert.ok(body.includes(words), `missing "${words}"`);
  }
  assert.ok(body.indexOf("Issues") < body.indexOf("For the next shift"), "problems come first");
});

test("a quiet night prints without empty sections or a change line", () => {
  const body = text(shiftReportSheet(base, {restaurant: "Osaka - Miami"}).bytes);
  assert.ok(body.includes("Nothing else was added to this report."));
  assert.ok(!body.includes("Last changed by"));
  assert.ok(!body.includes("URGENT"));
});
