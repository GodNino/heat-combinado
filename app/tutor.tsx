"use client";
// Tutor: study by talking. Pick a topic (or type anything) and the tutor asks, corrects and explains
// from the restaurant's own cards, story, standards and words (app/api/tutor, lib/tutor.ts). Its
// answer appears as it is written. The conversation lives on this screen only, but the tutor
// remembers how each card went (tutor_practice, migration 057): it starts with what the person
// missed, and TutorProgress shows it on My progress. None of it is a quiz score.
import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ChevronRight, GraduationCap, RotateCcw, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { MenuItem } from "@/lib/menu";
import { CONTENT_TYPES, categoryOf, contentTypeOf, type ContentType } from "@/lib/categories";
import { MAX_CHARS, MAX_TURNS, toReview, type PracticeRow, type TutorTurn } from "@/lib/tutor";
import { Notice, ScreenHeader } from "./ui";
import { currentLang } from "./language";
import { useTaxonomy } from "./taxonomy";

// Every starter is sent as the person's first message, in the language they use the app in (the
// conversation itself isn't run through the translator). The home screen reads top to bottom: what
// to review (or where to start), then how to practise, then what to study.
type Mode = "ask" | "teach" | "guest";
const MODES: {id: Mode; label: string; hint: string}[] = [
  {id: "ask", label: "Quiz me", hint: "I ask you questions, one card at a time, and correct you."},
  {id: "teach", label: "Explain it", hint: "I explain each card first, then ask you about it so it sticks."},
  {id: "guest", label: "Play a guest", hint: "Practise a real table: I'm the guest, then I coach you."},
];
const es = () => currentLang() === "es";
const topicPrompt = (mode: Mode, name: string) => mode === "teach"
  ? (es() ? `Explícame ${name}: cuéntame cada ficha y luego pregúntame.` : `Teach me the ${name}: explain each card, then ask me about it.`)
  : mode === "guest"
    ? (es() ? `Haz de cliente en mi mesa interesado en ${name}. Déjame recomendar y responder, y luego dame consejos.` : `Play a guest at my table who's interested in the ${name}. Let me recommend and answer, then coach me.`)
    : (es() ? `Pregúntame sobre ${name}, una ficha a la vez.` : `Quiz me on the ${name}, one card at a time.`);
const allergenPrompt = (mode: Mode, library: string) => mode === "teach"
  ? (es() ? `Explícame los alérgenos de ${library} y luego pregúntame.` : `Explain the allergens in ${library}, then ask me about them.`)
  : mode === "guest"
    ? (es() ? `Haz de cliente con una alergia alimentaria y déjame recomendarte algo de ${library}. Luego dame consejos.` : `Play a guest with a food allergy and let me recommend something from ${library}. Coach me afterwards.`)
    : (es() ? `Pregúntame los alérgenos de ${library}, un plato a la vez.` : `Quiz me on the allergens in ${library}, one item at a time.`);
const restaurantPrompt = (mode: Mode, what: "story" | "standards") => what === "story"
  ? (mode === "ask" ? (es() ? "Pregúntame sobre la historia del restaurante." : "Ask me about the story of the restaurant.") : (es() ? "Enséñame la historia del restaurante." : "Teach me the story of the restaurant."))
  : (mode === "ask" ? (es() ? "Pregúntame sobre nuestros estándares, uno a la vez." : "Quiz me on our standards, one at a time.") : (es() ? "Ayúdame a aprender nuestros estándares, uno a la vez." : "Help me learn our standards, one at a time."));
const practiceCard = (name: string) => es() ? `Quiero practicar la ficha "${name}". Hazme preguntas sobre ella.` : `I want to practice the card "${name}". Ask me about it.`;
const reviewMissed = () => es() ? "Repasemos las fichas que fallé antes." : "Let's review the cards I missed before.";
const FAILED = "Couldn't reach the tutor. Check your connection and try again.";

// This person's practice in this restaurant, newest first. Null until loaded, or when migration 057
// hasn't run (then there is nothing to show).
function usePractice(restaurantId: string, userId: string) {
  const [rows, setRows] = useState<PracticeRow[] | null>(null);
  useEffect(() => {
    let live = true;
    void supabase?.from("tutor_practice").select("menu_item_id, result, missed, created_at").eq("restaurant_id", restaurantId).eq("user_id", userId)
      .order("created_at", {ascending: false}).limit(500)
      .then(({data, error}) => { if (live) setRows(error ? null : (data ?? []) as PracticeRow[]); });
    return () => { live = false; };
  }, [restaurantId, userId]);
  return rows;
}

