// The schedule's arithmetic (migration 040): weeks, hours, overtime and the warnings a manager sees
// while building it. Kept free of React and Supabase so the screen and the tests share one copy.
// Everything is in the device's local time: the manager and the team are in the restaurant's city.

export type Shift = {
  id: string;
  restaurant_id: string;
  user_id: string;
  position: string;
  starts_at: string;
  ends_at: string;
  note: string;
  published: boolean;
};
export type Unavailability = {id: string; user_id: string; weekday: number; starts: string | null; ends: string | null; note: string};
export type TimeOff = {id: string; user_id: string; starts_on: string; ends_on: string; note: string; status: "pending" | "approved" | "denied"; created_at?: string};

export const OVERTIME_HOURS = 40;
export const POSITIONS = ["Server", "Server assistant", "Bartender", "Barback", "Host", "Runner", "Busser", "Kitchen", "Sommelier", "Bar Manager", "Manager", "GM"];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// Weeks run Monday to Sunday, as in most restaurant payroll.
export function weekStart(day: Date) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}
export function addDays(day: Date, days: number) {
  const next = new Date(day);
  next.setDate(next.getDate() + days);
  return next;
}
export function dayKey(day: Date) {
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, "0")}-${String(day.getDate()).padStart(2, "0")}`;
}
export function weekDays(start: Date) {
  return Array.from({length: 7}, (_, i) => addDays(start, i));
}

// "17:30" on a given day. An end at or before the start means the shift closes after midnight.
export function atTime(day: Date, time: string) {
  const [h, m] = time.split(":").map(Number);
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m || 0);
}
export function shiftTimes(day: Date, start: string, end: string) {
  const from = atTime(day, start);
  let to = atTime(day, end);
  if (to <= from) to = addDays(to, 1);
  return {from, to};
}
export const clock = (date: Date) => `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

// Sling-style short times: 5p, 5:30p, 11a.
export function shortTime(date: Date) {
  const h = date.getHours(), m = date.getMinutes();
  return `${h % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${h < 12 ? "a" : "p"}`;
}
export const shiftLabel = (shift: Pick<Shift, "starts_at" | "ends_at">) => `${shortTime(new Date(shift.starts_at))}–${shortTime(new Date(shift.ends_at))}`;

export const shiftHours = (shift: Pick<Shift, "starts_at" | "ends_at">) => (Date.parse(shift.ends_at) - Date.parse(shift.starts_at)) / 3_600_000;
export function hoursByPerson(shifts: Shift[]) {
  const hours = new Map<string, number>();
  for (const shift of shifts) hours.set(shift.user_id, (hours.get(shift.user_id) ?? 0) + shiftHours(shift));
  return hours;
}
export const formatHours = (hours: number) => `${Math.round(hours * 10) / 10}h`;

export type Warning = "overlap" | "unavailable" | "time_off" | "time_off_pending";
export const WARNING_TEXT: Record<Warning, string> = {
  overlap: "Overlaps another shift",
  unavailable: "Marked unavailable",
  time_off: "Approved time off",
  time_off_pending: "Asked for this day off",
};

const minutes = (time: string) => { const [h, m] = time.split(":").map(Number); return h * 60 + (m || 0); };

// What's wrong with this shift, given everything else on the schedule.
export function shiftWarnings(shift: Shift, others: Shift[], unavailable: Unavailability[], timeOff: TimeOff[]): Warning[] {
  const found: Warning[] = [];
  const from = Date.parse(shift.starts_at), to = Date.parse(shift.ends_at);
  if (others.some(o => o.id !== shift.id && o.user_id === shift.user_id && Date.parse(o.starts_at) < to && Date.parse(o.ends_at) > from)) found.push("overlap");
  const start = new Date(from);
  const startMin = start.getHours() * 60 + start.getMinutes();
  const endMin = startMin + (to - from) / 60_000;
  if (unavailable.some(u => u.user_id === shift.user_id && u.weekday === start.getDay()
    && (u.starts === null || u.ends === null || (minutes(u.starts) < endMin && minutes(u.ends) > startMin)))) found.push("unavailable");
  const day = dayKey(start);
  const off = timeOff.filter(t => t.user_id === shift.user_id && t.starts_on <= day && t.ends_on >= day);
  if (off.some(t => t.status === "approved")) found.push("time_off");
  else if (off.some(t => t.status === "pending")) found.push("time_off_pending");
  return found;
}

// Copying last week: the same shifts, seven days later, as drafts.
export function copiedWeek(shifts: Shift[]) {
  return shifts.map(s => ({
    restaurant_id: s.restaurant_id, user_id: s.user_id, position: s.position, note: s.note,
    starts_at: addDays(new Date(s.starts_at), 7).toISOString(), ends_at: addDays(new Date(s.ends_at), 7).toISOString(),
  }));
}
