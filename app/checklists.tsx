"use client";
// Checklists: the jobs a floor gets through before, during and after service -- napkins, ice
// buckets, side stations -- each with a name beside it. Managers build the jobs and hand them
// out; everyone else sees their own job and ticks it off.
//
// Jobs are the saved list: a name and a few small steps. Today (checklist-today.tsx) gives a job
// to a person for Lunch or Dinner; History (checklist-history.tsx) keeps the last 7 days.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, ChevronRight, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Notice, Field, ScreenHeader } from "./ui";
import { StepsEditor } from "./checklist-steps";
import { Today } from "./checklist-today";
import { MyShift } from "./checklist-mine";
import { History } from "./checklist-history";
import { SideworkLists, type SideworkList } from "./floor-plan";
import { MyShiftCard } from "./my-shift-card";
import { Tonight } from "./sidework-tonight";
import type { Phase, Role, Who } from "@/lib/sidework-plan";

// How a job hands itself out (051): when, to which role, one person / everyone / the closer, which weekdays.
export type Job = {id: string; name: string; group_name: string; steps: string[]; sort_order: number; phase?: Phase | null; role?: Role | null; who?: Who; days?: number[]};
type Draft = {name: string; steps: string[]; phase: Phase | ""; role: Role; who: Who; days: number[]};
type Tab = "tonight" | "setup" | "today" | "history";

const EMPTY: Draft = {name: "", steps: [""], phase: "", role: "server", who: "one", days: []};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TABS: Array<[Tab, string]> = [["tonight", "Tonight"], ["setup", "Setup"], ["history", "History"]];
const SECTIONS: Array<{key: string; title: string; hint: string; phase: Phase; role: Role}> = [
  {key: "server-opening", title: "Server opening", hint: "Before service, for servers.", phase: "opening", role: "server"},
  {key: "server-closing", title: "Server closing", hint: "After service, for servers.", phase: "closing", role: "server"},
  {key: "sa-opening", title: "S.A. opening", hint: "Before service, for S.A.s.", phase: "opening", role: "sa"},
  {key: "sa-closing", title: "S.A. closing", hint: "After service, for S.A.s.", phase: "closing", role: "sa"},
];
// Inside a section, when and whose are already said: only who does it and on which days.
const whoText = (row: Job) => [row.who === "all" ? "Everyone" : row.who === "closer" ? "The closer" : "One person, rotating", row.days?.length ? row.days.map(d => WEEKDAYS[d]).join(" ") : "Every day"].join(" · ");