// Opened from a card, it starts on that card straight away and offers a way back to it.
export function Tutor({restaurantId, restaurantName, userId, items, card}: {restaurantId: string; restaurantName: string; userId: string; items: MenuItem[]; card?: {name: string; onBack: () => void}}) {
  const [turns, setTurns] = useState<TutorTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [off, setOff] = useState(false);
  const practice = usePractice(restaurantId, userId);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({block: "end", behavior: "smooth"}); }, [turns, busy]);
  const started = useRef(false);

  async function ask(text: string) {
    const content = text.trim().slice(0, MAX_CHARS);
    if (!content || busy || !supabase) return;
    const next: TutorTurn[] = [...turns, {role: "user", content}];
    const undo = (message: string) => { setTurns(turns); setDraft(content); setError(message); };
    setTurns(next); setDraft(""); setBusy(true); setError("");
    try {
      const {data: session} = await supabase.auth.getSession();
      const response = await fetch("/api/tutor", {
        method: "POST",
        headers: {"Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token ?? ""}`},
        body: JSON.stringify({restaurantId, messages: next.slice(-MAX_TURNS), lang: currentLang()}),
      }).catch(() => null);
      if (!response) return undo(FAILED);
      // Plain JSON means the tutor never started: not switched on, or the request was refused.
      if (!response.body || (response.headers.get("content-type") ?? "").includes("application/json")) {
        const result = await response.json().catch(() => null) as {configured?: boolean; error?: string} | null;
        if (result?.configured === false) { setOff(true); setTurns(turns); return; }
        return undo(result?.error ?? FAILED);
      }
      // Otherwise one JSON object per line: pieces of the answer, or why it stopped.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", reply = "", stopped = "";
      for (;;) {
        const {value, done} = await reader.read().catch(() => ({value: undefined, done: true}));
        buffer += decoder.decode(value, {stream: !done});
        const lines = buffer.split("\n");
        buffer = done ? "" : lines.pop() ?? "";
        for (const line of lines) {
          const piece = (() => { try { return JSON.parse(line) as {text?: string; error?: string}; } catch { return null; } })();
          if (piece?.text) { reply += piece.text; setTurns([...next, {role: "assistant", content: reply}]); }
          if (piece?.error) stopped = piece.error;
        }
        if (done) break;
      }
      if (!reply.trim()) return undo(stopped || FAILED);
      // Part of an answer is still worth reading; say it was cut short.
      if (stopped) setError(stopped);
    } finally { setBusy(false); }
  }
  const send = (event: FormEvent) => { event.preventDefault(); void ask(draft); };
  // Once per card: the screen is remounted for each card, and the ref keeps a second effect run
  // (React's development double-run) from asking twice.
  useEffect(() => {
    if (!card || started.current) return;
    started.current = true;
    void ask(practiceCard(card.name));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const waiting = busy && turns.at(-1)?.role === "user";

  return <section className="tutor mx-auto max-w-2xl">
    {card && <button type="button" className="btn secondary mb-4" onClick={card.onBack}><ArrowLeft size={16} /><span data-no-translate>{card.name}</span></button>}
    <ScreenHeader
      eyebrow={restaurantName}
      title="Tutor"
      info="Study by talking. The tutor asks you about the menu, the restaurant's story and its standards, and corrects you from the cards. It remembers which cards you practised and starts with what you missed; none of it is a quiz score. Allergens: it only repeats what the cards say; when in doubt, ask the chef or a manager."
      action={turns.length > 0 && <button type="button" className="btn secondary shrink-0" disabled={busy} onClick={() => {setTurns([]); setError("");}}><RotateCcw size={15} />New conversation</button>}
    />
    {off && <p className="panel mt-4 p-4 text-sm">The tutor isn’t switched on yet. The app’s owner needs to add the tutor’s key (ANTHROPIC_API_KEY) in Vercel.</p>}
    <Notice text={error} error />
    {!turns.length && !off && <TutorHome items={items} practice={practice ?? []} busy={busy} onAsk={text => void ask(text)} />}
    {turns.length > 0 && <div className="tutor-chat mt-5" aria-live="polite" data-no-translate>
      {turns.map((t, i) => <p key={i} className={`tutor-bubble ${t.role}`}>{t.content}</p>)}
      {waiting && <p className="tutor-bubble assistant muted" role="status">…</p>}
      <div ref={end} />
    </div>}
    {!off && <form className="tutor-input mt-4" onSubmit={send}>
      <textarea aria-label="Your message" rows={2} maxLength={MAX_CHARS} value={draft} placeholder="Type your answer or question" onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(draft); } }} />
      <button type="submit" className="btn" disabled={busy || !draft.trim()} aria-label="Send"><Send size={16} /></button>
    </form>}
    {turns.length >= MAX_TURNS && <p className="muted mt-2 text-xs">Long conversation: the tutor now only remembers the most recent messages. Start a new one for a new topic.</p>}
  </section>;
}

