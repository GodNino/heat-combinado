import { test } from "node:test";
import assert from "node:assert/strict";
import { closers, peopleIn, planJobs, spreadHelpers, weekdayOf, type OnShift, type RuledJob } from "../lib/sidework-plan.ts";

const at = (hour: number, minute = 0) => new Date(2026, 9, 24, hour, minute).toISOString();
const person = (id: string, name: string, position: string, start: string): OnShift => ({user_id: id, name, shift_position: position, starts_at: start});
const job = (id: string, extra: Partial<RuledJob>): RuledJob => ({id, name: id, group_name: "", steps: ["Do it"], sort_order: 0, phase: "opening", role: "sa", who: "one", days: [], ...extra});

const floor = [
  person("s1", "Aston", "Server", at(16)), person("s2", "Yesenia", "Server", at(17, 30)),
  person("a1", "Jack", "Server assistant", at(16)), person("a2", "Juan", "Server assistant", at(16)), person("a3", "Cris", "Server assistant", at(17, 30)),
  person("k1", "Marco", "Sushi Chef", at(15)), person("l1", "Lunch only", "Server", at(11)),
];

test("the closer is whoever comes in last, for servers and S.A.s apart", () => {
  const dinner = peopleIn("Dinner", floor);
  assert.ok(!dinner.some(p => p.user_id === "l1"), "a lunch shift isn't on the dinner floor");
  assert.deepEqual(closers(dinner.filter(p => p.shift_position === "Server")), ["s2"]);
  const plan = planJobs([job("closer", {phase: "closing", who: "closer"}), job("closer-server", {phase: "closing", role: "server", who: "closer"})], dinner, "2026-10-24");
  assert.deepEqual(plan.map(p => [p.job.id, p.user_id]), [["closer-server", "s2"], ["closer", "a3"]]);
});

test("one-person jobs rotate a person along every day and spread evenly", () => {
  const dinner = peopleIn("Dinner", floor);
  const jobs = [job("a", {sort_order: 1}), job("b", {sort_order: 2}), job("c", {sort_order: 3})];
  const saturday = planJobs(jobs, dinner, "2026-10-24").map(p => p.user_id);
  const sunday = planJobs(jobs, dinner, "2026-10-25").map(p => p.user_id);
  assert.equal(new Set(saturday).size, 3, "three S.A.s, three jobs, one each");
  assert.notDeepEqual(saturday, sunday, "the next day each job goes to someone else");
  assert.equal(sunday[0], saturday[1], "it moves one person along");
});

test("everyone jobs go to the whole role, and day-only jobs skip the other days", () => {
  const dinner = peopleIn("Dinner", floor);
  assert.equal(weekdayOf("2026-10-24"), 6, "a Saturday");
  const jobs = [job("tables", {role: "server", who: "all"}), job("inventory", {days: [0, 4]})];
  const saturday = planJobs(jobs, dinner, "2026-10-24");
  assert.deepEqual(saturday.map(p => p.job.id), ["tables", "tables"]);
  assert.ok(planJobs(jobs, dinner, "2026-10-25").some(p => p.job.id === "inventory"), "Sunday has the inventory");
  assert.equal(planJobs([job("unset", {phase: null})], dinner, "2026-10-24").length, 0, "a job with no phase isn't handed out");
});

test("S.A.s spread across the servers' rows", () => {
  const rows = [{sa: [] as {id: string; name: string}[]}, {sa: [] as {id: string; name: string}[]}];
  const spread = spreadHelpers(rows, peopleIn("Dinner", floor).filter(p => p.shift_position === "Server assistant"), "2026-10-24");
  assert.equal(spread.flatMap(r => r.sa).length, 3);
  assert.ok(spread.every(r => r.sa.length >= 1));
});
