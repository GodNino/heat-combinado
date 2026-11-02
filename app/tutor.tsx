"use client";
// Tutor: study by talking. Pick a topic (or type anything) and the tutor asks, corrects and explains
// from the restaurant's own cards, story, standards and words (app/api/tutor, lib/tutor.ts). Its
// answer appears as it is written. The conversation lives on this screen only, but the tutor
// remembers how each card went (tutor_practice, migration 057): it starts with what the person
// missed, and TutorProgress shows it on My progress. None of it is a quiz score.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, GraduationCap, RotateCcw, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { MenuItem } from "@/lib/menu";
import { MAX_CHARS, MAX_TURNS, toReview, type PracticeRow, type TutorTurn } from "@/lib/tutor";
import { Notice, ScreenHeader } from "./ui";
import { currentLang } from "./language";

// Each starter is sent as the person's first message, in the language they use the app in (the
// conversation itself isn't run through the translator).
const EXTRA_TOPICS: {label: string; en: string; es: string}[] = [
  {label: "Quiz me on allergens", en: "Quiz me on the allergens of the menu, one dish at a time.", es: "Hazme preguntas sobre los alérgenos del menú, un plato a la vez."},
  {label: "Play a guest", en: "Play a guest with a dietary restriction and let me recommend dishes. Coach me afterwards.", es: "Haz de cliente con una restricción alimentaria y déjame recomendarte platos. Luego dame consejos."},
  {label: "Our story", en: "Teach me the story of the restaurant.", es: "Enséñame la historia del restaurante."},
  {label: "Standards", en: "Help me learn our standards, one at a time.", es: "Ayúdame a aprender nuestros estándares, uno a la vez."},
];
const practiceCard = (name: string) => currentLang() === "es" ? `Quiero practicar la ficha "${name}". Hazme preguntas sobre ella.` : `I want to practice the card "${name}". Ask me about it.`;
const studyTopic = (name: string) => currentLang() === "es" ? `Quiero estudiar: ${name}.` : `I want to study the ${name}.`;
const reviewMissed = () => currentLang() === "es" ? "Repasemos las fichas que fallé antes." : "Let's review the cards I missed before.";
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
export function Tutor({restaurantId, restaurantName, userId, categories, card}: {restaurantId: string; restaurantName: string; userId: string; categories: string[]; card?: {name: string; onBack: () => void}}) {
  const [turns, setTurns] = useState<TutorTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [off, setOff] = useState(false);
  const practice = usePractice(restaurantId, userId);
  const missed = practice ? toReview(practice).length : 0;
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
    {!turns.length && !off && <div className="mt-5">
      <p className="tutor-hello"><GraduationCap size={20} aria-hidden="true" />What would you like to study today?</p>
      <div className="word-chips mt-3" role="group" aria-label="Topics">
        {missed > 0 && <button type="button" className="word-chip tutor-review" disabled={busy} onClick={() => void ask(reviewMissed())}>{`Review what I missed · ${missed}`}</button>}
        {categories.map(name => <button key={name} type="button" className="word-chip" disabled={busy} onClick={() => void ask(studyTopic(name))}><span data-no-translate>{name}</span></button>)}
        {EXTRA_TOPICS.map(t => <button key={t.label} type="button" className="word-chip" disabled={busy} onClick={() => void ask(currentLang() === "es" ? t.es : t.en)}>{t.label}</button>)}
      </div>
      <p className="muted mt-3 text-xs">Or ask anything about the menu below.</p>
    </div>}
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
