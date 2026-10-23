import { test } from "node:test";
import assert from "node:assert/strict";
import { change, laborSummary, mostOut, serviceSummary } from "../lib/ops-stats.ts";
import type { Shift } from "../lib/schedule.ts";
import type { ShiftReport } from "../lib/shift-report.ts";

const shift = (user: string, position: string, day: number, from: number, to: number, published = true): Shift => ({
  id: `${user}-${day}-${from}`, restaurant_id: "r", user_id: user, position, note: "", published,
  starts_at: new Date(2026, 9, day, from).toISOString(), ends_at: new Date(2026, 9, day, to).toISOString(),
});
const report = (day: string, over: Partial<ShiftReport> = {}): ShiftReport => ({
  id: day, restaurant_id: "r", service_date: day, label: "Dinner", mood: "ok", covers: 100, sales: 5000, issues: [], urgent: false,
  low_stock: "", shoutouts: "", next_shift: "", notes: "", from_heat: {}, submitted_at: `${day}T23:00:00Z`, ...over,
});

test("labor: hours by position against last week, drafts, and who goes into overtime", () => {
  const thisWeek = [
    ...[22, 23, 24, 25, 26].map(d => shift("ana", "Server", d, 12, 21)),      // 45 hours: weekly overtime
    shift("luis", "Bartender", 22, 10, 22),                                    // 12 in a day: daily overtime with a limit of 8
    shift("sol", "Server", 23, 17, 23, false),                                 // a draft
  ];
  const lastWeek = [shift("ana", "Server", 15, 17, 23), shift("luis", " bartender ", 16, 17, 23)];
  const weekly = laborSummary(thisWeek, lastWeek, {overtime_weekly: 40, overtime_daily: null});
  assert.equal(weekly.hours, 63);
  assert.equal(weekly.lastHours, 12);
  assert.equal(weekly.people, 3);
  assert.equal(weekly.drafts, 1);
  assert.deepEqual(weekly.byPosition.map(p => [p.position, p.hours, p.lastHours, p.people]), [["Server", 51, 6, 2], ["Bartender", 12, 6, 1]]);
  assert.deepEqual(weekly.overtime, [{user_id: "ana", hours: 45, daily: false}]);
  const daily = laborSummary(thisWeek, lastWeek, {overtime_weekly: 40, overtime_daily: 8});
  assert.deepEqual(daily.overtime.map(o => [o.user_id, o.daily]), [["ana", false], ["luis", true]]);
});

test("service: covers and sales against last week, by day, moods, issues and what ran out", () => {
  const thisWeek = [
    report("2026-10-22", {covers: 180, sales: "14250", mood: "great"}),
    report("2026-10-23", {covers: 120, sales: null, mood: "rough", urgent: true, issues: [{kind: "allergy", note: "Sesame"}, {kind: "complaint", note: "Slow"}],
      from_heat: {eighty_six: [{name: "Toro", status: "86"}, {name: "Uni", status: "low"}]}}),
    report("2026-10-24", {from_heat: {eighty_six: [{name: "toro ", status: "86"}]}}),
  ];
  const s = serviceSummary(thisWeek, [report("2026-10-15", {covers: 200})], ["2026-10-22", "2026-10-23", "2026-10-24", "2026-10-25"]);
  assert.deepEqual([s.reports, s.covers, s.lastCovers, s.sales, s.hasSales, s.urgent], [3, 400, 200, 19250, true, 1]);
  assert.deepEqual(s.byDay.map(d => d.covers), [180, 120, 100, 0]);
  assert.deepEqual(s.moods, {great: 1, ok: 1, rough: 1});
  assert.deepEqual(s.issues, [{kind: "complaint", count: 1}, {kind: "allergy", count: 1}]);
  assert.deepEqual(mostOut(thisWeek), [{name: "Toro", out: 2, low: 0}, {name: "Uni", out: 0, low: 1}]);
  assert.equal(change(400, 200), "+100% vs last week");
  assert.equal(change(90, 100), "−10% vs last week");
  assert.equal(change(5, 0), null);
});
