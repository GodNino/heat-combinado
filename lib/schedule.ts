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
// Front of house and kitchen (back of house). Each side has its own schedulers (048): the floor
// managers build the front of house, the head chef or sous chef the kitchen; Team access does both.
export const FOH_POSITIONS = ["Server", "Server assistant", "Bartender", "Barback", "Host", "Runner", "Busser", "Sommelier", "Bar Manager", "Manager", "GM"];
export const KITCHEN_POSITIONS = ["Executive Chef", "Head Chef", "Sous Chef", "Chef de Partie", "Line Cook", "Prep Cook", "Pastry Chef", "Sushi Chef", "Expo", "Dishwasher", "Kitchen Manager", "Kitchen"];
export const POSITIONS = [...FOH_POSITIONS, ...KITCHEN_POSITIONS];
export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

// The first day of the week `day` falls in. Weeks run Monday to Sunday unless the restaurant's
// schedule settings say otherwise (startsOn: 0 Sunday … 6 Saturday; Osaka starts on Thursday, 4).
export function weekStart(day: Date, startsOn = 1) {
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  start.setDate(start.getDate() - ((start.getDay() - startsOn + 7) % 7));
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

export type Warning = "overlap" | "unavailable" | "time_off" | "time_off_pending" | "daily_overtime";
export const WARNING_TEXT: Record<Warning, string> = {
  daily_overtime: "Over the daily hours",
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

// Dragging a shift to another day (and maybe another person): the same time of day and the same
// length, so a 5p–1a close stays a 5p–1a close wherever it lands.
export function movedShift(shift: Pick<Shift, "starts_at" | "ends_at">, day: Date) {
  const from = new Date(shift.starts_at);
  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), from.getHours(), from.getMinutes());
  return {starts_at: start.toISOString(), ends_at: new Date(start.getTime() + Date.parse(shift.ends_at) - from.getTime()).toISOString()};
}

// What already fills someone's day before a shift goes in: their weekly unavailability and time off.
export type DayBlock = {kind: "unavailable" | "time_off" | "time_off_pending"; label: string};
export function dayBlocks(userId: string, day: Date, unavailable: Unavailability[], timeOff: TimeOff[]): DayBlock[] {
  const key = dayKey(day);
  const off = timeOff.filter(t => t.user_id === userId && t.starts_on <= key && t.ends_on >= key && t.status !== "denied");
  const blocks: DayBlock[] = off.map(t => ({kind: t.status === "approved" ? "time_off" : "time_off_pending", label: "All day"}));
  for (const u of unavailable) if (u.user_id === userId && u.weekday === day.getDay()) {
    blocks.push({kind: "unavailable", label: u.starts && u.ends ? `${shortTime(atTime(day, u.starts))}–${shortTime(atTime(day, u.ends))}` : "All day"});
  }
  return blocks;
}

