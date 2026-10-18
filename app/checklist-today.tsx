"use client";
// Checklists, the Today tab. Pick Lunch or Dinner, then give a saved job to a person. That is
// all: the person sees it on their Home screen straight away. Change who has a job, or delete
// it, by tapping it in the list.
//
// Every job is copied onto the shift, so editing a saved job later never rewrites a shift that
// already happened.
import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Notice, Field } from "./ui";
import { StepsEditor } from "./checklist-steps";
import { MyShift, Status, clock } from "./checklist-mine";
import { trimOld } from "./checklist-history";
import type { Job } from "./checklists";

type Person = {user_id: string; name: string};
type Shift = {id: string; label: string; status: "draft" | "posted" | "closed"; shift_date: string};
type Assignment = {id: string; shift_id: string; job_id: string | null; title: string; group_name: string; steps: string[]; user_id: string | null; sort_order: number; steps_done: number[]; done_at: string | null; note: string};
type Screen = "home" | "assign" | "change";

const SERVICES = ["Lunch", "Dinner"];
const ASSIGNMENT_COLUMNS = "id, shift_id, job_id, title, group_name, steps, user_id, sort_order, steps_done, done_at, note";

// The restaurant's own calendar day, not the server's.
function localDate() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const dayName = () => new Date().toLocaleDateString(undefined, {weekday: "long"});
const defaultService = () => new Date().getHours() < 16 ? "Lunch" : "Dinner";

function Initial({name}: {name: string}) {
  return <span aria-hidden="true" style={{display: "inline-flex", alignItems: "center", justifyContent: "center", width: 38, height: 38, flexShrink: 0, borderRadius: "50%", fontWeight: 700, fontSize: 15, color: "var(--ink)", border: "1.5px solid var(--c-line-5)"}}>{(name.trim()[0] ?? "?").toUpperCase()}</span>;
}

