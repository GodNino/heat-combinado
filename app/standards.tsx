"use client";
// Standards: the procedures a restaurant writes down. Servers read them, managers write them.
// A procedure is an ordered list of steps rather than a paragraph, so the app numbers them and
// two managers cannot format the same thing two different ways.
import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { ArrowLeft, ImagePlus, Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { validatePhoto } from "@/lib/menu";
import { Notice, Field, ScreenHeader } from "./ui";
import { DownloadSheet } from "./sheet-download";
import { standardSheet } from "@/lib/sheets";
import { photoLinks, shrinkPhoto } from "./photos";

export type Sop = {id: string; name: string; section: string; why: string; steps: string[]; photo_path: string; sort_order: number; updated_at: string};
type Draft = {name: string; section: string; why: string; steps: string[]};
const EMPTY: Draft = {name: "", section: "", why: "", steps: [""]};
const PHOTO_EXTENSIONS: Record<string, string> = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"};
const DAY = 24 * 60 * 60 * 1000;
const UNFILED = "Everything else";
// A procedure nobody has touched in a year is the dangerous kind: someone will still follow it.
const isStale = (when: string) => Date.now() - new Date(when).getTime() > 365 * DAY;
function since(when: string) {
  const days = Math.floor((Date.now() - new Date(when).getTime()) / DAY);
  if (days <= 0) return "Updated today";
  if (days === 1) return "Updated yesterday";
  if (days < 31) return `Updated ${days} days ago`;
  const months = Math.round(days / 30);
  if (months < 18) return `Updated ${months} month${months === 1 ? "" : "s"} ago`;
  const years = Math.round(days / 365);
  return `Updated ${years} year${years === 1 ? "" : "s"} ago`;
}

export function Standards({restaurantId, canEdit, restaurantName}: {restaurantId: string; canEdit: boolean; restaurantName: string}) {
  const [rows, setRows] = useState<Sop[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [form, setForm] = useState<{row?: Sop} | null>(null);
  const [reading, setReading] = useState("");
  const [query, setQuery] = useState("");
  const [section, setSection] = useState("");
  // The section box stays shut unless this standard is going somewhere new.
  const [newSection, setNewSection] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const load = useCallback(async () => {
    if (!supabase || !restaurantId) return;
    setLoading(true);
    const result = await supabase.from("sops").select("id, name, section, why, steps, photo_path, sort_order, updated_at").eq("restaurant_id", restaurantId);
    if (result.error) setError(explain(result.error)); else setRows((result.data ?? []) as Sop[]);
    setLoading(false);
  }, [restaurantId]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const paths = rows.map(row => row.photo_path).filter(Boolean);
    if (!paths.length) { setLinks({}); return; }
    let live = true;
    void photoLinks(paths).then(found => { if (live) setLinks(found); }).catch(() => { if (live) setLinks({}); });
    return () => { live = false; };
  }, [rows]);
  // Sections with a count, so the filter row can say how many are in each.
  const counts = useMemo(() => {
    const map = new Map<string, number>();
    for (const row of rows) {
      const key = row.section.trim() || UNFILED;
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].sort((a, b) => a[0] === UNFILED ? 1 : b[0] === UNFILED ? -1 : a[0].localeCompare(b[0]));
  }, [rows]);
  // A section that has been renamed away stops filtering rather than emptying the screen.
  const activeSection = counts.some(([name]) => name === section) ? section : "";
  const shown = useMemo(() => {
    const text = query.trim().toLowerCase();
    return rows
      .filter(row => !activeSection || (row.section.trim() || UNFILED) === activeSection)
      .filter(row => !text || row.name.toLowerCase().includes(text) || row.why.toLowerCase().includes(text) || row.steps.some(step => step.toLowerCase().includes(text)))
      .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name));
  }, [rows, query, activeSection]);
  // Grouped by the section a manager typed, with anything unfiled gathered at the end.
  const groups = useMemo(() => {
    const byName = new Map<string, Sop[]>();
    for (const row of shown) {
      const key = row.section.trim() || UNFILED;
      byName.set(key, [...(byName.get(key) ?? []), row]);
    }
    return [...byName.entries()].sort((a, b) => a[0] === UNFILED ? 1 : b[0] === UNFILED ? -1 : a[0].localeCompare(b[0]));
  }, [shown]);
  const sections = useMemo(() => [...new Set(rows.map(row => row.section.trim()).filter(Boolean))].sort(), [rows]);
  // The box opens only for a section that does not exist yet -- typed here, or carried by a
  // standard filed before its section was renamed away.
  const showSectionBox = newSection || !!(draft.section.trim() && !sections.some(name => name.toLowerCase() === draft.section.trim().toLowerCase()));
  const stale = rows.filter(row => isStale(row.updated_at)).length;
  const reader = reading ? rows.find(row => row.id === reading) : undefined;
  const shotFor = (row?: Sop) => (row?.photo_path && links[row.photo_path]) || "";
  function explain(e: unknown) {
    const text = e instanceof Error ? e.message : String((e as {message?: string})?.message ?? e);
    return /sops|PGRST205|42P01/.test(text) ? "Standards can’t be saved yet: the database update (025) hasn’t been run in Supabase." : text;
  }
  async function run(work: () => Promise<void>, done: string) {
    if (!supabase) return;
    setBusy(true); setError(""); setMessage("");
    try { await work(); await load(); setMessage(done); }
    catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  }
  function closeForm() { setForm(null); setFile(null); setPreview(""); setError(""); }
  function openForm(row?: Sop) {
    setDraft(row ? {name: row.name, section: row.section, why: row.why, steps: row.steps.length ? [...row.steps] : [""]} : EMPTY);
    setForm({row}); setError(""); setMessage(""); setConfirmDelete(""); setReading(""); setFile(null); setPreview(""); setNewSection(false);
    window.scrollTo(0, 0);
  }
  const setStep = (index: number, value: string) => setDraft(d => ({...d, steps: d.steps.map((step, i) => i === index ? value : step)}));
  const addStep = () => setDraft(d => ({...d, steps: [...d.steps, ""]}));
  const dropStep = (index: number) => setDraft(d => ({...d, steps: d.steps.length > 1 ? d.steps.filter((_, i) => i !== index) : [""]}));
  async function save(event: FormEvent) {
    event.preventDefault();
    const row = form?.row;
    const name = draft.name.trim();
    const steps = draft.steps.map(step => step.trim()).filter(Boolean);
    if (!name) { setError("Give it a name."); return; }
    if (!steps.length) { setError("A procedure needs at least one step."); return; }
    const clash = rows.find(r => r.name.trim().toLowerCase() === name.toLowerCase() && r.id !== row?.id);
    if (clash) { setError(`“${clash.name}” is already written. Find it below and tap Edit.`); return; }
    await run(async () => {
      let photo_path = row?.photo_path ?? "";
      let uploaded = "";
      if (file) {
        const shrunk = await shrinkPhoto(file);
        const next = `${restaurantId}/${crypto.randomUUID()}.${PHOTO_EXTENSIONS[shrunk.type] ?? "jpg"}`;
        const upload = await supabase!.storage.from("menu-photos").upload(next, shrunk, {contentType: shrunk.type, cacheControl: "31536000"});
        if (upload.error) throw upload.error;
        uploaded = next; photo_path = next;
      }
      const values = {name, section: draft.section.trim(), why: draft.why.trim(), steps, photo_path, updated_at: new Date().toISOString()};
      try {
        const result = row
          ? await supabase!.from("sops").update(values).eq("id", row.id).eq("restaurant_id", restaurantId)
          : await supabase!.from("sops").insert({...values, restaurant_id: restaurantId});
        if (result.error) throw result.error;
      } catch (e) {
        // The row never saved, so the photo we just pushed has nothing pointing at it.
        if (uploaded) await supabase!.storage.from("menu-photos").remove([uploaded]);
        throw e;
      }
      closeForm();
    }, `Saved “${name}”.`);
  }
  const remove = (row: Sop) => run(async () => {
    const result = await supabase!.from("sops").delete().eq("id", row.id).eq("restaurant_id", restaurantId);
    if (result.error) throw result.error;
    setConfirmDelete(""); setReading("");
  }, `“${row.name}” was deleted.`);
  const actions = (row: Sop) => !canEdit ? null : <div className="word-actions">
    {confirmDelete === row.id
      ? <><button className="btn secondary card-admin-danger" disabled={busy} onClick={() => void remove(row)}>Delete for good</button><button className="btn secondary" onClick={() => setConfirmDelete("")}>Keep</button></>
      : <>
        <button className="btn secondary" disabled={busy} onClick={() => openForm(row)}>Edit</button>
        <button className="btn secondary" disabled={busy} onClick={() => setConfirmDelete(row.id)}>Delete</button>
      </>}
  </div>;
  // One procedure on a screen of its own.
  if (reader) return <section className="mx-auto max-w-2xl">
    <button className="btn secondary" onClick={() => setReading("")}><ArrowLeft size={16} />Standards</button>
    {!!shotFor(reader) && <img src={shotFor(reader)} alt="" className="mt-4 w-full rounded-xl object-cover" style={{aspectRatio: "4 / 3"}} />}
    <p className="eyebrow muted mt-5">{reader.section.trim() || UNFILED}</p>
    <h1 className="mt-2 text-2xl font-semibold">{reader.name}</h1>
    {!!reader.why.trim() && <p className="mt-2 font-medium">{reader.why}</p>}
    {/* items-baseline, so the small monospace number sits on the same line as the first line of
      the step. Left to itself a smaller numeral aligns to the top of the row and floats above it. */}
    <ol className="mt-5 space-y-3">{reader.steps.map((step, index) => <li key={index} className="flex items-baseline gap-3">
      <span className="step-number shrink-0">{index + 1}</span>
      <span className="text-sm">{step}</span>
    </li>)}</ol>
    <p className="muted mt-6 border-t pt-3 text-xs" style={{borderColor: "var(--c-line)"}}>{since(reader.updated_at)}</p>
    {canEdit && <div className="mt-5"><DownloadSheet label="Download this standard" build={async () => standardSheet({title: reader.name, section: reader.section.trim() || UNFILED, summary: reader.why, steps: reader.steps, updated: reader.updated_at}, {restaurant: restaurantName})} /></div>}
    <div className="mt-5">{actions(reader)}</div>
  </section>;
  return <section className="mx-auto max-w-3xl">
    <ScreenHeader
      eyebrow={canEdit ? "Manager workspace" : "Know the floor"}
      title="Standards"
      info={canEdit
        ? "How this restaurant does things, in your own words. Your SOPs live here, and your team reads them."
        : "How this restaurant does things. Read them before service, and any time you are not sure."}
      action={canEdit && !form && <button className="btn shrink-0" onClick={() => openForm()}><Plus size={16} />Add an SOP</button>}
    />
    <div><Notice text={error} error /><Notice text={message} /></div>
    {canEdit && form && <form className="panel my-6 p-6" onSubmit={save}>
      <fieldset disabled={busy} className="space-y-4">
        <h2 className="text-xl font-semibold">{form.row ? `Edit “${form.row.name}”` : "Add an SOP"}</h2>
        <Field label="Name"><input id="sop-name" maxLength={120} value={draft.name} onChange={e => setDraft({...draft, name: e.target.value})} placeholder="Allergy at the table" required /></Field>
        {/* Chips, not a dropdown on the field: a datalist filters its own suggestions against
          whatever is already in the box, so most of the sections were hidden behind the text.
          These are always all here, and the box only opens for a section that does not exist yet. */}
        <fieldset className="field"><legend className="mb-2 block text-sm font-semibold">Section (optional)</legend>
          <div className="word-chips">
            <button type="button" className="word-chip" aria-pressed={!showSectionBox && !draft.section.trim()} onClick={() => {setNewSection(false); setDraft({...draft, section: ""});}}>{UNFILED}</button>
            {sections.map(name => <button key={name} type="button" className="word-chip" aria-pressed={!showSectionBox && draft.section.trim().toLowerCase() === name.toLowerCase()} onClick={() => {setNewSection(false); setDraft({...draft, section: name});}}>{name}</button>)}
            <button type="button" className="word-chip" aria-pressed={showSectionBox} onClick={() => setNewSection(true)}><Plus size={14} />New section</button>
          </div>
          {showSectionBox && <><input id="sop-section" className="mt-3" maxLength={60} value={draft.section} onChange={e => setDraft({...draft, section: e.target.value})} placeholder="Guest situations" /><p className="muted mt-2 text-xs">A new group, for this standard and any others you file here.</p></>}
        </fieldset>
        <Field label="Why it matters (optional, one line)"><input id="sop-why" maxLength={300} value={draft.why} onChange={e => setDraft({...draft, why: e.target.value})} placeholder="The one procedure nobody improvises." /></Field>
        <div>
          <label htmlFor="sop-step-0">Steps</label>
          <div className="mt-2 space-y-2">{draft.steps.map((step, index) => <div key={index} className="flex items-center gap-2">
            <span className="step-number shrink-0">{index + 1}</span>
            <input id={`sop-step-${index}`} className="min-w-0 flex-1" maxLength={500} value={step} onChange={e => setStep(index, e.target.value)} placeholder="The next thing they do…" />
            <button type="button" className="icon-chip shrink-0" onClick={() => dropStep(index)} aria-label={`Remove step ${index + 1}`} title="Remove this step"><X size={15} /></button>
          </div>)}</div>
          <button type="button" className="muted mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line p-3 text-sm" onClick={addStep}><Plus size={15} />Add a step</button>
        </div>
        <div>
          <label htmlFor="sop-photo">Photo (optional)</label>
          <div className="mt-2 rounded-xl border border-dashed border-line bg-raised p-5">
            {!!(preview || shotFor(form.row)) && <img src={preview || shotFor(form.row)} alt="" className="mb-4 h-48 w-full rounded-lg object-cover" />}
            <div className="muted mb-3 flex items-center gap-2 text-sm"><ImagePlus size={19} />JPG, PNG or WebP · up to 5 MB</div>
            <input id="sop-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
              const selected = event.target.files?.[0];
              setError(""); setFile(null); setPreview("");
              if (!selected) return;
              const issue = validatePhoto(selected);
              if (issue) { setError(issue); event.target.value = ""; return; }
              setFile(selected); setPreview(URL.createObjectURL(selected));
            }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-3"><button className="btn" type="submit">{busy ? "Saving…" : "Save SOP"}</button><button className="btn secondary" type="button" onClick={closeForm}>Cancel</button></div>
      </fieldset>
    </form>}
    {!form && <>
      <label className="sr-only" htmlFor="sop-search">Search standards</label>
      <input id="sop-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${rows.length} procedure${rows.length === 1 ? "" : "s"}…`} />
      {counts.length > 1 && <div className="category-tabs mt-3" role="group" aria-label="Sections">
        <button type="button" aria-pressed={!activeSection} onClick={() => setSection("")}>All <span className="tab-count">{rows.length}</span></button>
        {counts.map(([name, total]) => <button key={name} type="button" aria-pressed={activeSection === name} onClick={() => setSection(name)}>{name} <span className="tab-count">{total}</span></button>)}
      </div>}
      {canEdit && stale > 0 && <p className="mt-4 rounded-xl p-4 text-sm" style={{background: "var(--c-warning-bg)", border: "1px solid var(--c-warning-line)", color: "var(--c-warning)"}}>
        <b>{stale} procedure{stale === 1 ? " has" : "s have"} not been touched in over a year.</b> An out-of-date SOP is worse than none — somebody will follow it.</p>}
      {loading ? <p className="muted py-6" role="status">Loading standards…</p> : <div className="mt-4">
        {groups.map(([section, list]) => <div key={section} className="mb-5">
          <p className="section-chip">{section}</p>
          <div className="space-y-2">{list.map(row => <div key={row.id}>
            <button className="panel word-row sop-row w-full text-left" onClick={() => {setReading(row.id); window.scrollTo(0, 0);}}>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{row.name}</span>
                {!!row.why.trim() && <span className="muted mt-1 block text-sm">{row.why}</span>}
                <span className="muted mt-2 block text-xs">{row.steps.length} step{row.steps.length === 1 ? "" : "s"} · <span style={isStale(row.updated_at) ? {color: "var(--c-warning)", fontWeight: 600} : undefined}>{since(row.updated_at)}</span></span>
              </span>
            </button>
            {/* Edit and Delete live inside the standard, one tap away. */}
          </div>)}</div>
        </div>)}
        {!rows.length && <p className="muted py-6">{canEdit ? "No standards yet. Start with the one your team asks about most — six good ones are worth more than forty half-written." : "No standards yet. Your manager writes these."}</p>}
        {!!rows.length && !shown.length && <p className="muted py-6">Nothing matches “{query}”.</p>}
      </div>}
    </>}
  </section>;
}

