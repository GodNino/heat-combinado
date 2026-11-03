// The managers' assistant: a conversation about the restaurant -- who works when and for how long,
// how the team is doing with its study, what the shift reports say -- that can also propose study
// assignments for the manager to confirm. Pure functions, so the server route (app/api/assistant)
// and the tests share them:
//   * assistantSystem is the assistant's instructions.
//   * scheduleView / hoursView turn shifts into local times and per-person hours.
//   * reportsView keeps what matters from each shift report.
//   * checkProposal checks what the assistant asks to assign before the manager is shown it.
// Every piece of data reaches it through the manager's own sign-in, so it only ever sees what
// that manager can see in the app.

export type TeamMember = {user_id: string; name: string; role: string};
export type Shift = {id: string; user_id: string; position: string; starts_at: string; ends_at: string; published: boolean; on_call?: boolean | null};
export type Report = {service_date: string; label: string; mood: string; covers: number | null; urgent: boolean; issues: {kind: string; note?: string}[] | null;
  low_stock: string; shoutouts: string; next_shift: string; notes: string};
export type MenuEntry = {id: string; name: string; category: string | null; content_type: string | null};
export type Proposal = {learners: {id: string; name: string}[]; items: {id: string; name: string}[]; note: string};

export const MAX_RANGE_DAYS = 31;

export function assistantSystem(input: {restaurant: string; today: string; weekday: string; timeZone: string; weekStart: string; overtimeWeekly: number; overtimeDaily: number | null; manager: string}) {
  return `You are the assistant of ${input.manager}, a manager at ${input.restaurant}. You help them run the restaurant: who works when, hours and overtime, how the team is doing with its study, and what the shift reports say. Be the colleague they rely on: quick, concrete, and honest about what you don't know.

Today is ${input.weekday} ${input.today} in the restaurant's time zone (${input.timeZone}). Weeks start on ${input.weekStart}. Overtime: more than ${input.overtimeWeekly} hours in a week${input.overtimeDaily ? ` or ${input.overtimeDaily} in a day` : ""}.

How to work:
- Use your tools to look things up; never guess numbers, names, hours or dates. Look up only what the question needs.
- A tool that answers "not available with your access" means this manager can't see that part of the app: say so plainly, don't work around it.
- Answer first, in two to six short sentences or a short list; then, when useful, one line on where it came from (for example "From the published schedule, Nov 2-8"). Name people as the tools name them.
- Hours: count the scheduled shifts in the period asked. Flag who would pass the overtime limit, and by how much.
- Study: "needs review" means a quiz result under 80% or out of date; tutor practice marked wrong or partly means they missed something there, and what.
- Shift reports: lead with anything urgent (allergies, injuries), then what repeats across reports, then low stock and shout-outs.
- To give study to someone, call propose_assignment. It does NOT assign anything: the manager sees a card and confirms it. After calling it, say briefly what you proposed and that they can confirm it below; never say it is done.
- You can't change the schedule, approve requests or publish anything yet. If asked, say what they could do in the app instead.
- Stay on running this restaurant. Never share one employee's information beyond what the manager asked about, and don't judge people: describe what the data shows.

Write plain text, no markdown headings or tables; short lists are fine. Reply in the language the manager writes in.`;
}

// A date as YYYY-MM-DD in a time zone, and the weekday's name in English.
export function localDay(at: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", {timeZone, year: "numeric", month: "2-digit", day: "2-digit"}).format(at);
  const weekday = new Intl.DateTimeFormat("en-US", {timeZone, weekday: "long"}).format(at);
  return {day: parts, weekday};
}

