"use client";
// The floor plan for one service: each server's SA, section and running side work -- the jobs a
// server keeps an eye on during the shift (trays, coffee station, wine glasses), not the opening
// or closing ones. It starts from the published schedule; the running side work comes from a saved
// list, the first server getting the first job. Nothing is ticked off: being assigned is the point.
// Tables and the people list: migration 050.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ChevronRight, Plus, RotateCw, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Field, Notice } from "./ui";
import { StepsEditor } from "./checklist-steps";
import { DayPill } from "./day-pill";
import { PillSelect } from "./pill-select";
import { SERVICES, defaultServiceAt, halfOf, spreadHelpers } from "@/lib/sidework-plan";

export type Helper = {id: string; name: string};
export type FloorRow = {server_id: string | null; server_name: string; sa: Helper[]; section: string; task: string};
export type SideworkList = {id: string; name: string; tasks: string[]};
export type Working = {user_id: string; name: string; shift_position: string; starts_at: string};
export type Plan = {id: string; service_date: string; service: string; list_id: string | null; rows: FloorRow[]; updated_at: string};

export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const defaultService = () => defaultServiceAt();
// Lunch (and Brunch) is anything starting before 4pm; the rest is dinner, the same split as side work.
const serviceOf = (startsAt: string) => new Date(startsAt).getHours() < 16 ? "Lunch" : "Dinner";
const isServer = (position: string) => /^\s*server\s*$/i.test(position);
const isHelper = (position: string) => /assistant|^\s*s\.?\s*a\.?\s*$|runner|busser/i.test(position);
export const helpers = (sa: Helper[]) => sa.map(h => h.name || "Team member").join(" / ");

// A new plan: the servers in order, their section numbers, the list's jobs down the rows, and the S.A.s spread across them.
export function startingRows(working: Working[], service: string, day: string, list: SideworkList | undefined): FloorRow[] {
  const onService = working.filter(p => serviceOf(p.starts_at) === halfOf(service));
  return spreadHelpers(blankRows(onService.filter(p => isServer(p.shift_position)), list), onService.filter(p => isHelper(p.shift_position)), day);
}
export function suggestedList(working: Working[], service: string, lists: SideworkList[]) {
  const servers = working.filter(p => serviceOf(p.starts_at) === halfOf(service) && isServer(p.shift_position)).length;
  return lists.find(l => l.tasks.length === servers) ?? lists[0];
}

function blankRows(servers: Working[], list: SideworkList | undefined): FloorRow[] {
  return servers.map((s, i) => ({server_id: s.user_id, server_name: s.name || "Team member", sa: [], section: String(i + 1), task: list?.tasks[i] ?? ""}));
}

