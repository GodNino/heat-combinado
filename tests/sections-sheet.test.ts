import { test } from "node:test";
import assert from "node:assert/strict";
import { sectionsSheet } from "../lib/sheets.ts";

const ctx = {restaurant: "Osaka - Miami", printed: new Date("2026-11-03T12:00:00Z")};
const text = (bytes: Uint8Array) => { let out = ""; for (const b of bytes) out += String.fromCharCode(b); return out; };

test("tonight's sections print sideways with the map, the servers and the S.A.s", () => {
  const sheet = sectionsSheet({
    title: "Tuesday, November 3 · Dinner", day: "2026-11-03", service: "Dinner", width: 1000, height: 640,
    tables: [
      {label: "23", x: 205, y: 240, round: false, hw: 30, hh: 30, section: 1},
      {label: "22", x: 340, y: 250, round: true, hw: 26, hh: 26, section: 1},
      {label: "", x: 190, y: 34, round: true, hw: 15, hh: 15, section: null},
      {label: "805", x: 470, y: 490, round: true, hw: 26, hh: 26, section: null},
    ],
    tags: [{n: 1, name: "Segundo", x: 270, y: 200}],
    sections: [{n: 1, server: "Segundo", sas: ["Jack"], where: "23, 22"}, {n: 2, server: "Pick-up", sas: [], where: "805"}],
    helpers: [{name: "Jack", covers: "1/2"}, {name: "Gonzalo", covers: "Hot runner"}],
  }, ctx);
  const body = text(sheet.bytes);
  assert.equal(sheet.filename, "osaka-miami-sections-2026-11-03-dinner.pdf");
  assert.match(body, /\/MediaBox \[0 0 792 612\]/, "US Letter, landscape");
  for (const words of ["SERVERS", "SERVER ASSISTANTS", "Segundo", "Pick-up", "1/2", "Hot runner", "805", "23, 22"]) assert.ok(body.includes(words), `missing "${words}"`);
  assert.match(body, / c [\d.]+ [\d.]+ m| B 0 g| f 0 g/, "round tables are drawn as circles");
  assert.equal(Number(/\/Type \/Pages \/Count (\d+)/.exec(body)![1]), 1);
});
