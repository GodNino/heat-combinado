"use client";
// Tonight: the whole night's side work, worked out from the published schedule, so the manager only
// has to look it over and send it. The floor (sections, S.A.s, running side work) comes from the
// floor plan (050); opening and closing jobs are handed out by their rules (051, lib/sidework-plan):
// one person rotating, everyone, or the closer -- whoever comes in last. The rotation reads the
// week before from side work already sent, so nobody gets the same job two days running.
//
// Until it's sent, the plan is only on this screen. Sending saves the floor plan and gives every job
// to its person, the same assignments side work has always used, so each person's phone shows it.
// After that, changing a name changes that assignment straight away.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, Pencil, RefreshCw, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Notice } from "./ui";
import { FloorPlan, defaultService, helpers, localDate, startingRows, suggestedList, type FloorRow, type Plan, type SideworkList, type Working } from "./floor-plan";
import { SERVICES, closers, dayNumber, peopleIn, planJobs, roleOf, type PastJob, type Phase, type Role, type RuledJob } from "@/lib/sidework-plan";
import { DayPill } from "./day-pill";

type Sent = {id: string; title: string; user_id: string | null; phase: Phase; done_at: string | null; job_id: string | null; steps_done: number[]};
type Line = {key: string; title: string; user_id: string | null; phase: Phase; done?: boolean; jobId?: string | null; who?: string};

const JOB_COLUMNS = "id, name, group_name, steps, sort_order, phase, role, who, days";
const PHASES: [Phase | "during", string][] = [["opening", "Opening"], ["during", "During the shift"], ["closing", "Closing"]];
// The rotation looks back a week (History keeps the same).
const weekBefore = (day: string) => new Date((dayNumber(day) - 7) * 864e5).toISOString().slice(0, 10);
const longDay = (day: string) => new Date(`${day}T12:00:00`).toLocaleDateString(undefined, {weekday: "long"});

