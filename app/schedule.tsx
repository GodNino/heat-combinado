"use client";
// The schedule (migration 040), stage 1 of replacing Sling. Managers with Team access build the week
// person by person, see hours, overtime and conflicts as they go, and publish; the team sees their
// shifts and their coworkers', and keeps their own availability and time off.
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from "react";
import { AlertTriangle, ArrowLeftRight, ArrowRight, CalendarDays, ChevronLeft, ChevronRight, Check, ChevronDown, Copy, Plus, Settings, SlidersHorizontal, Users, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  PALETTE, POSITIONS, SUGGESTED_COLORS, WARNING_TEXT, WEEKDAYS, addDays, allWarnings, atTime, clock, colorFor, copiedWeek, newCopies, dayBlocks, dayKey,
  dayTotals, defaultShift, formatHours, hoursByPerson, initials, isLive, movedShift, readSettings, shiftHours, shiftLabel, shiftTimes, shortTime, weekDays, weekStart,
  changeWindowOpen, canSchedule, isKitchen, KITCHEN_POSITIONS, type ScheduleAccess, type ScheduleSettings, type Shift, type ShiftChange, type ShiftPreset, type TimeOff, type Unavailability, type Warning,
} from "@/lib/schedule";
import { scheduleSheet } from "@/lib/sheets";
import type { PushEvent } from "@/lib/push-messages";
import { notify } from "./notifications";
import { DownloadSheet } from "./sheet-download";
import { Field, SectionInfo } from "./ui";

type Person = {user_id: string; name: string; role: string};
type Tab = "week" | "mine" | "availability" | "timeoff" | "requests";

const dayHeading = (day: Date) => day.toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"});
const weekHeading = (start: Date) => `${start.toLocaleDateString("en-US", {month: "short", day: "numeric"})} – ${addDays(start, 6).toLocaleDateString("en-US", {month: "short", day: "numeric"})}`;
const dateLabel = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"}); };

// The restaurant's schedule settings (migration 044): the defaults until a manager saves some.
function useScheduleSettings(restaurantId: string) {
  const [settings, setSettings] = useState<ScheduleSettings | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let live = true;
    void supabase!.from("schedule_settings").select("*").eq("restaurant_id", restaurantId).maybeSingle().then(({data, error}) => {
      if (!live) return;
      setMissing(!!error);
      setSettings(readSettings(error ? null : data));
    });
    return () => {live = false;};
  }, [restaurantId]);
  return {settings, setSettings, missing};
}
// Shift changes (migration 045) this person may see: managers all of them; everyone else their own,
// the ones asked of them, and released shifts in their position. Reloaded after anything happens.
function useShiftChanges(restaurantId: string) {
  const [changes, setChanges] = useState<ShiftChange[]>([]);
  const reload = useCallback(async () => {
    const {data, error} = await supabase!.rpc("shift_change_list", {rid: restaurantId});
    setChanges(error ? [] : (data ?? []) as ShiftChange[]);
  }, [restaurantId]);
  useEffect(() => { void reload(); }, [reload]);
  return {changes, reload};
}
// "Fri, Oct 23 · 5p–11p", for a shift that's part of a change.
const when = (starts: string, ends: string) => `${dayHeading(new Date(starts))} · ${shiftLabel({starts_at: starts, ends_at: ends})}`;
// The database's own words for a refusal, or a plain fallback.
const changeError = (message: string) => /shift_change|function .* does not exist|PGRST202/.test(message) ? "Shift changes need database update 045." : message;

// The class that paints a shift in its position's colour, or nothing when it has none.
const paint = (position: string, settings: ScheduleSettings) => { const color = colorFor(position, settings.position_colors); return color ? `pos pos-${color}` : ""; };
const presetLabel = (preset: ShiftPreset) => { const today = new Date(); return `${shortTime(atTime(today, preset.start))}–${shortTime(atTime(today, preset.end))}`; };

export type ScheduleTab = Tab;
const FULL_ACCESS: ScheduleAccess = {all: true, foh: true, kitchen: true};
export function Schedule({restaurantId, restaurantName, userId, canManage, setMessage, initialTab, access = FULL_ACCESS}: {restaurantId: string; restaurantName: string; userId: string; canManage: boolean; setMessage: (text: string) => void; initialTab?: Tab | null; access?: ScheduleAccess}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? (canManage ? "week" : "mine"));
  const {settings, setSettings, missing} = useScheduleSettings(restaurantId);
  const {changes, reload: reloadChanges} = useShiftChanges(restaurantId);
  const awaitingManager = changes.filter(c => c.status === "pending").length;
  const askedOfMe = changes.filter(c => c.status === "asked" && c.taker_id === userId).length;
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!canManage) return;
    void supabase!.from("time_off_requests").select("id", {count: "exact", head: true}).eq("restaurant_id", restaurantId).eq("status", "pending")
      .then(({count}) => setPending(count ?? 0));
  }, [canManage, restaurantId, tab]);
  const tabs: [Tab, string][] = canManage
    ? [["week", "Build the week"], ["requests", awaitingManager ? `Requests · ${awaitingManager}` : "Requests"], ["timeoff", pending ? `Time off · ${pending}` : "Time off"], ["mine", askedOfMe ? `My shifts · ${askedOfMe}` : "My shifts"], ["availability", "My availability"]]
    : [["mine", askedOfMe ? `My shifts · ${askedOfMe}` : "My shifts"], ...(settings?.team_sees_all === false ? [] : [["week", "Team schedule"] as [Tab, string]]), ["availability", "My availability"], ["timeoff", "Time off"]];
  return <section className="mx-auto max-w-6xl">
    <p className="eyebrow muted">{canManage ? "Manager workspace" : "Your schedule"}</p>
    <h1 className="mt-3 mb-5 text-2xl font-semibold">Schedule</h1>
    <div className="category-tabs mb-5" role="group" aria-label="Schedule">
      {tabs.map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
    </div>
    {!settings ? <p className="muted" role="status">Loading the schedule…</p> : <>
    {tab === "week" && (canManage || settings.team_sees_all) && <WeekView restaurantId={restaurantId} restaurantName={restaurantName} canManage={canManage} setMessage={setMessage} settings={settings} settingsMissing={missing} onSettings={setSettings} changes={changes} access={access} />}
    {tab === "requests" && canManage && <ChangeRequests changes={changes} reload={reloadChanges} setMessage={setMessage} />}
    {tab === "mine" && <MyShifts restaurantId={restaurantId} userId={userId} settings={settings} changes={changes} reloadChanges={reloadChanges} setMessage={setMessage} />}
    {tab === "availability" && <Availability restaurantId={restaurantId} userId={userId} />}
    {tab === "timeoff" && (canManage ? <TimeOffDecisions restaurantId={restaurantId} setMessage={setMessage} access={access} settings={settings} /> : <TimeOffRequests restaurantId={restaurantId} userId={userId} setMessage={setMessage} />)}
    </>}
  </section>;
}

// ── The week ─────────────────────────────────────────────────────────────────────────────────
// `covering` is the extra step: the shift is for a position other than the one the person was hired for.
type Draft = {id?: string; user_id: string; position: string; day: string; start: string; end: string; note: string; covering?: boolean};
type ViewBy = "name" | "hours" | "position";
// A shift being dragged: where it was grabbed, where the pointer is now, and the cell under it.
type Drag = {shift: Shift; x: number; y: number; dx: number; dy: number; width: number; target: string | null; copy: boolean};
type Press = {shift: Shift; x: number; y: number; dx: number; dy: number; width: number; touch: boolean; timer?: number};

const BLOCK_TEXT = {unavailable: "Unavailable", time_off: "Time off", time_off_pending: "Asked off"} as const;
const cellKey = (userId: string, day: Date) => `${userId}|${dayKey(day)}`;

