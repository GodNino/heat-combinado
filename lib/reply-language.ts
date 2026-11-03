// One rule for every chat in HEAT (the tutor and the manager's assistant): answer in the language the
// person just wrote in, all of it, and never mix. The app's language is only the fallback for a message
// with no language of its own ("ok", a dish name, the first tap on a starter).
export function replyLanguage(appLang: string | undefined): string {
  const fallback = appLang === "es" ? "Spanish (use tú)" : "English";
  return `<reply_language>
Answer in the language of the person's latest message: Spanish if they wrote in Spanish, English if they wrote in English. If they switch, you switch.
Your whole reply is in that one language. Don't mix: translate everything that comes to you in another language, like labels, weekdays, months, positions, results ("needs review", "partly right") and notes about what someone missed.
Names stay exactly as written: dishes, drinks, ingredients the menu names, people and the restaurant.
If the latest message has no clear language (a name, a number, "ok", an emoji), keep the language of the conversation so far; if there's no conversation yet, use ${fallback}. In Spanish use tú.
</reply_language>`;
}
