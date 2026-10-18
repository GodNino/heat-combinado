import { test } from "node:test";
import assert from "node:assert/strict";
import { pushMessage } from "../lib/push-messages.ts";

test("each notification speaks the language its phone was set to", () => {
  assert.deepEqual(pushMessage("preshift_posted", "es", "Osaka Miami"), {
    title: "Ya está el pre-turno", body: "El pre-turno de hoy en Osaka Miami está publicado. Léelo antes del servicio.", url: "/app", tag: "preshift_posted",
  });
  assert.equal(pushMessage("urgent_report", "en", "Osaka Chicago").title, "Urgent shift report");
  assert.equal(pushMessage("study_assigned", "fr", "Osaka").title, "New dishes to study", "an unknown language falls back to English");
  assert.match(pushMessage("retake_requested", "en", "").body, /at HEAT/, "a missing restaurant name still reads well");
});
