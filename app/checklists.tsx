"use client";
// Side work: the tasks a floor gets through before, during and after service -- napkins, ice
// buckets, side stations -- each with a name beside it.
//
// Three tabs for the manager:
//   Today   (sidework-tonight.tsx) the night on one table, one row per person, worked out from the
//           schedule; look it over and send it.
//   Tasks   the saved tasks in three columns (opening, during, closing), each saying who does it and
//           on which days, so Today can hand them out on its own (051, 052).
//   History (checklist-history.tsx) the last 7 days.
// Everyone else sees their own shift and ticks their tasks off.
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { ArrowLeft, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Notice, Field, ScreenHeader } from "./ui";
import { StepsEditor } from "./checklist-steps";
import { MyShift } from "./checklist-mine";
import { History } from "./checklist-history";
import { MyShiftCard } from "./my-shift-card";
import { Tonight } from "./sidework-tonight";
import { PHASES, type Phase, type Role, type Who } from "@/lib/sidework-plan";

// How a task hands itself out: when, to which role, one person / everyone / the closer, which weekdays.
export type Job = {id: string; name: string; group_name: string; steps: string[]; sort_order: number; phase?: Phase | null; role?: Role | null; who?: Who; days?: number[]};
type Draft = {name: string; steps: string[]; phase: Phase | ""; role: Role; who: Who; days: number[]};
type Tab = "today" | "tasks" | "history";

const EMPTY: Draft = {name: "", steps: [""], phase: "", role: "server", who: "one", days: []};
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const PHASE_LABEL: Record<Phase, string> = {opening: "Opening", during: "During", closing: "Closing"};
const TABS: Array<[Tab, string]> = [["today", "Today"], ["tasks", "Tasks"], ["history", "History"]];
// "Who" is one plain question: role and rule together.
const WHO_CHOICES: Array<[string, string]> = [
  ["server:one", "One server, rotating every day"], ["server:all", "Every server"], ["server:closer", "The server who closes"],
  ["sa:one", "One S.A., rotating every day"], ["sa:all", "Every S.A."], ["sa:closer", "The S.A. who closes"],
];
const whoText = (row: Job) => {
  const text = WHO_CHOICES.find(([key]) => key === `${row.role ?? "server"}:${row.who ?? "one"}`)?.[1] ?? "";
  return text.replace(" every day", "") + (row.days?.length ? ` · ${row.days.map(d => WEEKDAYS[d]).join(" ")}` : "");
};

// A starting set for a restaurant with no tasks yet, from a real floor's sheets.
const TEMPLATE: Array<{name: string; phase: Phase; role: Role; who: Who; days?: number[]; steps: string[]}> = [
  {name: "Stations and menus", phase: "opening", role: "server", who: "one", steps: ["Restock trays, allergy sheets, print paper and staples in each station.", "Check boxes and dessert menus clean and evenly spread.", "Restock silverware in each station."]},
  {name: "Tables and chairs", phase: "opening", role: "server", who: "all", steps: ["Set up your tables, properly spaced for the right number of guests.", "Stabilize tables with wobble wedges.", "Brush the chairs and check under the tables."]},
  {name: "Kitchen setup", phase: "opening", role: "sa", who: "one", steps: ["Set up the plates and dish setups the kitchen needs.", "Set up dry and wet towels to wipe down trays."]},
  {name: "Floor setup", phase: "opening", role: "sa", who: "one", steps: ["Set the floor according to the host list.", "Wipe down all tables and chairs."]},
  {name: "Trays/BTG", phase: "during", role: "server", who: "one", steps: ["Keep trays and by-the-glass stocked through service."]},
  {name: "Coffee station", phase: "during", role: "server", who: "one", steps: ["Keep the coffee station clean and stocked through service."]},
  {name: "Side station", phase: "during", role: "server", who: "one", steps: ["Keep the side station clean and stocked through service."]},
  {name: "Wine glasses", phase: "during", role: "server", who: "one", steps: ["Keep wine glasses polished and on the floor through service."]},
  {name: "Coffee and bar", phase: "closing", role: "sa", who: "one", steps: ["Clean all sugar caddies.", "Clean the shelves below the coffee machine.", "Empty the bar trash."]},
  {name: "Trays and pitchers", phase: "closing", role: "sa", who: "one", steps: ["Collect all trays and bring them to the dishpit.", "Dry and store the water pitchers."]},
  {name: "Closer", phase: "closing", role: "sa", who: "closer", steps: ["Bring in the terrace chairs.", "Turn off the candles.", "Sanitize every table and chair."]},
];

