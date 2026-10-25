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
const PHASE_LABEL: Record<string, string> = {opening: "Opening", closing: "Closing"};
const WHO_LABEL: Record<Who, string> = {one: "One person, rotating", all: "Everyone", closer: "The closer"};
const describe = (row: Job) => row.phase ? [PHASE_LABEL[row.phase], row.role === "sa" ? "S.A.s" : "Servers", WHO_LABEL[row.who ?? "one"], row.days?.length ? row.days.map(d => WEEKDAYS[d]).join(" ") : ""].filter(Boolean).join(" · ") : "Given by hand";
const TABS: Array<[Tab, string]> = [["tonight", "Tonight"], ["setup", "Setup"], ["history", "History"]];

export function Checklists({restaurantId, canManage}: {restaurantId: string; canManage: boolean}) {
  const [tab, setTab] = useState<Tab>("tonight");
  const [lists, setLists] = useState<SideworkList[] | null>(null);
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
    const result = await supabase.from("checklist_jobs").select("id, name, group_name, steps, sort_order, phase, role, who, days")
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
    setDraft(row ? {name: row.name, steps: row.steps.length ? [...row.steps] : [""], phase: row.phase ?? "", role: row.role ?? "server", who: row.who ?? "one", days: row.days ?? []} : EMPTY);
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
            ? <div className="flex flex-wrap gap-3"><button className="btn secondary card-admin-danger" type="button" onClick={() => void remove(row)}>Delete for good</button><button className="btn secondary" type="button" onClick={() => setConfirmDelete(false)}>Keep</button></div>
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
    {!lists && !(tab === "today" && deep) && <div className="category-tabs" role="group" aria-label="Side work">
      {TABS.map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} style={{fontWeight: 700, border: "1.5px solid var(--edge)"}} onClick={() => {setTab(key); setError(""); setMessage("");}}>{label}</button>)}
    </div>}
    <div><Notice text={error} error /><Notice text={message} /></div>
    {tab === "tonight" && <Tonight restaurantId={restaurantId} />}
    {tab === "today" && <Today restaurantId={restaurantId} jobs={rows} onOpenSaved={() => setTab("setup")} onSavedJobsChanged={() => void load()} onDeep={setDeep} />}
    {tab === "history" && <History restaurantId={restaurantId} />}
    {tab === "setup" && lists && <SideworkLists restaurantId={restaurantId} lists={lists} onBack={() => setLists(null)} />}
    {tab === "setup" && !lists && <>
      {loading ? <p className="muted py-6" role="status">Loading jobs…</p> : <div className="mt-4">
        {!!sorted.length && <div className="space-y-2">{sorted.map(row => <button key={row.id} type="button" className="panel flex w-full items-center gap-3 text-left" style={{padding: "10px 16px"}} onClick={() => openForm(row)}>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{row.name}</span>
            <span className="muted block text-xs">{`${row.steps.length} ${row.steps.length === 1 ? "step" : "steps"} · ${describe(row)}`}</span>
          </span>
          <ChevronRight size={18} className="muted shrink-0" aria-hidden="true" />
        </button>)}</div>}
        {!rows.length && <p className="muted py-6">No jobs yet. Start with one your team does every shift.</p>}
        <div className="mt-4 flex flex-wrap gap-2">
          <button className="btn" type="button" onClick={() => openForm()}><Plus size={16} />New job</button>
          <button className="btn secondary" type="button" onClick={() => void supabase!.from("running_sidework_lists").select("id, name, tasks").eq("restaurant_id", restaurantId).order("name").then(({data, error}) => error ? setError(explain(error)) : setLists((data ?? []) as SideworkList[]))}>Running side work lists</button>
          <button className="btn secondary" type="button" onClick={() => setTab("today")}>Give a job by hand</button>
        </div>
      </div>}
    </>}
  </section>;
}