export function Checklists({restaurantId, canManage}: {restaurantId: string; canManage: boolean}) {
  const [tab, setTab] = useState<Tab>("tonight");
  // Setup's running side work lists, and the one open in its editor (a list, or "new").
  const [lists, setLists] = useState<SideworkList[]>([]);
  const [editingList, setEditingList] = useState<SideworkList | "new" | null>(null);
  // True while a single job or the Assign screen is open, when the tabs are put away.
  const [deep, setDeep] = useState(false);
  const [rows, setRows] = useState<Job[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<{row?: Job} | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    if (!supabase || !restaurantId) return;
    setLoading(true);
    const [result, saved] = await Promise.all([
      supabase.from("checklist_jobs").select("id, name, group_name, steps, sort_order, phase, role, who, days").eq("restaurant_id", restaurantId).eq("archived", false),
      supabase.from("running_sidework_lists").select("id, name, tasks").eq("restaurant_id", restaurantId).order("name"),
    ]);
    if (result.error) setError(explain(result.error)); else setRows((result.data ?? []) as Job[]);
    if (!saved.error) setLists((saved.data ?? []) as SideworkList[]);
    setLoading(false);
  }, [restaurantId]);
  useEffect(() => { void load(); }, [load]);

  function explain(e: unknown) {
    const text = e instanceof Error ? e.message : String((e as {message?: string})?.message ?? e);
    return /checklist_jobs|PGRST205|42P01/.test(text) ? "Checklists can’t be saved yet: the database update (033) hasn’t been run in Supabase." : text;
  }
  async function run(work: () => Promise<void>, done: string) {
    if (!supabase) return;
    setBusy(true); setError(""); setMessage("");
    try { await work(); await load(); setMessage(done); }
    catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  }

  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));

  function closeForm() { setForm(null); setConfirmDelete(false); setError(""); }
  // A new job opened from a section of Setup already knows when it is and whose it is.
  function openForm(row?: Job, preset?: {phase: Phase | ""; role: Role}) {
    setDraft(row ? {name: row.name, steps: row.steps.length ? [...row.steps] : [""], phase: row.phase ?? "", role: row.role ?? "server", who: row.who ?? "one", days: row.days ?? []} : {...EMPTY, ...(preset ?? {})});
    setForm({row}); setError(""); setMessage(""); setConfirmDelete(false);
    window.scrollTo(0, 0);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const row = form?.row;
    const name = draft.name.trim();
    const steps = draft.steps.map(step => step.trim()).filter(Boolean);
    if (!name) { setError("Give it a name."); return; }
    if (!steps.length) { setError("A job needs at least one step."); return; }
    const clash = rows.find(r => r.name.trim().toLowerCase() === name.toLowerCase() && r.id !== row?.id);
    if (clash) { setError("“" + clash.name + "” already exists. Find it in the list and tap it."); return; }
    await run(async () => {
      const values = {name, steps, phase: draft.phase || null, role: draft.phase ? draft.role : null, who: draft.who, days: draft.days, updated_at: new Date().toISOString()};
      const result = row
        ? await supabase!.from("checklist_jobs").update(values).eq("id", row.id).eq("restaurant_id", restaurantId)
        : await supabase!.from("checklist_jobs").insert({...values, group_name: "", restaurant_id: restaurantId, sort_order: rows.reduce((top, r) => Math.max(top, r.sort_order), 0) + 1});
      if (result.error) throw result.error;
      closeForm();
    }, "Saved “" + name + "”.");
  }
  // Removing a job archives it: it leaves the list and stops being handed out, but past shifts keep
  // pointing at it, so the rotation still knows who did it. Its name is free to use again.
  const remove = (row: Job) => run(async () => {
    const result = await supabase!.from("checklist_jobs").update({archived: true, updated_at: new Date().toISOString()}).eq("id", row.id).eq("restaurant_id", restaurantId);
    if (result.error) throw result.error;
    closeForm();
  }, "“" + row.name + "” was deleted.");

  // One job on a screen of its own: add it, or change it.
  if (canManage && form) {
    const row = form.row;
    return <section className="mx-auto max-w-3xl">
      <button className="btn secondary" disabled={busy} onClick={closeForm}><ArrowLeft size={16} />Setup</button>
      <p className="eyebrow muted mt-5">{draft.phase ? `${draft.role === "sa" ? "S.A." : "Server"} ${draft.phase}` : "Given by hand"}</p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{row ? row.name : "New job"}</h1>
      <div><Notice text={error} error /></div>
      <form className="mt-5 space-y-5" onSubmit={save}>
        <fieldset disabled={busy} className="space-y-5">
          <Field label="Name"><input id="job-name" maxLength={80} value={draft.name} onChange={e => setDraft({...draft, name: e.target.value})} placeholder="Silverware" required /></Field>
          <StepsEditor steps={draft.steps} onChange={steps => setDraft({...draft, steps})} idPrefix="job-step" />
          <fieldset className="job-rules">
            <legend>Hand it out on its own</legend>
            <Field label="When"><select id="job-phase" value={draft.phase} onChange={e => setDraft({...draft, phase: e.target.value as Phase | ""})}>
              <option value="">Not automatic (I give it by hand)</option><option value="opening">Opening</option><option value="closing">Closing</option>
            </select></Field>
            {draft.phase && <>
              <Field label="For"><select id="job-role" value={draft.role} onChange={e => setDraft({...draft, role: e.target.value as Role})}><option value="server">Servers</option><option value="sa">S.A.s</option></select></Field>
              <Field label="Who does it"><select id="job-who" value={draft.who} onChange={e => setDraft({...draft, who: e.target.value as Who})}>
                <option value="one">One person, rotating every day</option><option value="all">Everyone</option><option value="closer">The closer (whoever comes in last)</option>
              </select></Field>
              <div className="field"><label id="job-days-label">Days</label>
                <div className="word-chips" role="group" aria-labelledby="job-days-label">{WEEKDAYS.map((d, i) => <button key={d} type="button" className="word-chip" aria-pressed={draft.days.includes(i)} onClick={() => setDraft({...draft, days: draft.days.includes(i) ? draft.days.filter(x => x !== i) : [...draft.days, i].sort()})}>{d}</button>)}</div>
                <p className="muted mt-1 text-xs">{draft.days.length ? "Only on the days marked." : "Every day. Mark days to limit it."}</p>
              </div>
            </>}
          </fieldset>
          <button className="btn w-full" type="submit">{busy ? "Saving…" : "Save job"}</button>
          {row && (confirmDelete
            ? <div className="flex flex-wrap gap-3"><button className="btn secondary card-admin-danger" type="button" onClick={() => void remove(row)}>Yes, delete</button><button className="btn secondary" type="button" onClick={() => setConfirmDelete(false)}>Keep</button></div>
            : <button className="btn secondary w-full card-admin-danger" type="button" onClick={() => setConfirmDelete(true)}>Delete job</button>)}
        </fieldset>
      </form>
    </section>;
  }

  // Everyone else sees their own job and the floor, nothing to set up.
  if (!canManage) return <section className="mx-auto max-w-3xl">
    <ScreenHeader eyebrow="Know the floor" title="Side work" info="Your job for this shift, and how the rest of the floor is doing." />
    <MyShiftCard restaurantId={restaurantId} />
    <MyShift restaurantId={restaurantId} />
  </section>;

  return <section className="mx-auto max-w-3xl">
    <ScreenHeader
      eyebrow="Manager workspace"
      title="Side work"
      info="Who does which job before, during and after service, and when it is done."
    />
    {!editingList && !(tab === "today" && deep) && <div className="category-tabs" role="group" aria-label="Side work">
      {TABS.map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} style={{fontWeight: 700, border: "1.5px solid var(--edge)"}} onClick={() => {setTab(key); setError(""); setMessage("");}}>{label}</button>)}
    </div>}
    <div><Notice text={error} error /><Notice text={message} /></div>
    {tab === "tonight" && <Tonight restaurantId={restaurantId} />}
    {tab === "today" && <Today restaurantId={restaurantId} jobs={rows} onOpenSaved={() => setTab("setup")} onSavedJobsChanged={() => void load()} onDeep={setDeep} />}
    {tab === "history" && <History restaurantId={restaurantId} />}
    {tab === "setup" && editingList && <SideworkLists restaurantId={restaurantId} lists={lists} initial={editingList} onBack={() => {setEditingList(null); void load();}} />}
    {tab === "setup" && !editingList && (loading ? <p className="muted py-6" role="status">Loading jobs…</p> : <div className="mt-4">
      <p className="muted mb-4 text-sm">Set up once. Every day Tonight hands these out to whoever is on the schedule.</p>
      {/* One section per kind of side work, in the order of a shift, each with its own Add. */}
      {SECTIONS.map(section => {
        const group = sorted.filter(row => row.phase === section.phase && row.role === section.role);
        return <section key={section.key} className="setup-section" aria-labelledby={`setup-${section.key}`}>
          <div className="setup-section-head">
            <div><h3 id={`setup-${section.key}`}>{section.title}</h3><p className="muted text-xs">{section.hint}</p></div>
            <span className="setup-count">{group.length}</span>
          </div>
          {group.length ? <div className="space-y-2">{group.map(row => <button key={row.id} type="button" className="setup-job" onClick={() => openForm(row)}>
            <span className="min-w-0 flex-1"><b>{row.name}</b><small>{whoText(row)}</small></span>
            <ChevronRight size={16} className="muted shrink-0" aria-hidden="true" />
          </button>)}</div> : <p className="muted text-xs">Nothing here yet.</p>}
          <button type="button" className="setup-add" onClick={() => openForm(undefined, {phase: section.phase, role: section.role})}><Plus size={14} />{`Add to ${section.title}`}</button>
        </section>;
      })}
      <section className="setup-section" aria-labelledby="setup-running">
        <div className="setup-section-head">
          <div><h3 id="setup-running">Running side work</h3><p className="muted text-xs">What servers keep an eye on during service. Tonight picks the list that matches how many servers work.</p></div>
          <span className="setup-count">{lists.length}</span>
        </div>
        {lists.length ? <div className="space-y-2">{lists.map(list => <button key={list.id} type="button" className="setup-job" onClick={() => setEditingList(list)}>
          <span className="min-w-0 flex-1"><b>{list.name}</b><small>{list.tasks.join(" · ")}</small></span>
          <ChevronRight size={16} className="muted shrink-0" aria-hidden="true" />
        </button>)}</div> : <p className="muted text-xs">Nothing here yet.</p>}
        <button type="button" className="setup-add" onClick={() => setEditingList("new")}><Plus size={14} />Add a running side work list</button>
      </section>
      {(() => {
        const byHand = sorted.filter(row => !row.phase || !row.role);
        return <section className="setup-section quiet" aria-labelledby="setup-hand">
          <div className="setup-section-head">
            <div><h3 id="setup-hand">Given by hand</h3><p className="muted text-xs">Not handed out on their own. Give them for a day from here.</p></div>
            <span className="setup-count">{byHand.length}</span>
          </div>
          {byHand.length > 0 && <div className="space-y-2">{byHand.map(row => <button key={row.id} type="button" className="setup-job" onClick={() => openForm(row)}>
            <span className="min-w-0 flex-1"><b>{row.name}</b><small>{`${row.steps.length} ${row.steps.length === 1 ? "step" : "steps"}`}</small></span>
            <ChevronRight size={16} className="muted shrink-0" aria-hidden="true" />
          </button>)}</div>}
          <div className="flex flex-wrap gap-2">
            <button type="button" className="setup-add" onClick={() => openForm(undefined, {phase: "", role: "server"})}><Plus size={14} />Add a job</button>
            <button type="button" className="setup-add" onClick={() => setTab("today")}>Give a job for a day</button>
          </div>
        </section>;
      })()}
    </div>)}
  </section>;
}