function WeekView({restaurantId, restaurantName, canManage, setMessage, settings, settingsMissing, onSettings, changes, access}: {restaurantId: string; restaurantName: string; canManage: boolean; setMessage: (text: string) => void; settings: ScheduleSettings; settingsMissing: boolean; onSettings: (settings: ScheduleSettings) => void; changes: ShiftChange[]; access: ScheduleAccess}) {
  // A floor manager builds the floor, a head chef the kitchen; Team access builds everything (048).
  const mayEdit = (position: string) => canManage && canSchedule(position, access, settings);
  const editablePositions = POSITIONS.filter(p => canSchedule(p, access, settings));
  const [start, setStart] = useState(() => weekStart(new Date(), settings.week_start));
  const [editingSettings, setEditingSettings] = useState(false);
  // A new first day of the week moves the grid to the week holding the day it showed.
  useEffect(() => { setStart(current => weekStart(current, settings.week_start)); }, [settings.week_start]);
  const [people, setPeople] = useState<Person[]>([]);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [unavailable, setUnavailable] = useState<Unavailability[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [viewBy, setViewBy] = useState<ViewBy>("name");
  const [query, setQuery] = useState("");
  const [showConflicts, setShowConflicts] = useState(true);
  const [moreOpen, setMoreOpen] = useState(false);
  // Copy week: what the week before holds and what the week after already has, fetched when it opens.
  const [copying, setCopying] = useState<{before: Shift[]; after: Shift[]} | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [phoneDay, setPhoneDay] = useState(-1);
  const viewRef = useRef<HTMLSpanElement | null>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const press = useRef<Press | null>(null);
  const live = useRef<Drag | null>(null);
  const dragged = useRef(false);
  const days = useMemo(() => weekDays(start), [start]);
  const end = useMemo(() => addDays(start, 7), [start]);

  useEffect(() => {
    if (!viewOpen) return;
    const away = (e: Event) => { if (viewRef.current && !viewRef.current.contains(e.target as Node)) setViewOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setViewOpen(false); };
    document.addEventListener("pointerdown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("pointerdown", away); document.removeEventListener("keydown", esc); };
  }, [viewOpen]);

  const load = useCallback(async () => {
    setError("");
    const [team, week, blocks, off] = await Promise.all([
      supabase!.rpc("schedule_team", {rid: restaurantId}),
      supabase!.from("schedule_shifts").select("*").eq("restaurant_id", restaurantId).gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString()).order("starts_at"),
      canManage ? supabase!.from("schedule_unavailability").select("*").eq("restaurant_id", restaurantId) : Promise.resolve({data: [], error: null}),
      canManage ? supabase!.from("time_off_requests").select("*").eq("restaurant_id", restaurantId).neq("status", "denied").lte("starts_on", dayKey(addDays(start, 6))).gte("ends_on", dayKey(start)) : Promise.resolve({data: [], error: null}),
    ]);
    const problem = team.error ?? week.error ?? blocks.error ?? off.error;
    if (problem) { setError(problem.message.includes("schedule") ? "The schedule needs database update 040." : problem.message); setShifts([]); return; }
    setPeople((team.data as Person[]).map(p => ({...p, name: p.name || "Team member"})));
    setShifts(week.data as Shift[]);
    setUnavailable(blocks.data as Unavailability[]);
    setTimeOff(off.data as TimeOff[]);
  }, [restaurantId, start, end, canManage]);
  useEffect(() => { setShifts(null); void load(); }, [load]);

  const hours = useMemo(() => hoursByPerson(shifts ?? []), [shifts]);
  const drafts = (shifts ?? []).filter(s => !s.published && mayEdit(s.position)).length;
  const warningsOf = useMemo(() => {
    const found = new Map<string, Warning[]>();
    if (canManage) for (const shift of shifts ?? []) { const w = allWarnings(shift, shifts ?? [], unavailable, timeOff, settings.overtime_daily); if (w.length) found.set(shift.id, w); }
    return found;
  }, [canManage, shifts, unavailable, timeOff, settings.overtime_daily]);
  // Every position the colour settings should offer: the usual ones, the team's own, and any on a shift.
  const positions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const name of [...POSITIONS, ...people.map(p => p.role), ...(shifts ?? []).map(s => s.position), ...Object.keys(settings.position_colors)]) {
      const clean = name.trim();
      if (clean && !seen.has(clean.toLowerCase())) seen.set(clean.toLowerCase(), clean);
    }
    return [...seen.values()];
  }, [people, shifts, settings.position_colors]);
  const legend = useMemo(() => [...new Map((shifts ?? []).map(s => [s.position.trim().toLowerCase(), s.position.trim()])).values()]
    .map(name => [name, colorFor(name, settings.position_colors)] as const).filter((row): row is readonly [string, string] => !!row[1])
    .sort((a, b) => a[0].localeCompare(b[0])), [shifts, settings.position_colors]);
  // Employees see only who works this week; managers see the whole team, ready to fill in.
  const rows = useMemo(() => {
    const search = query.trim().toLowerCase();
    const list = (canManage ? people : people.filter(p => hours.has(p.user_id))).filter(p => !search || p.name.toLowerCase().includes(search) || p.role.toLowerCase().includes(search));
    const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
    return [...list].sort(viewBy === "hours" ? (a, b) => (hours.get(b.user_id) ?? 0) - (hours.get(a.user_id) ?? 0) || byName(a, b)
      : viewBy === "position" ? (a, b) => a.role.localeCompare(b.role) || byName(a, b) : byName);
  }, [canManage, people, hours, query, viewBy]);

  // A shift is for the position the person was hired for. Covering another one is a step of its own,
  // taken on purpose; it's also where we land when their own position isn't this manager's to schedule.
  const ownPosition = (userId: string) => people.find(p => p.user_id === userId)?.role.trim() ?? "";
  const samePosition = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();
  function forPerson(userId: string): Pick<Draft, "position" | "covering"> {
    const own = ownPosition(userId);
    return own && mayEdit(own) ? {position: own, covering: false} : {position: editablePositions[0] ?? own, covering: true};
  }
  function openNew(person: Person, day: Date) {
    setDraft({user_id: person.user_id, ...forPerson(person.user_id), day: dayKey(day), ...defaultShift(settings), note: ""});
  }
  function openShift(shift: Shift) {
    const from = new Date(shift.starts_at);
    const own = ownPosition(shift.user_id);
    setDraft({id: shift.id, user_id: shift.user_id, position: shift.position, covering: !own || !samePosition(own, shift.position), day: dayKey(from), start: clock(from), end: clock(new Date(shift.ends_at)), note: shift.note});
  }
  async function act(work: () => Promise<void>) {
    setBusy(true); setError("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong. Please try again."); } finally { setBusy(false); }
  }
  const save = (event: FormEvent) => { event.preventDefault(); if (draft) void act(async () => {
    const [y, m, d] = draft.day.split("-").map(Number);
    const {from, to} = shiftTimes(new Date(y, m - 1, d), draft.start, draft.end);
    const row = {restaurant_id: restaurantId, user_id: draft.user_id, position: draft.position, note: draft.note.trim(), starts_at: from.toISOString(), ends_at: to.toISOString()};
    const result = draft.id ? await supabase!.from("schedule_shifts").update(row).eq("id", draft.id) : await supabase!.from("schedule_shifts").insert(row);
    if (result.error) throw new Error(result.error.message.includes("check constraint") ? "A shift can be at most 16 hours." : result.error.message);
    setDraft(null); await load();
  }); };
  const remove = () => { if (draft?.id) void act(async () => {
    const result = await supabase!.from("schedule_shifts").delete().eq("id", draft.id!);
    if (result.error) throw new Error(result.error.message);
    setDraft(null); await load();
  }); };
  // Two ways to reuse a week, both as drafts: bring the week before into the one on screen, or send the
  // one on screen to the week after (and go there). Only shifts this manager may build are copied.
  const weekOf = async (from: Date) => {
    const result = await supabase!.from("schedule_shifts").select("*").eq("restaurant_id", restaurantId).gte("starts_at", from.toISOString()).lt("starts_at", addDays(from, 7).toISOString());
    if (result.error) throw new Error(result.error.message);
    return result.data as Shift[];
  };
  const openCopy = () => void act(async () => {
    setMoreOpen(false);
    const [before, after] = await Promise.all([weekOf(addDays(start, -7)), weekOf(end)]);
    setCopying({before, after});
  });
  const bringLastWeek = copying ? newCopies(copiedWeek(copying.before.filter(s => mayEdit(s.position))), shifts ?? []) : [];
  const sendToNextWeek = copying ? newCopies(copiedWeek((shifts ?? []).filter(s => mayEdit(s.position))), copying.after) : [];
  const copyInto = (rows: ReturnType<typeof copiedWeek>, next: boolean) => void act(async () => {
    if (!rows.length) return;
    const result = await supabase!.from("schedule_shifts").insert(rows);
    if (result.error) throw new Error(result.error.message);
    setCopying(null);
    const count = `${rows.length} ${rows.length === 1 ? "shift" : "shifts"}`;
    if (next) {
      setMessage(`Copied ${count} into ${weekHeading(end)} as drafts. Publish when it's ready.`);
      setStart(end);
    } else {
      setMessage(`Copied ${count} from last week as drafts.`);
      await load();
    }
  });
  const publish = () => void act(async () => {
    const result = await supabase!.rpc("publish_schedule", {rid: restaurantId, from_ts: start.toISOString(), to_ts: end.toISOString()});
    if (result.error) throw new Error(result.error.message);
    const done = result.data as {id: string; shifts: number; people: number};
    if (done.shifts) notify("schedule_published", done.id);
    setMessage(done.shifts ? `Published ${done.shifts} ${done.shifts === 1 ? "shift" : "shifts"}. ${done.people} ${done.people === 1 ? "person was" : "people were"} told.` : "Nothing new to publish.");
    await load();
  });

  // Dropping a shift on another cell moves it there, same hours; holding Alt (Option) or Ctrl copies it.
  // The grid shows the result at once and the database catches up; a refusal puts the week back.
  const drop = (shift: Shift, target: string, copy: boolean) => {
    const [userId, key] = target.split("|");
    const [y, m, d] = key.split("-").map(Number);
    const times = movedShift(shift, new Date(y, m - 1, d));
    if (!copy && userId === shift.user_id && times.starts_at === shift.starts_at) return;
    const name = people.find(p => p.user_id === userId)?.name ?? "Team member";
    setShifts(list => copy ? [...(list ?? []), {...shift, id: `copy-${Date.now()}`, user_id: userId, ...times, published: false}]
      : (list ?? []).map(s => s.id === shift.id ? {...s, user_id: userId, ...times, published: false} : s));
    void act(async () => {
      const result = copy
        ? await supabase!.from("schedule_shifts").insert({restaurant_id: restaurantId, user_id: userId, position: shift.position, note: shift.note, ...times})
        : await supabase!.from("schedule_shifts").update({user_id: userId, ...times}).eq("id", shift.id);
      if (result.error) { await load(); throw new Error(result.error.message.includes("row-level security") ? "That person isn't on this team's schedule." : result.error.message); }
      setMessage(`${copy ? "Copied" : "Moved"} to ${name}, ${dayHeading(new Date(y, m - 1, d))}.`);
      await load();
    });
  };
  const dropRef = useRef(drop);
  dropRef.current = drop;
  const liftRef = useRef(lift);
  liftRef.current = lift;

  function grab(event: ReactPointerEvent<HTMLButtonElement>, shift: Shift) {
    if (!mayEdit(shift.position) || busy || event.button !== 0 || shift.id.startsWith("copy-")) return;
    const box = event.currentTarget.getBoundingClientRect();
    const touch = event.pointerType === "touch";
    press.current = {shift, x: event.clientX, y: event.clientY, dx: event.clientX - box.left, dy: event.clientY - box.top, width: box.width, touch};
    // On a phone a quick swipe scrolls the week; holding a shift for a moment picks it up.
    if (touch) press.current.timer = window.setTimeout(() => { const p = press.current; if (p) lift(p, p.x, p.y, false); }, 350);
  }
  function lift(p: Press, x: number, y: number, copy: boolean) {
    live.current = {shift: p.shift, x, y, dx: p.dx, dy: p.dy, width: p.width, target: cellAt(x, y), copy};
    dragged.current = true;
    setDrag(live.current);
    if (p.touch) navigator.vibrate?.(10);
  }
  useEffect(() => {
    const move = (x: number, y: number, copy: boolean) => {
      const p = press.current;
      if (!p) return;
      if (live.current) { live.current = {...live.current, x, y, copy, target: cellAt(x, y)}; setDrag(live.current); return; }
      if (Math.hypot(x - p.x, y - p.y) < (p.touch ? 10 : 5)) return;
      if (p.touch) { window.clearTimeout(p.timer); press.current = null; return; } // a swipe: the page scrolls
      liftRef.current(p, x, y, copy);
    };
    const finish = (cancel: boolean) => {
      if (press.current) window.clearTimeout(press.current.timer);
      press.current = null;
      const done = live.current;
      live.current = null;
      setDrag(null);
      if (done && !cancel && done.target) dropRef.current(done.shift, done.target, done.copy);
      // The click that follows a drop shouldn't open the shift.
      window.setTimeout(() => { dragged.current = false; }, 0);
    };
    const onPointerMove = (e: PointerEvent) => { if (e.pointerType !== "touch") move(e.clientX, e.clientY, e.altKey || e.ctrlKey || e.metaKey); };
    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (!press.current || !t) return;
      if (live.current) e.preventDefault(); // while a shift is held, the finger moves it instead of the page
      move(t.clientX, t.clientY, false);
    };
    // Copy or move is decided by the keys held at the moment of release, not at the last movement.
    const onUp = (e: PointerEvent | TouchEvent) => {
      if (live.current && e instanceof PointerEvent && e.pointerType !== "touch") live.current = {...live.current, copy: e.altKey || e.ctrlKey || e.metaKey};
      finish(false);
    };
    // A cancelled mouse or pen drag ends here, since no pointerup may follow. A finger holding a shift
    // is the exception: its pointer can be cancelled while the touch goes on, and touchend or touchcancel ends it.
    const onCancel = (e: PointerEvent) => { if (!live.current || e.pointerType !== "touch") finish(true); };
    const onTouchCancel = () => finish(true);
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") finish(true); };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("touchmove", onTouchMove, {passive: false});
    window.addEventListener("pointerup", onUp);
    window.addEventListener("touchend", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchcancel", onTouchCancel);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("touchend", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchcancel", onTouchCancel);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const changing = (shift: Shift) => changes.find(c => isLive(c) && (c.shift_id === shift.id || c.swap_shift_id === shift.id));
  const card = (shift: Shift, warnings: Warning[]) => <>
    <b><Hours shift={shift} /></b>
    {changing(shift) && <small className="sched-change"><ArrowLeftRight size={12} aria-hidden="true" />{changing(shift)!.status === "pending" ? "Change to approve" : "Change asked"}</small>}
    <small>{shift.position}{shift.published ? "" : " · Draft"}</small>
    {warnings.length > 0 && <small className="sched-warn"><AlertTriangle size={12} aria-hidden="true" />{WARNING_TEXT[warnings[0]]}</small>}
  </>;
  // The week on paper: everyone the screen would list (whatever is typed in the search), in the same order.
  const printWeek = async () => {
    const list = (canManage ? people : people.filter(p => hours.has(p.user_id)));
    const byName = (a: Person, b: Person) => a.name.localeCompare(b.name);
    const ordered = [...list].sort(viewBy === "hours" ? (a, b) => (hours.get(b.user_id) ?? 0) - (hours.get(a.user_id) ?? 0) || byName(a, b)
      : viewBy === "position" ? (a, b) => a.role.localeCompare(b.role) || byName(a, b) : byName);
    const week = shifts ?? [];
    return scheduleSheet({
      week: weekHeading(start), start: dayKey(start),
      days: days.map(day => day.toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"}).replace(",", "")),
      rows: ordered.map(person => {
        const mine = hours.get(person.user_id) ?? 0;
        return {
          name: person.name, hours: formatHours(mine), overtime: mine > settings.overtime_weekly,
          days: days.map(day => ({
            shifts: week.filter(s => s.user_id === person.user_id && dayKey(new Date(s.starts_at)) === dayKey(day))
              .map(s => ({time: shiftLabel(s), detail: [s.position, s.note].filter(Boolean).join(" · "), draft: !s.published})),
            notes: canManage ? dayBlocks(person.user_id, day, unavailable, timeOff).map(b => `${BLOCK_TEXT[b.kind]} · ${b.label}`) : [],
          })),
        };
      }),
      totals: days.map(day => { const t = dayTotals(week, day); return {hours: formatHours(t.hours), people: t.people}; }),
      total: formatHours(week.reduce((sum, s) => sum + shiftHours(s), 0)),
      drafts: week.filter(s => !s.published).length,
    }, {restaurant: restaurantName});
  };
  const conflicts = warningsOf.size;
  const total = (shifts ?? []).reduce((sum, s) => sum + shiftHours(s), 0);
  const working = new Set((shifts ?? []).map(s => s.user_id)).size;
  const today = dayKey(new Date());

  return <div>
    <div className="sched-bar">
      <div className="sched-nav">
        <button type="button" className="btn secondary" onClick={() => setStart(weekStart(new Date(), settings.week_start))}>Today</button>
        <div className="sched-range">
          <button type="button" className="sched-icon" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}><ChevronLeft size={17} /></button>
          <CalendarDays size={15} aria-hidden="true" className="muted" />
          <b>{weekHeading(start)}</b>
          <button type="button" className="sched-icon" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}><ChevronRight size={17} /></button>
        </div>
        {shifts && shifts.length > 0 && <DownloadSheet variant="button" buttonLabel="Print" busyLabel="Preparing the schedule" label="Download this week's schedule to print" build={printWeek} />}
      </div>
      {canManage && <div className="sched-actions">
        <div className={`sched-more-items ${moreOpen ? "open" : ""}`}>
        <label className="sched-toggle">
          <input type="checkbox" checked={showConflicts} onChange={e => setShowConflicts(e.target.checked)} />
          <span aria-hidden="true" />
          Show conflicts
          {conflicts > 0 && <em>{conflicts}</em>}
        </label>
        <button type="button" className="btn secondary" disabled={busy} onClick={openCopy}><Copy size={15} />Copy week</button>
        {access.all && <button type="button" className="btn secondary sched-gear" aria-label="Schedule settings" title="Schedule settings" onClick={() => setEditingSettings(true)}><Settings size={17} /></button>}
        </div>
        <button type="button" className="btn" disabled={busy || !drafts} onClick={publish}>{drafts ? `Publish ${drafts} ${drafts === 1 ? "change" : "changes"}` : "Published"}</button>
        <button type="button" className="btn secondary sched-more-btn" aria-expanded={moreOpen} aria-label="More options" onClick={() => setMoreOpen(open => !open)}><span aria-hidden="true">···</span></button>
      </div>}
    </div>
    {error && <p role="alert" className="notice bad mb-4">{error}</p>}
    {canManage && !access.all && <p className="sched-side muted mb-3 text-sm">{access.kitchen && !access.foh ? "You build the kitchen schedule. Front-of-house shifts are shown for reference." : access.foh && !access.kitchen ? "You build the front-of-house schedule. Kitchen shifts are shown for reference." : ""}</p>}
    {!shifts ? <p className="muted" role="status">Loading the schedule…</p>
      : !people.length || (!canManage && !rows.length && !query) ? <p className="panel p-5 muted">{canManage ? "Nobody on the team yet. Invite your team from Team." : "Nothing published for this week yet."}</p>
      : <>
        <div className="sched-find">
          <span className="sched-search"><input type="search" aria-label="Search the team" placeholder="Search the team" value={query} onChange={e => setQuery(e.target.value)} /></span>
          <span className="sched-viewby" ref={viewRef}>
            <button type="button" className={`sched-viewby-btn ${viewOpen ? "open" : ""}`} aria-haspopup="menu" aria-expanded={viewOpen} onClick={() => setViewOpen(o => !o)}>
              <SlidersHorizontal size={14} aria-hidden="true" />
              <span>{viewBy === "name" ? "First name" : viewBy === "hours" ? "Most hours" : "Position"}</span>
              <ChevronDown size={14} aria-hidden="true" />
            </button>
            {viewOpen && <div className="sched-viewby-menu" role="menu" aria-label="View by">
              <span className="sched-viewby-title">View by</span>
              {([["name", "First name"], ["hours", "Most hours"], ["position", "Position"]] as const).map(([key, label]) => <button key={key} type="button" role="menuitemradio" aria-checked={viewBy === key} className={viewBy === key ? "on" : ""} onClick={() => { setViewBy(key); setViewOpen(false); }}>{label}{viewBy === key && <Check size={14} aria-hidden="true" />}</button>)}
            </div>}
          </span>
        </div>
        <div className={`sched-scroll ${drag ? "dragging" : ""}`}>
        <table className="sched-grid">
          <thead><tr>
            <th scope="col"><span className="sched-corner">Team</span></th>
            {days.map(day => <th key={day.toISOString()} scope="col" aria-label={dayHeading(day)}>
              <span className={`sched-day ${dayKey(day) === today ? "today" : ""}`}><span>{day.toLocaleDateString("en-US", {weekday: "short"})}</span> <b>{day.getDate()}</b></span>
            </th>)}
          </tr></thead>
          <tbody>{rows.length ? rows.map(person => {
            const mine = hours.get(person.user_id) ?? 0;
            return <tr key={person.user_id}>
              <th scope="row">
                <span className="sched-person">
                  <span className="sched-avatar" aria-hidden="true">{initials(person.name)}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{person.name}</span>
                    <span className={`sched-hours ${mine > settings.overtime_weekly ? "over" : ""}`}>{formatHours(mine)}{mine > settings.overtime_weekly ? " · Overtime" : ""}</span>
                  </span>
                </span>
              </th>
              {days.map(day => {
                const key = cellKey(person.user_id, day);
                const theirs = (shifts ?? []).filter(s => s.user_id === person.user_id && dayKey(new Date(s.starts_at)) === dayKey(day));
                const blocks = canManage ? dayBlocks(person.user_id, day, unavailable, timeOff) : [];
                return <td key={key} data-cell={key} className={drag?.target === key ? "drop" : ""}>
                  {blocks.map((block, i) => <span key={i} className={`sched-block ${block.kind}`}><b>{BLOCK_TEXT[block.kind]}</b><small>{block.label}</small></span>)}
                  {theirs.map(shift => {
                    const warnings = showConflicts ? warningsOf.get(shift.id) ?? [] : [];
                    return <button key={shift.id} type="button" disabled={!mayEdit(shift.position)}
                      onPointerDown={e => grab(e, shift)} onContextMenu={e => { if (canManage) e.preventDefault(); }}
                      onClick={() => { if (!dragged.current && !shift.id.startsWith("copy-")) openShift(shift); }}
                      className={`sched-shift ${paint(shift.position, settings)} ${shift.published ? "" : "draft"} ${warnings.length ? "warn" : ""} ${drag?.shift.id === shift.id && !drag.copy ? "lifting" : ""}`}
                      title={warnings.map(w => WARNING_TEXT[w]).join(" · ") || undefined}>
                      {card(shift, warnings)}
                    </button>;
                  })}
                  {canManage && <button type="button" className={`sched-add ${theirs.length || blocks.length ? "" : "empty"}`} aria-label={`Add a shift for ${person.name} on ${dayHeading(day)}`} onClick={() => openNew(person, day)}><Plus size={14} /></button>}
                </td>;
              })}
            </tr>;
          }) : <tr><td colSpan={8} className="muted">Nobody matches that search.</td></tr>}</tbody>
          <tfoot><tr>
            <th scope="row">
              <span className="sched-foot-label"><span>Hours</span><b>{formatHours(total)}</b></span>
              <span className="sched-foot-label"><span>People</span><b>{working}</b></span>
            </th>
            {days.map(day => { const t = dayTotals(shifts ?? [], day); return <td key={day.toISOString()}>
              <span className="sched-foot"><Users size={13} aria-hidden="true" />{t.people}</span>
              <span className="sched-foot">{formatHours(t.hours)}</span>
            </td>; })}
          </tr></tfoot>
        </table>
      </div>
      <div className="sched-daylist">
        {(() => {
          const pick = phoneDay >= 0 ? phoneDay : Math.max(0, days.findIndex(d => dayKey(d) === today));
          const dayList = rows.flatMap(person => (shifts ?? []).filter(s => s.user_id === person.user_id && dayKey(new Date(s.starts_at)) === dayKey(days[pick])).map(shift => ({person, shift})));
          return <>
            <div className="sched-daypick" role="group" aria-label="Day">{days.map((day, i) => <button key={day.toISOString()} type="button" aria-pressed={i === pick} className={dayKey(day) === today ? "today" : ""} onClick={() => setPhoneDay(i)}><span>{day.toLocaleDateString("en-US", {weekday: "short"})}</span><b>{day.getDate()}</b></button>)}</div>
            <p className="sched-dayhead"><b>{dayHeading(days[pick])}</b></p>
            {dayList.length ? dayList.map(({person, shift}) => {
              const warnings = showConflicts ? warningsOf.get(shift.id) ?? [] : [];
              return <button key={shift.id} type="button" disabled={!mayEdit(shift.position)} onClick={() => { if (!shift.id.startsWith("copy-")) openShift(shift); }} className={`sched-dayrow ${paint(shift.position, settings)} ${shift.published ? "" : "draft"}`}>
                <span className="sched-avatar" aria-hidden="true">{initials(person.name)}</span>
                <span className="sched-dayname">{person.name}</span>
                <span className="sched-daycard">{card(shift, warnings)}</span>
              </button>;
            }) : <p className="muted text-sm">No shifts this day.</p>}
            {canManage && (() => {
              const away = rows.flatMap(person => dayBlocks(person.user_id, days[pick], unavailable, timeOff).map(block => ({person, block})));
              return away.length > 0 && <div className="sched-dayaway"><p className="eyebrow muted">Away</p>{away.map(({person, block}, i) => <p key={i} className="text-sm"><b>{person.name}</b><span className="muted">{` · ${BLOCK_TEXT[block.kind]}`}</span></p>)}</div>;
            })()}
            {canManage && <div className="sched-dayadd">
              <p className="eyebrow muted">Add a shift for</p>
              <div className="category-tabs">{rows.map(person => <button key={person.user_id} type="button" onClick={() => openNew(person, days[pick])}>{person.name}</button>)}</div>
            </div>}
          </>;
        })()}
      </div>
      </>}
    {canManage && shifts && shifts.length > 0 && <p className="muted mt-3 text-xs sched-dragnote">{"Drag a shift to move it to another day or person. Hold Alt (Option on a Mac) as you drop to copy it instead; on a phone, hold the shift for a moment to pick it up."}</p>}
    {canManage && shifts && shifts.length > 0 && <p className="muted mt-1 text-xs">{`Dashed shifts are drafts: the team sees them once you publish. Total this week: ${formatHours(total)}.`}</p>}

    {drag && <div className={`sched-shift sched-ghost ${paint(drag.shift.position, settings)} ${drag.shift.published && !drag.copy ? "" : "draft"}`} aria-hidden="true"
      style={{left: drag.x - drag.dx, top: drag.y - drag.dy, width: drag.width}}>
      {card(drag.shift, [])}
      {drag.copy && <em>Copy</em>}
    </div>}

    {copying && <div className="sched-sheet" role="dialog" aria-modal="true" aria-labelledby="copy-title">
      <div className="panel sched-form">
        <div className="mb-3 flex items-center">
          <h2 id="copy-title" className="text-lg font-semibold">Copy a week</h2>
          <button type="button" className="ml-auto muted" aria-label="Close" onClick={() => setCopying(null)}><X size={18} /></button>
        </div>
        <p className="muted mb-4 text-sm">Copies come in as drafts. Nobody sees them until you publish.</p>
        <div className="sched-copy-options">
          <button type="button" className="sched-copy-option" disabled={busy || !bringLastWeek.length} onClick={() => copyInto(bringLastWeek, false)}>
            <b>Bring last week here</b>
            <small>{weekHeading(addDays(start, -7))}</small>
            <span>{bringLastWeek.length ? `${bringLastWeek.length} ${bringLastWeek.length === 1 ? "shift" : "shifts"} into this week` : "Nothing new to bring"}</span>
          </button>
          <button type="button" className="sched-copy-option" disabled={busy || !sendToNextWeek.length} onClick={() => copyInto(sendToNextWeek, true)}>
            <b>Copy this week to next week</b>
            <small>{weekHeading(end)}</small>
            <span>{sendToNextWeek.length ? `${sendToNextWeek.length} ${sendToNextWeek.length === 1 ? "shift" : "shifts"} into next week` : "Nothing new to copy"}</span>
          </button>
        </div>
      </div>
    </div>}

    {draft && <div className="sched-sheet" role="dialog" aria-modal="true" aria-labelledby="shift-title">
      <form className="panel sched-form" onSubmit={save}>
        <div className="mb-3 flex items-center">
          <h2 id="shift-title" className="text-lg font-semibold">{draft.id ? "Edit shift" : "New shift"}</h2>
          <button type="button" className="ml-auto muted" aria-label="Close" onClick={() => setDraft(null)}><X size={18} /></button>
        </div>
        <fieldset disabled={busy}>
          <Field label="Who"><select id="shift-who" value={draft.user_id} onChange={e => setDraft({...draft, user_id: e.target.value, ...(draft.covering ? {} : forPerson(e.target.value))})}>{people.map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select></Field>
          {(() => {
            const own = ownPosition(draft.user_id);
            const canOwn = !!own && mayEdit(own);
            if (!draft.covering) return <div className="field" role="group" aria-labelledby="shift-own-label">
              <label id="shift-own-label">Position</label>
              <div className="sched-own-row"><b>{draft.position}</b><span className="muted text-xs">Their position</span>
                <button type="button" className="btn secondary ml-auto" onClick={() => setDraft({...draft, covering: true, position: editablePositions.find(p => !samePosition(p, draft.position)) ?? draft.position})}>Cover another position</button></div>
            </div>;
            return <>
              <Field label="Covering another position"><select id="shift-position" value={draft.position} onChange={e => setDraft({...draft, position: e.target.value})}>{(editablePositions.includes(draft.position) ? editablePositions : [draft.position, ...editablePositions]).map(p => <option key={p}>{p}</option>)}</select></Field>
              <p className="muted -mt-2 mb-4 text-xs">{own ? `Hired as ${own}.` : "No position on their profile yet. Set it in Team."}{canOwn && <> <button type="button" className="underline underline-offset-4" onClick={() => setDraft({...draft, covering: false, position: own})}>Back to their position</button></>}</p>
            </>;
          })()}
          <Field label="Day"><input id="shift-day" type="date" required value={draft.day} onChange={e => setDraft({...draft, day: e.target.value})} /></Field>
          {settings.shift_presets.length > 0 && <div className="sched-presets" role="group" aria-label="Quick shifts">{settings.shift_presets.map(preset =>
            <button key={preset.name} type="button" className="word-chip" aria-pressed={draft.start === preset.start && draft.end === preset.end} onClick={() => setDraft({...draft, start: preset.start, end: preset.end})}>{preset.name}<small>{presetLabel(preset)}</small></button>)}</div>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts"><input id="shift-start" type="time" required step={900} value={draft.start} onChange={e => setDraft({...draft, start: e.target.value})} /></Field>
            <Field label="Ends"><input id="shift-end" type="time" required step={900} value={draft.end} onChange={e => setDraft({...draft, end: e.target.value})} /></Field>
          </div>
          <Field label="Note (optional)"><input id="shift-note" maxLength={300} value={draft.note} placeholder="e.g. Patio, private party" onChange={e => setDraft({...draft, note: e.target.value})} /></Field>
          {(() => {
            const [y, m, d] = draft.day.split("-").map(Number);
            const {from, to} = draft.day && draft.start && draft.end ? shiftTimes(new Date(y, m - 1, d), draft.start, draft.end) : {from: null, to: null};
            const length = from && to ? Math.round((to.getTime() - from.getTime()) / 36e5 * 100) / 100 : 0;
            const overnight = !!from && !!to && to.getDate() !== from.getDate();
            return <>
              {length > 16
                ? <p role="alert" className="notice bad mb-4 text-xs">{`That's ${length} hours${overnight ? ", ending the next day" : ""}. Check AM and PM: a shift can be at most 16 hours.`}</p>
                : <p className="muted mb-4 text-xs">{length ? `${length} ${length === 1 ? "hour" : "hours"}${overnight ? ", ending the next day" : ""}.` : "An end time before the start means the shift closes after midnight."}</p>}
              <div className="flex flex-wrap gap-2">
                <button className="btn" disabled={length > 16}>{draft.id ? "Save changes" : "Add shift"}</button>
                {draft.id && <button type="button" className="btn secondary" onClick={remove}>Delete shift</button>}
              </div>
            </>;
          })()}
        </fieldset>
      </form>
    </div>}
    {editingSettings && access.all && <SettingsSheet restaurantId={restaurantId} settings={settings} positions={positions} missing={settingsMissing}
      onClose={() => setEditingSettings(false)} onSaved={saved => {onSettings(saved);setEditingSettings(false);setMessage("Schedule settings saved.");}} />}
  </div>;
}

// ── The gear: this restaurant's schedule settings ───────────────────────────────────────────────
const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0];
function SettingsSheet({restaurantId, settings, positions, missing, onClose, onSaved}: {restaurantId: string; settings: ScheduleSettings; positions: string[]; missing: boolean; onClose: () => void; onSaved: (settings: ScheduleSettings) => void}) {
  const [form, setForm] = useState<ScheduleSettings>(settings);
  const [daily, setDaily] = useState(settings.overtime_daily !== null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(missing ? "Schedule settings need database update 044." : "");
  const setColor = (position: string, color: string | null) => setForm(current => {
    const colors = Object.fromEntries(Object.entries(current.position_colors).filter(([name]) => name.toLowerCase() !== position.toLowerCase()));
    return {...current, position_colors: color ? {...colors, [position]: color} : colors};
  });
  const setPreset = (index: number, change: Partial<ShiftPreset>) => setForm(current => ({...current, shift_presets: current.shift_presets.map((p, i) => i === index ? {...p, ...change} : p)}));
  async function save(event: FormEvent) {
    event.preventDefault();
    const presets = form.shift_presets.map(p => ({...p, name: p.name.trim()})).filter(p => p.name);
    if (new Set(presets.map(p => p.name.toLowerCase())).size !== presets.length) return setError("Give each quick shift a different name.");
    const row = {
      restaurant_id: restaurantId, week_start: form.week_start, position_colors: form.position_colors,
      overtime_weekly: form.overtime_weekly, overtime_daily: daily ? form.overtime_daily ?? 8 : null,
      shift_presets: presets, team_sees_all: form.team_sees_all, change_cutoff_hours: form.change_cutoff_hours,
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone || null,
      kitchen_positions: form.kitchen_positions,
    };
    setBusy(true); setError("");
    const result = await supabase!.from("schedule_settings").upsert(row);
    setBusy(false);
    if (result.error) return setError(/schedule_settings|PGRST205|42P01/.test(result.error.message) ? "Schedule settings need database update 044." : result.error.message);
    onSaved(readSettings(row));
  }
  return <div className="sched-sheet" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <form className="panel sched-form sched-settings" onSubmit={save}>
      <div className="mb-3 flex items-center">
        <h2 id="settings-title" className="text-lg font-semibold">Schedule settings</h2>
        <button type="button" className="ml-auto muted" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      <fieldset disabled={busy}>
        <Field label="The week starts on"><select id="settings-week" value={form.week_start} onChange={e => setForm({...form, week_start: Number(e.target.value)})}>
          {WEEK_ORDER.map(d => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}
        </select></Field>
        <p className="muted -mt-2 mb-5 text-xs">{`Weeks run ${WEEKDAYS[form.week_start]} to ${WEEKDAYS[(form.week_start + 6) % 7]}: the grid, Copy last week, publishing and weekly overtime all follow it.`}</p>

        <fieldset className="mb-5">
          <legend className="mb-1 flex w-full items-center text-sm font-semibold">Position colours
            <button type="button" className="ml-auto text-xs underline" onClick={() => setForm({...form, position_colors: Object.fromEntries(positions.map(name => [name, colorFor(name, form.position_colors) ?? colorFor(name, SUGGESTED_COLORS)]).filter(([, c]) => c))})}>Use suggested colours</button>
          </legend>
          <p className="muted mb-2 text-xs">A shift takes the colour of its position, so someone who bartends on Friday shows red that day.</p>
          {positions.map(name => { const current = colorFor(name, form.position_colors); return <div key={name} className="set-row">
            <b>{name}</b>
            <span className="set-swatches" role="radiogroup" aria-label={`Colour for ${name}`}>
              <button type="button" role="radio" aria-checked={!current} className="swatch none" title="No colour" aria-label="No colour" onClick={() => setColor(name, null)} />
              {Object.entries(PALETTE).map(([key, label]) => <button key={key} type="button" role="radio" aria-checked={current === key} className={`swatch pos-${key}`} title={label} aria-label={label} onClick={() => setColor(name, key)} />)}
            </span>
          </div>; })}
        </fieldset>

        <fieldset className="mb-5">
          <legend className="mb-1 block text-sm font-semibold">Kitchen positions</legend>
          <p className="muted mb-2 text-xs">The head chef or sous chef builds these (Schedule: kitchen); everything else is front of house (Schedule: front of house). Team access builds both.</p>
          <div className="word-chips">{positions.map(name => { const on = isKitchen(name, form); return <button key={name} type="button" className="word-chip" aria-pressed={on}
            onClick={() => { const list = form.kitchen_positions ?? KITCHEN_POSITIONS; setForm({...form, kitchen_positions: on ? list.filter(k => k.trim().toLowerCase() !== name.trim().toLowerCase()) : [...list, name]}); }}>{name}</button>; })}</div>
        </fieldset>

        <fieldset className="mb-5">
          <legend className="mb-2 block text-sm font-semibold">Overtime</legend>
          <div className="set-inline"><span>After</span><input id="settings-weekly" aria-label="Weekly overtime hours" type="number" min={1} max={100} step={0.5} required value={form.overtime_weekly} onChange={e => setForm({...form, overtime_weekly: Number(e.target.value)})} /><span>hours a week</span></div>
          <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" checked={daily} onChange={e => {setDaily(e.target.checked);if (e.target.checked && form.overtime_daily === null) setForm({...form, overtime_daily: 8});}} />Also count overtime by the day</label>
          {daily && <div className="set-inline mt-2"><span>After</span><input id="settings-daily" aria-label="Daily overtime hours" type="number" min={1} max={24} step={0.5} required value={form.overtime_daily ?? 8} onChange={e => setForm({...form, overtime_daily: Number(e.target.value)})} /><span>hours in a day</span></div>}
        </fieldset>

        <fieldset className="mb-5">
          <legend className="mb-1 block text-sm font-semibold">Quick shifts</legend>
          <p className="muted mb-2 text-xs">Offered when you add a shift. The first one is what a new shift starts with.</p>
          {form.shift_presets.map((preset, i) => <div key={i} className="set-preset">
            <input aria-label="Quick shift name" maxLength={30} placeholder="Dinner" value={preset.name} onChange={e => setPreset(i, {name: e.target.value})} />
            <input aria-label="Starts" type="time" step={900} required value={preset.start} onChange={e => setPreset(i, {start: e.target.value})} />
            <input aria-label="Ends" type="time" step={900} required value={preset.end} onChange={e => setPreset(i, {end: e.target.value})} />
            <button type="button" className="muted" aria-label={`Remove quick shift ${preset.name}`.trim()} onClick={() => setForm({...form, shift_presets: form.shift_presets.filter((_, j) => j !== i)})}><X size={16} /></button>
          </div>)}
          {form.shift_presets.length < 12 && <button type="button" className="btn secondary mt-1" onClick={() => setForm({...form, shift_presets: [...form.shift_presets, {name: "", start: "17:00", end: "23:00"}]})}><Plus size={15} />Add a quick shift</button>}
        </fieldset>

        <fieldset className="mb-5">
          <legend className="mb-2 block text-sm font-semibold">Shift changes</legend>
          <div className="set-inline"><span>Close</span><input id="settings-cutoff" aria-label="Hours before the shift" type="number" min={0} max={336} step={1} required value={form.change_cutoff_hours} onChange={e => setForm({...form, change_cutoff_hours: Math.max(0, Math.round(Number(e.target.value)))})} /><span>hours before the shift</span></div>
          <p className="muted mt-2 text-xs">Releasing, offering and swapping stop then; after that it's a conversation with the manager. 0 keeps them open until the shift starts. A manager always approves, and a released shift only goes to someone in the same position.</p>
        </fieldset>

        <fieldset className="mb-5">
          <legend className="mb-2 block text-sm font-semibold">What the team sees</legend>
          <label className="flex items-center gap-2 text-sm"><input type="radio" name="team-sees" checked={form.team_sees_all} onChange={() => setForm({...form, team_sees_all: true})} />Everyone's published shifts</label>
          <label className="mt-1 flex items-center gap-2 text-sm"><input type="radio" name="team-sees" checked={!form.team_sees_all} onChange={() => setForm({...form, team_sees_all: false})} />Only their own shifts</label>
        </fieldset>

        {error && <p role="alert" className="verdict-bad mb-3 text-sm">{error}</p>}
        <div className="flex flex-wrap gap-2">
          <button className="btn">Save settings</button>
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
        </div>
      </fieldset>
    </form>
  </div>;
}

// "4:30p–10:30p" in a narrow day: the end time drops to the next line instead of being cut off.
function Hours({shift}: {shift: Pick<Shift, "starts_at" | "ends_at">}) {
  const [from, to] = shiftLabel(shift).split("–");
  return <>{from}–<wbr />{to}</>;
}

// The cell under the pointer while dragging: the ghost card ignores the pointer, so this finds the grid.
function cellAt(x: number, y: number) {
  return (document.elementFromPoint(x, y)?.closest("[data-cell]") as HTMLElement | null)?.dataset.cell ?? null;
}

// ── My shifts, and changing them ────────────────────────────────────────────────────────────────
const KIND_TEXT = {release: "Released", offer: "Offered", swap: "Swap"} as const;
const STATUS_WORDS = {
  open: "Waiting for someone in the same area", asked: "Waiting for their answer", pending: "Waiting for the manager",
  approved: "Approved", denied: "Not approved", declined: "They said no", cancelled: "Cancelled",
} as const;

// One change, the same way everywhere: what, when, who, and where it stands.
function ChangeCard({change, children}: {change: ShiftChange; children?: React.ReactNode}) {
  return <li className={`panel sched-change-card ${change.status}`}>
    <span className="min-w-0 flex-1">
      <span className="flex flex-wrap items-center gap-2">
        <b>{KIND_TEXT[change.kind]}</b>
        <span className="sched-change-status">{STATUS_WORDS[change.status]}</span>
        {change.other_area && <span className="sched-change-status other">Other area</span>}
      </span>
      <span className="mt-1 block text-sm">{`${when(change.shift_starts, change.shift_ends)} · ${change.shift_position}`}</span>
      {change.kind === "swap" && change.swap_starts && change.swap_ends && <span className="block text-sm"><ArrowLeftRight size={12} aria-hidden="true" className="mr-1 inline" />{`${when(change.swap_starts, change.swap_ends)} · ${change.swap_position}`}</span>}
      <small className="muted mt-1 block">{`Asked by ${change.requester_name || "Team member"}`}{change.taker_id ? ` · ${change.kind === "swap" ? `Swaps with ${change.taker_name || "Team member"}` : `Covering: ${change.taker_name || "Team member"}`}` : ""}</small>
      {change.note && <small className="muted block">{`“${change.note}”`}</small>}
      {isLive(change) && change.taker_overtime && change.taker_name !== undefined && <small className="sched-overtime"><AlertTriangle size={12} aria-hidden="true" />{`If approved, ${change.taker_name || "they"} will have ${formatHours(Number(change.taker_hours))} that week: overtime`}</small>}
      {isLive(change) && change.requester_overtime && <small className="sched-overtime"><AlertTriangle size={12} aria-hidden="true" />{`If approved, ${change.requester_name || "they"} will have ${formatHours(Number(change.requester_hours))} that week: overtime`}</small>}
    </span>
    {children && <span className="flex shrink-0 flex-wrap gap-2">{children}</span>}
  </li>;
}

function MyShifts({restaurantId, userId, settings, changes, reloadChanges, setMessage}: {restaurantId: string; userId: string; settings: ScheduleSettings; changes: ShiftChange[]; reloadChanges: () => Promise<void>; setMessage: (text: string) => void}) {
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [changingShift, setChangingShift] = useState<Shift | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const loadShifts = useCallback(async () => {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const {data} = await supabase!.from("schedule_shifts").select("*").eq("restaurant_id", restaurantId).eq("user_id", userId).eq("published", true)
      .gte("starts_at", from.toISOString()).lt("starts_at", addDays(from, 28).toISOString()).order("starts_at");
    setShifts((data ?? []) as Shift[]);
  }, [restaurantId, userId]);
  useEffect(() => { void loadShifts(); }, [loadShifts]);
  async function act(id: string, call: PromiseLike<{error: {message: string} | null}>, done: string, event?: PushEvent) {
    setBusy(id); setError("");
    const {error} = await call;
    setBusy("");
    if (error) return setError(changeError(error.message));
    if (event) notify(event, id);
    setMessage(done);
    await Promise.all([reloadChanges(), loadShifts()]);
  }

  const forMe = changes.filter(c => c.status === "asked" && c.taker_id === userId);
  const upForGrabs = changes.filter(c => c.status === "open" && c.requested_by !== userId);
  const mine = changes.filter(c => c.requested_by === userId || (c.taker_id === userId && c.status !== "asked"));
  const liveOn = (shift: Shift) => changes.find(c => isLive(c) && (c.shift_id === shift.id || c.swap_shift_id === shift.id));
  if (!shifts) return <p className="muted" role="status">Loading your shifts…</p>;
  const thisWeek = shifts.filter(s => weekStart(new Date(s.starts_at), settings.week_start).getTime() === weekStart(new Date(), settings.week_start).getTime());

  return <div>
    {error && <p role="alert" className="notice bad mb-4">{error}</p>}
    {forMe.length > 0 && <section className="mb-6">
      <p className="eyebrow muted mb-2">Waiting for you</p>
      <ul className="space-y-2">{forMe.map(c => <ChangeCard key={c.id} change={c}>
        <button type="button" className="btn" disabled={!!busy} onClick={() => void act(c.id, supabase!.rpc("answer_shift_change", {change: c.id, accept: true}), "Done. Your manager approves it next.", "shift_change_pending")}>{c.kind === "swap" ? "Swap" : "I'll cover it"}</button>
        <button type="button" className="btn secondary" disabled={!!busy} onClick={() => void act(c.id, supabase!.rpc("answer_shift_change", {change: c.id, accept: false}), "You said no.", "shift_change_declined")}>No</button>
      </ChangeCard>)}</ul>
    </section>}
    {upForGrabs.length > 0 && <section className="mb-6">
      <p className="eyebrow muted mb-2">Up for grabs in your area</p>
      <ul className="space-y-2">{upForGrabs.map(c => <ChangeCard key={c.id} change={c}>
        <button type="button" className="btn" disabled={!!busy} onClick={() => void act(c.id, supabase!.rpc("take_released_shift", {change: c.id}), "It's yours once your manager approves.", "shift_change_pending")}>Take it</button>
      </ChangeCard>)}</ul>
    </section>}
    {mine.length > 0 && <section className="mb-6">
      <p className="eyebrow muted mb-2">Your changes</p>
      <ul className="space-y-2">{mine.map(c => <ChangeCard key={c.id} change={c}>
        {c.requested_by === userId && isLive(c) && <button type="button" className="btn secondary" disabled={!!busy} onClick={() => void act(c.id, supabase!.rpc("cancel_shift_change", {change: c.id}), "Request cancelled. The shift is still yours.")}>Cancel</button>}
      </ChangeCard>)}</ul>
    </section>}

    {!shifts.length ? <p className="panel p-5 muted">No shifts in the next four weeks yet. Your manager publishes the schedule here.</p> : <>
      <p className="muted mb-3 text-sm">{`This week: ${formatHours(thisWeek.reduce((sum, s) => sum + shiftHours(s), 0))}`}</p>
      <ul className="space-y-2">{shifts.map(shift => {
        const live = liveOn(shift);
        const open = changeWindowOpen(shift.starts_at, settings.change_cutoff_hours);
        return <li key={shift.id} className="panel sched-mine">
          <span className="sched-date">{dayHeading(new Date(shift.starts_at))}</span>
          <span className="min-w-0 flex-1">
            <b className="block">{shiftLabel(shift)}</b>
            <small className="muted">{shift.position}{shift.note ? ` · ${shift.note}` : ""}</small>
            {live && <small className="sched-change block"><ArrowLeftRight size={12} aria-hidden="true" />{STATUS_WORDS[live.status]}</small>}
          </span>
          <span className="flex flex-col items-end gap-1">
            <span className="muted text-xs">{formatHours(shiftHours(shift))}</span>
            {!live && (open
              ? <button type="button" className="btn secondary sched-cant" onClick={() => setChangingShift(shift)}>Can't make it?</button>
              : Date.parse(shift.starts_at) > Date.now() && <small className="muted text-xs">Too close to change here</small>)}
          </span>
        </li>;
      })}</ul>
    </>}

    {changingShift && <ChangeSheet shift={changingShift} onClose={() => setChangingShift(null)} onDone={async (message, id, event) => {
      setChangingShift(null); notify(event, id); setMessage(message); await Promise.all([reloadChanges(), loadShifts()]);
    }} />}
  </div>;
}

type Person2 = {user_id: string; name: string; role: string; same_area: boolean; busy: boolean; hours?: number | string; overtime?: boolean};
type SwapChoice = {shift_id: string; user_id: string; name: string; role: string; shift_position: string; starts_at: string; ends_at: string; same_area: boolean; hours?: number | string; overtime?: boolean};
// "· 42h that week · Overtime": what taking the shift does to someone's week, when the database says.
const weekNote = (hours?: number | string, overtime?: boolean) => hours === undefined || hours === null ? "" : ` · ${formatHours(Number(hours))} that week${overtime ? " · Overtime" : ""}`;

// "Can't make it?": release to the area, give it to someone, or swap. Same area first; the rest of
// the team appears only when asked for, and the manager sees that it crosses areas.
function ChangeSheet({shift, onClose, onDone}: {shift: Shift; onClose: () => void; onDone: (message: string, id: string, event: PushEvent) => Promise<void>}) {
  const [kind, setKind] = useState<"offer" | "swap" | "release">("offer");
  const [people, setPeople] = useState<Person2[] | null>(null);
  const [choices, setChoices] = useState<SwapChoice[] | null>(null);
  const [others, setOthers] = useState(false);
  const [pick, setPick] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    void Promise.all([
      supabase!.rpc("shift_change_people", {shift: shift.id}),
      supabase!.rpc("shift_swap_choices", {shift: shift.id}),
    ]).then(([who, swaps]) => {
      if (who.error) setError(changeError(who.error.message));
      setPeople((who.data ?? []) as Person2[]);
      setChoices((swaps.data ?? []) as SwapChoice[]);
    });
  }, [shift.id]);
  const visiblePeople = (people ?? []).filter(p => others || p.same_area);
  const visibleChoices = (choices ?? []).filter(c => others || c.same_area);
  const hiddenCount = kind === "offer" ? (people ?? []).filter(p => !p.same_area).length : kind === "swap" ? (choices ?? []).filter(c => !c.same_area).length : 0;
  async function send(event: FormEvent) {
    event.preventDefault();
    if (kind !== "release" && !pick) return setError(kind === "offer" ? "Choose who covers it." : "Choose the shift to swap for.");
    setBusy(true); setError("");
    const result = kind === "release" ? await supabase!.rpc("release_shift", {shift: shift.id, note})
      : kind === "offer" ? await supabase!.rpc("offer_shift", {shift: shift.id, to_user: pick, note})
      : await supabase!.rpc("swap_shift", {shift: shift.id, their_shift: pick, note});
    setBusy(false);
    if (result.error) return setError(changeError(result.error.message));
    await onDone(kind === "release" ? "Released. Someone in your area can take it; your manager approves." : "Sent. They answer, then your manager approves.",
      result.data as string, kind === "release" ? "shift_released" : "shift_offered");
  }
  return <div className="sched-sheet" role="dialog" aria-modal="true" aria-labelledby="change-title">
    <form className="panel sched-form" onSubmit={send}>
      <div className="mb-1 flex items-center">
        <h2 id="change-title" className="text-lg font-semibold">Can't make it?</h2>
        <button type="button" className="ml-auto muted" aria-label="Close" onClick={onClose}><X size={18} /></button>
      </div>
      <p className="muted mb-4 text-sm">{`${dayHeading(new Date(shift.starts_at))} · ${shiftLabel(shift)} · ${shift.position}`}</p>
      <fieldset disabled={busy}>
        <div className="library-switch mb-4" role="group" aria-label="What to do">
          {([["offer", "Someone covers"], ["swap", "Swap"], ["release", "Release"]] as const).map(([key, label]) =>
            <button key={key} type="button" aria-pressed={kind === key} onClick={() => {setKind(key);setPick("");setError("");}}>{label}</button>)}
        </div>
        {kind === "release" && <p className="mb-4 text-sm">{`Anyone working as ${shift.position} can take it. It stays yours until someone does and your manager approves.`}</p>}
        {kind !== "release" && (!people || !choices ? <p className="muted mb-4" role="status">Loading your team…</p> : <>
          <ul className="sched-pick mb-2" role="radiogroup" aria-label={kind === "offer" ? "Who covers it" : "Which shift you take instead"}>
            {kind === "offer" && visiblePeople.map(p => <li key={p.user_id}>
              <label className={`${p.busy ? "muted" : ""} ${p.overtime ? "overtime" : ""}`}><input type="radio" name="pick" value={p.user_id} disabled={p.busy} checked={pick === p.user_id} onChange={() => setPick(p.user_id)} />
                <span className="min-w-0 flex-1"><b className="block">{p.name}</b><small className="muted">{p.role}{p.busy ? " · Working then" : weekNote(p.hours, p.overtime)}{!p.same_area ? " · Other area" : ""}</small></span></label>
            </li>)}
            {kind === "swap" && visibleChoices.map(c => <li key={c.shift_id}>
              <label className={c.overtime ? "overtime" : ""}><input type="radio" name="pick" value={c.shift_id} checked={pick === c.shift_id} onChange={() => setPick(c.shift_id)} />
                <span className="min-w-0 flex-1"><b className="block">{c.name}</b><small className="muted">{`${when(c.starts_at, c.ends_at)} · ${c.shift_position}`}{weekNote(c.hours, c.overtime)}{!c.same_area ? " · Other area" : ""}</small></span></label>
            </li>)}
            {(kind === "offer" ? visiblePeople : visibleChoices).length === 0 && <li className="muted text-sm">{kind === "offer" ? "Nobody else in your area yet." : "No shifts in your area to swap for in the next four weeks."}</li>}
          </ul>
          {!others && hiddenCount > 0 && <button type="button" className="mb-4 text-sm underline" onClick={() => setOthers(true)}>Someone from another area will cover?</button>}
          {others && <p className="muted mb-4 text-xs">Someone from another area is marked for your manager, who decides.</p>}
          {(kind === "offer" ? visiblePeople : visibleChoices).some(p => p.overtime) && <p className="muted mb-4 text-xs">People who'd go into overtime with this shift are last. Your manager sees it before approving.</p>}
        </>)}
        <Field label="Note (optional)"><input id="change-note" maxLength={300} value={note} placeholder="e.g. Family dinner" onChange={e => setNote(e.target.value)} /></Field>
        {error && <p role="alert" className="verdict-bad mb-3 text-sm">{error}</p>}
        <p className="muted mb-4 text-xs">Until your manager approves, the shift is still yours.</p>
        <div className="flex flex-wrap gap-2">
          <button className="btn">{kind === "release" ? "Release shift" : kind === "swap" ? "Ask to swap" : "Ask them"}</button>
          <button type="button" className="btn secondary" onClick={onClose}>Cancel</button>
        </div>
      </fieldset>
    </form>
  </div>;
}

// The manager's side: everything waiting for a yes or no first, then what's still with the team.
function ChangeRequests({changes, reload, setMessage}: {changes: ShiftChange[]; reload: () => Promise<void>; setMessage: (text: string) => void}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function decide(change: ShiftChange, approve: boolean) {
    setBusy(change.id); setError("");
    const {error} = await supabase!.rpc("decide_shift_change", {change: change.id, approve});
    setBusy("");
    if (error) return setError(changeError(error.message));
    notify("shift_change_decided", change.id);
    setMessage(approve ? "Approved. The schedule is updated and they're told." : "Not approved. The shift stays as it was.");
    await reload();
  }
  const waiting = changes.filter(c => c.status === "pending");
  const withTeam = changes.filter(c => c.status === "open" || c.status === "asked");
  const done = changes.filter(c => !isLive(c));
  return <div className="max-w-3xl">
    {error && <p role="alert" className="notice bad mb-4">{error}</p>}
    <p className="eyebrow muted mb-2">Waiting for you</p>
    {waiting.length ? <ul className="mb-6 space-y-2">{waiting.map(c => <ChangeCard key={c.id} change={c}>
      <button type="button" className="btn" disabled={!!busy} onClick={() => void decide(c, true)}>Approve</button>
      <button type="button" className="btn secondary" disabled={!!busy} onClick={() => void decide(c, false)}>Deny</button>
    </ChangeCard>)}</ul> : <p className="panel mb-6 p-5 muted">No shift changes waiting.</p>}
    {withTeam.length > 0 && <><p className="eyebrow muted mb-2">Still with the team</p>
      <ul className="mb-6 space-y-2">{withTeam.map(c => <ChangeCard key={c.id} change={c} />)}</ul></>}
    {done.length > 0 && <><p className="eyebrow muted mb-2">Last two weeks</p>
      <ul className="space-y-2">{done.map(c => <ChangeCard key={c.id} change={c} />)}</ul></>}
  </div>;
}

// On Home: the next shift, so nobody has to open the schedule to know when to come in.
export function NextShift({restaurantId, userId, onOpen}: {restaurantId: string; userId: string; onOpen: () => void}) {
  const [shift, setShift] = useState<Shift | null>(null);
  useEffect(() => {
    let live = true;
    void supabase!.from("schedule_shifts").select("*").eq("restaurant_id", restaurantId).eq("user_id", userId).eq("published", true)
      .gt("ends_at", new Date().toISOString()).lt("starts_at", addDays(new Date(), 8).toISOString()).order("starts_at").limit(1)
      .then(({data}) => {if (live) setShift((data?.[0] as Shift) ?? null);});
    return () => {live = false;};
  }, [restaurantId, userId]);
  if (!shift) return null;
  const started = Date.parse(shift.starts_at) <= Date.now();
  return <button type="button" className="panel report-handover" onClick={onOpen}>
    <span className="eyebrow muted">{started ? "On shift now" : "Your next shift"}</span>
    <span className="mt-1 block font-semibold">{`${dayHeading(new Date(shift.starts_at))} · ${shiftLabel(shift)}`}</span>
    <span className="muted block text-sm">{shift.position}{shift.note ? ` · ${shift.note}` : ""}</span>
  </button>;
}

// On a server's Home: their week, Monday to Sunday, with the next shift picked out. It stays out of
// the way for restaurants that don't use the schedule: nothing shows until a shift is published.
export function MyWeek({restaurantId, userId, onOpen}: {restaurantId: string; userId: string; onOpen: () => void}) {
  const {settings} = useScheduleSettings(restaurantId);
  const startsOn = settings?.week_start ?? 1;
  const [start, setStart] = useState(() => weekStart(new Date()));
  // The restaurant's own first day of the week, once its settings have loaded.
  useEffect(() => { setStart(weekStart(new Date(), startsOn)); }, [startsOn]);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [off, setOff] = useState<TimeOff[]>([]);
  const [next, setNext] = useState<Shift | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    void supabase!.from("schedule_shifts").select("*").eq("restaurant_id", restaurantId).eq("user_id", userId).eq("published", true)
      .gt("ends_at", new Date().toISOString()).lt("starts_at", addDays(weekStart(new Date(), startsOn), 14).toISOString()).order("starts_at").limit(1)
      .then(({data}) => {if (live) setNext((data?.[0] as Shift) ?? null);});
    return () => {live = false;};
  }, [restaurantId, userId, startsOn]);
  useEffect(() => {
    let live = true;
    const end = addDays(start, 7);
    void Promise.all([
      supabase!.from("schedule_shifts").select("*").eq("restaurant_id", restaurantId).eq("user_id", userId).eq("published", true)
        .gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString()).order("starts_at"),
      supabase!.from("time_off_requests").select("*").eq("restaurant_id", restaurantId).eq("user_id", userId).eq("status", "approved")
        .lte("starts_on", dayKey(addDays(start, 6))).gte("ends_on", dayKey(start)),
    ]).then(([week, away]) => {
      if (!live) return;
      setShifts((week.data ?? []) as Shift[]);
      setOff((away.data ?? []) as TimeOff[]);
    });
    return () => {live = false;};
  }, [restaurantId, userId, start]);
  // On a phone the days scroll sideways: start the strip at today rather than at Monday.
  const strip = useRef<HTMLOListElement>(null);
  useEffect(() => {
    const list = strip.current, today = list?.querySelector<HTMLElement>(".today");
    if (list && today && list.scrollWidth > list.clientWidth) list.scrollLeft = today.offsetLeft - list.offsetLeft - 16;
  }, [shifts, next]);
  // Nothing published in this or next week, and nobody has looked further: the schedule isn't in use.
  if (!settings || next === undefined || (next === null && start.getTime() === weekStart(new Date(), startsOn).getTime() && !shifts?.length)) return null;
  const today = dayKey(new Date());
  const started = next ? Date.parse(next.starts_at) <= Date.now() : false;
  const total = (shifts ?? []).reduce((sum, s) => sum + shiftHours(s), 0);
  return <section className="panel my-week mb-4" aria-label="Your week">
    <div className="my-week-head">
      <div className="min-w-0">
        <p className="eyebrow muted">{next ? (started ? "On shift now" : "Your next shift") : "Your week"}</p>
        {next ? <p className="mt-1 font-semibold">{`${dayHeading(new Date(next.starts_at))} · ${shiftLabel(next)}`}<span className="muted font-normal">{` · ${next.position}`}</span></p>
          : <p className="muted mt-1 text-sm">No shifts coming up yet.</p>}
      </div>
      <button type="button" className="btn secondary shrink-0" onClick={onOpen}>Full schedule<ArrowRight size={15} aria-hidden="true" /></button>
    </div>
    <div className="my-week-bar">
      <button type="button" className="sched-icon" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}><ChevronLeft size={17} /></button>
      <b>{weekHeading(start)}</b>
      <button type="button" className="sched-icon" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}><ChevronRight size={17} /></button>
      <span className="my-week-total">{shifts ? formatHours(total) : ""}</span>
    </div>
    <ol ref={strip} className="my-week-days">{weekDays(start).map(day => {
      const key = dayKey(day);
      const theirs = (shifts ?? []).filter(s => dayKey(new Date(s.starts_at)) === key);
      const away = off.some(t => t.starts_on <= key && t.ends_on >= key);
      const isNext = !!next && theirs.some(s => s.id === next.id);
      return <li key={key} className={`my-week-day ${key === today ? "today" : ""} ${isNext ? "next" : ""} ${theirs.length ? "working" : ""}`} aria-label={dayHeading(day)}>
        <span className="my-week-date"><span>{day.toLocaleDateString("en-US", {weekday: "short"})}</span> <b>{day.getDate()}</b></span>
        {!shifts ? <small className="muted">…</small>
          : theirs.length ? theirs.map(s => <span key={s.id} className={`my-week-shift ${paint(s.position, settings)}`}><b><Hours shift={s} /></b><small>{s.position}</small></span>)
          : <small className="muted">{away ? "Time off" : "Off"}</small>}
      </li>;
    })}</ol>
  </section>;
}

