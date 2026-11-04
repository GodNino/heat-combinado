"use client";
// Tonight: the manager gives out tonight's side work by hand. Two tabs, Servers and S.A.s; in each, the
// people on the published schedule for that service sit on the left and the side work on the right,
// in three columns: opening, during the shift and closing. Tap a name, then a job, and it's theirs;
// the same on a computer and a phone. Nothing is handed out on its own.
//
// Until it's sent, the plan is only on this screen. Sending gives every job to its people, the same
// assignments side work has always used (checklist_assignments, one row per person on a job), so each
// person's phone shows theirs. After that, changes go out as they're made. A job someone already
// started can't be taken off them.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Notice } from "./ui";
import { defaultService, localDate, mainList, type SideworkList, type Working } from "./floor-plan";
import { SERVICES, closers, peopleIn, roleOf, weekdayOf, type Phase, type Role, type RuledJob, type SideRoles } from "@/lib/sidework-plan";
import { DayPill } from "./day-pill";
import { currentLang } from "./language";
import { FloorSections } from "./floor-sections";
import { notify } from "./notifications";

type Sent = {id: string; title: string; user_id: string | null; phase: Phase; done_at: string | null; job_id: string | null; steps_done: number[]};
// One person on one job: saved (key is its row id) or only on this screen (key starts with "draft-").
type Line = {key: string; title: string; user_id: string; phase: Phase; jobId: string | null; started?: boolean};
// A job on the board: a saved job for this role and weekday, or a job only the assignments still name.
type Card = {key: string; title: string; phase: Phase; jobId: string | null; running?: boolean};

const JOB_COLUMNS = "id, name, group_name, steps, sort_order, phase, role, who, days";
const PHASES: [Phase, string][] = [["opening", "Opening"], ["during", "During the shift"], ["closing", "Closing"]];
const TEAMS: [Role, string][] = [["server", "Servers"], ["sa", "S.A.s"]];
// The day in the app's language; the service name is its own text so the app translates it.
const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(currentLang() === "es" ? "es" : undefined, {weekday: "long", month: "long", day: "numeric"});
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"});

