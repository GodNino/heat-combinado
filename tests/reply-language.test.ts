import { test } from "node:test";
import assert from "node:assert/strict";
import { replyLanguage } from "../lib/reply-language.ts";
import { tutorSystem } from "../lib/tutor.ts";

test("chats answer in the language of the latest message, without mixing", () => {
  const rule = replyLanguage("en");
  assert.match(rule, /language of the person's latest message/);
  assert.match(rule, /If they switch, you switch/);
  assert.match(rule, /Don't mix/);
  assert.match(rule, /Names stay exactly as written/);
  assert.match(rule, /no conversation yet, use English/, "the app's language is only the fallback");
  assert.match(replyLanguage("es"), /no conversation yet, use Spanish \(use tú\)/);
  assert.doesNotMatch(tutorSystem("Osaka"), /Use the person's language and tú/, "the old, weaker rule is gone");
});