export function Today({restaurantId, jobs, onOpenSaved, onSavedJobsChanged, onDeep}: {restaurantId: string; jobs: Job[]; onOpenSaved: () => void; onSavedJobsChanged?: () => void; onDeep?: (deep: boolean) => void}) {
  const [screen, setScreen] = useState<Screen>("home");
  const [people, setPeople] = useState<Person[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [items, setItems] = useState<Assignment[]>([]);
  const [service, setService] = useState(defaultService);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // The Assign screen.
  const [pickJob, setPickJob] = useState("");
  const [pickWho, setPickWho] = useState("");
  const [pickService, setPickService] = useState(defaultService);
  // The Change screen.
  const [openId, setOpenId] = useState("");
  const [giveTo, setGiveTo] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editing, setEditing] = useState(false);
  // Making a brand new job right on the Assign screen.
  const [newJob, setNewJob] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSteps, setNewSteps] = useState<string[]>([""]);

  function explain(e: unknown) {
    const text = e instanceof Error ? e.message : String((e as {message?: string})?.message ?? e);
    return /checklist_|PGRST205|42P01/.test(text) ? "Checklists can’t be saved yet: the database update (033) hasn’t been run in Supabase." : text;
  }

  const load = useCallback(async (quiet: boolean) => {
    if (!supabase || !restaurantId) return;
    if (!quiet) setLoading(true);
    try {
      const names = await supabase.rpc("checklist_names", {rid: restaurantId});
      if (names.error) throw names.error;
      setPeople((names.data ?? []) as Person[]);
      const today = await supabase.from("checklist_shifts").select("id, label, status, shift_date")
        .eq("restaurant_id", restaurantId).eq("shift_date", localDate()).order("created_at", {ascending: false});
      if (today.error) throw today.error;
      let list = (today.data ?? []) as Shift[];
      // There is no Post step any more, so a shift left as a draft from before goes live.
      const drafts = list.filter(s => s.status === "draft");
      if (drafts.length) {
        const live = await supabase.from("checklist_shifts").update({status: "posted", posted_at: new Date().toISOString()}).in("id", drafts.map(s => s.id));
        if (!live.error) list = list.map(s => s.status === "draft" ? {...s, status: "posted" as const} : s);
      }
      setShifts(list);
      if (list.length) {
        const found = await supabase.from("checklist_assignments").select(ASSIGNMENT_COLUMNS).in("shift_id", list.map(s => s.id)).order("sort_order");
        if (found.error) throw found.error;
        setItems((found.data ?? []) as Assignment[]);
      } else setItems([]);
      setError("");
    } catch (e) { setError(explain(e)); }
    setLoading(false);
  }, [restaurantId]);
  useEffect(() => { void load(false); void trimOld(restaurantId); }, [load, restaurantId]);
  // The Checklists tabs step aside while a single job or the Assign screen is open.
  useEffect(() => { onDeep?.(screen !== "home"); return () => onDeep?.(false); }, [screen]);
  // People tick their steps while you watch, so look again every half minute.
  useEffect(() => {
    if (screen !== "home") return;
    const timer = window.setInterval(() => void load(true), 30000);
    return () => window.clearInterval(timer);
  }, [screen, load]);

  // Opened from a job on the manager's Home screen: go straight to that job.
  useEffect(() => {
    if (loading || !items.length) return;
    let id = "";
    try { id = window.sessionStorage.getItem("heat-open-job") ?? ""; window.sessionStorage.removeItem("heat-open-job"); } catch { return; }
    const row = items.find(r => r.id === id);
    if (!row) return;
    const label = shifts.find(s => s.id === row.shift_id)?.label;
    if (label) setService(label);
    openRow(row);
  }, [loading, items]);

  async function work(job: () => Promise<void>) {
    setBusy(true); setError("");
    try { await job(); } catch (e) { setError(explain(e)); }
    setBusy(false);
  }

  const nameOf = (id: string | null) => people.find(p => p.user_id === id)?.name ?? "Nobody yet";
  const current = shifts.find(s => s.label === service);
  const rows = items.filter(row => row.shift_id === current?.id);
  const countFor = (label: string) => items.filter(row => row.shift_id === shifts.find(s => s.label === label)?.id).length;
  const done = rows.filter(row => row.done_at).length;
  const sortedJobs = [...jobs].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  function openAssign() {
    setPickJob(""); setPickWho(""); setPickService(service); setNewJob(false); setNewName(""); setNewSteps([""]); setError(""); setScreen("assign"); window.scrollTo(0, 0);
  }
  function openRow(row: Assignment) {
    setOpenId(row.id); setGiveTo(row.user_id ?? ""); setConfirmDelete(false); setEditing(!row.done_at); setError(""); setScreen("change"); window.scrollTo(0, 0);
  }

  const assign = () => work(async () => {
    let job: Job | undefined = jobs.find(j => j.id === pickJob);
    if (newJob || !jobs.length) {
      const name = newName.trim();
      const steps = newSteps.map(step => step.trim()).filter(Boolean);
      if (!name) { setError("Give the job a name."); return; }
      if (!steps.length) { setError("A job needs at least one step."); return; }
      const clash = jobs.find(j => j.name.trim().toLowerCase() === name.toLowerCase());
      if (clash) { setError("“" + clash.name + "” already exists. Tap it in the list above."); return; }
      const saved = await supabase!.from("checklist_jobs").insert({restaurant_id: restaurantId, name, group_name: "", steps, sort_order: jobs.reduce((top, j) => Math.max(top, j.sort_order), 0) + 1}).select("id, name, group_name, steps, sort_order").single();
      if (saved.error) throw saved.error;
      job = saved.data as Job;
      onSavedJobsChanged?.();
    }
    if (!job) { setError("Pick a job."); return; }
    if (!pickWho) { setError("Choose who does it."); return; }
    // The first job of a meal starts that meal's list; it is live for the team from the start.
    let target = shifts.find(s => s.label === pickService);
    if (!target) {
      const made = await supabase!.from("checklist_shifts").insert({restaurant_id: restaurantId, shift_date: localDate(), label: pickService, status: "posted", posted_at: new Date().toISOString()}).select("id, label, status, shift_date").single();
      if (made.error) throw made.error;
      target = made.data as Shift;
    } else if (target.status !== "posted") {
      const live = await supabase!.from("checklist_shifts").update({status: "posted", posted_at: new Date().toISOString()}).eq("id", target.id);
      if (live.error) throw live.error;
    }
    const shiftId = target.id;
    const sort = items.filter(row => row.shift_id === shiftId).reduce((top, r) => Math.max(top, r.sort_order), 0) + 1;
    const made = await supabase!.from("checklist_assignments").insert({shift_id: shiftId, restaurant_id: restaurantId, job_id: job.id, title: job.name, group_name: job.group_name, steps: job.steps, user_id: pickWho, locked: true, sort_order: sort});
    if (made.error) throw made.error;
    setService(pickService);
    await load(true);
    setScreen("home");
  });

  const save = (row: Assignment) => work(async () => {
    if (!giveTo) { setError("Choose who does it."); return; }
    if (giveTo !== row.user_id) {
      // A new person starts the job fresh.
      const moved = await supabase!.from("checklist_assignments").update({user_id: giveTo, locked: true, steps_done: [], done_at: null, note: ""}).eq("id", row.id);
      if (moved.error) throw moved.error;
      await load(true);
    }
    setScreen("home");
  });
  const remove = (row: Assignment) => work(async () => {
    const gone = await supabase!.from("checklist_assignments").delete().eq("id", row.id);
    if (gone.error) throw gone.error;
    setItems(list => list.filter(r => r.id !== row.id));
    setScreen("home");
  });

  const back = (label: string) => <button className="btn secondary" disabled={busy} onClick={() => {setError(""); setScreen("home");}}><ArrowLeft size={16} />{label}</button>;
  const toggle = (value: string, onPick: (next: string) => void, label: string) => <div className="category-tabs" role="group" aria-label={label}>
    {SERVICES.map(name => <button key={name} type="button" aria-pressed={value === name} style={{fontWeight: 700, border: "1.5px solid var(--edge)"}} onClick={() => onPick(name)}>{name}</button>)}
  </div>;

  if (loading) return <p className="muted py-6" role="status">Loading…</p>;

  // ---- Give a job to someone ----
  if (screen === "assign") {
    const making = newJob || !jobs.length;
    const ready = !!pickWho && (making ? !!newName.trim() && newSteps.some(step => step.trim()) : !!pickJob);
    return <div>
      {back("Checklists")}
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">Assign a job</h1>
      <div><Notice text={error} error /></div>
      <div className="mt-5 space-y-5">
        <fieldset className="field"><legend className="mb-2 block text-sm font-semibold">Job</legend>
          <div className="word-chips">
            {sortedJobs.map(job => <button key={job.id} type="button" className="word-chip" aria-pressed={!making && pickJob === job.id} onClick={() => {setPickJob(job.id); setNewJob(false);}}>{job.name}</button>)}
            <button type="button" className="word-chip" aria-pressed={making} onClick={() => setNewJob(true)}><Plus size={14} />New job</button>
          </div>
        </fieldset>
        {making && <div className="panel space-y-5 p-4">
          <Field label="Job name"><input id="assign-new-name" maxLength={80} value={newName} onChange={e => setNewName(e.target.value)} placeholder="Silverware" /></Field>
          <StepsEditor steps={newSteps} onChange={setNewSteps} idPrefix="assign-step" />
          <p className="muted text-xs">It is also saved in Jobs, so you can use it again.</p>
        </div>}
        <Field label="Who does it?">
          <select id="assign-who" value={pickWho} onChange={e => setPickWho(e.target.value)}>
            <option value="">Choose a person</option>
            {people.map(person => <option key={person.user_id} value={person.user_id}>{person.name}</option>)}
          </select>
        </Field>
        <fieldset className="field"><legend className="mb-2 block text-sm font-semibold">Which meal?</legend>
          {toggle(pickService, setPickService, "Meal")}
        </fieldset>
        <button className="btn w-full" disabled={busy || !ready} onClick={() => void assign()}>{busy ? "One moment…" : "Assign"}</button>
      </div>
    </div>;
  }

  // ---- Change who has a job, or delete it ----
  const row = items.find(r => r.id === openId);
  if (screen === "change" && row) {
    const label = shifts.find(s => s.id === row.shift_id)?.label ?? "";
    return <div>
      {back("Checklists")}
      <p className="eyebrow muted mt-5">{dayName()} · {label}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{row.title}</h1>
      <p className="muted mt-1 text-sm">{nameOf(row.user_id) + " · "}{row.done_at ? "Done " + clock(row.done_at) : row.steps_done.length ? row.steps_done.length + " of " + row.steps.length + " steps" : "Not started"}</p>
      <div><Notice text={error} error /></div>
      <div className="panel mt-5 p-5">
        <ol className="space-y-2">{row.steps.map((step, i) => <li key={i} className="flex items-start gap-2 text-sm">
          <span aria-hidden="true" style={{display: "inline-flex", alignItems: "center", justifyContent: "center", width: 20, height: 20, flexShrink: 0, borderRadius: 6, border: "1.5px solid var(--c-line-5)", fontSize: 12}}>{row.steps_done.includes(i + 1) ? "✓" : ""}</span>
          <span>{step}</span>
        </li>)}</ol>
        {!!row.note.trim() && <p className="mt-3 rounded-xl p-3 text-sm" style={{background: "var(--c-raised)"}}><b>Note from {nameOf(row.user_id)}:</b> {row.note}</p>}
      </div>
      {!editing ? <button className="btn secondary mt-5 w-full" onClick={() => setEditing(true)}>Change person or delete</button> : <div className="mt-5 space-y-5">
        <Field label="Give this job to">
          <select id="change-who" value={giveTo} onChange={e => setGiveTo(e.target.value)}>
            {!giveTo && <option value="">Choose a person</option>}
            {people.map(person => <option key={person.user_id} value={person.user_id}>{person.name}</option>)}
          </select>
        </Field>
        <button className="btn w-full" disabled={busy} onClick={() => void save(row)}>{busy ? "One moment…" : "Save"}</button>
        {confirmDelete
          ? <div className="flex flex-wrap gap-3"><button className="btn secondary card-admin-danger" disabled={busy} onClick={() => void remove(row)}>Delete for good</button><button className="btn secondary" onClick={() => setConfirmDelete(false)}>Keep</button></div>
          : <button className="btn secondary w-full card-admin-danger" onClick={() => setConfirmDelete(true)}>Delete this job</button>}
      </div>}
    </div>;
  }

  // ---- The list for the meal ----
  return <div className="mt-2">
    <div><Notice text={error} error /></div>
    <MyShift key={items.map(r => r.id + (r.user_id ?? "")).join(",")} restaurantId={restaurantId} showFloor={false} />
    <p className="eyebrow muted">{dayName()}</p>
    <div className="category-tabs mt-3" role="group" aria-label="Meal">
      {SERVICES.map(name => <button key={name} type="button" aria-pressed={service === name} style={{fontWeight: 700, border: "1.5px solid var(--edge)"}} onClick={() => setService(name)}>{name} <span className="tab-count">{countFor(name)}</span></button>)}
    </div>
    {rows.length > 0
      ? <div className="panel mt-4" style={{padding: 0}}>
        <div style={{padding: "12px 16px", borderBottom: "1px solid var(--c-line)"}}>
          <div className="flex items-baseline justify-between gap-3"><span className="font-semibold">{service} jobs</span><span className="muted text-sm">{done} of {rows.length} done</span></div>
          <div aria-hidden="true" className="mt-2" style={{height: 6, borderRadius: 999, background: "var(--c-line-3)", overflow: "hidden"}}>
            <div style={{width: Math.round(done / rows.length * 100) + "%", height: "100%", background: "var(--ink)", transition: "width .2s"}} />
          </div>
        </div>
        {rows.map((r, index) => <button key={r.id} type="button" onClick={() => openRow(r)} className="flex w-full items-center gap-3 text-left" style={{padding: "12px 16px", borderBottom: index === rows.length - 1 ? undefined : "1px solid var(--c-line)"}}>
          <Initial name={nameOf(r.user_id)} />
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{r.title}</span>
            <span className="muted block text-xs">{nameOf(r.user_id)}</span>
          </span>
          <Status row={r} />
          <ChevronRight size={16} aria-hidden="true" />
        </button>)}
      </div>
      : <div className="panel mt-4 p-6"><p className="muted">{`No jobs for ${service} yet.`}</p></div>}
    <button className="btn mt-4" onClick={openAssign}><Plus size={14} />Assign a job</button>
  </div>;
}