export function Tonight({restaurantId, onOpenSchedule}: {restaurantId: string; onOpenSchedule?: () => void}) {
  const [day, setDay] = useState(localDate);
  const [service, setService] = useState<string>(defaultService);
  const [team, setTeam] = useState<Role>("server");
  const [working, setWorking] = useState<Working[]>([]);
  const [jobs, setJobs] = useState<RuledJob[]>([]);
  // The running side work tasks from Setup, shown under the servers' "During the shift".
  const [running, setRunning] = useState<string[]>([]);
  // Which positions are servers and S.A.s here (Schedule > Settings, 060).
  const [roles, setRoles] = useState<SideRoles>({});
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  // What the manager has given out on this screen, before it's sent.
  const [draft, setDraft] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  // The name tapped, waiting for a job.
  const [picked, setPicked] = useState<string | null>(null);
  // Side work (the board) or Sections (the floor map).
  const [view, setView] = useState<"sidework" | "sections">("sidework");
  const drafted = useRef(0);

  const explain = (e: unknown) => {
    const text = e instanceof Error ? e.message : String((e as {message?: string})?.message ?? e);
    return /phase_check/.test(text) ? "During-the-shift side work needs database update 052." : /phase|who|floor_plan|PGRST20[0-9]|42P01|42703|42883/.test(text) ? "Tonight needs the database updates (050 and 051)." : text;
  };

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true); setError(""); setPicked(null);
    try {
      // Read on its own: before database update 060 the columns aren't there, and the usual names apply.
      void supabase.from("schedule_settings").select("server_positions, sa_positions").eq("restaurant_id", restaurantId).maybeSingle()
        .then(({data, error}) => setRoles(error || !data ? {} : data as SideRoles));
      const [people, savedJobs, shift, lists] = await Promise.all([
        supabase.rpc("floor_plan_people", {rid: restaurantId, day}),
        supabase.from("checklist_jobs").select(JOB_COLUMNS).eq("restaurant_id", restaurantId).eq("archived", false),
        supabase.from("checklist_shifts").select("id, posted_at").eq("restaurant_id", restaurantId).eq("shift_date", day).eq("label", service).maybeSingle(),
        supabase.from("running_sidework_lists").select("id, name, tasks").eq("restaurant_id", restaurantId),
      ]);
      for (const r of [people, savedJobs, shift]) if (r.error) throw r.error;
      setWorking((people.data ?? []) as Working[]);
      setJobs((savedJobs.data ?? []) as RuledJob[]);
      // Without the list (or before its table exists) the column just shows the saved jobs.
      const tasks = lists.error ? [] : mainList((lists.data ?? []) as SideworkList[])?.tasks ?? [];
      setRunning([...new Set(tasks.map(t => t.trim()).filter(Boolean))]);
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
      setDraft([]);
    } catch (e) { setError(explain(e)); }
    finally { setLoading(false); }
  }, [restaurantId, day, service]);
  useEffect(() => { void load(); }, [load]);

  const people = useMemo(() => peopleIn(service, working), [working, service]);
  const mine = people.filter(p => roleOf(p.shift_position, roles) === team).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.name.localeCompare(b.name));
  const closing = useMemo(() => new Set(closers(mine)), [mine]);
  const nameOf = (id: string) => working.find(p => p.user_id === id)?.name || "Team member";
  const roleOfPerson = (id: string) => roleOf(working.find(p => p.user_id === id)?.shift_position ?? "", roles);
  const isSent = sent.length > 0;
  const lines: Line[] = isSent
    ? sent.filter(s => s.user_id).map(s => ({key: s.id, title: s.title, user_id: s.user_id!, phase: s.phase, jobId: s.job_id, started: !!s.done_at || s.steps_done.length > 0}))
    : draft;

  // This tab's jobs: saved jobs for this role on tonight's weekday, plus any job its assignments still name.
  const weekday = weekdayOf(day);
  // "During the shift" is the same work for servers and S.A.s, so both tabs show every during job.
  const roleJobs = jobs.filter(j => j.phase && (j.role === team || j.phase === "during") && (!j.days?.length || j.days.includes(weekday)))
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const cards: Card[] = roleJobs.map(j => ({key: j.id, title: j.name, phase: j.phase!, jobId: j.id}));
  // "During the shift" also shows the running side work list, one card per task, for both teams.
  for (const task of running) if (!cards.some(c => c.title === task)) cards.push({key: `title-${task}`, title: task, phase: "during", jobId: null, running: true});
  for (const l of lines) {
    const key = l.jobId ?? `title-${l.title}`;
    if (!cards.some(c => c.key === key) && (l.phase === "during" || (jobs.find(j => j.id === l.jobId)?.role ?? roleOfPerson(l.user_id)) === team)) cards.push({key, title: l.title, phase: l.phase, jobId: l.jobId});
  }
  const onCard = (card: Card) => lines.filter(l => (l.jobId ?? `title-${l.title}`) === card.key);
  const jobsOf = (id: string) => cards.filter(c => onCard(c).some(l => l.user_id === id)).map(c => c.title);
  const named = cards.filter(c => onCard(c).length > 0).length;
  const unruled = jobs.filter(j => !j.phase).length;
  const teamLabel = team === "server" ? "Servers" : "S.A.s";

  // Give a job to a person; a job can have several people and a person several jobs.
  async function giveTo(card: Card, userId: string) {
    setMessage(""); setError(""); setPicked(null);
    if (roleOfPerson(userId) !== team) { setError(team === "server" ? "That job is for servers. Pick a server." : "That job is for S.A.s. Pick an S.A."); return; }
    if (onCard(card).some(l => l.user_id === userId)) return;
    if (!isSent) { setDraft(d => [...d, {key: `draft-${++drafted.current}`, title: card.title, user_id: userId, phase: card.phase, jobId: card.jobId}]); return; }
    const job = jobs.find(j => j.id === card.jobId);
    const made = await supabase!.from("checklist_assignments").insert({shift_id: shiftId, restaurant_id: restaurantId, job_id: card.jobId, title: card.title, group_name: job?.group_name ?? "", steps: job?.steps ?? [], user_id: userId, locked: true, phase: card.phase, sort_order: (job?.sort_order ?? 0) * 100 + 50 + ++drafted.current}).select("id, title, user_id, phase, done_at, job_id, steps_done").single();
    if (made.error) { setError(explain(made.error)); return; }
    setSent(s => [...s, made.data as Sent]);
  }

  // Take one person off a job. A job someone already started stays theirs.
  async function takeOff(line: Line) {
    setMessage(""); setError("");
    if (line.started) { setError("They already started this job, so it can't be taken off."); return; }
    if (!isSent) { setDraft(d => d.filter(l => l.key !== line.key)); return; }
    const gone = await supabase!.from("checklist_assignments").delete().eq("id", line.key);
    if (gone.error) { setError(explain(gone.error)); return; }
    setSent(s => s.filter(a => a.id !== line.key));
  }

  // Sending: open (or reuse) the service's side work and save who does what, for both tabs.
  async function send() {
    if (!supabase || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      let id = shiftId;
      if (!id) {
        const made = await supabase.from("checklist_shifts").insert({restaurant_id: restaurantId, shift_date: day, label: service, status: "posted", posted_at: new Date().toISOString()}).select("id").single();
        if (made.error) throw made.error;
        id = (made.data as {id: string}).id;
      } else {
        const live = await supabase.from("checklist_shifts").update({status: "posted", posted_at: new Date().toISOString()}).eq("id", id);
        if (live.error) throw live.error;
      }
      const insert = draft.map((l, i) => {
        const job = jobs.find(j => j.id === l.jobId);
        return {shift_id: id, restaurant_id: restaurantId, job_id: l.jobId, title: l.title, group_name: job?.group_name ?? "", steps: job?.steps ?? [], user_id: l.user_id, locked: true, phase: l.phase, sort_order: (job?.sort_order ?? 0) * 100 + i};
      });
      if (insert.length) {
        const made = await supabase.from("checklist_assignments").insert(insert);
        if (made.error) throw made.error;
      }
      const floorPeople = people.map(p => ({shift_id: id, restaurant_id: restaurantId, user_id: p.user_id}));
      if (floorPeople.length) await supabase.from("checklist_floor").upsert(floorPeople, {onConflict: "shift_id,user_id", ignoreDuplicates: true});
      // Everyone given a job gets a notification on their phone (062).
      if (id) notify("sidework_posted", id);
      setMessage("Sent. Everyone sees their side work on their phone and gets a notification. Sections are sent from Sections.");
      await load();
    } catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  }

  return <div className="tonight sw-board mt-4">
    <div className="sw-head">
      <div className="min-w-0">
        <p className="sw-eyebrow">Side work · Tonight</p>
        {/* The date is formatted in the browser's language, so it waits for the first load (no server mismatch). */}
        {!loading && <p className="tonight-title"><span data-no-translate>{longDay(day)}</span> · <span>{service}</span></p>}
      </div>
      {view === "sidework" && <div className="sw-head-actions">
        {isSent && sentAt ? <span className="muted text-sm">{`Sent ${clock(sentAt)} · changes go out as you make them`}</span>
          : <span className="swb-progress"><span>{`${named} of ${cards.length} jobs named`}</span><span className="swb-bar" aria-hidden="true"><i style={{width: cards.length ? `${named / cards.length * 100}%` : 0}} /></span></span>}
        {!isSent && <button type="button" className="btn" disabled={busy || !draft.length} onClick={() => void send()}>{busy ? "Sending…" : "Send to the team"}</button>}
      </div>}
    </div>
    <div className="floor-bar">
      <DayPill label="Day" value={day} onChange={setDay} />
      <div className="category-tabs" role="group" aria-label="Service">
        {SERVICES.map(s => <button key={s} type="button" aria-pressed={service === s} onClick={() => setService(s)}>{s}</button>)}
      </div>
    </div>
    <Notice text={error} error /><Notice text={message} />
    {loading ? <p className="muted py-6" role="status">Loading tonight…</p> : <>
      <div className="sw-tabs-row">
        <div className="fs-views">
        <div className="category-tabs" role="group" aria-label="Tonight view">
          <button type="button" aria-pressed={view === "sidework"} onClick={() => setView("sidework")}>Side work</button>
          <button type="button" aria-pressed={view === "sections"} onClick={() => {setView("sections"); setPicked(null);}}>Sections</button>
        </div>
        {view === "sidework" && <div className="category-tabs" role="group" aria-label="Team">
          {TEAMS.map(([role, label]) => <button key={role} type="button" aria-pressed={team === role} onClick={() => {setTeam(role); setPicked(null);}}>{label}</button>)}
        </div>}
        </div>
        {view === "sidework" && <p className="muted text-sm">{picked ? `${nameOf(picked)} is selected: tap a job.` : team === "server" ? "Tap a server, then a job." : "Tap an S.A., then a job."}</p>}
      </div>

      {view === "sections" ? <FloorSections restaurantId={restaurantId} day={day} service={service} people={people} roles={roles} onOpenSchedule={onOpenSchedule} /> : <>
      <div className="swb-grid">
        <section className="swb-card swb-people" aria-label={`${teamLabel} tonight`}>
          <div className="swb-card-head"><b>{`${teamLabel} tonight`}</b><span className="swb-count">{mine.length}</span></div>
          {mine.length ? <div className="swb-plist">{mine.map(p => {
            const theirs = jobsOf(p.user_id);
            const name = p.name || "Team member";
            return <button key={p.user_id} type="button" className="swb-person" aria-pressed={picked === p.user_id}
              onClick={() => setPicked(x => x === p.user_id ? null : p.user_id)}>
              <span className="swb-av" aria-hidden="true" data-no-translate>{name.trim()[0]?.toUpperCase()}</span>
              <span className="swb-who">
                <b data-no-translate>{name}</b>
                <small>{`${clock(p.starts_at)}${closing.has(p.user_id) ? " · ©" : ""} · `}{theirs.length ? <span data-no-translate>{theirs.join(", ")}</span> : "No jobs yet"}</small>
              </span>
              <span className="swb-tag">{theirs.length}</span>
            </button>;
          })}</div> : <><p className="muted text-sm">{team === "server" ? "No servers on the published schedule for this service." : "No S.A.s on the published schedule for this service."}</p>
            <p className="muted text-xs">Which positions count as servers and S.A.s is set in Schedule, Settings.</p>
            {onOpenSchedule && <div><button type="button" className="btn secondary" onClick={onOpenSchedule}>Open the schedule</button></div>}</>}
          <p className="swb-legend">© closes: whoever comes in last. A name can go on several jobs.</p>
        </section>

        <section className={`swb-phases${picked ? " ready" : ""}`} aria-label="Side work">
          {PHASES.map(([phase, label]) => {
            const column = cards.filter(c => c.phase === phase);
            const own = column.filter(c => !c.running), run = column.filter(c => c.running);
            const row = (card: Card) => {
              const who = onCard(card);
              const mineToo = picked && who.some(l => l.user_id === picked);
              // The whole row takes the tap; its title is the button for keyboards, and the x stays its own.
              return <div key={card.key} className="swb-job" onClick={e => { if (picked && !(e.target as HTMLElement).closest(".swb-pill button")) void giveTo(card, picked); }}>
                <button type="button" className="swb-job-title" aria-label={picked ? `Give ${card.title} to ${nameOf(picked)}` : card.title}><span data-no-translate>{card.title}</span></button>
                <span className="swb-names">
                  {who.map(l => <span key={l.key} className="swb-pill"><span data-no-translate>{nameOf(l.user_id)}</span>
                    {!l.started && <button type="button" aria-label={`Take ${nameOf(l.user_id)} off ${card.title}`} onClick={() => void takeOff(l)}><X size={11} aria-hidden="true" /></button>}</span>)}
                  {picked && !mineToo ? <span className="swb-add" data-no-translate>{`+ ${nameOf(picked).split(" ")[0]}`}</span> : !who.length && <span className="swb-empty">Nobody yet</span>}
                </span>
              </div>;
            };
            return <div key={phase} className="swb-card">
              <div className="swb-card-head"><p className="section-chip">{label}</p><span className="swb-count">{`${column.filter(c => onCard(c).length).length}/${column.length}`}</span></div>
              {column.length ? <div className="swb-rows">
                {own.map(row)}
                {run.length > 0 && <><p className="swb-sub">Running side work</p>{run.map(row)}</>}
              </div> : <p className="muted text-xs">Nothing set up for this yet (Setup).</p>}
            </div>;
          })}
        </section>
      </div>
      </>}
      {view === "sidework" && unruled > 0 && <p className="muted mt-4 text-xs">{`${unruled} ${unruled === 1 ? "job has" : "jobs have"} no time of the shift yet, so ${unruled === 1 ? "it isn't" : "they aren't"} on the board (Setup)`}</p>}
    </>}
  </div>;
}
