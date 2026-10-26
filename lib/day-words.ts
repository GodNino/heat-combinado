// The words for a day in the day pill (app/day-pill.tsx), kept free of React so the tests share them.
export const key = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const parse = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d); };
const short = (d: Date) => d.toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"});

/** The words for a day: "Today · Mon, Oct 26", "Tomorrow · Tue, Oct 27", "Yesterday · …", or just "Wed, Oct 28". */
export function dayWords(day: string, now = new Date()) {
  const date = parse(day);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const gap = Math.round((date.getTime() - start.getTime()) / 864e5);
  const word = gap === 0 ? "Today" : gap === 1 ? "Tomorrow" : gap === -1 ? "Yesterday" : "";
  return word ? `${word} · ${short(date)}` : short(date);
}

/** Yesterday through two weeks from today, and the chosen day too if it is outside that. */
export function dayChoices(chosen: string, now = new Date()) {
  const days = Array.from({length: 16}, (_, i) => key(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i - 1)));
  return chosen && !days.includes(chosen) ? [...days, chosen].sort() : days;
}