// The home screen, top to bottom: the cards to review (or, with nothing to review, where to start)
// with the screen's one primary button; how to practise; what to study, one library at a time, each
// section in the restaurant's own order with how much of it was practised; the restaurant itself.
function TutorHome({items, practice, busy, onAsk}: {items: MenuItem[]; practice: PracticeRow[]; busy: boolean; onAsk: (text: string) => void}) {
  const {namesFor, labelFor} = useTaxonomy();
  const [mode, setMode] = useState<Mode>("ask");
  const libraries = CONTENT_TYPES.filter(type => items.some(item => contentTypeOf(item) === type));
  const [picked, setPicked] = useState<ContentType | null>(null);
  const library = picked && libraries.includes(picked) ? picked : libraries[0] ?? "food";
  const byId = useMemo(() => new Map(items.map(item => [item.id, item])), [items]);
  const practised = useMemo(() => new Set(practice.map(row => row.menu_item_id)), [practice]);
  const review = toReview(practice).filter(row => byId.has(row.menu_item_id));
  // Sections that have cards, in the restaurant's order; any it hasn't placed come after, A to Z.
  const sectionsOf = (type: ContentType) => {
    const counts = new Map<string, {total: number; done: number}>();
    for (const item of items.filter(i => contentTypeOf(i) === type)) {
      const name = categoryOf(item), had = counts.get(name) ?? {total: 0, done: 0};
      counts.set(name, {total: had.total + 1, done: had.done + (practised.has(item.id) ? 1 : 0)});
    }
    const order = namesFor(type).filter(name => counts.has(name));
    const rest = [...counts.keys()].filter(name => !order.includes(name)).sort((a, b) => a.localeCompare(b));
    return [...order, ...rest].map(name => ({name, ...counts.get(name)!}));
  };
  const sections = sectionsOf(library);
  const start = review.length ? null : libraries.flatMap(sectionsOf).find(section => section.done < section.total);
  const minutes = (cards: number) => Math.max(5, Math.round(cards * 1.5));

  return <div className="tutor-home mt-5">
    {review.length > 0 && <section className="panel tutor-lead" aria-label="Pick up where you left off">
      <p className="tutor-lead-eyebrow">Pick up where you left off</p>
      <h2 className="tutor-lead-title">{`${review.length} ${review.length === 1 ? "card" : "cards"} to review`}</h2>
      <ul className="tutor-lead-list">{review.slice(0, 3).map(row => <li key={row.menu_item_id}>
        <span className="font-semibold" data-no-translate>{byId.get(row.menu_item_id)!.name}</span>
        {row.missed ? <span className="muted text-xs" data-no-translate>{row.missed}</span> : <span className="muted text-xs">{row.result === "wrong" ? "Missed" : "Partly right"}</span>}
      </li>)}</ul>
      <button type="button" className="btn" disabled={busy} onClick={() => onAsk(reviewMissed())}>Review now</button>
    </section>}
    {start && <section className="panel tutor-lead" aria-label="Start here">
      <p className="tutor-lead-eyebrow">Start here</p>
      <h2 className="tutor-lead-title" data-no-translate>{start.name}</h2>
      <p className="muted text-sm">{`${start.total} ${start.total === 1 ? "card" : "cards"}, about ${minutes(start.total)} minutes. I ask, correct you and remember what you miss for next time.`}</p>
      <button type="button" className="btn" disabled={busy} onClick={() => onAsk(topicPrompt(mode, start.name))}>Start</button>
    </section>}

    <section className="tutor-step" aria-label="How do you want to practise?">
      <p className="section-chip">1 · How do you want to practise?</p>
      <div className="category-tabs" role="group" aria-label="Way to practise">
        {MODES.map(m => <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>)}
      </div>
      <p className="muted text-sm">{MODES.find(m => m.id === mode)!.hint}</p>
    </section>

    <section className="tutor-step" aria-label="What do you want to study?">
      <p className="section-chip">2 · What do you want to study?</p>
      {libraries.length > 1 && <div className="category-tabs" role="group" aria-label="Menu section">
        {libraries.map(type => <button key={type} type="button" aria-pressed={library === type} onClick={() => setPicked(type)}><span data-no-translate>{labelFor(type).name}</span></button>)}
      </div>}
      {sections.length > 0 && <div className="panel tutor-topics">
        <button type="button" className="tutor-topic" disabled={busy} onClick={() => onAsk(allergenPrompt(mode, labelFor(library).name))}>
          <span className="tutor-allergen-tag">ALG</span>
          <span className="flex-1 font-semibold">Allergens in this section</span>
          <ChevronRight size={16} className="muted shrink-0" aria-hidden="true" />
        </button>
        {sections.map(section => <button key={section.name} type="button" className="tutor-topic" disabled={busy} onClick={() => onAsk(topicPrompt(mode, section.name))}>
          <span className="tutor-topic-body">
            <span className="tutor-topic-line"><span className="font-semibold" data-no-translate>{section.name}</span><span className="muted text-xs">{section.done === section.total ? "All practised" : `${section.done} of ${section.total} practised`}</span></span>
            <span className="tutor-bar" aria-hidden="true"><span className={section.done === section.total ? "full" : ""} style={{width: `${Math.round(100 * section.done / section.total)}%`}} /></span>
          </span>
          <ChevronRight size={16} className="muted shrink-0" aria-hidden="true" />
        </button>)}
      </div>}
    </section>

    <section className="tutor-step" aria-label="Get to know the restaurant">
      <p className="font-semibold text-sm">Get to know the restaurant</p>
      <div className="tutor-know">
        <button type="button" className="btn secondary" disabled={busy} onClick={() => onAsk(restaurantPrompt(mode, "story"))}>Our story</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => onAsk(restaurantPrompt(mode, "standards"))}>Standards</button>
      </div>
    </section>
    <p className="muted text-xs">Or ask anything below.</p>
  </div>;
}

