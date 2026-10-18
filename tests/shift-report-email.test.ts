import { test } from "node:test";
import assert from "node:assert/strict";
import { heatLines, reportEmail, type ShiftReport } from "../lib/shift-report.ts";

const base: ShiftReport = {
  id: "r", restaurant_id: "m", service_date: "2026-10-17", label: "Dinner", mood: "rough",
  covers: 182, sales: "14250.50", issues: [], urgent: false, low_stock: "", shoutouts: "", next_shift: "", notes: "",
  from_heat: {}, submitted_at: "2026-10-18T04:00:00Z",
};

test("the report email leads with problems and marks urgent ones in the subject", () => {
  const mail = reportEmail({...base, urgent: true, issues: [{kind: "allergy", note: "Sesame mix-up, comped"}, {kind: "equipment", note: "Fryer 2 down"}]}, "Osaka Miami", "https://www.heatplatform.io/app");
  assert.equal(mail.subject, "URGENT · Osaka Miami · Dinner report · Sat, Oct 17");
  assert.ok(mail.text.indexOf("ISSUES") < mail.text.indexOf("SERVICE"), "issues come before the numbers");
  assert.match(mail.text, /Allergy incident \(urgent\): Sesame mix-up, comped/);
  assert.match(mail.text, /Covers: 182/);
  assert.match(mail.text, /Sales: \$14,251/);
});

test("the report email leaves out empty sections and escapes what managers typed", () => {
  const mail = reportEmail({...base, mood: "great", notes: "<script>alert(1)</script> & done"}, "Bar <Uno>", "https://x.test/app");
  assert.doesNotMatch(mail.html, /<script>/);
  assert.match(mail.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt; &amp; done/);
  assert.match(mail.html, /Bar &lt;Uno&gt;/);
  assert.doesNotMatch(mail.text, /ISSUES|SHOUT-OUTS|FROM HEAT/, "sections with nothing in them are not printed");
});

test("what HEAT recorded reads as one line per thing", () => {
  assert.deepEqual(heatLines({
    eighty_six: [{name: "Black Cod", status: "86"}, {name: "Uni", status: "low"}],
    checklists: {total: 9, done: 7, missing: ["Mop the kitchen", "Lock the wine fridge"]},
    on_floor: ["Ana", "Luis"], quizzes: 4,
  }), [
    "86'd or low: Black Cod, Uni (low)",
    "Checklists: 7 of 9 jobs done · not done: Mop the kitchen, Lock the wine fridge",
    "On the floor: Ana, Luis",
    "Quizzes taken today: 4",
  ]);
  assert.deepEqual(heatLines({checklists: {total: 0, done: 0, missing: []}}), [], "no checklists that night means no line");
});

test("the service day is the phone's day, and until 5 am it is still last night", async () => {
  const {serviceDate} = await import("../lib/shift-report.ts");
  assert.equal(serviceDate(new Date(2026, 9, 17, 23, 30)), "2026-10-17", "a late dinner report");
  assert.equal(serviceDate(new Date(2026, 9, 18, 1, 15)), "2026-10-17", "after midnight it still belongs to the night it started");
  assert.equal(serviceDate(new Date(2026, 9, 18, 11, 0)), "2026-10-18", "lunch the next day");
});
