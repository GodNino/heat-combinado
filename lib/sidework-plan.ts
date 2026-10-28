// Tonight's side work, worked out from the schedule (migration 051). Pure functions, so the same
// rules run on the manager's screen and in tests:
//   * The closer is whoever starts latest in that service, per role (servers and S.A.s each have one).
//   * "One person" jobs rotate: each goes to whoever did it longest ago (from the last week's side
//     work), so the job you had yesterday goes to someone else even when tonight's team isn't
//     yesterday's. Everybody still gets a fair share: nobody gets a second job before everyone
//     has one. With no history, the list just moves one person along every day.
//   * "Everyone" jobs go to everybody in the role; "closer" jobs to that role's closer.
//   * A job set for certain weekdays only appears on those days.

export type Phase = "opening" | "closing";
export type Role = "server" | "sa";
export type Who = "one" | "all" | "closer";
export type RuledJob = {id: string; name: string; group_name: string; steps: string[]; sort_order: number; phase: Phase | null; role: Role | null; who: Who; days: number[]};
export type OnShift = {user_id: string; name: string; shift_position: string; starts_at: string};
export type PlannedJob = {job: RuledJob; user_id: string | null; phase: Phase};
// A job someone was given on an earlier day (checklist_assignments), for the rotation.
export type PastJob = {job_id: string; user_id: string; day: string};

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
export const BRUNCH_READY = true;
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

export function planJobs(jobs: RuledJob[], people: OnShift[], day: string, history: PastJob[] = []): PlannedJob[] {
  const weekday = weekdayOf(day);
  const shift = dayNumber(day);
  // The last day each person did each job, before today.
  const lastDid = new Map<string, number>();
  for (const h of history) {
    const when = dayNumber(h.day);
    const key = `${h.job_id}|${h.user_id}`;
    if (when < shift && when > (lastDid.get(key) ?? -Infinity)) lastDid.set(key, when);
  }
  const planned: PlannedJob[] = [];
  for (const role of ["server", "sa"] as Role[]) {
    const team = people.filter(p => roleOf(p.shift_position) === role).sort((a, b) => a.name.localeCompare(b.name) || a.user_id.localeCompare(b.user_id));
    const closing = closers(team);
    const mine = jobs.filter(j => j.phase && j.role === role && (!j.days.length || j.days.includes(weekday))).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
    // "One person" jobs are matched all at once: nobody gets a second before everyone has one,
    // and a repeat of a recent job is only made when nothing else fits.
    const dealt: {at: number; job: RuledJob}[] = [];
    for (const job of mine) {
      const phase = job.phase!;
      if (job.who === "all") { for (const p of team) planned.push({job, user_id: p.user_id, phase}); continue; }
      if (job.who === "closer") { for (const id of closing.length ? closing : [null]) planned.push({job, user_id: id, phase}); continue; }
      dealt.push({at: planned.length, job});
      planned.push({job, user_id: null, phase});
    }
    if (!team.length || !dealt.length) continue;
    // Each person has a slot per job they might get tonight; a later slot costs more than any
    // repeat, which keeps the shares even.
    const slots = Math.ceil(dealt.length / team.length);
    const cost = dealt.map((d, t) => Array.from({length: team.length * slots}, (_, c) => {
      const i = c % team.length;
      const ago = shift - (lastDid.get(`${d.job.id}|${team[i].user_id}`) ?? -Infinity);
      // Yesterday's job costs most, a week ago least. The tiny last part keeps the day's place in
      // the rotation, so with no history the list just moves one person along.
      const place = ((i - (t + shift)) % team.length + team.length) % team.length;
      return 1000 * Math.floor(c / team.length) + Math.max(0, 8 - ago) + 1e-4 * place;
    }));
    matchJobs(cost).forEach((c, t) => { planned[dealt[t].at].user_id = team[c % team.length].user_id; });
  }
  return planned;
}

// The cheapest way to give each job (row) its own person (column), with no fewer people than
// jobs: the Hungarian method. Returns the person for each job.
function matchJobs(cost: number[][]) {
  const jobs = cost.length, people = cost[0]?.length ?? 0;
  const u = new Array(jobs + 1).fill(0), v = new Array(people + 1).fill(0);
  const owner = new Array(people + 1).fill(0), way = new Array(people + 1).fill(0);
  for (let row = 1; row <= jobs; row++) {
    owner[0] = row;
    let col = 0;
    const least = new Array(people + 1).fill(Infinity), used = new Array(people + 1).fill(false);
    do {
      used[col] = true;
      const r = owner[col];
      let delta = Infinity, next = 0;
      for (let c = 1; c <= people; c++) {
        if (used[c]) continue;
        const reduced = cost[r - 1][c - 1] - u[r] - v[c];
        if (reduced < least[c]) { least[c] = reduced; way[c] = col; }
        if (least[c] < delta) { delta = least[c]; next = c; }
      }
      for (let c = 0; c <= people; c++) {
        if (used[c]) { u[owner[c]] += delta; v[c] -= delta; } else least[c] -= delta;
      }
      col = next;
    } while (owner[col] !== 0);
    do { const prev = way[col]; owner[col] = owner[prev]; col = prev; } while (col);
  }
  const pick = new Array(jobs).fill(0);
  for (let c = 1; c <= people; c++) if (owner[c]) pick[owner[c] - 1] = c - 1;
  return pick;
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
