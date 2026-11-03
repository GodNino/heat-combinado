import { test } from "node:test";
import assert from "node:assert/strict";
import { assistantSystem, checkProposal, checkRange, hoursView, localDay, reportsView, scheduleView, type Shift, type TeamMember } from "../lib/assistant.ts";

const team: TeamMember[] = [{user_id: "g", name: "Gonzalo", role: "Server"}, {user_id: "y", name: "Yesenia", role: "Server"}, {user_id: "j", name: "Jose", role: "Server assistant"}];
// Miami: 5pm to 11pm local is 22:00 to 04:00 UTC in November (EST, UTC-5).
const shift = (id: string, user: string, day: number, hours: number, extra: Partial<Shift> = {}): Shift => {
  const start = Date.UTC(2026, 10, day, 22);
  return {id, user_id: user, position: "Server", starts_at: new Date(start).toISOString(), ends_at: new Date(start + hours * 36e5).toISOString(), published: true, ...extra};
};

test("days and ranges are read in the restaurant's own time zone", () => {
  assert.deepEqual(localDay(new Date("2026-11-04T03:00:00Z"), "America/New_York"), {day: "2026-11-03", weekday: "Tuesday"}, "10pm on the 3rd in Miami is already the 4th in UTC");
  assert.deepEqual(checkRange("2026-11-02", "2026-11-08"), {from: "2026-11-02", to: "2026-11-08"});
  for (const [from, to] of [["2026-11-08", "2026-11-02"], ["2026-11-01", "2026-12-15"], ["yesterday", "2026-11-08"], [undefined, "2026-11-08"]]) {
    assert.equal(checkRange(from, to), null, `${from} → ${to}`);
  }
});

test("shifts show local day and times, drafts and on-call marked", () => {
  const view = scheduleView([shift("b", "y", 4, 6, {published: false}), shift("a", "g", 3, 6), shift("c", "x", 5, 5, {on_call: true})], team, "America/New_York");
  assert.deepEqual(view.map(v => [v.day, v.weekday, v.person, v.time, v.hours]), [
    ["2026-11-03", "Tuesday", "Gonzalo", "5:00 PM-11:00 PM", 6],
    ["2026-11-04", "Wednesday", "Yesenia", "5:00 PM-11:00 PM", 6],
    ["2026-11-05", "Thursday", "Former team member", "5:00 PM-10:00 PM", 5],
  ]);
  assert.equal((view[1] as {draft?: boolean}).draft, true);
  assert.equal((view[2] as {on_call?: boolean}).on_call, true);
});

test("hours per person flag who passes the weekly limit, and on-call shifts don't count", () => {
  const week = [2, 3, 4, 5, 6, 7, 8].map(d => shift(`g${d}`, "g", d, 6.5)).concat([shift("y1", "y", 2, 8), shift("y2", "y", 3, 8, {on_call: true})]);
  assert.deepEqual(hoursView(week, team, 40), [
    {person: "Gonzalo", hours: 45.5, over_limit_by: 5.5},
    {person: "Yesenia", hours: 8, over_limit_by: 0},
  ]);
});

test("reports keep what matters, oldest first, without empty fields", () => {
  const view = reportsView([
    {service_date: "2026-11-05", label: "Dinner", mood: "rough", covers: 180, urgent: true, issues: [{kind: "allergy", note: " Table 12, sesame "}], low_stock: "Uni", shoutouts: "", next_shift: "", notes: ""},
    {service_date: "2026-11-03", label: "Dinner", mood: "great", covers: null, urgent: false, issues: [], low_stock: "", shoutouts: "Yesenia", next_shift: "", notes: ""},
  ]);
  assert.deepEqual(view, [
    {date: "2026-11-03", service: "Dinner", mood: "great", shoutouts: "Yesenia"},
    {date: "2026-11-05", service: "Dinner", mood: "rough", covers: 180, urgent: true, issues: ["allergy: Table 12, sesame"], low_stock: "Uni"},
  ]);
});

test("only real people and real cards can be proposed, each once", () => {
  const menu = [{id: "c1", name: "Ceviche Nikkei", category: "Ceviches", content_type: "food"}, {id: "c2", name: "Tiradito", category: "Tiraditos", content_type: "food"}];
  assert.deepEqual(checkProposal({user_ids: ["j", "g", "j"], menu_item_ids: ["c1"], note: "  Before   Friday "}, team, menu), {
    learners: [{id: "j", name: "Jose"}, {id: "g", name: "Gonzalo"}], items: [{id: "c1", name: "Ceviche Nikkei"}], note: "Before Friday",
  });
  for (const bad of [null, {user_ids: [], menu_item_ids: ["c1"]}, {user_ids: ["j"], menu_item_ids: []}, {user_ids: ["someone"], menu_item_ids: ["c1"]},
    {user_ids: ["j"], menu_item_ids: ["gone"]}, {user_ids: "j", menu_item_ids: ["c1"]}, {user_ids: ["j"], menu_item_ids: ["c1"], note: 5}]) {
    assert.equal(checkProposal(bad, team, menu), null, JSON.stringify(bad));
  }
});

test("the instructions carry today, the overtime limit and the confirm-first rule", () => {
  const text = assistantSystem({restaurant: "Osaka - Miami", today: "2026-11-03", weekday: "Tuesday", timeZone: "America/New_York", weekStart: "Monday", overtimeWeekly: 40, overtimeDaily: null, manager: "Nino"});
  assert.match(text, /assistant of Nino, a manager at Osaka - Miami/);
  assert.match(text, /Today is Tuesday 2026-11-03/);
  assert.match(text, /more than 40 hours in a week\./);
  assert.match(text, /It does NOT assign anything/);
  assert.match(text, /never guess numbers/);
});
