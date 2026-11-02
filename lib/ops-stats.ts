// The operations dashboard's arithmetic: labor from the schedule and the service from the shift
// reports, this week against last. Kept free of React and Supabase so the screen and the tests share
// one copy. Weeks are the restaurant's own (schedule settings); days are the device's local days.
import { dayKey, shiftHours, weekStart, type ScheduleSettings, type Shift } from "./schedule.ts";
import { ISSUE_KINDS, type IssueKind, type Mood, type ShiftReport } from "./shift-report.ts";

export type PositionHours = {position: string; hours: number; lastHours: number; people: number};
export type Overtime = {user_id: string; hours: number; daily: boolean};
export type LaborSummary = {
  hours: number; lastHours: number; people: number; drafts: number;
  byPosition: PositionHours[]; overtime: Overtime[];
};

const sum = (shifts: Shift[]) => shifts.reduce((total, s) => total + shiftHours(s), 0);
const positionKey = (position: string) => position.trim().toLowerCase();

// Hours, people and drafts this week, hours by position against last week, and who goes into
// overtime (past the weekly limit, or past the daily one on any day when the restaurant sets one).
export function laborSummary(thisWeek: Shift[], lastWeek: Shift[], settings: Pick<ScheduleSettings, "overtime_weekly" | "overtime_daily">): LaborSummary {
  const names = new Map<string, string>();
  for (const s of [...thisWeek, ...lastWeek]) if (!names.has(positionKey(s.position))) names.set(positionKey(s.position), s.position.trim());
  const byPosition = [...names.entries()].map(([key, position]) => {
    const now = thisWeek.filter(s => positionKey(s.position) === key);
    return {position, hours: sum(now), lastHours: sum(lastWeek.filter(s => positionKey(s.position) === key)), people: new Set(now.map(s => s.user_id)).size};
  }).sort((a, b) => b.hours - a.hours || a.position.localeCompare(b.position));

  const overtime: Overtime[] = [];
  for (const user of new Set(thisWeek.map(s => s.user_id))) {
    const theirs = thisWeek.filter(s => s.user_id === user);
    const hours = sum(theirs);
    const perDay = new Map<string, number>();
    for (const s of theirs) perDay.set(dayKey(new Date(s.starts_at)), (perDay.get(dayKey(new Date(s.starts_at))) ?? 0) + shiftHours(s));
    const daily = settings.overtime_daily !== null && [...perDay.values()].some(h => h > settings.overtime_daily!);
    if (hours > settings.overtime_weekly || daily) overtime.push({user_id: user, hours, daily: daily && hours <= settings.overtime_weekly});
  }
  overtime.sort((a, b) => b.hours - a.hours);
  return {
    hours: sum(thisWeek), lastHours: sum(lastWeek), people: new Set(thisWeek.map(s => s.user_id)).size,
    drafts: thisWeek.filter(s => !s.published).length, byPosition, overtime,
  };
}

// Any stretch of days, not only a week: the same numbers as laborSummary, but overtime is judged one
// restaurant week at a time inside the stretch, so a month does not turn 160 honest hours into "overtime".
// A short stretch (a day, a few days) is judged on the shifts inside it, because that is all it holds.
export function laborRange(now: Shift[], before: Shift[], settings: Pick<ScheduleSettings, "overtime_weekly" | "overtime_daily" | "week_start">): LaborSummary {
  const base = laborSummary(now, before, settings);
  const weeks = new Map<string, Shift[]>();
  for (const s of now) {
    const key = dayKey(weekStart(new Date(s.starts_at), settings.week_start));
    weeks.set(key, [...(weeks.get(key) ?? []), s]);
  }
  const worst = new Map<string, Overtime>();
  for (const week of weeks.values()) for (const o of laborSummary(week, [], settings).overtime) {
    const seen = worst.get(o.user_id);
    if (!seen || o.hours > seen.hours) worst.set(o.user_id, o);
  }
  return {...base, overtime: [...worst.values()].sort((a, b) => b.hours - a.hours)};
}