export function Checklists({restaurantId, canManage, onOpenSchedule}: {restaurantId: string; canManage: boolean; onOpenSchedule?: () => void}) {
  const [tab, setTab] = useState<Tab>("today");
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
    return /phase|who|days|PGRST20[0-9]|42P01|42703|23514/.test(text) ? "Side work needs the database updates (050 to 052)." : text;
  }
  async function run(work: () => Promise<void>, done: string) {
    if (!supabase) return;
    setBusy(true); setError(""); setMessage("");
    try { await work(); await load(); setMessage(done); }
    catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  }

  const sorted = [...rows].sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  const nextOrder = () => rows.reduce((top, r) => Math.max(top, r.sort_order), 0) + 1;

  function closeForm() { setForm(null); setConfirmDelete(false); setError(""); }
  function openForm(row?: Job, phase: Phase | "" = "") {
    setDraft(row ? {name: row.name, steps: row.steps.length ? [...row.steps] : [""], phase: row.phase ?? "", role: row.role ?? "server", who: row.who ?? "one", days: row.days ?? []} : {...EMPTY, phase});
    setForm({row}); setError(""); setMessage(""); setConfirmDelete(false);
    window.scrollTo(0, 0);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const row = form?.row;
    const name = draft.name.trim();
    const typed = draft.steps.map(step => step.trim()).filter(Boolean);
    if (!name) { setError("Give it a name."); return; }
    const clash = rows.find(r => r.name.trim().toLowerCase() === name.toLowerCase() && r.id !== row?.id);
    if (clash) { setError("“" + clash.name + "” already exists. Find it in the list and tap it."); return; }
    // A task with no steps written is one step: itself.
    const steps = typed.length ? typed : [name];
    await run(async () => {
      const values = {name, steps, phase: draft.phase || null, role: draft.phase ? draft.role : null, who: draft.who, days: draft.days, updated_at: new Date().toISOString()};
      const result = row
        ? await supabase!.from("checklist_jobs").update(values).eq("id", row.id).eq("restaurant_id", restaurantId)
        : await supabase!.from("checklist_jobs").insert({...values, group_name: "", restaurant_id: restaurantId, sort_order: nextOrder()});
      if (result.error) throw result.error;
      closeForm();
    }, "Saved “" + name + "”.");
  }
  const remove = (row: Job) => run(async () => {
    const result = await supabase!.from("checklist_jobs").delete().eq("id", row.id).eq("restaurant_id", restaurantId);
    if (result.error) throw result.error;
    closeForm();
  }, "“" + row.name + "” was deleted.");
  const addTemplate = () => run(async () => {
    const taken = new Set(rows.map(r => r.name.trim().toLowerCase()));
    const fresh = TEMPLATE.filter(t => !taken.has(t.name.toLowerCase())).map((t, i) => ({restaurant_id: restaurantId, group_name: "", name: t.name, steps: t.steps, phase: t.phase, role: t.role, who: t.who, days: t.days ?? [], sort_order: nextOrder() + i}));
    if (!fresh.length) return;
    const result = await supabase!.from("checklist_jobs").insert(fresh);
    if (result.error) throw result.error;
  }, "Template added. Change any task to fit your floor.");

  // One task on a screen of its own: add it, or change it.
  if (canManage && form) {
    const row = form.row;
    return <section className="mx-auto max-w-3xl">
      <button className="btn secondary" disabled={busy} onClick={closeForm}><ArrowLeft size={16} />Tasks</button>
      <h1 className="mt-5 text-2xl font-semibold tracking-tight">{row ? row.name : "New task"}</h1>
      <div><Notice text={error} error /></div>
      <form className="mt-5 space-y-5" onSubmit={save}>
        <fieldset disabled={busy} className="space-y-5">
          <Field label="Name"><input id="job-name" maxLength={80} value={draft.name} onChange={e => setDraft({...draft, name: e.target.value})} placeholder="Coffee station" required /></Field>
          <div className="field"><label id="job-when-label">When</label>
            <div className="word-chips" role="group" aria-labelledby="job-when-label">
              {PHASES.map(p => <button key={p} type="button" className="word-chip" aria-pressed={draft.phase === p} onClick={() => setDraft({...draft, phase: p})}>{PHASE_LABEL[p]}</button>)}
              <button type="button" className="word-chip" aria-pressed={!draft.phase} onClick={() => setDraft({...draft, phase: ""})}>Only by hand</button>
            </div>
          </div>
          {draft.phase ? <>
            <Field label="Who does it"><select id="job-who" value={`${draft.role}:${draft.who}`} onChange={e => {const [role, who] = e.target.value.split(":"); setDraft({...draft, role: role as Role, who: who as Who});}}>
              {WHO_CHOICES.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></Field>
            <div className="field"><label id="job-days-label">Days</label>
              <div className="word-chips" role="group" aria-labelledby="job-days-label">{WEEKDAYS.map((d, i) => <button key={d} type="button" className="word-chip" aria-pressed={draft.days.includes(i)} onClick={() => setDraft({...draft, days: draft.days.includes(i) ? draft.days.filter(x => x !== i) : [...draft.days, i].sort()})}>{d}</button>)}</div>
              <p className="muted mt-1 text-xs">{draft.days.length ? "Only on the days marked." : "Every day. Mark days to limit it."}</p>
            </div>
          </> : <p className="muted text-xs">It won’t be handed out on its own. Give it from Today with “Add a task for tonight”.</p>}
          <StepsEditor steps={draft.steps} onChange={steps => setDraft({...draft, steps})} idPrefix="job-step" label="Steps (optional)" />
          <button className="btn w-full" type="submit">{busy ? "Saving…" : "Save task"}</button>
          {row && (confirmDelete
            ? <div className="flex flex-wrap gap-3"><button className="btn secondary card-admin-danger" type="button" onClick={() => void remove(row)}>Delete for good</button><button className="btn secondary" type="button" onClick={() => setConfirmDelete(false)}>Keep</button></div>
            : <button className="btn secondary w-full card-admin-danger" type="button" onClick={() => setConfirmDelete(true)}>Delete task</button>)}
        </fieldset>
      </form>
    </section>;
  }

  // Everyone else sees their own shift and ticks their tasks off.
  if (!canManage) return <section className="mx-auto max-w-3xl">
    <ScreenHeader eyebrow="Know the floor" title="Side work" info="Your section and tasks for this shift, and how the rest of the floor is doing." />
    <MyShiftCard restaurantId={restaurantId} />
    <MyShift restaurantId={restaurantId} />
  </section>;

  const columns: Array<[Phase | "", string]> = [...PHASES.map(p => [p, PHASE_LABEL[p]] as [Phase, string]), ["", "Only by hand"]];
  const anyRuled = rows.some(r => r.phase);
  return <section className="mx-auto w-full max-w-6xl">
    <ScreenHeader eyebrow="Manager workspace" title="Side work" info="Who does which task before, during and after service. Today works it out from the schedule; Tasks is where you set them up once." />
    <div className="category-tabs" role="group" aria-label="Side work">
      {TABS.map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} style={{fontWeight: 700, border: "1.5px solid var(--edge)"}} onClick={() => {setTab(key); setError(""); setMessage("");}}>{label}</button>)}
    </div>
    <div><Notice text={error} error /><Notice text={message} /></div>
    {tab === "today" && <Tonight restaurantId={restaurantId} onOpenSchedule={onOpenSchedule} />}
    {tab === "history" && <History restaurantId={restaurantId} />}
    {tab === "tasks" && (loading ? <p className="muted py-6" role="status">Loading tasks…</p> : <div className="mt-4">
      <p className="muted mb-3 text-sm">Set these up once. Every day, Today hands them out to whoever is on the schedule.</p>
      {!anyRuled && <div className="sw-empty mb-4">
        <p className="font-semibold">Start with a template?</p>
        <p className="muted text-sm">A starting set of opening, during and closing tasks for servers and S.A.s. Change or delete any of them after.</p>
        <button type="button" className="btn mt-3" disabled={busy} onClick={() => void addTemplate()}>Use the template</button>
      </div>}
      <div className="sw-columns">
        {columns.map(([phase, label]) => {
          const list = sorted.filter(r => (r.phase ?? "") === phase);
          return <div key={label} className="sw-column">
            <p className="sw-column-title">{label}</p>
            {list.map(row => <button key={row.id} type="button" className="sw-task" onClick={() => openForm(row)}>
              <b>{row.name}</b><small>{row.phase ? whoText(row) : `${row.steps.length} ${row.steps.length === 1 ? "step" : "steps"}`}</small>
            </button>)}
            {!list.length && <p className="muted text-xs">Nothing here yet.</p>}
            <button type="button" className="sw-add-task" onClick={() => openForm(undefined, phase)}><Plus size={14} />Add</button>
          </div>;
        })}
      </div>
    </div>)}
  </section>;
}
