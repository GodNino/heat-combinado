"use client";
// Our story: what the restaurant is and where it comes from, written by managers and read by the team.
// Plain topics with an optional photo, optionally filed under a group. Nothing here is scored or tracked.
import { useCallback, useEffect, useMemo, useState, type FormEvent, type ReactNode } from "react";
import { ArrowLeft, ImagePlus, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { validatePhoto } from "@/lib/menu";
import { Notice, Field, ScreenHeader } from "./ui";
import { photoLinks, shrinkPhoto } from "./photos";
import { DownloadSheet, loadPhoto } from "./sheet-download";
import { storySheet } from "@/lib/sheets";

export type StoryTopic = {id: string; title: string; body: string; section: string; photo_path: string; sort_order: number; updated_at: string};
type StoryDraft = {title: string; body: string; section: string};
const EMPTY_STORY: StoryDraft = {title: "", body: "", section: ""};
const PHOTO_EXTENSIONS: Record<string, string> = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"};
const storyParagraphs = (body: string) => body.split("\n").map(part => part.trim()).filter(Boolean);
const storyExcerpt = (body: string) => { const first = storyParagraphs(body)[0] ?? ""; if (first.length <= 120) return first; const cut = first.slice(0, 117); const space = cut.lastIndexOf(" "); return (space > 60 ? cut.slice(0, space) : cut).trimEnd() + "…"; };

export function Story({restaurantId, restaurantName = "HEAT", canEdit}: {restaurantId: string; restaurantName?: string; canEdit: boolean}) {
  const [rows, setRows] = useState<StoryTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<StoryDraft>(EMPTY_STORY);
  const [form, setForm] = useState<{row?: StoryTopic} | null>(null);
  const [reading, setReading] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const [newGroup, setNewGroup] = useState(false);
  function explain(e: unknown) {
    const text = e instanceof Error ? e.message : String((e as {message?: string})?.message ?? e);
    return /story_topics|PGRST205|42P01/.test(text) ? "Our story can’t be saved yet: the database update hasn’t been run in Supabase." : text;
  }
  const load = useCallback(async () => {
    if (!supabase || !restaurantId) return;
    setLoading(true);
    const result = await supabase.from("story_topics").select("id, title, body, section, photo_path, sort_order, updated_at").eq("restaurant_id", restaurantId);
    if (result.error) setError(explain(result.error)); else setRows(((result.data ?? []) as StoryTopic[]).sort((a, b) => a.sort_order - b.sort_order || a.title.localeCompare(b.title)));
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
  const reader = reading ? rows.find(row => row.id === reading) : undefined;
  // Groups in the order they first appear. Until one topic has a group, the list shows no headings at all.
  const groups = useMemo(() => { const seen = new Map<string, string>(); for (const row of rows) { const name = row.section.trim(); if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name); } return [...seen.values()]; }, [rows]);
  const showGroupBox = newGroup || !!(draft.section.trim() && !groups.some(name => name.toLowerCase() === draft.section.trim().toLowerCase()));
  const sections = useMemo<[string, StoryTopic[]][]>(() => {
    if (!groups.length) return [["", rows]];
    const out: [string, StoryTopic[]][] = groups.map(name => [name, rows.filter(row => row.section.trim().toLowerCase() === name.toLowerCase())]);
    const loose = rows.filter(row => !row.section.trim());
    if (loose.length) out.push(["More", loose]);
    return out;
  }, [rows, groups]);
  const shotFor = (row?: StoryTopic) => (row?.photo_path && links[row.photo_path]) || "";
  async function run(work: () => Promise<void>, done: string) {
    if (!supabase) return;
    setBusy(true); setError(""); setMessage("");
    try { await work(); await load(); setMessage(done); }
    catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  }
  function closeForm() { setForm(null); setFile(null); setPreview(""); setError(""); }
  function openForm(row?: StoryTopic) {
    setDraft(row ? {title: row.title, body: row.body, section: row.section} : EMPTY_STORY); setNewGroup(false);
    setForm({row}); setError(""); setMessage(""); setConfirmDelete(""); setReading(""); setFile(null); setPreview("");
    window.scrollTo(0, 0);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const row = form?.row;
    const title = draft.title.trim();
    if (!title) { setError("Give it a title."); return; }
    const clash = rows.find(r => r.title.trim().toLowerCase() === title.toLowerCase() && r.id !== row?.id);
    if (clash) { setError("“" + clash.title + "” is already here. Find it below and tap Edit."); return; }
    await run(async () => {
      let photo_path = row?.photo_path ?? "";
      let uploaded = "";
      if (file) {
        const shrunk = await shrinkPhoto(file);
        const next = restaurantId + "/" + crypto.randomUUID() + "." + (PHOTO_EXTENSIONS[shrunk.type] ?? "jpg");
        const upload = await supabase!.storage.from("menu-photos").upload(next, shrunk, {contentType: shrunk.type, cacheControl: "31536000"});
        if (upload.error) throw upload.error;
        uploaded = next; photo_path = next;
      }
      const values = {title, body: draft.body.trim(), section: draft.section.trim(), photo_path, updated_at: new Date().toISOString()};
      try {
        const result = row
          ? await supabase!.from("story_topics").update(values).eq("id", row.id).eq("restaurant_id", restaurantId)
          : await supabase!.from("story_topics").insert({...values, restaurant_id: restaurantId, sort_order: rows.reduce((top, r) => Math.max(top, r.sort_order), 0) + 1});
        if (result.error) throw result.error;
      } catch (e) {
        // The row never saved, so the photo we just pushed has nothing pointing at it.
        if (uploaded) await supabase!.storage.from("menu-photos").remove([uploaded]);
        throw e;
      }
      closeForm();
    }, "Saved “" + title + "”.");
  }
  const remove = (row: StoryTopic) => run(async () => {
    const result = await supabase!.from("story_topics").delete().eq("id", row.id).eq("restaurant_id", restaurantId);
    if (result.error) throw result.error;
    setConfirmDelete(""); setReading("");
  }, "“" + row.title + "” was deleted.");
  const buttons = (row: StoryTopic, card?: {download?: ReactNode}) => <>
    {confirmDelete === row.id
      ? <><button className="btn secondary card-admin-danger" disabled={busy} onClick={() => void remove(row)}>Delete for good</button><button className="btn secondary" onClick={() => setConfirmDelete("")}>Keep</button></>
      : <>
        <button className="btn secondary" disabled={busy} onClick={() => openForm(row)}>{card ? "Edit topic" : "Edit"}</button>
        {card?.download}
        <button className="btn secondary" disabled={busy} onClick={() => setConfirmDelete(row.id)}>Delete</button>
      </>}
  </>;
  // A topic uses the dish cards' Manager only row (Edit, Download, Delete, one size); the list keeps its small buttons.
  const actions = (row: StoryTopic, card?: {download?: ReactNode}) => !canEdit ? null : card ? buttons(row, card) : <div className="word-actions">{buttons(row)}</div>;
  // One topic on a screen of its own. The photo only shows when a manager added one.
  if (reader) return <section className="mx-auto max-w-2xl">
    <button className="btn secondary" onClick={() => setReading("")}><ArrowLeft size={16} />Our story</button>
    {!!shotFor(reader) && <img src={shotFor(reader)} alt="" className="mt-4 w-full rounded-xl object-cover" style={{aspectRatio: "4 / 3"}} />}
    <h1 className="mt-5 text-2xl font-semibold">{reader.title}</h1>
    <div className="mt-4 space-y-3">{storyParagraphs(reader.body).map((part, index) => <p key={index}>{part}</p>)}</div>
    {canEdit && <div className="card-admin"><p className="eyebrow muted mb-3">Manager only</p><div className="card-admin-actions">{actions(reader, {download: <DownloadSheet variant="button" label="Download this topic" build={async () => storySheet({topics: [{title: reader.title, body: reader.body, section: reader.section}], photo: await loadPhoto(shotFor(reader)), updated: reader.updated_at}, {restaurant: restaurantName})} />})}</div></div>}
  </section>;
  return <section className="story-page mx-auto max-w-3xl">
    <ScreenHeader
      eyebrow={canEdit ? "Manager workspace" : "The restaurant"}
      title="Our story"
      info={canEdit
        ? "The story of the restaurant, in your own words: the concept, where it comes from, what the design means. Add a topic, with a photo if you like. Your team reads it; nothing here is scored."
        : "The story behind the restaurant: the concept, where it comes from, what the design means. Read it any time. Nothing here is scored."}
      action={canEdit && !form && <button className="btn shrink-0" onClick={() => openForm()}><Plus size={16} />Add</button>}
    />
    <div><Notice text={error} error /><Notice text={message} /></div>
    {canEdit && form && <form className="panel my-6 p-6" onSubmit={save}>
      <fieldset disabled={busy} className="space-y-4">
        <h2 className="text-xl font-semibold">{form.row ? "Edit “" + form.row.title + "”" : "Add a topic"}</h2>
        <Field label="Title"><input id="story-title" maxLength={120} value={draft.title} onChange={e => setDraft({...draft, title: e.target.value})} placeholder="Our concept" required /></Field>
        <fieldset className="field"><legend className="mb-2 block text-sm font-semibold">Group (optional)</legend>
          <div className="word-chips">
            <button type="button" className="word-chip" aria-pressed={!showGroupBox && !draft.section.trim()} onClick={() => {setNewGroup(false); setDraft({...draft, section: ""});}}>No group</button>
            {groups.map(name => <button key={name} type="button" className="word-chip" aria-pressed={!showGroupBox && draft.section.trim().toLowerCase() === name.toLowerCase()} onClick={() => {setNewGroup(false); setDraft({...draft, section: name});}}>{name}</button>)}
            <button type="button" className="word-chip" aria-pressed={showGroupBox} onClick={() => setNewGroup(true)}><Plus size={14} />New group</button>
          </div>
          {showGroupBox && <input id="story-group" className="mt-3" maxLength={60} value={draft.section} onChange={e => setDraft({...draft, section: e.target.value})} placeholder="The design" />}
        </fieldset>
        <Field label="Text"><textarea id="story-body" rows={10} maxLength={8000} value={draft.body} onChange={e => setDraft({...draft, body: e.target.value})} placeholder="Write or paste the text. A blank line starts a new paragraph." /></Field>
        <div>
          <label htmlFor="story-photo">Photo (optional)</label>
          <div className="mt-2 rounded-xl border border-dashed border-line bg-raised p-5">
            {!!(preview || shotFor(form.row)) && <img src={preview || shotFor(form.row)} alt="" className="mb-4 h-48 w-full rounded-lg object-cover" />}
            <div className="muted mb-3 flex items-center gap-2 text-sm"><ImagePlus size={19} />JPG, PNG or WebP · up to 5 MB</div>
            <input id="story-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
              const selected = event.target.files?.[0];
              setError(""); setFile(null); setPreview("");
              if (!selected) return;
              const issue = validatePhoto(selected);
              if (issue) { setError(issue); event.target.value = ""; return; }
              setFile(selected); setPreview(URL.createObjectURL(selected));
            }} />
          </div>
        </div>
        <div className="flex flex-wrap gap-3"><button className="btn" type="submit">{busy ? "Saving…" : "Save"}</button><button className="btn secondary" type="button" onClick={closeForm}>Cancel</button></div>
      </fieldset>
    </form>}
    {!form && (loading ? <p className="muted py-6" role="status">Loading…</p> : <div className="mt-4 space-y-2">
      {sections.map(([label, list]) => <div key={label || "all"} className="space-y-2">{!!label && <p className="section-chip">{label}</p>}{list.map(row => <div key={row.id}>
        <button className="panel word-row sop-row w-full text-left" onClick={() => {setReading(row.id); window.scrollTo(0, 0);}}>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{row.title}</span>
            {!!storyExcerpt(row.body) && <span className="muted mt-1 block text-sm">{storyExcerpt(row.body)}</span>}
          </span>
        </button>
        {/* Edit and Delete live inside the topic, one tap away. */}
      </div>)}</div>)}
      {!rows.length && <p className="muted py-6">{canEdit ? "Nothing here yet. Add the first topic. The concept is a good place to start." : "Nothing here yet. Your manager writes this."}</p>}
    </div>)}
    {canEdit && !form && !loading && rows.length > 0 && <div className="card-admin"><p className="eyebrow muted mb-3">Manager only</p><div className="card-admin-actions"><DownloadSheet variant="button" buttonLabel="Download all" label="Download all of Our story" build={async () => storySheet({topics: rows.map(row => ({title: row.title, body: row.body, section: row.section})), updated: rows.reduce((latest, row) => row.updated_at > latest ? row.updated_at : latest, "")}, {restaurant: restaurantName})} /></div></div>}
  </section>;
}
