import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_SETTINGS, allWarnings, colorFor, copiedWeek, newCopies, dayBlocks, dayKey, dayTotals, defaultShift, hoursByPerson, initials, movedShift, positionAfterDrop, readSettings, shiftLabel, shiftTimes, shiftWarnings, weekStart, type Shift } from "../lib/schedule.ts";

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

test("schedule settings: weeks start on the restaurant's day, colours follow the position, daily overtime counts", () => {
  // Osaka's week runs Thursday to Wednesday.
  assert.equal(dayKey(weekStart(new Date(2026, 9, 21), 4)), "2026-10-15", "a Wednesday ends the week that began the Thursday before");
  assert.equal(dayKey(weekStart(new Date(2026, 9, 22), 4)), "2026-10-22", "Thursday begins a new one");
  assert.equal(dayKey(weekStart(new Date(2026, 9, 25, 23), 0)), "2026-10-25", "a Sunday week starts on Sunday");
  assert.equal(dayKey(weekStart(new Date(2026, 9, 25))), "2026-10-19", "Monday stays the default");

  assert.equal(colorFor(" bartender ", {Bartender: "red"}), "red", "matched without caring about case or spaces");
  assert.equal(colorFor("Captain", {Bartender: "red"}), undefined);

  const read = readSettings({week_start: 4, position_colors: {Server: "blue", Host: "neon"}, overtime_weekly: 40, overtime_daily: 8,
    shift_presets: [{name: "Dinner", start: "17:00", end: "23:00"}, {name: "Broken", start: "5pm", end: "11"}], team_sees_all: false});
  assert.deepEqual(read.position_colors, {Server: "blue"}, "an unknown colour is dropped");
  assert.deepEqual(read.shift_presets.map(p => p.name), ["Dinner"], "a malformed quick shift is dropped");
  assert.equal(read.team_sees_all, false);
  assert.deepEqual(readSettings(null), DEFAULT_SETTINGS);
  assert.deepEqual(defaultShift(read), {start: "17:00", end: "23:00"});
  assert.deepEqual(defaultShift({...read, shift_presets: [{name: "Lunch", start: "11:00", end: "15:00"}]}), {start: "11:00", end: "15:00"});

  const lunch = shift("l", "ana", new Date(2026, 9, 22, 10), new Date(2026, 9, 22, 15));
  const dinner = shift("d", "ana", new Date(2026, 9, 22, 17), new Date(2026, 9, 22, 22));
  assert.deepEqual(allWarnings(dinner, [lunch, dinner], [], [], 8), ["daily_overtime"], "10 hours on a day with an 8-hour limit");
  assert.deepEqual(allWarnings(dinner, [lunch, dinner], [], [], null), [], "no daily limit, no warning");
  assert.deepEqual(allWarnings(dinner, [lunch, dinner], [], [], 10), [], "exactly the limit is fine");
});

test("copying a week moves every shift by whole weeks and never doubles one already there", () => {
  const a = {id: "a", restaurant_id: "r", user_id: "u1", position: "Server", starts_at: "2026-10-01T21:00:00.000Z", ends_at: "2026-10-02T03:00:00.000Z", note: "", published: true} as Shift;
  const b = {...a, id: "b", user_id: "u2"};
  const copies = copiedWeek([a, b]);
  assert.equal(copies[0].starts_at, "2026-10-08T21:00:00.000Z");
  assert.equal(copiedWeek([a], 2)[0].starts_at, "2026-10-15T21:00:00.000Z");
  const fresh = newCopies(copies, [{user_id: "u1", starts_at: "2026-10-08T21:00:00.000Z"}]);
  assert.deepEqual(fresh.map(s => s.user_id), ["u2"]);
});

test("a dragged or copied shift takes the position of the person it lands on", () => {
  assert.equal(positionAfterDrop("Manager", false, "Bartender", true), "Bartender", "onto someone else: their own position");
  assert.equal(positionAfterDrop("Manager", true, "Bartender", true), "Manager", "same person, another day: it stays what it was");
  assert.equal(positionAfterDrop("Manager", false, "", false), "Manager", "nobody set a position for them: it keeps its own");
  assert.equal(positionAfterDrop("Manager", false, "Sushi Chef", false), "Manager", "a position this manager may not schedule: it keeps its own");
  assert.equal(positionAfterDrop("Manager", false, "  Server ", true), "Server", "stray spaces are ignored");
});
