"use client";
// The Words tab: the glossary a restaurant writes, and the longer guides written from it.
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode, type TouchEvent } from "react";
import { ArrowLeft, ArrowRight, BookOpen, ImagePlus, Plus } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { sameWord, type CustomTerm } from "@/lib/glossary";
import { validatePhoto } from "@/lib/menu";
import { allergenBadge } from "@/lib/menu-summary";
import { Notice, Field, ScreenHeader } from "./ui";
import { DownloadSheet, loadPhoto } from "./sheet-download";
import { wordsSheet, guideSheet } from "@/lib/sheets";
import { photoLinks, shrinkPhoto } from "./photos";

// The words a menu uses, and the longer guides written from them. Servers read it;
// managers write it. A word with a story is a guide: the same row, written up properly.
type WordDraft = {term: string; say: string; means: string; note: string; also: string; story: string};
// A row is a word plus the restaurant’s record of it. The app ships no words of its own.
type WordRow = {term: string; custom?: CustomTerm};
const EMPTY_WORD: WordDraft = {term: "", say: "", means: "", note: "", also: "", story: ""};
const storyOf = (row?: WordRow) => (row?.custom?.story ?? "").trim();
const photoOf = (row?: WordRow) => (row?.custom?.photo_path ?? "").trim();
const PHOTO_EXTENSIONS: Record<string, string> = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"};
export function WordsManager({restaurantId, restaurantName, custom, onChanged, canEdit}: {restaurantId: string; restaurantName: string; custom: CustomTerm[]; onChanged: () => Promise<void>; canEdit: boolean}) {
  const [draft, setDraft] = useState<WordDraft>(EMPTY_WORD);
  const [form, setForm] = useState<{row?: WordRow} | null>(null);
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState("");
  const [side, setSide] = useState<"words" | "guides">("words");
  const [reading, setReading] = useState("");
  const [openWord, setOpenWord] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState("");
  const [links, setLinks] = useState<Record<string, string>>({});
  const guideTouch = useRef<{x: number; y: number; lock: "" | "swipe" | "scroll"} | null>(null);
  // Every word belongs to the restaurant. The app ships none of its own.
  const rows = useMemo<WordRow[]>(() => custom.filter(c => !c.hidden).map(c => ({term: c.term, custom: c})).sort((a, b) => a.term.localeCompare(b.term)), [custom]);
  const guides = useMemo(() => rows.filter(row => storyOf(row).length > 0), [rows]);
  const list = side === "guides" ? guides : rows;
  const shown = list.filter(row => !query.trim() || sameWord(row.term, query) || row.term.toLowerCase().includes(query.trim().toLowerCase()));
  const reader = reading ? rows.find(row => sameWord(row.term, reading)) : undefined;
  // Guide photos live in the same private bucket as the menu photos, so each needs a signed link.
  useEffect(() => {
    const paths = rows.map(row => photoOf(row)).filter(Boolean);
    if (!paths.length) { setLinks({}); return; }
    let live = true;
    void photoLinks(paths).then(found => { if (live) setLinks(found); }).catch(() => { if (live) setLinks({}); });
    return () => { live = false; };
  }, [rows]);
  const shotFor = (row?: WordRow) => (photoOf(row) && links[photoOf(row)]) || "";
  const editingShot = preview || shotFor(form?.row);
  const explain = (e: unknown) => {
    const text = e instanceof Error ? e.message : String((e as {message?: string})?.message ?? e);
    if (/story|photo_path/.test(text)) return "Guides can’t be saved yet: the database update (024) hasn’t been run in Supabase.";
    return /glossary_terms|PGRST205|42P01/.test(text) ? "Words can’t be saved yet: the database update (017) hasn’t been run in Supabase." : text;
  };
  async function run(work: () => Promise<void>, done: string) {
    if (!supabase) return;
    setBusy(true); setError(""); setMessage("");
    try { await work(); await onChanged(); setMessage(done); }
    catch (e) { setError(explain(e)); }
    finally { setBusy(false); }
  }
  function closeForm() { setForm(null); setFile(null); setPreview(""); setError(""); }
  function openForm(row?: WordRow) {
    const source = row?.custom;
    setDraft(source ? {term: source.term, say: source.say, means: source.means, note: source.note ?? "", also: (source.also ?? []).join(", "), story: source.story ?? ""} : EMPTY_WORD);
    setForm({row}); setError(""); setMessage(""); setConfirmDelete(""); setReading(""); setFile(null); setPreview("");
    window.scrollTo(0, 0);
  }
  async function save(event: FormEvent) {
    event.preventDefault();
    const row = form?.row;
    const term = draft.term.trim();
    if (!term || !draft.means.trim()) { setError("Add the word and what it means."); return; }
    const clash = rows.find(r => sameWord(r.term, term) && r !== row);
    if (clash) { setError(`“${clash.term}” is already in the list. Find it below and tap Edit.`); return; }
    const story = draft.story.trim();
    const base = {term, say: draft.say.trim(), means: draft.means.trim(), note: draft.note.trim(), story,
      also: draft.also.split(",").map(word => word.trim()).filter(Boolean).slice(0, 10), hidden: false, updated_at: new Date().toISOString()};
    await run(async () => {
      let photo_path = row?.custom?.photo_path ?? "";
      let uploaded = "";
      if (file) {
        const shrunk = await shrinkPhoto(file);
        const next = `${restaurantId}/${crypto.randomUUID()}.${PHOTO_EXTENSIONS[shrunk.type] ?? "jpg"}`;
        const upload = await supabase!.storage.from("menu-photos").upload(next, shrunk, {contentType: shrunk.type, cacheControl: "31536000"});
        if (upload.error) throw upload.error;
        uploaded = next; photo_path = next;
      }
      const values = {...base, photo_path};
      try {
        const result = row?.custom
          ? await supabase!.from("glossary_terms").update(values).eq("id", row.custom.id).eq("restaurant_id", restaurantId)
          : await supabase!.from("glossary_terms").insert({...values, restaurant_id: restaurantId});
        if (result.error) throw result.error;
      } catch (e) {
        // The row never saved, so the photo we just pushed has nothing pointing at it.
        if (uploaded) await supabase!.storage.from("menu-photos").remove([uploaded]);
        throw e;
      }
      closeForm();
      if (story) setSide("guides");
    }, story ? `Saved “${term}”. It shows on every card that mentions it, and its guide is under Guides.` : `Saved “${term}”. It now shows on every card that mentions it.`);
  }
  const remove = (row: WordRow, done: string) => run(async () => {
    const result = await supabase!.from("glossary_terms").delete().eq("id", row.custom!.id).eq("restaurant_id", restaurantId);
    if (result.error) throw result.error;
    setConfirmDelete(""); setReading("");
  }, done);
  const buttons = (row: WordRow, card?: {download?: ReactNode}) => <>
    {confirmDelete === row.term
      ? <><button className="btn secondary card-admin-danger" disabled={busy} onClick={() => void remove(row, `“${row.term}” was deleted.`)}>Delete for good</button><button className="btn secondary" onClick={() => setConfirmDelete("")}>Keep</button></>
      : <>
        <button className="btn secondary" disabled={busy} onClick={() => openForm(row)}>{card ? "Edit guide" : "Edit"}</button>
        {card?.download}
        <button className="btn secondary" disabled={busy} onClick={() => setConfirmDelete(row.term)}>Delete</button>
      </>}
  </>;
  // The guide uses the dish cards' Manager only row (Edit, Download, Delete, one size); the word list keeps its small buttons.
  const actions = (row: WordRow, card?: {download?: ReactNode}) => !canEdit ? null : card ? buttons(row, card) : <div className="word-actions">{buttons(row)}</div>;
  // Browsing guides the way the dish cards browse: arrows, a count, and a swipe.
  const guideIndex = reader ? guides.findIndex(row => sameWord(row.term, reader.term)) : -1;
  const goGuide = (step: number) => {
    const next = guides[guideIndex + step];
    if (next) { setReading(next.term); window.scrollTo(0, 0); }
  };
  const guideSwipe = {
    onTouchStart: (event: TouchEvent) => {
      const touch = event.touches[0];
      // One finger, and never from the screen edge — that belongs to the browser’s own back gesture.
      guideTouch.current = event.touches.length === 1 && touch.clientX > 25 && touch.clientX < window.innerWidth - 25
        ? {x: touch.clientX, y: touch.clientY, lock: ""}
        : null;
    },
    onTouchMove: (event: TouchEvent) => {
      const start = guideTouch.current;
      if (!start) return;
      if (event.touches.length > 1) {guideTouch.current = null; return;}
      if (start.lock) return;
      const touch = event.touches[0];
      const across = Math.abs(touch.clientX - start.x), down = Math.abs(touch.clientY - start.y);
      // Decided once, early: a gesture that begins vertical is a scroll and stays a scroll,
      // so reading the write-up can never flick you onto the next guide.
      if (across > 10 || down > 10) start.lock = down > across ? "scroll" : "swipe";
    },
    onTouchEnd: (event: TouchEvent) => {
      const start = guideTouch.current;
      guideTouch.current = null;
      if (!start || start.lock !== "swipe" || guideIndex < 0) return;
      const across = event.changedTouches[0].clientX - start.x;
      if (Math.abs(across) < 60) return;
      // Stop at the ends rather than looping, the same as the dish cards.
      goGuide(across < 0 ? 1 : -1);
    },
  };
  const guidePager = guideIndex < 0 ? null : <nav className="card-navigation" aria-label="Browse guides">
    <button type="button" className="btn secondary" disabled={guideIndex <= 0} onClick={() => goGuide(-1)} title={guides[guideIndex - 1]?.term} aria-label="Previous guide"><ArrowLeft size={18} aria-hidden="true"/></button>
    <span className="muted text-xs" aria-live="polite">{guideIndex + 1} of {guides.length}</span>
    <button type="button" className="btn secondary" disabled={guideIndex >= guides.length - 1} onClick={() => goGuide(1)} title={guides[guideIndex + 1]?.term} aria-label="Next guide"><ArrowRight size={18} aria-hidden="true"/></button>
  </nav>;
  // A guide on a screen of its own, so nothing competes with it.
  if (reader) return <section className="mx-auto max-w-2xl item-detail" {...guideSwipe}>
    <button className="btn secondary" onClick={() => setReading("")}><ArrowLeft size={16} />Guides</button>
    {guidePager}
    {shotFor(reader)
      ? <img src={shotFor(reader)} alt={reader.term} className="mt-4 w-full rounded-xl object-cover" style={{aspectRatio: "4 / 3"}} />
      : <div className="panel mt-4 flex items-center justify-center" style={{aspectRatio: "4 / 3"}}><span className="muted flex flex-col items-center gap-2 text-sm"><ImagePlus size={22} />No photo yet</span></div>}
    <h1 className="mt-5 text-2xl font-semibold">{reader.term}</h1>
    {!!reader.custom?.say.trim() && <p className="word-say mt-1">{reader.custom.say}</p>}
    <p className="mt-4 font-medium">{reader.custom?.means}</p>
    <div className="mt-4 space-y-3">{storyOf(reader).split("\n").map(part => part.trim()).filter(Boolean).map((part, index) => <p key={index} className="muted">{part}</p>)}</div>
    {!!reader.custom?.note.trim() && <section className="dish-allergens" aria-label="Allergen notes">
      <h3>Allergens</h3>
      <ul>{reader.custom.note.split(/[,;]/).map(part => part.trim()).filter(Boolean).map((part, index) => {
        const badge = allergenBadge(part);
        return <li key={index} className={badge.cc ? "cross-contact" : ""}><strong>{badge.code}</strong><span aria-hidden="true"> · </span>{badge.text}</li>;
      })}</ul>
    </section>}
    {guidePager}
    {canEdit && <div className="card-admin"><p className="eyebrow muted mb-3">Manager only</p><div className="card-admin-actions">{actions(reader, {download: reader.custom ? <DownloadSheet variant="button" label="Download this guide" build={async () => guideSheet({word: reader.custom!, photo: await loadPhoto(shotFor(reader))}, {restaurant: restaurantName})} /> : null})}</div></div>}
  </section>;
  return <section className="mx-auto max-w-3xl">
    <ScreenHeader
      eyebrow={canEdit ? "Manager workspace" : "Know your menu"}
      title={side === "guides" ? "Guides" : "Words"}
      info={canEdit
        ? "The words your menu uses, in your own wording. A word shows on every card that mentions it. Write one up properly and it becomes a guide your team can browse before service."
        : "The words and ingredients your menu uses, in your kitchen’s own wording. Tap a word to see what it means. Guides are the ones written up in full, with the story behind them."}
      action={canEdit && !form && <button className="btn shrink-0" onClick={() => openForm()}><Plus size={16} />{side === "guides" ? "Add a guide" : "Add a word"}</button>}
    />
    {canEdit && !form && side === "words" && rows.length > 0 && <div className="mb-4"><DownloadSheet variant="button" buttonLabel="Download all words" label="Download all words" build={async () => wordsSheet(custom, {restaurant: restaurantName})} /></div>}
    <div className="library-switch mb-4" aria-label="Words or guides">
      <button type="button" aria-pressed={side === "words"} onClick={() => {setSide("words"); setQuery(""); setMessage("");}}>Words</button>
      <button type="button" aria-pressed={side === "guides"} onClick={() => {setSide("guides"); setQuery(""); setMessage("");}}>Guides</button>
    </div>
    <div><Notice text={error} error /><Notice text={message} /></div>
    {canEdit && form && <form className="panel my-6 p-6" onSubmit={save}>
      <fieldset disabled={busy} className="space-y-4">
        <h2 className="text-xl font-semibold">{form.row ? `Edit “${form.row.term}”` : side === "guides" ? "Add a guide" : "Add a word"}</h2>
        <Field label="Word"><input id="word-term" maxLength={60} value={draft.term} onChange={e => setDraft({...draft, term: e.target.value})} placeholder="A word from your menu" required /></Field>
        <Field label="How to say it"><input id="word-say" maxLength={120} value={draft.say} onChange={e => setDraft({...draft, say: e.target.value})} placeholder="How it sounds out loud" /></Field>
        <Field label="What it means"><textarea id="word-means" maxLength={600} value={draft.means} onChange={e => setDraft({...draft, means: e.target.value})} placeholder="One or two sentences a server can say at the table." required /></Field>
        <Field label="The full write-up (optional — this is what makes it a guide)"><textarea id="word-story" rows={8} maxLength={4000} value={draft.story} onChange={e => setDraft({...draft, story: e.target.value})} placeholder="Where it comes from, what it tastes like, how it compares to what sits next to it on the menu, and what to say if a guest asks. Leave a blank line between paragraphs." /></Field>
        <div>
          <label htmlFor="word-photo">Photo (optional)</label>
          <div className="mt-2 rounded-xl border border-dashed border-line bg-raised p-5">
            {!!editingShot && <img src={editingShot} alt="" className="mb-4 h-48 w-full rounded-lg object-cover" />}
            <div className="muted mb-3 flex items-center gap-2 text-sm"><ImagePlus size={19} />JPG, PNG or WebP · up to 5 MB</div>
            <input id="word-photo" type="file" accept="image/jpeg,image/png,image/webp" onChange={event => {
              const selected = event.target.files?.[0];
              setError(""); setFile(null); setPreview("");
              if (!selected) return;
              const issue = validatePhoto(selected);
              if (issue) { setError(issue); event.target.value = ""; return; }
              setFile(selected); setPreview(URL.createObjectURL(selected));
            }} />
            {!!form.row && !!photoOf(form.row) && <p className="muted mt-3 text-xs">This guide already has a photo. Choosing a new one replaces it.</p>}
          </div>
        </div>
        <Field label="Allergens (optional, separate with commas)"><input id="word-note" maxLength={300} value={draft.note} onChange={e => setDraft({...draft, note: e.target.value})} placeholder="Fish, sesame, soy" /></Field>
        <Field label="Other spellings on the menu (optional, separate with commas)"><input id="word-also" value={draft.also} onChange={e => setDraft({...draft, also: e.target.value})} placeholder="Another spelling you use" /></Field>
        <div className="flex flex-wrap gap-3"><button className="btn" type="submit">{busy ? "Saving…" : draft.story.trim() ? "Save guide" : "Save word"}</button><button className="btn secondary" type="button" onClick={closeForm}>Cancel</button></div>
      </fieldset>
    </form>}
    {!form && <><label className="sr-only" htmlFor="word-search">Search {side === "guides" ? "guides" : "words"}</label>
    <input id="word-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${list.length} ${side === "guides" ? "guide" : "word"}${list.length === 1 ? "" : "s"}…`} />
    {side === "guides" ? <div className="mt-4">
      <p className="muted text-sm">{canEdit ? `${guides.length} written · ${guides.filter(row => !photoOf(row)).length} need a photo` : `${guides.length} to read`}</p>
      <div className="mt-2 grid grid-cols-2 gap-2 xl:grid-cols-3">{shown.map(row => <div key={row.term} className="flex min-w-0 flex-col">
        <button className="panel category-card flex w-full flex-1 flex-col overflow-hidden p-0 text-left" onClick={() => {setReading(row.term); window.scrollTo(0, 0);}}>
          {shotFor(row)
            ? <img src={shotFor(row)} alt="" className="block w-full object-cover" style={{aspectRatio: "4 / 3"}} />
            : <span className="muted flex items-center justify-center" style={{aspectRatio: "4 / 3", background: "var(--c-raised)"}}><ImagePlus size={20} /></span>}
          <span className="block p-3">
            <span className="block text-sm font-semibold">{row.term}</span>
            {!!row.custom?.say.trim() && <span className="word-say mt-1 block">{row.custom.say}</span>}
            <span className="guide-blurb muted mt-1 block text-xs">{row.custom?.means}</span>
          </span>
        </button>
      </div>)}</div>
      {!guides.length && <p className="muted py-6">{canEdit ? "No guides yet. Open a word under Words, add the full write-up, and it appears here for your team to browse." : "No guides yet. Your manager writes these — ask for the ones your section asks about most."}</p>}
      {!!guides.length && !shown.length && <p className="muted py-6">No guide matches “{query}”.</p>}
    </div> : <div className="mt-4 space-y-2">{shown.map(row => {
      const isOpen = !!openWord && sameWord(openWord, row.term);
      return <div key={row.term} className="panel overflow-hidden p-0">
        <button className="flex w-full items-baseline gap-3 p-4 text-left" aria-expanded={isOpen} onClick={() => setOpenWord(isOpen ? "" : row.term)}>
          <span className="font-semibold">{row.term}</span>
          {!!row.custom?.say.trim() && <span className="word-say">{row.custom.say}</span>}
          <ArrowRight size={14} className="muted ml-auto shrink-0 self-center" style={{transform: isOpen ? "rotate(90deg)" : "none"}} />
        </button>
        {isOpen && <div className="px-4 pb-4">
          <p className="text-sm">{row.custom?.means}</p>
          {!!row.custom?.note.trim() && <p className="muted mt-2 text-xs">{row.custom.note}</p>}
          {storyOf(row) ? <button className="btn secondary mt-3" onClick={() => {setSide("guides"); setReading(row.term); window.scrollTo(0, 0);}}><BookOpen size={15} />Read the guide</button> : null}
          {canEdit && <div className="mt-3">{actions(row)}</div>}
        </div>}
      </div>;
    })}
    {!rows.length && <p className="muted py-6">{canEdit ? "No words yet. Add the ones your team asks about most — a word shows on every card that mentions it." : "No words yet. Your manager adds these."}</p>}
    {!!rows.length && !shown.length && <p className="muted py-6">No word matches “{query}”.{canEdit ? <> <button className="btn secondary ml-2" onClick={() => {setDraft({...EMPTY_WORD, term: query.trim()});setForm({});window.scrollTo(0,0);}}>Add it</button></> : null}</p>}</div>}</>}
  </section>;
}