// On My progress: how many cards were practised with the tutor and which to review, each opening its
// card. Shows nothing until the person has practised (or before migration 057).
export function TutorProgress({restaurantId, userId, items, onOpen, onTutor}: {restaurantId: string; userId: string; items: MenuItem[]; onOpen: (item: MenuItem) => void; onTutor: () => void}) {
  const practice = usePractice(restaurantId, userId);
  if (!practice?.length) return null;
  const byId = new Map(items.map(item => [item.id, item]));
  const cards = new Set(practice.map(row => row.menu_item_id).filter(id => byId.has(id))).size;
  const review = toReview(practice).filter(row => byId.has(row.menu_item_id));
  return <section className="panel my-6 p-5" aria-label="Practice with the tutor">
    <div className="flex items-center justify-between gap-3">
      <h2 className="text-lg font-semibold">Practice with the tutor</h2>
      <button type="button" className="btn secondary shrink-0" onClick={onTutor}><GraduationCap size={15} />Tutor</button>
    </div>
    <p className="muted mt-1 text-sm">{`${cards} ${cards === 1 ? "card" : "cards"} practised · ${review.length} to review`}</p>
    {review.length > 0 && <ul className="mt-3 space-y-2">{review.slice(0, 12).map(row => {
      const item = byId.get(row.menu_item_id)!;
      return <li key={row.menu_item_id}><button type="button" className="tutor-review-row" onClick={() => onOpen(item)}>
        <span className="font-semibold" data-no-translate>{item.name}</span>
        <span className="muted text-xs">{row.result === "wrong" ? "Missed" : "Partly right"}{row.missed ? <> · <span data-no-translate>{row.missed}</span></> : null}</span>
      </button></li>;
    })}</ul>}
  </section>;
}