// A validated range: both dates real, from <= to, and at most MAX_RANGE_DAYS long.
export function checkRange(from: unknown, to: unknown): {from: string; to: string} | null {
  const ok = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
  if (!ok(from) || !ok(to)) return null;
  const days = (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 864e5;
  return days < 0 || days > MAX_RANGE_DAYS ? null : {from, to};
}

const hoursOf = (s: Shift) => Math.round((Date.parse(s.ends_at) - Date.parse(s.starts_at)) / 36e5 * 100) / 100;

// Shifts as the manager reads them: local day and times, person, position, hours, draft or not.
export function scheduleView(shifts: readonly Shift[], team: readonly TeamMember[], timeZone: string) {
  const nameOf = new Map(team.map(m => [m.user_id, m.name]));
  const time = (iso: string) => new Intl.DateTimeFormat("en-US", {timeZone, hour: "numeric", minute: "2-digit"}).format(new Date(iso));
  return [...shifts].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at)).map(s => ({
    day: localDay(new Date(s.starts_at), timeZone).day,
    weekday: localDay(new Date(s.starts_at), timeZone).weekday,
    person: nameOf.get(s.user_id) ?? "Former team member",
    position: s.position,
    time: `${time(s.starts_at)}-${time(s.ends_at)}`,
    hours: hoursOf(s),
    ...(s.published ? {} : {draft: true}),
    ...(s.on_call ? {on_call: true} : {}),
  }));
}

// Scheduled hours per person in the shifts given, most first, with how far over the weekly limit.
export function hoursView(shifts: readonly Shift[], team: readonly TeamMember[], weeklyLimit: number) {
  const nameOf = new Map(team.map(m => [m.user_id, m.name]));
  const total = new Map<string, number>();
  for (const s of shifts) if (!s.on_call) total.set(s.user_id, (total.get(s.user_id) ?? 0) + hoursOf(s));
  return [...total.entries()].map(([id, hours]) => ({person: nameOf.get(id) ?? "Former team member", hours: Math.round(hours * 100) / 100,
    over_limit_by: hours > weeklyLimit ? Math.round((hours - weeklyLimit) * 100) / 100 : 0}))
    .sort((a, b) => b.hours - a.hours || a.person.localeCompare(b.person));
}

// What matters from each report, oldest first; empty fields are left out.
export function reportsView(reports: readonly Report[]) {
  return [...reports].sort((a, b) => a.service_date.localeCompare(b.service_date) || a.label.localeCompare(b.label)).map(r => {
    const view: Record<string, unknown> = {date: r.service_date, service: r.label, mood: r.mood};
    if (r.covers != null) view.covers = r.covers;
    if (r.urgent) view.urgent = true;
    const issues = (r.issues ?? []).map(i => `${i.kind}${i.note?.trim() ? `: ${i.note.trim()}` : ""}`);
    if (issues.length) view.issues = issues;
    for (const key of ["low_stock", "shoutouts", "next_shift", "notes"] as const) if (r[key]?.trim()) view[key] = r[key].trim();
    return view;
  });
}

// A proposal the manager will be shown: real team members and real menu items only, each once,
// at most 20 people and 40 items, and a short note. Anything else is refused.
export function checkProposal(input: unknown, team: readonly TeamMember[], menu: readonly MenuEntry[]): Proposal | null {
  if (!input || typeof input !== "object") return null;
  const {user_ids, menu_item_ids, note} = input as {user_ids?: unknown; menu_item_ids?: unknown; note?: unknown};
  if (!Array.isArray(user_ids) || !Array.isArray(menu_item_ids) || !user_ids.length || !menu_item_ids.length) return null;
  if (user_ids.length > 20 || menu_item_ids.length > 40) return null;
  if (note !== undefined && typeof note !== "string") return null;
  const people = new Map(team.map(m => [m.user_id, m]));
  const dishes = new Map(menu.map(m => [m.id, m]));
  if (!user_ids.every(id => typeof id === "string" && people.has(id)) || !menu_item_ids.every(id => typeof id === "string" && dishes.has(id))) return null;
  return {
    learners: [...new Set(user_ids as string[])].map(id => ({id, name: people.get(id)!.name})),
    items: [...new Set(menu_item_ids as string[])].map(id => ({id, name: dishes.get(id)!.name})),
    note: ((note as string | undefined) ?? "").replace(/\s+/g, " ").trim().slice(0, 200),
  };
}
