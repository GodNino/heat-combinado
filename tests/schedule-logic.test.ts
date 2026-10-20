import { test } from "node:test";
import assert from "node:assert/strict";
import { copiedWeek, dayBlocks, dayKey, dayTotals, hoursByPerson, initials, movedShift, shiftLabel, shiftTimes, shiftWarnings, weekStart, type Shift } from "../lib/schedule.ts";

const shift = (id: string, user: string, from: Date, to: Date): Shift => ({
  id, restaurant_id: "r", user_id: user, position: "Server", note: "", published: false, starts_at: from.toISOString(), ends_at: to.toISOString(),
});

test("weeks start on Monday, and a closing shift ends the next day", () => {
  assert.equal(dayKey(weekStart(new Date(2026, 9, 25))), "2026-10-19", "Sunday belongs to the week that began Monday");
  assert.equal(dayKey(weekStart(new Date(2026, 9, 19, 23))), "2026-10-19");
  const {from, to} = shiftTimes(new Date(2026, 9, 20), "17:00", "01:30");
  assert.equal(to.getTime() - from.getTime(), 8.5 * 3_600_000);
  assert.equal(shiftLabel({starts_at: from.toISOString(), ends_at: to.toISOString()}), "5p–1:30a");
});

test("hours add up per person, and overlaps, availability and time off are flagged", () => {
  const monday = new Date(2026, 9, 19);
  const a = shift("a", "ana", new Date(2026, 9, 19, 17), new Date(2026, 9, 19, 23));
  const b = shift("b", "ana", new Date(2026, 9, 19, 22), new Date(2026, 9, 20, 2));
  const c = shift("c", "luis", new Date(2026, 9, 19, 11), new Date(2026, 9, 19, 16));
  assert.equal(hoursByPerson([a, b, c]).get("ana"), 10);
  assert.deepEqual(shiftWarnings(a, [a, b, c], [], []), ["overlap"]);
  assert.deepEqual(shiftWarnings(c, [a, b, c], [{id: "u", user_id: "luis", weekday: monday.getDay(), starts: "09:00", ends: "12:00", note: ""}], []), ["unavailable"]);
  assert.deepEqual(shiftWarnings(c, [c], [{id: "u", user_id: "luis", weekday: monday.getDay(), starts: "17:00", ends: "23:00", note: ""}], []), [], "unavailable at night only: a lunch shift is fine");
  assert.deepEqual(shiftWarnings(c, [c], [], [{id: "t", user_id: "luis", starts_on: "2026-10-18", ends_on: "2026-10-19", note: "", status: "pending"}]), ["time_off_pending"]);
  assert.deepEqual(shiftWarnings(c, [c], [], [{id: "t", user_id: "luis", starts_on: "2026-10-19", ends_on: "2026-10-19", note: "", status: "denied"}]), []);
  const copy = copiedWeek([a])[0];
  assert.equal(dayKey(new Date(copy.starts_at)), "2026-10-26");
  assert.equal(new Date(copy.starts_at).getHours(), 17, "same time of day a week later");
});

test("a dragged shift keeps its hours, and each day shows what blocks it and what it adds up to", () => {
  const close = shift("a", "ana", new Date(2026, 9, 19, 17), new Date(2026, 9, 20, 1, 30));
  const moved = movedShift(close, new Date(2026, 9, 22));
  assert.equal(shiftLabel(moved), "5p–1:30a", "same time of day");
  assert.equal(dayKey(new Date(moved.starts_at)), "2026-10-22");
  assert.equal(dayKey(new Date(moved.ends_at)), "2026-10-23", "still closes after midnight");
  const thursday = new Date(2026, 9, 22);
  assert.deepEqual(dayBlocks("luis", thursday, [{id: "u", user_id: "luis", weekday: thursday.getDay(), starts: "09:00", ends: "12:00", note: ""}], []), [{kind: "unavailable", label: "9a–12p"}]);
  assert.deepEqual(dayBlocks("luis", thursday, [], [{id: "t", user_id: "luis", starts_on: "2026-10-21", ends_on: "2026-10-23", note: "", status: "pending"}]), [{kind: "time_off_pending", label: "All day"}]);
  assert.deepEqual(dayBlocks("luis", thursday, [], [{id: "t", user_id: "luis", starts_on: "2026-10-22", ends_on: "2026-10-22", note: "", status: "denied"}]), []);
  const lunch = shift("b", "luis", new Date(2026, 9, 19, 11), new Date(2026, 9, 19, 15));
  assert.deepEqual(dayTotals([close, lunch], new Date(2026, 9, 19)), {hours: 12.5, people: 2});
  assert.equal(initials("Ana María López"), "AM");
  assert.equal(initials("  "), "?");
});