// Hours past the weekly limit, added up week by week, for one person's shifts.
export function overtimeHours(shifts: Shift[], settings: Pick<ScheduleSettings, "overtime_weekly" | "week_start">) {
  const weeks = new Map<string, number>();
  for (const s of shifts) {
    const key = dayKey(weekStart(new Date(s.starts_at), settings.week_start));
    weeks.set(key, (weeks.get(key) ?? 0) + shiftHours(s));
  }
  return [...weeks.values()].reduce((total, hours) => total + Math.max(0, hours - settings.overtime_weekly), 0);
}

export type ServiceDay = {day: string; covers: number; sales: number; reports: number};
export type ServiceSummary = {
  reports: number; covers: number; lastCovers: number; sales: number; lastSales: number; hasSales: boolean;
  byDay: ServiceDay[]; moods: Record<Mood, number>; issues: {kind: IssueKind; count: number}[]; urgent: number;
};
const covers = (reports: ShiftReport[]) => reports.reduce((total, r) => total + (r.covers ?? 0), 0);
const sales = (reports: ShiftReport[]) => reports.reduce((total, r) => total + (r.sales === null || r.sales === "" ? 0 : Number(r.sales)), 0);

// Covers and sales against last week, each day of this week, how the nights went, and the issues by kind.
export function serviceSummary(thisWeek: ShiftReport[], lastWeek: ShiftReport[], days: string[]): ServiceSummary {
  const moods: Record<Mood, number> = {great: 0, ok: 0, rough: 0};
  const issueCount = new Map<IssueKind, number>();
  for (const r of thisWeek) {
    moods[r.mood] += 1;
    for (const issue of r.issues) issueCount.set(issue.kind, (issueCount.get(issue.kind) ?? 0) + 1);
  }
  return {
    reports: thisWeek.length,
    covers: covers(thisWeek), lastCovers: covers(lastWeek),
    sales: sales(thisWeek), lastSales: sales(lastWeek),
    hasSales: [...thisWeek, ...lastWeek].some(r => r.sales !== null && r.sales !== ""),
    byDay: days.map(day => { const theirs = thisWeek.filter(r => r.service_date === day); return {day, covers: covers(theirs), sales: sales(theirs), reports: theirs.length}; }),
    moods,
    issues: (Object.keys(ISSUE_KINDS) as IssueKind[]).map(kind => ({kind, count: issueCount.get(kind) ?? 0})).filter(i => i.count),
    urgent: thisWeek.filter(r => r.urgent).length,
  };
}

// What ran out most: how many reports listed each dish as 86'd or low, most often first.
export function mostOut(reports: ShiftReport[], limit = 5) {
  const seen = new Map<string, {name: string; out: number; low: number}>();
  for (const r of reports) {
    const listed = new Map<string, string>();
    for (const e of r.from_heat?.eighty_six ?? []) listed.set(e.name.trim().toLowerCase(), e.status);
    for (const [key, status] of listed) {
      const name = (r.from_heat?.eighty_six ?? []).find(e => e.name.trim().toLowerCase() === key)!.name.trim();
      const row = seen.get(key) ?? {name, out: 0, low: 0};
      if (status === "86") row.out += 1; else row.low += 1;
      seen.set(key, row);
    }
  }
  return [...seen.values()].sort((a, b) => (b.out + b.low) - (a.out + a.low) || b.out - a.out || a.name.localeCompare(b.name)).slice(0, limit);
}

// "+12% vs last week" or "−8% vs the same days last week", or nothing to compare with.
export function change(now: number, before: number, against = "last week") {
  if (!before) return null;
  const delta = Math.round((now - before) / before * 100);
  return delta === 0 ? `Same as ${against}` : `${delta > 0 ? "+" : "−"}${Math.abs(delta)}% vs ${against}`;
}
