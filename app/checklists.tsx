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

export type Job = {id: string; name: string; group_name: string; steps: string[]; sort_order: number};
type Draft = {name: string; steps: string[]};
type Tab = "today" | "saved" | "history";

const EMPTY: Draft = {name: "", steps: [""]};
const TABS: Array<[Tab, string]> = [["today", "Today"], ["saved", "Jobs"], ["history", "History"]];

export function Checklists({restaurantId, canManage}: {restaurantId: string; canManage: boolean}) {
  const [tab, setTab] = useState<Tab>("today");
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
    const result = await supabase.from("checklist_jobs").select("id, name, group_name, steps, sort_order")
      .eq("restaurant_id", restaurantId).eq("archived", false);
    if (result.error) setError(explain(result.error)); else setRows((result.data ?? []) as Job[]);
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
  function openForm(row?: Job) {
    setDraft(row ? {name: row.name, steps: row.steps.length ? [...row.steps] : [""]} : EMPTY);
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
      const values = {name, steps, updated_at: new Date().toISOString()};
      const result = row
        ? await supabase!.from("checklist_jobs").update(values).eq("id", row.id).eq("restaurant_id", restaurantId)
        : await supabase!.from("checklist_jobs").insert({...values, group_name: "", restaurant_id: restaurantId, sort_order: rows.reduce((top, r) => Math.max(top, r.sort_order), 0) + 1});
      if (result.error) throw result.error;
      closeForm();
    }, "Saved “" + name + "”.");
  }
  const remove = (row: Job) => run(async () => {
    const result = await supabase!.from("checklist_jobs").delete().eq("id", row.id).eq("restaurant_id", restaurantId);
    if (result.error) throw result.error;
    closeForm();
  }, "“" + row.name + "” was deleted.");

  // One job on a screen of its own: add it, or change it.
  if (canManage && form) {
    const row = form.row;
    return <section className="mx-auto max-w-3xl">
      <button className="btn secondary" disabled={busy} onClick={closeForm}><ArrowLeft size={16} />Jobs</button>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">{row ? row.name : "New job"}</h1>
      <div><Notice text={error} error /></div>
      <form className="mt-5 space-y-5" onSubmit={save}>
        <fieldset disabled={busy} className="space-y-5">
          <Field label="Name"><input id="job-name" maxLength={80} value={draft.name} onChange={e => setDraft({...draft, name: e.target.value})} placeholder="Silverware" required /></Field>
          <StepsEditor steps={draft.steps} onChange={steps => setDraft({...draft, steps})} idPrefix="job-step" />
          <button className="btn w-full" type="submit">{busy ? "Saving…" : "Save job"}</button>
          {row && (confirmDelete
            ? <div className="flex flex-wrap gap-3"><button className="btn secondary card-admin-danger" type="button" onClick={() => void remove(row)}>Delete for good</button><button className="btn secondary" type="button" onClick={() => setConfirmDelete(false)}>Keep</button></div>
            : <button className="btn secondary w-full card-admin-danger" type="button" onClick={() => setConfirmDelete(true)}>Delete job</button>)}
        </fieldset>
      </form>
    </section>;
  }

  // Everyone else sees their own job and the floor, nothing to set up.
  if (!canManage) return <section className="mx-auto max-w-3xl">
    <ScreenHeader eyebrow="Know the floor" title="Checklists" info="Your job for this shift, and how the rest of the floor is doing." />
    <MyShift restaurantId={restaurantId} />
  </section>;

  return <section className="mx-auto max-w-3xl">
    <ScreenHeader
      eyebrow="Manager workspace"
      title="Checklists"
      info="Who does which job before, during and after service, and when it is done."
    />
    {!(tab === "today" && deep) && <div className="category-tabs" role="group" aria-label="Checklists">
      {TABS.map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} style={{fontWeight: 700, border: "1.5px solid var(--edge)"}} onClick={() => {setTab(key); setError(""); setMessage("");}}>{label}</button>)}
    </div>}
    <div><Notice text={error} error /><Notice text={message} /></div>
    {tab === "today" && <Today restaurantId={restaurantId} jobs={rows} onOpenSaved={() => setTab("saved")} onSavedJobsChanged={() => void load()} onDeep={setDeep} />}
    {tab === "history" && <History restaurantId={restaurantId} />}
    {tab === "saved" && <>
      {loading ? <p className="muted py-6" role="status">Loading jobs…</p> : <div className="mt-4">
        {!!sorted.length && <div className="space-y-2">{sorted.map(row => <button key={row.id} type="button" className="panel flex w-full items-center gap-3 text-left" style={{padding: "10px 16px"}} onClick={() => openForm(row)}>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{row.name}</span>
            <span className="muted block text-xs">{row.steps.length} step{row.steps.length === 1 ? "" : "s"}</span>
          </span>
          <ChevronRight size={18} className="muted shrink-0" aria-hidden="true" />
        </button>)}</div>}
        {!rows.length && <p className="muted py-6">No jobs yet. Start with one your team does every shift.</p>}
        <button className="btn mt-4" type="button" onClick={() => openForm()}><Plus size={16} />New job</button>
      </div>}
    </>}
  </section>;
}
