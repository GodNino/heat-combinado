// Tonight's side work, worked out from the schedule (migration 051). Pure functions, so the same
// rules run on the manager's screen and in tests:
//   * The closer is whoever starts latest in that service, per role (servers and S.A.s each have one).
//   * "One person" jobs rotate: the list moves one person along every day, so nobody keeps the
//     same job and everybody ends up with a fair share.
//   * "Everyone" jobs go to everybody in the role; "closer" jobs to that role's closer.
//   * A job set for certain weekdays only appears on those days.

export type Phase = "opening" | "closing";
export type Role = "server" | "sa";
export type Who = "one" | "all" | "closer";
export type RuledJob = {id: string; name: string; group_name: string; steps: string[]; sort_order: number; phase: Phase | null; role: Role | null; who: Who; days: number[]};
export type OnShift = {user_id: string; name: string; shift_position: string; starts_at: string};
export type PlannedJob = {job: RuledJob; user_id: string | null; phase: Phase};

export const isServer = (position: string) => /^\s*server\s*$/i.test(position);
export const isHelper = (position: string) => /assistant|^\s*s\.?\s*a\.?\s*$|runner|busser/i.test(position);
export const roleOf = (position: string): Role | null => isServer(position) ? "server" : isHelper(position) ? "sa" : null;

// Lunch is anything starting before 4pm; the rest is dinner.
export const serviceOf = (startsAt: string) => new Date(startsAt).getHours() < 16 ? "Lunch" : "Dinner";
// The services a manager can pick. Brunch is the daytime service too (normally Saturday and Sunday, but the manager
// decides): it has the same people as Lunch, the day's shifts that start before 4pm, under its own name and its own
// floor plan and side work.
export const ALL_SERVICES = ["Brunch", "Lunch", "Dinner"] as const;
// Off until database update 054 has been run (Supabase SQL editor): until then a Brunch plan can't be saved, so the
// Brunch chip isn't offered. Switch to true once 054 is in.
export const BRUNCH_READY = false;
export const SERVICES = BRUNCH_READY ? ALL_SERVICES : ALL_SERVICES.filter(s => s !== "Brunch");
export const halfOf = (service: string) => service === "Dinner" ? "Dinner" : "Lunch";
// Where the screen starts: Dinner from 4pm, otherwise Brunch on a Saturday or Sunday and Lunch on the other days.
export const defaultServiceAt = (now = new Date(), brunch = BRUNCH_READY) => now.getHours() >= 16 ? "Dinner" : brunch && (now.getDay() === 0 || now.getDay() === 6) ? "Brunch" : "Lunch";

// A day number that goes up by one every calendar day, for the rotation.
export function dayNumber(day: string) {
  const [y, m, d] = day.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 864e5);
}
export const weekdayOf = (day: string) => new Date(dayNumber(day) * 864e5).getUTCDay();

// One entry per person (someone on two shifts in a service counts once, at their earliest start).
export function peopleIn(service: string, onShift: OnShift[]) {
  const seen = new Map<string, OnShift>();
  for (const p of onShift) {
    if (serviceOf(p.starts_at) !== halfOf(service)) continue;
    const had = seen.get(p.user_id);
    if (!had || Date.parse(p.starts_at) < Date.parse(had.starts_at)) seen.set(p.user_id, p);
  }
  return [...seen.values()];
}

// Whoever comes in last closes. Two people starting at the same latest time both close.
export function closers(people: OnShift[]) {
  if (!people.length) return [];
  const last = Math.max(...people.map(p => Date.parse(p.starts_at)));
  return people.filter(p => Date.parse(p.starts_at) === last).map(p => p.user_id);
}

export function planJobs(jobs: RuledJob[], people: OnShift[], day: string): PlannedJob[] {
  const weekday = weekdayOf(day);
  const shift = dayNumber(day);
  const planned: PlannedJob[] = [];
  for (const role of ["server", "sa"] as Role[]) {
    const team = people.filter(p => roleOf(p.shift_position) === role).sort((a, b) => a.name.localeCompare(b.name) || a.user_id.localeCompare(b.user_id));
    const closing = closers(team);
    const mine = jobs.filter(j => j.phase && j.role === role && (!j.days.length || j.days.includes(weekday))).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    let turn = 0;
    for (const job of mine) {
      const phase = job.phase!;
      if (job.who === "all") { for (const p of team) planned.push({job, user_id: p.user_id, phase}); continue; }
      if (job.who === "closer") { for (const id of closing.length ? closing : [null]) planned.push({job, user_id: id, phase}); continue; }
      planned.push({job, user_id: team.length ? team[(turn + shift) % team.length].user_id : null, phase});
      turn++;
    }
  }
  return planned;
}

// S.A.s spread across the servers' rows, moving one row along each day.
export function spreadHelpers<T extends {sa: {id: string; name: string}[]}>(rows: T[], helpers: OnShift[], day: string): T[] {
  if (!rows.length || !helpers.length) return rows;
  const shift = dayNumber(day);
  const sorted = [...helpers].sort((a, b) => a.name.localeCompare(b.name));
  const next = rows.map(r => ({...r, sa: [...r.sa]}));
  sorted.forEach((h, i) => { next[(i + shift) % next.length].sa.push({id: h.user_id, name: h.name}); });
  return next;
}