export function Tonight({restaurantId}: {restaurantId: string}) {
  const [day, setDay] = useState(localDate);
  const [service, setService] = useState<string>(defaultService);
  const [working, setWorking] = useState<Working[]>([]);
  const [jobs, setJobs] = useState<RuledJob[]>([]);
  const [past, setPast] = useState<PastJob[]>([]);
  const [lists, setLists] = useState<SideworkList[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [shiftId, setShiftId] = useState<string | null>(null);
  const [sentAt, setSentAt] = useState<string | null>(null);
  const [sent, setSent] = useState<Sent[]>([]);
  // The plan worked out on this screen, before it's sent.
  const [draft, setDraft] = useState<Line[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingFloor, setEditingFloor] = useState(false);

  const explain = (e: unknown) => {
    const text = e instanceof Error ? e.message : String((e as {message?: string})?.message ?? e);
    return /floor_plans_service_check/.test(text) ? "Brunch needs database update 054." : /phase|who|floor_plan|running_sidework|PGRST20[0-9]|42P01|42703|42883/.test(text) ? "Tonight needs the database updates (050 and 051)." : text;
  };

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true); setError("");
    try {
      const [people, savedJobs, savedLists, floor, shift, before] = await Promise.all([
        supabase.rpc("floor_plan_people", {rid: restaurantId, day}),
        supabase.from("checklist_jobs").select(JOB_COLUMNS).eq("restaurant_id", restaurantId).eq("archived", false),
        supabase.from("running_sidework_lists").select("id, name, tasks").eq("restaurant_id", restaurantId).order("name"),
        supabase.from("floor_plans").select("id, service_date, service, list_id, rows, updated_at").eq("restaurant_id", restaurantId).eq("service_date", day).eq("service", service).maybeSingle(),
        supabase.from("checklist_shifts").select("id, posted_at").eq("restaurant_id", restaurantId).eq("shift_date", day).eq("label", service).maybeSingle(),
        supabase.from("checklist_shifts").select("id, shift_date").eq("restaurant_id", restaurantId).gte("shift_date", weekBefore(day)).lt("shift_date", day),
      ]);
      for (const r of [people, savedJobs, savedLists, floor, shift, before]) if (r.error) throw r.error;
      // Who did which job in the week before, so nobody gets the same job again tomorrow.
      const earlier = (before.data ?? []) as {id: string; shift_date: string}[];
      let history: PastJob[] = [];
      if (earlier.length) {
        const done = await supabase.from("checklist_assignments").select("shift_id, job_id, user_id").in("shift_id", earlier.map(s => s.id)).not("job_id", "is", null).not("user_id", "is", null);
        if (done.error) throw done.error;
        const dayOf = new Map(earlier.map(s => [s.id, s.shift_date]));
        history = ((done.data ?? []) as {shift_id: string; job_id: string; user_id: string}[]).map(a => ({job_id: a.job_id, user_id: a.user_id, day: dayOf.get(a.shift_id)!}));
      }
      setPast(history);
      const team = (people.data ?? []) as Working[];
      const ruled = (savedJobs.data ?? []) as RuledJob[];
      setWorking(team); setJobs(ruled); setLists((savedLists.data ?? []) as SideworkList[]); setPlan(floor.data as Plan | null);
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
      setDraft(planJobs(ruled, peopleIn(service, team), day, history).map((p, i) => ({key: `${p.job.id}-${i}`, title: p.job.name, user_id: p.user_id, phase: p.phase, jobId: p.job.id})));
    } catch (e) { setError(explain(e)); }
    finally { setLoading(false); }
  }, [restaurantId, day, service]);
  useEffect(() => { void load(); }, [load]);

  const people = useMemo(() => peopleIn(service, working), [working, service]);
  const nameOf = (id: string | null) => {
    const person = id ? working.find(p => p.user_id === id) : undefined;
    return person ? person.name || "Team member" : "Nobody yet";
  };
  const closing = useMemo(() => new Set([...closers(people.filter(p => roleOf(p.shift_position) === "server")), ...closers(people.filter(p => roleOf(p.shift_position) === "sa"))]), [people]);
  const servers = people.filter(p => roleOf(p.shift_position) === "server").length;
  const sas = people.filter(p => roleOf(p.shift_position) === "sa").length;
  // The floor: what was saved, or what the schedule suggests.
  const rows: FloorRow[] = useMemo(() => plan?.rows ?? startingRows(working, service, day, suggestedList(working, service, lists)), [plan, working, service, day, lists]);
  const isSent = sent.length > 0;
  const lines: Line[] = isSent ? sent.map(s => ({key: s.id, title: s.title, user_id: s.user_id, phase: s.phase, done: !!s.done_at, jobId: s.job_id})) : draft;
  const during: Line[] = rows.filter(r => r.task).map((r, i) => ({key: `during-${i}`, title: r.task, user_id: r.server_id, phase: "opening", who: r.server_name || (r.section ? "Pick-up" : "")}));
  const unruled = jobs.filter(j => !j.phase).length;
  // Which side of the floor a task belongs to: its job says so; failing that, whoever has it.
  const lineRole = (l: Line): Role => jobs.find(j => j.id === l.jobId)?.role ?? (roleOf(working.find(p => p.user_id === l.user_id)?.shift_position ?? "") ?? "server");
  const choicesFor = (line: Line) => {
    const role = jobs.find(j => j.id === line.jobId)?.role;
    const same = people.filter(p => !role || roleOf(p.shift_position) === role);
    return same.length ? same : people;
  };

  async function changePerson(line: Line, userId: string) {
    setMessage("");
    if (!isSent) { setDraft(d => d.map(l => l.key === line.key ? {...l, user_id: userId || null} : l)); return; }
    const result = await supabase!.from("checklist_assignments").update({user_id: userId || null, locked: true}).eq("id", line.key);
    if (result.error) { setError(explain(result.error)); return; }
    setSent(s => s.map(a => a.id === line.key ? {...a, user_id: userId || null} : a));
  }

  // Sending: save the floor, open (or reuse) the service's side work, and give each job to its person.
  // Jobs someone already started are left alone when it's sent again.
  async function send(rebuild = false) {
    if (!supabase || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const me = (await supabase.auth.getUser()).data.user?.id;
      if (!plan || rebuild) {
        const floor = await supabase.from("floor_plans").upsert({restaurant_id: restaurantId, service_date: day, service, list_id: plan?.list_id ?? suggestedList(working, service, lists)?.id ?? null, rows: rebuild ? startingRows(working, service, day, lists.find(l => l.id === plan?.list_id) ?? suggestedList(working, service, lists)) : rows, updated_at: new Date().toISOString(), updated_by: me}, {onConflict: "restaurant_id,service_date,service"});
        if (floor.error) throw floor.error;
      }
      let id = shiftId;
      if (!id) {
        const made = await supabase.from("checklist_shifts").insert({restaurant_id: restaurantId, shift_date: day, label: service, status: "posted", posted_at: new Date().toISOString()}).select("id").single();
        if (made.error) throw made.error;
        id = (made.data as {id: string}).id;
      } else {
        const live = await supabase.from("checklist_shifts").update({status: "posted", posted_at: new Date().toISOString()}).eq("id", id);
        if (live.error) throw live.error;
      }
      const fresh = rebuild || !isSent ? (rebuild ? planJobs(jobs, people, day, past).map((p, i) => ({key: String(i), title: p.job.name, user_id: p.user_id, phase: p.phase, jobId: p.job.id})) : draft) : [];
      if (isSent && rebuild) {
        const cleared = await supabase.from("checklist_assignments").delete().eq("shift_id", id).not("phase", "is", null).is("done_at", null).eq("steps_done", "{}");
        if (cleared.error) throw cleared.error;
      }
      const started = new Set(sent.filter(s => s.done_at || s.steps_done.length).map(s => `${s.job_id}|${s.user_id}`));
      const insert = fresh.filter(l => !started.has(`${l.jobId}|${l.user_id}`)).map((l, i) => {
        const job = jobs.find(j => j.id === l.jobId);
        return {shift_id: id, restaurant_id: restaurantId, job_id: l.jobId ?? null, title: l.title, group_name: job?.group_name ?? "", steps: job?.steps ?? [], user_id: l.user_id, phase: l.phase, sort_order: (job?.sort_order ?? 0) * 100 + i};
      });
      if (insert.length) {
        const made = await supabase.from("checklist_assignments").insert(insert);
        if (made.error) throw made.error;
      }
      const floorPeople = people.map(p => ({shift_id: id, restaurant_id: restaurantId, user_id: p.user_id}));
      if (floorPeople.length) await supabase.from("checklist_floor").upsert(floorPeople, {onConflict: "shift_id,user_id", ignoreDuplicates: true});
      setMessage(rebuild ? "Rebuilt from the schedule and sent." : "Sent. Everyone sees their section and side work on their phone.");
      await load();
    } catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  }

  if (editingFloor) return <FloorPlan restaurantId={restaurantId} initialDay={day} initialService={service} onBack={() => {setEditingFloor(false); void load();}} />;

  return <div className="tonight mt-4">
    <div className="floor-bar">
      <DayPill label="Day" value={day} onChange={setDay} />
      <div className="category-tabs" role="group" aria-label="Service">
        {SERVICES.map(s => <button key={s} type="button" aria-pressed={service === s} onClick={() => setService(s)}>{s}</button>)}
      </div>
    </div>
    <Notice text={error} error /><Notice text={message} />
    {loading ? <p className="muted py-6" role="status">Working out tonight…</p> : <>
      <div className="tonight-head">
        <div className="min-w-0">
          <p className="tonight-title">{`${longDay(day)} · ${service}`}</p>
          <p className="muted text-xs">{people.length ? `From the schedule: ${servers} ${servers === 1 ? "server" : "servers"}, ${sas} ${sas === 1 ? "S.A." : "S.A.s"}` : "Nobody on the published schedule for this service yet."}</p>
          <p className="muted text-xs">{isSent && sentAt ? `Sent ${new Date(sentAt).toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"})}. Changes go out as you make them.` : "Not sent yet. Look it over, then send it."}</p>
        </div>
        <div className="tonight-actions">
          {isSent && <button type="button" className="btn secondary" disabled={busy} onClick={() => void send(true)}><RefreshCw size={14} />Rebuild</button>}
          {!isSent && <button type="button" className="btn" disabled={busy || !people.length} onClick={() => void send()}><Send size={14} />{busy ? "Sending…" : "Send to the team"}</button>}
        </div>
      </div>

      <section className="tonight-block" aria-label="Floor">
        <div className="tonight-block-head"><h3>Floor</h3><button type="button" className="btn secondary" onClick={() => setEditingFloor(true)}><Pencil size={13} />Edit floor</button></div>
        {rows.length ? <div className="tonight-sections">{rows.map((r, i) => <div key={i} className={`tonight-section${r.server_id && closing.has(r.server_id) ? " closer" : ""}`}>
          <b>{r.section || "—"}</b><span>{r.server_name || "Pick-up"}{r.server_id && closing.has(r.server_id) && <span className="sched-kind" role="img" aria-label="Closer" title="Closer">C</span>}</span>
          {r.sa.length > 0 && <small>{helpers(r.sa)}</small>}
        </div>)}</div> : <p className="muted text-sm">No servers on the schedule for this service.</p>}
        {closing.size > 0 && <p className="muted mt-2 text-xs">{`Closer: ${[...closing].map(nameOf).join(", ")}. Whoever comes in last closes.`}</p>}
      </section>

      {unruled > 0 && <p className="muted mt-4 text-xs">{`${unruled} ${unruled === 1 ? "job isn't" : "jobs aren't"} set up to hand out yet (Setup)`}</p>}
      {(["server", "sa"] as Role[]).map(role => {
        // During the shift: servers keep their running side work; S.A.s cover the sections they're on.
        const duringFor: Line[] = role === "server" ? during : people.filter(p => roleOf(p.shift_position) === "sa").map(p => {
          const covers = rows.filter(r => r.sa.some(h => h.id === p.user_id)).map(r => r.section).filter(Boolean);
          return {key: `cover-${p.user_id}`, title: covers.length ? `Sections ${covers.join("/")}` : "No section yet", user_id: p.user_id, phase: "opening" as Phase, who: p.name || "Team member"};
        });
        return <section key={role} className={`tonight-block tonight-role ${role}`} aria-label={role === "server" ? "Side work · Servers" : "Side work · S.A.s"}>
          <div className="tonight-block-head"><h3>{role === "server" ? "Side work · Servers" : "Side work · S.A.s"}</h3></div>
          <div className="tonight-phases">
            {PHASES.map(([phase, label]) => {
              const list = phase === "during" ? duringFor : lines.filter(l => l.phase === phase && lineRole(l) === role);
              return <div key={phase} className="tonight-phase">
                <p className="tonight-phase-title">{label}</p>
                {list.length ? list.map(l => <div key={l.key} className="tonight-line">
                  <span className="min-w-0">{l.done && <Check size={13} aria-label="Done" />}{l.title}</span>
                  {phase === "during"
                    ? <small>{l.who || nameOf(l.user_id)}</small>
                    : <select aria-label={`Who does ${l.title}`} value={l.user_id ?? ""} onChange={e => void changePerson(l, e.target.value)}>
                        <option value="">Nobody yet</option>
                        {choicesFor(l).map(p => <option key={p.user_id} value={p.user_id}>{`${p.name || "Team member"}${closing.has(p.user_id) ? " · Closer" : ""}`}</option>)}
                      </select>}
                </div>) : <p className="muted text-xs">{phase === "during" ? (role === "server" ? "Comes from the floor plan's running side work." : "No S.A.s on the schedule.") : "Nothing set up for this yet."}</p>}
              </div>;
            })}
          </div>
        </section>;
      })}
    </>}
  </div>;
}