// ── Availability ─────────────────────────────────────────────────────────────────────────────
function Availability({restaurantId, userId}: {restaurantId: string; userId: string}) {
  const [blocks, setBlocks] = useState<Unavailability[] | null>(null);
  const [weekday, setWeekday] = useState(1);
  const [allDay, setAllDay] = useState(true);
  const [from, setFrom] = useState("09:00");
  const [to, setTo] = useState("16:00");
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    const {data, error} = await supabase!.from("schedule_unavailability").select("*").eq("restaurant_id", restaurantId).eq("user_id", userId).order("weekday");
    if (error) setError(error.message); else setBlocks(data as Unavailability[]);
  }, [restaurantId, userId]);
  useEffect(() => {void load();}, [load]);
  async function add(event: FormEvent) {
    event.preventDefault(); setError("");
    if (!allDay && to <= from) return setError("The end time must be after the start.");
    const {error} = await supabase!.from("schedule_unavailability").insert({restaurant_id: restaurantId, weekday, starts: allDay ? null : from, ends: allDay ? null : to});
    if (error) setError(error.message); else await load();
  }
  async function remove(id: string) {
    const {error} = await supabase!.from("schedule_unavailability").delete().eq("id", id);
    if (error) setError(error.message); else await load();
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  return <div className="panel dash-panel max-w-2xl">
    <SectionInfo heading="When you can't work">Every week, the same. Your manager sees it while building the schedule. For a one-off day, ask for time off instead.</SectionInfo>
    {error && <p role="alert" className="notice bad mt-3">{error}</p>}
    {blocks && (blocks.length ? <ul className="report-recipients">{[...blocks].sort((a, b) => order.indexOf(a.weekday) - order.indexOf(b.weekday)).map(block => <li key={block.id}>
      <span className="min-w-0 flex-1">{WEEKDAYS[block.weekday]}{" · "}{block.starts && block.ends ? `${block.starts.slice(0, 5)}–${block.ends.slice(0, 5)}` : "All day"}</span>
      <button type="button" className="muted" aria-label={`Remove ${WEEKDAYS[block.weekday]}`} onClick={() => void remove(block.id)}><X size={16} /></button>
    </li>)}</ul> : <p className="muted mt-3 text-sm">You're available every day.</p>)}
    <form className="mt-4" onSubmit={add}>
      <div className="report-row">
        <Field label="Day"><select id="avail-day" value={weekday} onChange={e => setWeekday(Number(e.target.value))}>{order.map(d => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}</select></Field>
        <Field label="From"><input id="avail-from" type="time" disabled={allDay} value={from} onChange={e => setFrom(e.target.value)} /></Field>
        <Field label="To"><input id="avail-to" type="time" disabled={allDay} value={to} onChange={e => setTo(e.target.value)} /></Field>
      </div>
      <label className="mb-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={allDay} onChange={e => setAllDay(e.target.checked)} />All day</label>
      <button className="btn">Add</button>
    </form>
  </div>;
}

// ── Time off ─────────────────────────────────────────────────────────────────────────────────
const STATUS_TEXT = {pending: "Waiting for approval", approved: "Approved", denied: "Not approved"} as const;

function TimeOffRequests({restaurantId, userId, setMessage}: {restaurantId: string; userId: string; setMessage: (text: string) => void}) {
  const [requests, setRequests] = useState<TimeOff[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const today = dayKey(new Date());
  const load = useCallback(async () => {
    const {data, error} = await supabase!.from("time_off_requests").select("*").eq("restaurant_id", restaurantId).eq("user_id", userId).gte("ends_on", today).order("starts_on");
    if (error) setError(error.message); else setRequests(data as TimeOff[]);
  }, [restaurantId, userId, today]);
  useEffect(() => {void load();}, [load]);
  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const starts = String(data.get("from")), ends = String(data.get("to") || data.get("from"));
    if (ends < starts) return setError("The last day must be on or after the first.");
    setBusy(true); setError("");
    const {data: saved, error} = await supabase!.from("time_off_requests").insert({restaurant_id: restaurantId, starts_on: starts, ends_on: ends, note: String(data.get("note") ?? "").trim()}).select("id").single();
    setBusy(false);
    if (error) return setError(error.message.includes("check constraint") ? "Time off can be up to 60 days at a time." : error.message);
    notify("time_off_requested", saved.id as string);
    setMessage("Request sent. Your manager will approve it here.");
    form.reset(); await load();
  }
  async function withdraw(id: string) {
    const {error} = await supabase!.from("time_off_requests").delete().eq("id", id);
    if (error) setError(error.message); else await load();
  }
  return <div className="max-w-2xl">
    <form className="panel dash-panel" onSubmit={ask}>
      <SectionInfo heading="Ask for time off">Your manager approves it, and the schedule shows it while they build the week.</SectionInfo>
      <div className="report-row mt-3">
        <Field label="First day"><input id="off-from" name="from" type="date" required min={today} /></Field>
        <Field label="Last day (optional)"><input id="off-to" name="to" type="date" min={today} /></Field>
        <Field label="Reason (optional)"><input id="off-note" name="note" maxLength={300} placeholder="e.g. Family wedding" /></Field>
      </div>
      {error && <p role="alert" className="notice bad mb-3">{error}</p>}
      <button className="btn" disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
    </form>
    {requests && requests.length > 0 && <ul className="mt-4 space-y-2">{requests.map(r => <li key={r.id} className="panel sched-mine">
      <span className="min-w-0 flex-1">
        <b className="block">{r.starts_on === r.ends_on ? dateLabel(r.starts_on) : `${dateLabel(r.starts_on)} – ${dateLabel(r.ends_on)}`}</b>
        <small className="muted">{STATUS_TEXT[r.status]}{r.note ? ` · ${r.note}` : ""}</small>
      </span>
      {r.status === "pending" && <button type="button" className="btn secondary" onClick={() => void withdraw(r.id)}>Withdraw</button>}
    </li>)}</ul>}
  </div>;
}

function TimeOffDecisions({restaurantId, setMessage, access, settings}: {restaurantId: string; setMessage: (text: string) => void; access: ScheduleAccess; settings: ScheduleSettings}) {
  const [requests, setRequests] = useState<TimeOff[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [roles, setRoles] = useState<Map<string, string>>(new Map());
  const [error, setError] = useState("");
  const today = dayKey(new Date());
  const load = useCallback(async () => {
    const [list, team] = await Promise.all([
      supabase!.from("time_off_requests").select("*").eq("restaurant_id", restaurantId).gte("ends_on", today).neq("status", "denied").order("starts_on"),
      supabase!.rpc("schedule_team", {rid: restaurantId}),
    ]);
    if (list.error) return setError(list.error.message);
    setRequests(list.data as TimeOff[]);
    setNames(new Map(((team.data ?? []) as Person[]).map(p => [p.user_id, p.name])));
    setRoles(new Map(((team.data ?? []) as Person[]).map(p => [p.user_id, p.role])));
  }, [restaurantId, today]);
  useEffect(() => {void load();}, [load]);
  async function decide(id: string, approve: boolean) {
    setError("");
    const {error} = await supabase!.rpc("decide_time_off", {request_id: id, approve});
    if (error) return setError(error.message);
    notify("time_off_decided", id);
    setMessage(approve ? "Time off approved." : "Time off not approved.");
    await load();
  }
  if (!requests) return <p className="muted" role="status">Loading…</p>;
  const mine = requests.filter(r => canSchedule(roles.get(r.user_id) ?? "Server", access, settings));
  const waiting = mine.filter(r => r.status === "pending"), approved = mine.filter(r => r.status === "approved");
  const row = (r: TimeOff, actions: boolean) => <li key={r.id} className="panel sched-mine">
    <span className="min-w-0 flex-1">
      <b className="block">{names.get(r.user_id) ?? "Team member"}</b>
      <small className="muted">{r.starts_on === r.ends_on ? dateLabel(r.starts_on) : `${dateLabel(r.starts_on)} – ${dateLabel(r.ends_on)}`}{r.note ? ` · ${r.note}` : ""}</small>
    </span>
    {actions && <span className="flex gap-2">
      <button type="button" className="btn" onClick={() => void decide(r.id, true)}>Approve</button>
      <button type="button" className="btn secondary" onClick={() => void decide(r.id, false)}>Deny</button>
    </span>}
  </li>;
  return <div className="max-w-3xl">
    {error && <p role="alert" className="notice bad mb-4">{error}</p>}
    <p className="eyebrow muted mb-2">Waiting for you</p>
    {waiting.length ? <ul className="mb-6 space-y-2">{waiting.map(r => row(r, true))}</ul> : <p className="panel mb-6 p-5 muted">No requests waiting.</p>}
    <p className="eyebrow muted mb-2">Coming up</p>
    {approved.length ? <ul className="space-y-2">{approved.map(r => row(r, false))}</ul> : <p className="panel p-5 muted">No approved time off coming up.</p>}
  </div>;
}

// ── On Home ──────────────────────────────────────────────────────────────────────────────────────
// The manager's "who works today": today's shifts by position, in the restaurant's colours, with
// drafts and shifts that are changing hands marked.
export function WhoWorksToday({restaurantId, onOpen}: {restaurantId: string; onOpen: () => void}) {
  const {settings} = useScheduleSettings(restaurantId);
  const {changes} = useShiftChanges(restaurantId);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  useEffect(() => {
    let live = true;
    const from = new Date(); from.setHours(0, 0, 0, 0);
    void Promise.all([
      supabase!.from("schedule_shifts").select("*").eq("restaurant_id", restaurantId).gte("starts_at", from.toISOString()).lt("starts_at", addDays(from, 1).toISOString()).order("starts_at"),
      supabase!.rpc("schedule_team", {rid: restaurantId}),
    ]).then(([today, team]) => {
      if (!live) return;
      setShifts(today.error ? [] : (today.data ?? []) as Shift[]);
      setNames(new Map(((team.data ?? []) as Person[]).map(p => [p.user_id, p.name || "Team member"])));
    });
    return () => {live = false;};
  }, [restaurantId]);
  if (!shifts || !settings) return null;
  const groups = [...new Map(shifts.map(s => [s.position.trim().toLowerCase(), s.position.trim()])).values()].sort((a, b) => a.localeCompare(b));
  const people = new Set(shifts.map(s => s.user_id)).size;
  const hours = shifts.reduce((sum, s) => sum + shiftHours(s), 0);
  const changing = (shift: Shift) => changes.some(c => isLive(c) && (c.shift_id === shift.id || c.swap_shift_id === shift.id));
  return <section className="panel today-floor mb-4" aria-label="Working today">
    <div className="flex items-center gap-3">
      <div className="min-w-0 flex-1">
        <p className="eyebrow muted">Working today</p>
        <p className="mt-1 font-semibold">{shifts.length ? `${people} ${people === 1 ? "person" : "people"} · ${formatHours(hours)}` : "Nobody is scheduled today."}</p>
      </div>
      <button type="button" className="btn secondary shrink-0" onClick={onOpen}>{shifts.length ? "Schedule" : "Build the week"}<ArrowRight size={15} aria-hidden="true" /></button>
    </div>
    {groups.length > 0 && <div className="today-groups">{groups.map(group => <div key={group}>
      <p className={`today-position ${paint(group, settings)}`}><i aria-hidden="true" />{group}</p>
      <ul>{shifts.filter(s => s.position.trim().toLowerCase() === group.toLowerCase()).map(s => <li key={s.id} className={s.published ? "" : "draft"}>
        <span className="min-w-0 flex-1 truncate">{names.get(s.user_id) ?? "Team member"}</span>
        <span className="today-time">{shiftLabel(s)}</span>
        {!s.published && <small className="muted">Draft</small>}
        {changing(s) && <ArrowLeftRight size={13} aria-label="Change asked" />}
      </li>)}</ul>
    </div>)}</div>}
  </section>;
}

// The manager's Today roster: one folded line, "Who is working today · 3". Open it and it is the
// day's roster, one short line per person in the order they start, with the full schedule one tap
// away at the end. Built for a night with thirty people on it: nothing here needs the schedule page.
export function TodayRoster({restaurantId}: {restaurantId: string; onOpen?: () => void}) {
  const {settings} = useScheduleSettings(restaurantId);
  const {changes} = useShiftChanges(restaurantId);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [open, setOpen] = useState(false);
  useEffect(() => {
    let live = true;
    const from = new Date(); from.setHours(0, 0, 0, 0);
    void Promise.all([
      supabase!.from("schedule_shifts").select("*").eq("restaurant_id", restaurantId).gte("starts_at", from.toISOString()).lt("starts_at", addDays(from, 1).toISOString()).order("starts_at"),
      supabase!.rpc("schedule_team", {rid: restaurantId}),
    ]).then(([today, team]) => {
      if (!live) return;
      setShifts(today.error ? [] : (today.data ?? []) as Shift[]);
      setNames(new Map(((team.data ?? []) as Person[]).map(p => [p.user_id, p.name || "Team member"])));
    });
    return () => {live = false;};
  }, [restaurantId]);
  if (!shifts || !settings) return null;
  const people = new Set(shifts.map(s => s.user_id)).size;
  const hours = shifts.reduce((sum, s) => sum + shiftHours(s), 0);
  const changing = (shift: Shift) => changes.some(c => isLive(c) && (c.shift_id === shift.id || c.swap_shift_id === shift.id));
  const ordered = [...shifts].sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || (names.get(a.user_id) ?? "").localeCompare(names.get(b.user_id) ?? ""));
  return <section className="today-roster" aria-label="Working today">
    <button type="button" className="btn secondary today-roster-toggle" aria-expanded={open} onClick={() => setOpen(value => !value)}>
      <span>{`Who is working today · ${people}`}</span><ChevronDown size={16} aria-hidden="true" />
    </button>
    {open && <div className="panel today-roster-body">
      {ordered.length ? <ul>{ordered.map(s => <li key={s.id} className={s.published ? "" : "draft"}>
        <span className={`today-dot ${paint(s.position, settings)}`} aria-hidden="true" />
        <span className="today-name"><b>{names.get(s.user_id) ?? "Team member"}</b><small>{s.position}</small></span>
        {!s.published && <small className="muted">Draft</small>}
        {changing(s) && <ArrowLeftRight size={13} aria-label="Change asked" />}
        <span className="today-time">{shiftLabel(s)}</span>
      </li>)}</ul> : <p className="muted">Nobody is scheduled today.</p>}
      {ordered.length > 0 && <div className="today-roster-foot">
        <span className="muted">{`${people} ${people === 1 ? "person" : "people"} · ${formatHours(hours)}`}</span>
      </div>}
    </div>}
  </section>;
}

// An employee's "waiting for you": shifts a coworker asked them to cover or swap, shifts up for grabs
// in their position, and what happened to their own requests lately. Nothing to show, nothing shown.
export function ShiftChangesWaiting({restaurantId, userId, onOpen, setMessage}: {restaurantId: string; userId: string; onOpen: () => void; setMessage: (text: string) => void}) {
  const {changes, reload} = useShiftChanges(restaurantId);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  async function act(id: string, call: PromiseLike<{error: {message: string} | null}>, done: string, event: PushEvent) {
    setBusy(id); setError("");
    const {error} = await call;
    setBusy("");
    if (error) return setError(changeError(error.message));
    notify(event, id);
    setMessage(done);
    await reload();
  }
  const forMe = changes.filter(c => c.status === "asked" && c.taker_id === userId);
  const upForGrabs = changes.filter(c => c.status === "open" && c.requested_by !== userId);
  const recent = Date.now() - 2 * 86_400_000;
  const answered = changes.filter(c => c.requested_by === userId && (c.status === "approved" || c.status === "denied" || c.status === "declined")
    && Date.parse(c.decided_at ?? c.created_at) > recent);
  if (!forMe.length && !upForGrabs.length && !answered.length) return null;
  return <section className="panel dash-panel waiting-card mb-4" aria-label="Shifts waiting for you">
    <div className="mb-2 flex items-center gap-3">
      <p className="eyebrow muted min-w-0 flex-1">Shifts waiting for you</p>
      <button type="button" className="text-sm underline" onClick={onOpen}>My shifts</button>
    </div>
    {error && <p role="alert" className="verdict-bad mb-2 text-sm">{error}</p>}
    <ul className="space-y-2">
      {forMe.map(c => <ChangeCard key={c.id} change={c}>
        <button type="button" className="btn" disabled={!!busy} onClick={() => void act(c.id, supabase!.rpc("answer_shift_change", {change: c.id, accept: true}), "Done. Your manager approves it next.", "shift_change_pending")}>{c.kind === "swap" ? "Swap" : "I'll cover it"}</button>
        <button type="button" className="btn secondary" disabled={!!busy} onClick={() => void act(c.id, supabase!.rpc("answer_shift_change", {change: c.id, accept: false}), "You said no.", "shift_change_declined")}>No</button>
      </ChangeCard>)}
      {upForGrabs.map(c => <ChangeCard key={c.id} change={c}>
        <button type="button" className="btn" disabled={!!busy} onClick={() => void act(c.id, supabase!.rpc("take_released_shift", {change: c.id}), "It's yours once your manager approves.", "shift_change_pending")}>Take it</button>
      </ChangeCard>)}
      {answered.map(c => <ChangeCard key={c.id} change={c} />)}
    </ul>
  </section>;
}
