"use client";
// Side work · Today: the night on one table, one row per person -- the same sheet the floor already
// uses on paper: who, their section, and their opening, during and closing side work.
//
// It is worked out from the published schedule: the servers' sections in order, the S.A.s spread
// across them, and every task handed out by its rule (lib/sidework-plan: one person rotating day by
// day, everyone, or the closer -- whoever comes in last). Three steps across the top say where things
// stand: the schedule is published, look it over, send it. Until it's sent the plan lives only on this
// screen; sending saves the sections (floor_plans, 050) and gives each task to its person
// (checklist_assignments), which is what each person's My shift card reads. After that, a change to a
// task goes out as it's made.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Check, Plus, RefreshCw, Send, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Notice } from "./ui";
import { defaultService, localDate, startingRows, type FloorRow, type Plan, type Working } from "./floor-plan";
import { PHASES, closers, peopleIn, planJobs, roleOf, type Phase, type RuledJob } from "@/lib/sidework-plan";

type Sent = {id: string; title: string; user_id: string | null; phase: Phase; done_at: string | null; job_id: string | null; steps_done: number[]};
type Line = {key: string; title: string; user_id: string | null; phase: Phase; done?: boolean; jobId?: string | null};

const SERVICES = ["Lunch", "Dinner"] as const;
const JOB_COLUMNS = "id, name, group_name, steps, sort_order, phase, role, who, days";
const PHASE_LABEL: Record<Phase, string> = {opening: "Opening", during: "During", closing: "Closing"};
const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {weekday: "long"});
const clockOf = (iso: string) => new Date(iso).toLocaleTimeString("en-US", {hour: "numeric", minute: "2-digit"}).replace(":00", "").replace(" ", "").toLowerCase();
const sameSection = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