// The footer of each day: hours scheduled and how many people work.
export function dayTotals(shifts: Shift[], day: Date) {
  const mine = shifts.filter(s => dayKey(new Date(s.starts_at)) === dayKey(day));
  return {hours: mine.reduce((sum, s) => sum + shiftHours(s), 0), people: new Set(mine.map(s => s.user_id)).size};
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join("") || "?";

// Copying last week: the same shifts, seven days later, as drafts.
// The same shifts a week later (or `weeks` weeks later), as new drafts.
export function copiedWeek(shifts: Shift[], weeks = 1) {
  return shifts.map(s => ({
    restaurant_id: s.restaurant_id, user_id: s.user_id, position: s.position, note: s.note,
    starts_at: addDays(new Date(s.starts_at), 7 * weeks).toISOString(), ends_at: addDays(new Date(s.ends_at), 7 * weeks).toISOString(),
  }));
}

// Only the copies whose person doesn't already start a shift at that moment, so copying twice never doubles one.
export function newCopies<T extends {user_id: string; starts_at: string}>(copies: T[], already: {user_id: string; starts_at: string}[]) {
  const here = new Set(already.map(s => `${s.user_id}|${Date.parse(s.starts_at)}`));
  return copies.filter(s => !here.has(`${s.user_id}|${Date.parse(s.starts_at)}`));
}

// ── Schedule settings (migration 044) ──
export type ShiftPreset = {name: string; start: string; end: string};
export type ScheduleSettings = {
  week_start: number;
  position_colors: Record<string, string>;
  overtime_weekly: number;
  overtime_daily: number | null;
  shift_presets: ShiftPreset[];
  team_sees_all: boolean;
  /** The positions that count as kitchen (back of house) here, or null for the usual ones (048). */
  kitchen_positions: string[] | null;
  /** Releases, offers and swaps close this many hours before the shift (045). */
  change_cutoff_hours: number;
};
// What a restaurant without saved settings gets: the schedule as it always was.
export const DEFAULT_SETTINGS: ScheduleSettings = {
  week_start: 1, position_colors: {}, overtime_weekly: OVERTIME_HOURS, overtime_daily: null, shift_presets: [], team_sees_all: true, change_cutoff_hours: 24, kitchen_positions: null,
};
// Whatever the database row holds, read safely: anything missing or malformed falls back to the default.
export function readSettings(row: Partial<Record<keyof ScheduleSettings, unknown>> | null | undefined): ScheduleSettings {
  if (!row) return DEFAULT_SETTINGS;
  const colors = row.position_colors && typeof row.position_colors === "object" ? row.position_colors as Record<string, unknown> : {};
  const presets = Array.isArray(row.shift_presets) ? row.shift_presets : [];
  const time = /^\d\d:\d\d$/;
  return {
    week_start: Number.isInteger(Number(row.week_start)) && Number(row.week_start) >= 0 && Number(row.week_start) <= 6 ? Number(row.week_start) : 1,
    position_colors: Object.fromEntries(Object.entries(colors).filter(([, c]) => typeof c === "string" && c in PALETTE)) as Record<string, string>,
    overtime_weekly: Number(row.overtime_weekly) > 0 ? Number(row.overtime_weekly) : OVERTIME_HOURS,
    overtime_daily: row.overtime_daily == null || !(Number(row.overtime_daily) > 0) ? null : Number(row.overtime_daily),
    shift_presets: presets.filter((p): p is ShiftPreset => !!p && typeof p.name === "string" && time.test(p.start) && time.test(p.end)).slice(0, 12),
    team_sees_all: row.team_sees_all !== false,
    kitchen_positions: Array.isArray(row.kitchen_positions) ? (row.kitchen_positions as unknown[]).filter((p): p is string => typeof p === "string") : null,
    change_cutoff_hours: Number.isInteger(Number(row.change_cutoff_hours)) && Number(row.change_cutoff_hours) >= 0 ? Number(row.change_cutoff_hours) : 24,
  };
}

// The colours a position can have. Names only: the screen turns each into shades that read well in
// light and dark (globals.css, .pos-<name>).
export const PALETTE: Record<string, string> = {
  blue: "Blue", red: "Red", green: "Green", orange: "Orange", purple: "Purple",
  pink: "Pink", teal: "Teal", yellow: "Yellow", brown: "Brown", gray: "Gray",
};
// One click away in settings: a colour for every usual position.
export const SUGGESTED_COLORS: Record<string, string> = {
  "Server": "blue", "Server assistant": "teal", "Bartender": "red", "Barback": "orange", "Host": "purple",
  "Runner": "green", "Busser": "brown", "Kitchen": "yellow", "Sommelier": "pink", "Bar Manager": "red", "Manager": "gray", "GM": "gray",
  "Executive Chef": "brown", "Head Chef": "brown", "Sous Chef": "orange", "Chef de Partie": "yellow", "Line Cook": "yellow", "Prep Cook": "green",
  "Pastry Chef": "pink", "Sushi Chef": "teal", "Expo": "purple", "Dishwasher": "gray", "Kitchen Manager": "brown",
};
// A shift's colour comes from its position, not the person: a server who bartends on Friday is red on Friday.
export function colorFor(position: string, colors: Record<string, string>) {
  const key = Object.keys(colors).find(name => name.trim().toLowerCase() === position.trim().toLowerCase());
  return key ? colors[key] : undefined;
}

// Hours this person works on the calendar day this shift starts, this shift included.
export function dayHoursFor(shift: Shift, shifts: Shift[]) {
  const day = dayKey(new Date(shift.starts_at));
  return shifts.filter(s => s.user_id === shift.user_id && dayKey(new Date(s.starts_at)) === day).reduce((sum, s) => sum + shiftHours(s), 0);
}
// Every warning for a shift, daily overtime included when the restaurant counts it.
export function allWarnings(shift: Shift, shifts: Shift[], unavailable: Unavailability[], timeOff: TimeOff[], dailyLimit: number | null): Warning[] {
  const found = shiftWarnings(shift, shifts, unavailable, timeOff);
  if (dailyLimit && dayHoursFor(shift, shifts) > dailyLimit) found.push("daily_overtime");
  return found;
}
// The time a new shift starts with: the first quick shift, or 17:00–23:00.
export function defaultShift(settings: ScheduleSettings) {
  const first = settings.shift_presets[0];
  return first ? {start: first.start, end: first.end} : {start: "17:00", end: "23:00"};
}

// ── Shift changes (migration 045): release, offer, swap, always approved by a manager ──
export type ChangeStatus = "open" | "asked" | "pending" | "approved" | "denied" | "declined" | "cancelled";
export type ShiftChange = {
  id: string; kind: "release" | "offer" | "swap"; status: ChangeStatus; other_area: boolean; note: string;
  created_at: string; decided_at: string | null;
  requested_by: string; requester_name: string; taker_id: string | null; taker_name: string | null;
  shift_id: string; shift_position: string; shift_starts: string; shift_ends: string;
  swap_shift_id: string | null; swap_position: string | null; swap_starts: string | null; swap_ends: string | null;
  /** The hours whoever takes the shift would have that week, and whether that's overtime (047). In a swap, the same for whoever asked. */
  taker_hours?: number | string | null; taker_overtime?: boolean | null;
  requester_hours?: number | string | null; requester_overtime?: boolean | null;
};
export const LIVE_CHANGES: ChangeStatus[] = ["open", "asked", "pending"];
export const isLive = (change: Pick<ShiftChange, "status">) => LIVE_CHANGES.includes(change.status);
// Whether a shift starting then can still be released, offered or swapped.
export function changeWindowOpen(startsAt: string, cutoffHours: number, now = Date.now()) {
  return Date.parse(startsAt) > now + cutoffHours * 3_600_000;
}

// ── Front of house and kitchen (048) ──
const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
// Whether a position is kitchen (back of house) at this restaurant. The database asks the same question.
export function isKitchen(position: string, settings: Pick<ScheduleSettings, "kitchen_positions">) {
  return (settings.kitchen_positions ?? KITCHEN_POSITIONS).some(k => same(k, position));
}
export type ScheduleAccess = {all: boolean; foh: boolean; kitchen: boolean};
// What this person may build: everything with Team access, otherwise their side of the house.
export function canSchedule(position: string, access: ScheduleAccess, settings: Pick<ScheduleSettings, "kitchen_positions">) {
  return access.all || (isKitchen(position, settings) ? access.kitchen : access.foh);
}