// ── The manager's screen ──
// Opened from Tonight, it comes with that night's day and service and a way back.
export function FloorPlan({restaurantId, initialDay, initialService, onBack}: {restaurantId: string; initialDay?: string; initialService?: string; onBack?: () => void}) {
  const [day, setDay] = useState(initialDay ?? localDate());
  const [service, setService] = useState<string>(initialService ?? defaultService());
  const [working, setWorking] = useState<Working[]>([]);
  const [lists, setLists] = useState<SideworkList[]>([]);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [rows, setRows] = useState<FloorRow[]>([]);
  const [listId, setListId] = useState("");
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editingLists, setEditingLists] = useState(false);

  const explain = (e: unknown) => {
    const text = e instanceof Error ? e.message : String((e as {message?: string})?.message ?? e);
    return /floor_plans_service_check/.test(text) ? "Brunch needs database update 054." : /floor_plan|running_sidework|PGRST205|PGRST202|42P01|42883/.test(text) ? "The floor plan needs the database update (050)." : text;
  };

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true); setError("");
    try {
      const [people, saved, current] = await Promise.all([
        supabase.rpc("floor_plan_people", {rid: restaurantId, day}),
        supabase.from("running_sidework_lists").select("id, name, tasks").eq("restaurant_id", restaurantId).order("name"),
        supabase.from("floor_plans").select("id, service_date, service, list_id, rows, updated_at").eq("restaurant_id", restaurantId).eq("service_date", day).eq("service", service).maybeSingle(),
      ]);
      if (people.error) throw people.error;
      if (saved.error) throw saved.error;
      if (current.error) throw current.error;
      const team = (people.data ?? []) as Working[];
      const savedLists = (saved.data ?? []) as SideworkList[];
      setWorking(team);
      setLists(savedLists);
      const existing = current.data as Plan | null;
      setPlan(existing);
      if (existing) {
        setRows(existing.rows);
        setListId(existing.list_id ?? "");
      } else {
        // A new plan starts from the servers on tonight's schedule and the list that fits how many there are.
        const fits = suggestedList(team, service, savedLists);
        setRows(startingRows(team, service, day, fits));
        setListId(fits?.id ?? "");
      }
      setDirty(false);
    } catch (e) { setError(explain(e)); }
    finally { setLoading(false); }
  }, [restaurantId, day, service]);
  useEffect(() => { void load(); }, [load]);

  const onService = useMemo(() => working.filter(p => serviceOf(p.starts_at) === halfOf(service)), [working, service]);
  const serverChoices = onService.filter(p => isServer(p.shift_position));
  const saChoices = [...onService.filter(p => isHelper(p.shift_position)), ...onService.filter(p => !isHelper(p.shift_position) && !isServer(p.shift_position))];
  const list = lists.find(l => l.id === listId);

  const change = (next: FloorRow[]) => { setRows(next); setDirty(true); setMessage(""); };
  const setRow = (index: number, patch: Partial<FloorRow>) => change(rows.map((row, i) => i === index ? {...row, ...patch} : row));
  const applyList = (id: string) => {
    setListId(id);
    const chosen = lists.find(l => l.id === id);
    if (chosen) change(rows.map((row, i) => ({...row, task: chosen.tasks[i] ?? ""})));
    else setDirty(true);
  };
  // Everyone moves one job down the list (the last one comes back to the top), for a fair week.
  const rotate = () => { if (rows.length > 1) change(rows.map((row, i) => ({...row, task: rows[(i - 1 + rows.length) % rows.length].task}))); };
  const restart = () => change(startingRows(working, service, day, list));

  async function save() {
    if (!supabase || busy) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const clean = rows.map(r => ({...r, server_name: r.server_name.trim(), section: r.section.trim(), task: r.task.trim()})).filter(r => r.server_id || r.server_name);
      const result = await supabase.from("floor_plans").upsert({restaurant_id: restaurantId, service_date: day, service, list_id: listId || null, rows: clean, updated_at: new Date().toISOString(), updated_by: (await supabase.auth.getUser()).data.user?.id}, {onConflict: "restaurant_id,service_date,service"});
      if (result.error) throw result.error;
      setMessage("Floor plan saved. Each server and SA sees their row on their phone.");
      await load();
    } catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  }
  async function clear() {
    if (!supabase || !plan || busy) return;
    setBusy(true); setError("");
    const result = await supabase.from("floor_plans").delete().eq("id", plan.id);
    setBusy(false);
    if (result.error) { setError(explain(result.error)); return; }
    setMessage("Floor plan cleared.");
    await load();
  }

  if (editingLists) return <SideworkLists restaurantId={restaurantId} lists={lists} onBack={() => {setEditingLists(false); void load();}} />;

  return <div className="floor-plan mt-4">
    {onBack && <button type="button" className="btn secondary mb-4" onClick={onBack}><ArrowLeft size={16} />Tonight</button>}
    <div className="floor-bar">
      <DayPill label="Day" value={day} onChange={setDay} />
      <div className="category-tabs" role="group" aria-label="Service">
        {SERVICES.map(s => <button key={s} type="button" aria-pressed={service === s} onClick={() => setService(s)}>{s}</button>)}
      </div>
    </div>
    <Notice text={error} error /><Notice text={message} />
    {loading ? <p className="muted py-6" role="status">Loading the floor plan…</p> : <>
      <div className="floor-list-row">
        <Field label="Running side work">
          <PillSelect id="floor-list" text={list ? `${list.name} · ${list.tasks.length}` : "No list"}>
            <select id="floor-list" value={listId} onChange={e => applyList(e.target.value)}>
              <option value="">No list</option>
              {lists.map(l => <option key={l.id} value={l.id}>{`${l.name} · ${l.tasks.length}`}</option>)}
            </select>
          </PillSelect>
        </Field>
        <button type="button" className="btn secondary" onClick={() => setEditingLists(true)}>{lists.length ? "Edit lists" : "New list"}</button>
        <button type="button" className="btn secondary" disabled={rows.length < 2} onClick={rotate} title="Everyone moves one job down"><RotateCw size={14} />Rotate</button>
      </div>
      {!plan && <p className="muted mb-3 text-xs">{serverChoices.length ? `Started from the ${serverChoices.length} ${serverChoices.length === 1 ? "server" : "servers"} on the published schedule. Save it to send it out.` : "No servers on the published schedule for this service. Add rows by hand, or publish the schedule first."}</p>}
      {plan && <p className="muted mb-3 text-xs">{`Saved ${new Date(plan.updated_at).toLocaleString(undefined, {weekday: "short", hour: "numeric", minute: "2-digit"})}.`}</p>}

      <div className="floor-table" role="table" aria-label="Floor plan">
        <div className="floor-head" role="row"><span role="columnheader">Section</span><span role="columnheader">Server</span><span role="columnheader">S.A.</span><span role="columnheader">Running side work</span><span /></div>
        {rows.map((row, index) => {
          const options = serverChoices.some(p => p.user_id === row.server_id) || !row.server_id ? serverChoices : [{user_id: row.server_id, name: row.server_name, shift_position: "", starts_at: ""}, ...serverChoices];
          const freeSA = saChoices.filter(p => !row.sa.some(h => h.id === p.user_id));
          return <div key={index} className="floor-row" role="row">
            <span role="cell"><input aria-label="Section" className="floor-section" maxLength={8} value={row.section} onChange={e => setRow(index, {section: e.target.value})} /></span>
            <span role="cell"><PillSelect text={options.find(p => p.user_id === row.server_id)?.name || (row.server_name && !row.server_id ? row.server_name : "Choose a server")}><select aria-label="Server" value={row.server_id ?? ""} onChange={e => {const who = onService.find(p => p.user_id === e.target.value); setRow(index, {server_id: who?.user_id ?? null, server_name: who?.name ?? ""});}}>
              <option value="">{row.server_name && !row.server_id ? row.server_name : "Choose a server"}</option>
              {options.map(p => <option key={p.user_id} value={p.user_id}>{p.name || "Team member"}</option>)}
              {onService.filter(p => !isServer(p.shift_position) && !options.some(o => o.user_id === p.user_id)).map(p => <option key={p.user_id} value={p.user_id}>{`${p.name || "Team member"} · ${p.shift_position}`}</option>)}
            </select></PillSelect></span>
            <span role="cell" className="floor-sa">
              {row.sa.map(h => <button key={h.id} type="button" className="word-chip" aria-label={`Remove ${h.name}`} onClick={() => setRow(index, {sa: row.sa.filter(x => x.id !== h.id)})}>{h.name || "Team member"}<X size={12} aria-hidden="true" /></button>)}
              {freeSA.length > 0 && row.sa.length < 3 && <PillSelect text="+ S.A."><select aria-label="Add an S.A." className="floor-add-sa" value="" onChange={e => {const who = onService.find(p => p.user_id === e.target.value); if (who) setRow(index, {sa: [...row.sa, {id: who.user_id, name: who.name}]});}}>
                <option value="">+ S.A.</option>
                {freeSA.map(p => <option key={p.user_id} value={p.user_id}>{`${p.name || "Team member"} · ${p.shift_position}`}</option>)}
              </select></PillSelect>}
            </span>
            <span role="cell"><input aria-label="Running side work" list="floor-tasks" maxLength={60} value={row.task} placeholder="Coffee station" onChange={e => setRow(index, {task: e.target.value})} /></span>
            <span role="cell"><button type="button" className="icon-chip" aria-label={`Remove row ${index + 1}`} onClick={() => change(rows.filter((_, i) => i !== index))}><X size={14} /></button></span>
          </div>;
        })}
        {!rows.length && <p className="muted p-4 text-sm">No rows yet.</p>}
      </div>
      <datalist id="floor-tasks">{[...new Set(lists.flatMap(l => l.tasks))].map(t => <option key={t} value={t} />)}</datalist>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className="btn secondary" onClick={() => change([...rows, {server_id: null, server_name: "", sa: [], section: String(rows.length + 1), task: list?.tasks[rows.length] ?? ""}])}><Plus size={14} />Add a row</button>
        {serverChoices.length > 0 && <button type="button" className="btn secondary" onClick={restart}>Start again from the schedule</button>}
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        <button type="button" className="btn" disabled={busy || (!dirty && !!plan)} onClick={() => void save()}>{busy ? "Saving…" : plan ? "Save changes" : "Save floor plan"}</button>
        {plan && <button type="button" className="btn secondary card-admin-danger" disabled={busy} onClick={() => void clear()}>Clear</button>}
      </div>
    </>}
  </div>;
}