export function Tonight({restaurantId, onOpenSchedule}: {restaurantId: string; onOpenSchedule?: () => void}) {
  const [day, setDay] = useState(localDate);
  const [service, setService] = useState<string>(defaultService);
  const [working, setWorking] = useState<Working[]>([]);
  const [jobs, setJobs] = useState<RuledJob[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [rows, setRows] = useState<FloorRow[]>([]);
  const [floorDirty, setFloorDirty] = useState(false);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  const [draft, setDraft] = useState<Line[]>([]);
  const [moving, setMoving] = useState<string | null>(null);
  const [adding, setAdding] = useState<{title: string; phase: Phase; user_id: string} | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const explain = (e: unknown) => {
    const text = e instanceof Error ? e.message : String((e as {message?: string})?.message ?? e);
    return /phase|who|floor_plan|PGRST20[0-9]|42P01|42703|42883|23514/.test(text) ? "Side work needs the database updates (050 to 052)." : text;
  };

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true); setError(""); setMoving(null); setAdding(null);
    try {
      const [people, savedJobs, floor, shift] = await Promise.all([
        supabase.rpc("floor_plan_people", {rid: restaurantId, day}),
        supabase.from("checklist_jobs").select(JOB_COLUMNS).eq("restaurant_id", restaurantId).eq("archived", false),
        supabase.from("floor_plans").select("id, service_date, service, list_id, rows, updated_at").eq("restaurant_id", restaurantId).eq("service_date", day).eq("service", service).maybeSingle(),
        supabase.from("checklist_shifts").select("id, posted_at").eq("restaurant_id", restaurantId).eq("shift_date", day).eq("label", service).maybeSingle(),
      ]);
      for (const r of [people, savedJobs, floor, shift]) if (r.error) throw r.error;
      const team = (people.data ?? []) as Working[];
      const ruled = (savedJobs.data ?? []) as RuledJob[];
      const savedPlan = floor.data as Plan | null;
      setWorking(team); setJobs(ruled); setPlan(savedPlan);
      setRows(savedPlan?.rows ?? startingRows(team, service, day, undefined));
      setFloorDirty(false);
      const shiftRow = shift.data as {id: string; posted_at: string | null} | null;
      setShiftId(shiftRow?.id ?? null);
      let given: Sent[] = [];
      if (shiftRow) {
        const a = await supabase.from("checklist_assignments").select("id, title, user_id, phase, done_at, job_id, steps_done").eq("shift_id", shiftRow.id).not("phase", "is", null).order("sort_order");
        if (a.error) throw a.error;
        given = (a.data ?? []) as Sent[];
      }
      setSent(given);
      setSentAt(given.length ? shiftRow?.posted_at ?? null : null);
      setDraft(fromPlan(ruled, team));
    } catch (e) { setError(explain(e)); }
    finally { setLoading(false); }
  }, [restaurantId, day, service]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);

  function fromPlan(ruled: RuledJob[], team: Working[]): Line[] {
    return planJobs(ruled, peopleIn(service, team), day).map((p, i) => ({key: `${p.job.id}-${i}`, title: p.job.name, user_id: p.user_id, phase: p.phase, jobId: p.job.id}));
  }

  const people = useMemo(() => peopleIn(service, working), [working, service]);
  const servers = useMemo(() => people.filter(p => roleOf(p.shift_position) === "server").sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.name.localeCompare(b.name)), [people]);
  const sas = useMemo(() => people.filter(p => roleOf(p.shift_position) === "sa").sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.name.localeCompare(b.name)), [people]);
  const closing = useMemo(() => new Set([...closers(servers), ...closers(sas)]), [servers, sas]);
  const isSent = sent.length > 0;
  const lines: Line[] = isSent ? sent.map(s => ({key: s.id, title: s.title, user_id: s.user_id, phase: s.phase, done: !!s.done_at, jobId: s.job_id})) : draft;
  const nobody = lines.filter(l => !l.user_id || !people.some(p => p.user_id === l.user_id));
  const unset = jobs.filter(j => !j.phase).length;

  const sectionOf = (userId: string, role: "server" | "sa") => role === "server"
    ? rows.find(r => r.server_id === userId)?.section ?? ""
    : rows.filter(r => r.sa.some(h => h.id === userId)).map(r => r.section).filter(Boolean).join("/");
  // Typing a server's section renames their row; an S.A.'s "1/2" puts them on those rows.
  function setSection(userId: string, role: "server" | "sa", value: string, name: string) {
    setFloorDirty(true); setMessage("");
    if (role === "server") {
      const has = rows.some(r => r.server_id === userId);
      setRows(has ? rows.map(r => r.server_id === userId ? {...r, section: value} : r) : [...rows, {server_id: userId, server_name: name, sa: [], section: value, task: ""}]);
      return;
    }
    const wanted = value.split(/[/,\s]+/).map(s => s.trim()).filter(Boolean);
    setRows(rows.map(r => {
      const without = r.sa.filter(h => h.id !== userId);
      return wanted.some(w => sameSection(w, r.section)) ? {...r, sa: [...without, {id: userId, name}]} : {...r, sa: without};
    }));
  }

  async function giveTo(line: Line, userId: string) {
    setMoving(null); setMessage("");
    if (!isSent) { setDraft(d => d.map(l => l.key === line.key ? {...l, user_id: userId || null} : l)); return; }
    const result = await supabase!.from("checklist_assignments").update({user_id: userId || null, locked: true}).eq("id", line.key);
    if (result.error) { setError(explain(result.error)); return; }
    setSent(s => s.map(a => a.id === line.key ? {...a, user_id: userId || null} : a));
  }
  async function removeLine(line: Line) {
    setMoving(null);
    if (!isSent) { setDraft(d => d.filter(l => l.key !== line.key)); return; }
    const result = await supabase!.from("checklist_assignments").delete().eq("id", line.key);
    if (result.error) { setError(explain(result.error)); return; }
    setSent(s => s.filter(a => a.id !== line.key));
  }

  async function ensureShift() {
    if (shiftId) {
      const live = await supabase!.from("checklist_shifts").update({status: "posted", posted_at: new Date().toISOString()}).eq("id", shiftId);
      if (live.error) throw live.error;
      return shiftId;
    }
    const made = await supabase!.from("checklist_shifts").insert({restaurant_id: restaurantId, shift_date: day, label: service, status: "posted", posted_at: new Date().toISOString()}).select("id").single();
    if (made.error) throw made.error;
    return (made.data as {id: string}).id;
  }
  async function saveFloor(next: FloorRow[]) {
    const me = (await supabase!.auth.getUser()).data.user?.id;
    const floor = await supabase!.from("floor_plans").upsert({restaurant_id: restaurantId, service_date: day, service, list_id: plan?.list_id ?? null, rows: next, updated_at: new Date().toISOString(), updated_by: me}, {onConflict: "restaurant_id,service_date,service"});
    if (floor.error) throw floor.error;
  }
  async function addTask(event: FormEvent) {
    event.preventDefault();
    if (!adding?.title.trim()) return;
    const line: Line = {key: `extra-${Date.now()}`, title: adding.title.trim(), phase: adding.phase, user_id: adding.user_id || null};
    if (!isSent) { setDraft(d => [...d, line]); setAdding(null); return; }
    setBusy(true);
    try {
      const id = await ensureShift();
      const made = await supabase!.from("checklist_assignments").insert({shift_id: id, restaurant_id: restaurantId, title: line.title, user_id: line.user_id, phase: line.phase, locked: true, sort_order: 99999});
      if (made.error) throw made.error;
      setAdding(null); await load();
    } catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  }

  // Sending: save the sections, open (or reuse) the service's side work, give each task to its person.
  // Rebuild starts again from the schedule but leaves alone anything someone already started.
  async function send(rebuild = false) {
    if (!supabase || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const floor = rebuild ? startingRows(working, service, day, undefined) : rows;
      await saveFloor(floor);
      const id = await ensureShift();
      if (isSent && rebuild) {
        const cleared = await supabase.from("checklist_assignments").delete().eq("shift_id", id).not("phase", "is", null).is("done_at", null).eq("steps_done", "{}");
        if (cleared.error) throw cleared.error;
      }
      if (!isSent || rebuild) {
        const started = new Set(sent.filter(s => s.done_at || s.steps_done.length).map(s => `${s.job_id}|${s.user_id}`));
        const fresh = rebuild ? fromPlan(jobs, working) : draft;
        const insert = fresh.filter(l => !started.has(`${l.jobId}|${l.user_id}`)).map((l, i) => {
          const job = jobs.find(j => j.id === l.jobId);
          return {shift_id: id, restaurant_id: restaurantId, job_id: l.jobId ?? null, title: l.title, group_name: job?.group_name ?? "", steps: job?.steps ?? [], user_id: l.user_id, phase: l.phase, locked: !job, sort_order: (job?.sort_order ?? 999) * 100 + i};
        });
        if (insert.length) {
          const made = await supabase.from("checklist_assignments").insert(insert);
          if (made.error) throw made.error;
        }
      }
      const floorPeople = people.map(p => ({shift_id: id, restaurant_id: restaurantId, user_id: p.user_id}));
      if (floorPeople.length) await supabase.from("checklist_floor").upsert(floorPeople, {onConflict: "shift_id,user_id", ignoreDuplicates: true});
      setMessage(rebuild ? "Started again from the schedule and sent." : isSent ? "Sections saved." : "Sent. Everyone sees their section and side work on their phone.");
      await load();
    } catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  }

  const chip = (l: Line) => {
    const job = jobs.find(j => j.id === l.jobId);
    const choices = people.filter(p => !job?.role || roleOf(p.shift_position) === job.role);
    if (moving === l.key) return <span key={l.key} className="sw-move">
      <select autoFocus aria-label={`Give ${l.title} to`} value={l.user_id ?? ""} onChange={e => void giveTo(l, e.target.value)} onBlur={() => setMoving(null)}>
        <option value="">Nobody yet</option>
        {(choices.length ? choices : people).map(p => <option key={p.user_id} value={p.user_id}>{p.name || "Team member"}</option>)}
      </select>
      <button type="button" className="sw-x" aria-label={`Remove ${l.title} for tonight`} onMouseDown={e => e.preventDefault()} onClick={() => void removeLine(l)}><X size={13} /></button>
    </span>;
    return <button key={l.key} type="button" className={`sw-chip${l.done ? " done" : ""}`} title="Tap to give it to someone else" onClick={() => setMoving(l.key)}>{l.done && <Check size={12} aria-hidden="true" />}{l.title}</button>;
  };
  const cells = (userId: string | null) => PHASES.map(phase => {
    const mine = lines.filter(l => l.phase === phase && (userId ? l.user_id === userId : !l.user_id || !people.some(p => p.user_id === l.user_id)));
    return <td key={phase} data-label={PHASE_LABEL[phase]}>{mine.length ? mine.map(chip) : <span className="sw-none">—</span>}</td>;
  });
  const personRow = (p: Working, role: "server" | "sa") => <tr key={p.user_id} className={closing.has(p.user_id) ? "closer" : ""}>
    <th scope="row"><b>{p.name || "Team member"}{closing.has(p.user_id) ? " ©" : ""}</b><small>{`${role === "server" ? "Server" : "S.A."} · ${clockOf(p.starts_at)}${closing.has(p.user_id) ? " · closer" : ""}`}</small></th>
    <td data-label="Section"><input className="sw-section" aria-label={`Section for ${p.name}`} maxLength={12} placeholder={role === "server" ? "#" : "1/2"} value={sectionOf(p.user_id, role)} onChange={e => setSection(p.user_id, role, e.target.value, p.name)} /></td>
    {cells(p.user_id)}
  </tr>;

  const step = (n: number, label: string, state: "done" | "now" | "next") => <span className={`sw-step ${state}`}>{state === "done" ? <Check size={13} aria-hidden="true" /> : <b>{n}</b>}{label}</span>;

  return <div className="sidework-today mt-4">
    <div className="floor-bar">
      <input type="date" aria-label="Day" value={day} onChange={e => e.target.value && setDay(e.target.value)} />
      <div className="category-tabs" role="group" aria-label="Service">
        {SERVICES.map(s => <button key={s} type="button" aria-pressed={service === s} onClick={() => setService(s)}>{s}</button>)}
      </div>
    </div>
    <Notice text={error} error /><Notice text={message} />
    {loading ? <p className="muted py-6" role="status">Working out the night…</p> : <>
      <div className="sw-head">
        <p className="sw-title">{`${longDay(day)} · ${service}`}</p>
        <div className="sw-steps" aria-label="Where things stand">
          {step(1, people.length ? "Schedule published" : "Publish the schedule", people.length ? "done" : "now")}
          {step(2, "Look it over", !people.length ? "next" : isSent ? "done" : "now")}
          {step(3, isSent ? "Sent" : "Send", isSent ? "done" : "next")}
        </div>
      </div>

      {!people.length ? <div className="sw-empty">
        <p className="font-semibold">Nobody is on the published schedule for this service yet.</p>
        <p className="muted text-sm">Side work is worked out from the schedule: publish who works, and their sections and tasks appear here.</p>
        {onOpenSchedule && <button type="button" className="btn mt-3" onClick={onOpenSchedule}>Open the schedule</button>}
      </div> : <>
        <p className="muted mb-2 text-xs">{`${servers.length} ${servers.length === 1 ? "server" : "servers"} and ${sas.length} ${sas.length === 1 ? "S.A." : "S.A.s"} on the schedule. © closes: whoever comes in last. Tap a task to give it to someone else.`}</p>
        <div className="sw-table-wrap">
          <table className="sw-table">
            <thead><tr><th scope="col">Person</th><th scope="col">Section</th>{PHASES.map(p => <th key={p} scope="col">{PHASE_LABEL[p]}</th>)}</tr></thead>
            <tbody>
              {servers.map(p => personRow(p, "server"))}
              {sas.map(p => personRow(p, "sa"))}
              {nobody.length > 0 && <tr className="sw-nobody"><th scope="row"><b>Nobody yet</b><small>Tap to give these out</small></th><td data-label="Section" />{cells(null)}</tr>}
            </tbody>
          </table>
        </div>
        {adding ? <form className="sw-add" onSubmit={addTask}>
          <input autoFocus aria-label="Task" maxLength={80} placeholder="Restock the bar fridge" value={adding.title} onChange={e => setAdding({...adding, title: e.target.value})} />
          <select aria-label="When" value={adding.phase} onChange={e => setAdding({...adding, phase: e.target.value as Phase})}>{PHASES.map(p => <option key={p} value={p}>{PHASE_LABEL[p]}</option>)}</select>
          <select aria-label="Who" value={adding.user_id} onChange={e => setAdding({...adding, user_id: e.target.value})}><option value="">Nobody yet</option>{people.map(p => <option key={p.user_id} value={p.user_id}>{p.name}</option>)}</select>
          <button type="submit" className="btn secondary" disabled={busy}>Add</button>
          <button type="button" className="btn secondary" onClick={() => setAdding(null)}>Cancel</button>
        </form> : <button type="button" className="btn secondary mt-3" onClick={() => setAdding({title: "", phase: "closing", user_id: ""})}><Plus size={14} />Add a task for tonight</button>}
        {unset > 0 && <p className="muted mt-2 text-xs">{`${unset} ${unset === 1 ? "task is" : "tasks are"} only given by hand (see Tasks).`}</p>}

        <div className="sw-send">
          {isSent ? <>
            <span className="muted text-xs">{sentAt ? `Sent at ${clockOf(sentAt)}. Task changes go out as you make them.` : "Sent."}</span>
            {floorDirty && <button type="button" className="btn" disabled={busy} onClick={() => void send()}>Save sections</button>}
            <button type="button" className="btn secondary" disabled={busy} onClick={() => void send(true)}><RefreshCw size={14} />Start again from the schedule</button>
          </> : <button type="button" className="btn sw-send-btn" disabled={busy} onClick={() => void send()}><Send size={15} />{busy ? "Sending…" : "Send to the team"}</button>}
        </div>
      </>}
    </>}
  </div>;
}
