"use client";
// The schedule (migration 040), stage 1 of replacing Sling. Managers with Team access build the week
// person by person, see hours, overtime and conflicts as they go, and publish; the team sees their
// shifts and their coworkers', and keeps their own availability and time off.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { AlertTriangle, ChevronLeft, ChevronRight, Copy, Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  OVERTIME_HOURS, POSITIONS, WARNING_TEXT, WEEKDAYS, addDays, clock, copiedWeek, dayKey, formatHours, hoursByPerson,
  shiftHours, shiftLabel, shiftTimes, shiftWarnings, weekDays, weekStart,
  type Shift, type TimeOff, type Unavailability,
} from "@/lib/schedule";
import { notify } from "./notifications";
import { Field, SectionInfo } from "./ui";

type Person = {user_id: string; name: string; role: string};
type Tab = "week" | "mine" | "availability" | "timeoff";

const dayHeading = (day: Date) => day.toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"});
const weekHeading = (start: Date) => `${start.toLocaleDateString("en-US", {month: "short", day: "numeric"})} – ${addDays(start, 6).toLocaleDateString("en-US", {month: "short", day: "numeric"})}`;
const dateLabel = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"}); };

export function Schedule({restaurantId, userId, canManage, setMessage}: {restaurantId: string; userId: string; canManage: boolean; setMessage: (text: string) => void}) {
  const [tab, setTab] = useState<Tab>(canManage ? "week" : "mine");
  const [pending, setPending] = useState(0);
  useEffect(() => {
    if (!canManage) return;
    void supabase!.from("time_off_requests").select("id", {count: "exact", head: true}).eq("restaurant_id", restaurantId).eq("status", "pending")
      .then(({count}) => setPending(count ?? 0));
  }, [canManage, restaurantId, tab]);
  const tabs: [Tab, string][] = canManage
    ? [["week", "Build the week"], ["timeoff", pending ? `Time off · ${pending}` : "Time off"], ["mine", "My shifts"], ["availability", "My availability"]]
    : [["mine", "My shifts"], ["week", "Team schedule"], ["availability", "My availability"], ["timeoff", "Time off"]];
  return <section className="mx-auto max-w-6xl">
    <p className="eyebrow muted">{canManage ? "Manager workspace" : "Your schedule"}</p>
    <h1 className="mt-3 mb-5 text-2xl font-semibold">Schedule</h1>
    <div className="library-switch mb-5" aria-label="Schedule">
      {tabs.map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
    </div>
    {tab === "week" && <WeekView restaurantId={restaurantId} canManage={canManage} setMessage={setMessage} />}
    {tab === "mine" && <MyShifts restaurantId={restaurantId} userId={userId} />}
    {tab === "availability" && <Availability restaurantId={restaurantId} userId={userId} />}
    {tab === "timeoff" && (canManage ? <TimeOffDecisions restaurantId={restaurantId} setMessage={setMessage} /> : <TimeOffRequests restaurantId={restaurantId} userId={userId} setMessage={setMessage} />)}
  </section>;
}

// ── The week ─────────────────────────────────────────────────────────────────────────────────
type Draft = {id?: string; user_id: string; position: string; day: string; start: string; end: string; note: string};

function WeekView({restaurantId, canManage, setMessage}: {restaurantId: string; canManage: boolean; setMessage: (text: string) => void}) {
  const [start, setStart] = useState(() => weekStart(new Date()));
  const [people, setPeople] = useState<Person[]>([]);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [unavailable, setUnavailable] = useState<Unavailability[]>([]);
  const [timeOff, setTimeOff] = useState<TimeOff[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const days = useMemo(() => weekDays(start), [start]);
  const end = useMemo(() => addDays(start, 7), [start]);

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
  const drafts = (shifts ?? []).filter(s => !s.published).length;
  // Employees see only who works this week; managers see the whole team, ready to fill in.
  const rows = canManage ? people : people.filter(p => hours.has(p.user_id));

  function openNew(person: Person, day: Date) {
    setDraft({user_id: person.user_id, position: POSITIONS.includes(person.role) ? person.role : "Server", day: dayKey(day), start: "17:00", end: "23:00", note: ""});
  }
  function openShift(shift: Shift) {
    const from = new Date(shift.starts_at);
    setDraft({id: shift.id, user_id: shift.user_id, position: shift.position, day: dayKey(from), start: clock(from), end: clock(new Date(shift.ends_at)), note: shift.note});
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
  const copyLastWeek = () => void act(async () => {
    const last = await supabase!.from("schedule_shifts").select("*").eq("restaurant_id", restaurantId).gte("starts_at", addDays(start, -7).toISOString()).lt("starts_at", start.toISOString());
    if (last.error) throw new Error(last.error.message);
    // Only what isn't here already, so copying twice never doubles a shift.
    const here = new Set((shifts ?? []).map(s => `${s.user_id}|${Date.parse(s.starts_at)}`));
    const rows = copiedWeek(last.data as Shift[]).filter(s => !here.has(`${s.user_id}|${Date.parse(s.starts_at)}`));
    if (!rows.length) return setMessage("Nothing to copy: last week had no new shifts for this one.");
    const result = await supabase!.from("schedule_shifts").insert(rows);
    if (result.error) throw new Error(result.error.message);
    setMessage(`Copied ${rows.length} ${rows.length === 1 ? "shift" : "shifts"} from last week as drafts.`);
    await load();
  });
  const publish = () => void act(async () => {
    const result = await supabase!.rpc("publish_schedule", {rid: restaurantId, from_ts: start.toISOString(), to_ts: end.toISOString()});
    if (result.error) throw new Error(result.error.message);
    const done = result.data as {id: string; shifts: number; people: number};
    if (done.shifts) notify("schedule_published", done.id);
    setMessage(done.shifts ? `Published ${done.shifts} ${done.shifts === 1 ? "shift" : "shifts"}. ${done.people} ${done.people === 1 ? "person was" : "people were"} told.` : "Nothing new to publish.");
    await load();
  });

  return <div>
    <div className="sched-bar">
      <div className="flex items-center gap-1">
        <button type="button" className="btn secondary sched-icon" aria-label="Previous week" onClick={() => setStart(addDays(start, -7))}><ChevronLeft size={18} /></button>
        <button type="button" className="btn secondary" onClick={() => setStart(weekStart(new Date()))}>This week</button>
        <button type="button" className="btn secondary sched-icon" aria-label="Next week" onClick={() => setStart(addDays(start, 7))}><ChevronRight size={18} /></button>
        <b className="ml-2 text-sm">{weekHeading(start)}</b>
      </div>
      {canManage && <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn secondary" disabled={busy} onClick={copyLastWeek}><Copy size={15} />Copy last week</button>
        <button type="button" className="btn" disabled={busy || !drafts} onClick={publish}>{drafts ? `Publish ${drafts} ${drafts === 1 ? "change" : "changes"}` : "Published"}</button>
      </div>}
    </div>
    {error && <p role="alert" className="notice bad mb-4">{error}</p>}
    {!shifts ? <p className="muted" role="status">Loading the schedule…</p>
      : !rows.length ? <p className="panel p-5 muted">{canManage ? "Nobody on the team yet. Invite your team from Team." : "Nothing published for this week yet."}</p>
      : <div className="sched-scroll">
        <table className="sched-grid">
          <thead><tr>
            <th scope="col">Team</th>
            {days.map(day => <th key={day.toISOString()} scope="col" className={dayKey(day) === dayKey(new Date()) ? "today" : ""}>{dayHeading(day)}</th>)}
          </tr></thead>
          <tbody>{rows.map(person => {
            const total = hours.get(person.user_id) ?? 0;
            return <tr key={person.user_id}>
              <th scope="row">
                <span className="block font-semibold">{person.name}</span>
                <span className={`sched-hours ${total > OVERTIME_HOURS ? "over" : ""}`}>{formatHours(total)}{total > OVERTIME_HOURS ? " · Overtime" : ""}</span>
              </th>
              {days.map(day => {
                const mine = (shifts ?? []).filter(s => s.user_id === person.user_id && dayKey(new Date(s.starts_at)) === dayKey(day));
                return <td key={day.toISOString()}>
                  {mine.map(shift => {
                    const warnings = canManage ? shiftWarnings(shift, shifts ?? [], unavailable, timeOff) : [];
                    return <button key={shift.id} type="button" disabled={!canManage} onClick={() => openShift(shift)}
                      className={`sched-shift ${shift.published ? "" : "draft"} ${warnings.length ? "warn" : ""}`}
                      title={warnings.map(w => WARNING_TEXT[w]).join(" · ") || undefined}>
                      <b>{shiftLabel(shift)}</b>
                      <small>{shift.position}{shift.published ? "" : " · Draft"}</small>
                      {warnings.length > 0 && <small className="sched-warn"><AlertTriangle size={12} aria-hidden="true" />{WARNING_TEXT[warnings[0]]}</small>}
                    </button>;
                  })}
                  {canManage && <button type="button" className="sched-add" aria-label={`Add a shift for ${person.name} on ${dayHeading(day)}`} onClick={() => openNew(person, day)}><Plus size={14} /></button>}
                </td>;
              })}
            </tr>;
          })}</tbody>
        </table>
      </div>}
    {canManage && shifts && shifts.length > 0 && <p className="muted mt-3 text-xs">{`Dashed shifts are drafts: the team sees them once you publish. Total this week: ${formatHours((shifts ?? []).reduce((sum, s) => sum + shiftHours(s), 0))}.`}</p>}

    {draft && <div className="sched-sheet" role="dialog" aria-modal="true" aria-labelledby="shift-title">
      <form className="panel sched-form" onSubmit={save}>
        <div className="mb-3 flex items-center">
          <h2 id="shift-title" className="text-lg font-semibold">{draft.id ? "Edit shift" : "New shift"}</h2>
          <button type="button" className="ml-auto muted" aria-label="Close" onClick={() => setDraft(null)}><X size={18} /></button>
        </div>
        <fieldset disabled={busy}>
          <Field label="Who"><select id="shift-who" value={draft.user_id} onChange={e => setDraft({...draft, user_id: e.target.value})}>{people.map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select></Field>
          <Field label="Position"><select id="shift-position" value={draft.position} onChange={e => setDraft({...draft, position: e.target.value})}>{(POSITIONS.includes(draft.position) ? POSITIONS : [draft.position, ...POSITIONS]).map(p => <option key={p}>{p}</option>)}</select></Field>
          <Field label="Day"><input id="shift-day" type="date" required value={draft.day} onChange={e => setDraft({...draft, day: e.target.value})} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Starts"><input id="shift-start" type="time" required step={900} value={draft.start} onChange={e => setDraft({...draft, start: e.target.value})} /></Field>
            <Field label="Ends"><input id="shift-end" type="time" required step={900} value={draft.end} onChange={e => setDraft({...draft, end: e.target.value})} /></Field>
          </div>
          <Field label="Note (optional)"><input id="shift-note" maxLength={300} value={draft.note} placeholder="e.g. Patio, private party" onChange={e => setDraft({...draft, note: e.target.value})} /></Field>
          <p className="muted mb-4 text-xs">An end time before the start means the shift closes after midnight.</p>
          <div className="flex flex-wrap gap-2">
            <button className="btn">{draft.id ? "Save changes" : "Add shift"}</button>
            {draft.id && <button type="button" className="btn secondary" onClick={remove}>Delete shift</button>}
          </div>
        </fieldset>
      </form>
    </div>}
  </div>;
}

// ── My shifts ────────────────────────────────────────────────────────────────────────────────
function MyShifts({restaurantId, userId}: {restaurantId: string; userId: string}) {
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  useEffect(() => {
    const from = new Date(); from.setHours(0, 0, 0, 0);
    void supabase!.from("schedule_shifts").select("*").eq("restaurant_id", restaurantId).eq("user_id", userId).eq("published", true)
      .gte("starts_at", from.toISOString()).lt("starts_at", addDays(from, 21).toISOString()).order("starts_at")
      .then(({data}) => setShifts((data ?? []) as Shift[]));
  }, [restaurantId, userId]);
  if (!shifts) return <p className="muted" role="status">Loading your shifts…</p>;
  if (!shifts.length) return <p className="panel p-5 muted">No shifts in the next three weeks yet. Your manager publishes the schedule here.</p>;
  const thisWeek = shifts.filter(s => weekStart(new Date(s.starts_at)).getTime() === weekStart(new Date()).getTime());
  return <div>
    <p className="muted mb-3 text-sm">{`This week: ${formatHours(thisWeek.reduce((sum, s) => sum + shiftHours(s), 0))}`}</p>
    <ul className="space-y-2">{shifts.map(shift => <li key={shift.id} className="panel sched-mine">
      <span className="sched-date">{dayHeading(new Date(shift.starts_at))}</span>
      <span className="min-w-0 flex-1">
        <b className="block">{shiftLabel(shift)}</b>
        <small className="muted">{shift.position}{shift.note ? ` · ${shift.note}` : ""}</small>
      </span>
      <span className="muted text-xs">{formatHours(shiftHours(shift))}</span>
    </li>)}</ul>
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

function TimeOffDecisions({restaurantId, setMessage}: {restaurantId: string; setMessage: (text: string) => void}) {
  const [requests, setRequests] = useState<TimeOff[] | null>(null);
  const [names, setNames] = useState<Map<string, string>>(new Map());
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
  const waiting = requests.filter(r => r.status === "pending"), approved = requests.filter(r => r.status === "approved");
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
