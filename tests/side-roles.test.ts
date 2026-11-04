import { test } from "node:test";
import assert from "node:assert/strict";
import { roleOf } from "../lib/sidework-plan.ts";

test("without a saved list, the usual names decide who is a server or an S.A.", () => {
  assert.equal(roleOf("Server"), "server");
  assert.equal(roleOf("Server assistant"), "sa");
  assert.equal(roleOf("S.A."), "sa");
  assert.equal(roleOf("Busser"), "sa");
  assert.equal(roleOf("Mesero"), null, "another restaurant's word isn't known yet");
  assert.equal(roleOf("Bartender"), null);
});

test("a restaurant's own lists win, matched without caring about case or spaces", () => {
  const roles = {server_positions: ["Mesero", "Captain"], sa_positions: ["Back waiter", "Food runner"]};
  assert.equal(roleOf(" mesero ", roles), "server");
  assert.equal(roleOf("Captain", roles), "server");
  assert.equal(roleOf("Back Waiter", roles), "sa");
  assert.equal(roleOf("Server", roles), null, "once a list is saved, only the list counts");
  assert.equal(roleOf("Busser", roles), null);
  assert.equal(roleOf("Busser", {server_positions: ["Mesero"]}), "sa", "a list left empty (null) keeps the usual names for that role");
});

test("each restaurant can say when dinner starts; 4pm until it does", async () => {
  const { serviceOf, peopleIn } = await import("../lib/sidework-plan.ts");
  const at = (h: number) => { const d = new Date(2026, 10, 4, h, 30); return d.toISOString(); };
  assert.equal(serviceOf(at(15)), "Lunch");
  assert.equal(serviceOf(at(16)), "Dinner");
  assert.equal(serviceOf(at(16), 17), "Lunch", "dinner at 5pm: a 4:30 shift is still lunch");
  const team = [{user_id: "a", name: "A", shift_position: "Server", starts_at: at(16)}, {user_id: "b", name: "B", shift_position: "Server", starts_at: at(18)}];
  assert.deepEqual(peopleIn("Dinner", team, 17).map(p => p.user_id), ["b"]);
  assert.deepEqual(peopleIn("Lunch", team, 17).map(p => p.user_id), ["a"]);
});
