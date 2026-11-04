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