// ── Saved running side work lists ──
export function SideworkLists({restaurantId, lists, onBack, initial}: {restaurantId: string; lists: SideworkList[]; onBack: () => void; initial?: SideworkList | "new"}) {
  const [open, setOpen] = useState<SideworkList | "new" | null>(initial ?? (lists.length ? null : "new"));
  const [name, setName] = useState("");
  const [tasks, setTasks] = useState<string[]>([""]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const start = (row: SideworkList | "new") => { setOpen(row); setError(""); setName(row === "new" ? "" : row.name); setTasks(row === "new" ? [""] : row.tasks.length ? [...row.tasks] : [""]); };
  useEffect(() => { if (open) start(open); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function save(event: FormEvent) {
    event.preventDefault();
    const clean = tasks.map(t => t.trim()).filter(Boolean);
    if (!name.trim()) { setError("Give the list a name, like “Saturday · 7 servers”."); return; }
    if (!clean.length) { setError("Add at least one job."); return; }
    setBusy(true); setError("");
    const values = {name: name.trim(), tasks: clean, updated_at: new Date().toISOString()};
    const result = open && open !== "new"
      ? await supabase!.from("running_sidework_lists").update(values).eq("id", open.id)
      : await supabase!.from("running_sidework_lists").insert({...values, restaurant_id: restaurantId});
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    onBack();
  }
  async function remove() {
    if (!open || open === "new") return;
    setBusy(true);
    const result = await supabase!.from("running_sidework_lists").delete().eq("id", open.id);
    setBusy(false);
    if (result.error) { setError(result.error.message); return; }
    onBack();
  }

  return <div className="mt-4">
    <button type="button" className="btn secondary" onClick={open && lists.length && !initial ? () => setOpen(null) : onBack}><ArrowLeft size={16} />{initial ? "Setup" : open && lists.length ? "Lists" : "Floor plan"}</button>
    <Notice text={error} error />
    {!open ? <div className="mt-4 space-y-2">
      <p className="muted mb-3 text-sm">One list for each kind of night. The first server gets the first job, the second the second, and so on down.</p>
      {lists.map(l => <button key={l.id} type="button" className="panel flex w-full items-center gap-3 text-left" style={{padding: "10px 16px"}} onClick={() => start(l)}>
        <span className="min-w-0 flex-1"><span className="block font-semibold">{l.name}</span><span className="muted block text-xs">{l.tasks.join(" · ")}</span></span>
        <ChevronRight size={18} className="muted shrink-0" aria-hidden="true" />
      </button>)}
      <button type="button" className="btn mt-2" onClick={() => start("new")}><Plus size={16} />New list</button>
    </div> : <form className="mt-5 space-y-5" onSubmit={save}>
      <fieldset disabled={busy} className="space-y-5">
        <Field label="Name"><input id="sidework-list-name" maxLength={60} value={name} onChange={e => setName(e.target.value)} placeholder="Saturday · 7 servers" /></Field>
        <StepsEditor steps={tasks} onChange={setTasks} idPrefix="sidework-task" label="Jobs, in order" addLabel="Add a job" placeholder="Coffee station" />
        <div className="flex flex-wrap gap-2">
          <button className="btn" type="submit">{busy ? "Saving…" : "Save list"}</button>
          {open !== "new" && <button type="button" className="btn secondary card-admin-danger" onClick={() => void remove()}>Delete list</button>}
        </div>
      </fieldset>
    </form>}
  </div>;
}

// ── What a server or SA sees: their own row, and the whole floor a tap away ──
export function MyFloorPlan({restaurantId, userId: given}: {restaurantId: string; userId?: string}) {
  const [plans, setPlans] = useState<Plan[]>([]);
  const [userId, setUserId] = useState(given ?? "");
  useEffect(() => { if (!given && supabase) void supabase.auth.getUser().then(({data}) => setUserId(data.user?.id ?? "")); }, [given]);
  const [showAll, setShowAll] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    let live = true;
    void supabase.from("floor_plans").select("id, service_date, service, list_id, rows, updated_at").eq("restaurant_id", restaurantId).eq("service_date", localDate())
      .then(({data}) => { if (live) setPlans(((data ?? []) as Plan[]).sort((a, b) => a.service.localeCompare(b.service) * (defaultService() === "Dinner" ? -1 : 1))); });
    return () => { live = false; };
  }, [restaurantId]);
  const mine = !userId ? [] : plans.flatMap(p => p.rows.filter(r => r.server_id === userId || r.sa.some(h => h.id === userId)).map(r => ({plan: p, row: r})));
  if (!mine.length) return null;
  const {plan, row} = mine[0];
  const asServer = row.server_id === userId;
  return <section className="panel floor-mine mb-4" aria-label="Your floor plan">
    <p className="eyebrow muted">{`Floor plan · ${plan.service}`}</p>
    <div className="floor-mine-main">
      <div><b>{row.section ? `Section ${row.section}` : "No section"}</b><span>{row.task || "No running side work"}</span></div>
      <small className="muted">{asServer ? (row.sa.length ? `S.A.: ${helpers(row.sa)}` : "No S.A. assigned") : `Server: ${row.server_name || "Team member"}`}</small>
    </div>
    <button type="button" className="floor-mine-toggle" aria-expanded={showAll} onClick={() => setShowAll(v => !v)}>{showAll ? "Hide the floor" : "See the whole floor"}</button>
    {showAll && <FloorTable rows={plan.rows} highlight={userId} />}
  </section>;
}

export function FloorTable({rows, highlight}: {rows: FloorRow[]; highlight?: string}) {
  return <div className="floor-table readonly mt-3" role="table" aria-label="Floor plan">
    <div className="floor-head" role="row"><span role="columnheader">Section</span><span role="columnheader">Server</span><span role="columnheader">S.A.</span><span role="columnheader">Running side work</span></div>
    {rows.map((row, i) => <div key={i} role="row" className={`floor-row${highlight && (row.server_id === highlight || row.sa.some(h => h.id === highlight)) ? " me" : ""}`}>
      <span role="cell"><b>{row.section}</b></span><span role="cell">{row.server_name || "Team member"}</span><span role="cell">{helpers(row.sa) || "—"}</span><span role="cell">{row.task}</span>
    </div>)}
  </div>;
}
