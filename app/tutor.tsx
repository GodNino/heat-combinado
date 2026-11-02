"use client";
// Tutor: study by talking. Pick a topic (or type anything) and the tutor asks, corrects and explains
// from the restaurant's own cards, story, standards and words (app/api/tutor, lib/tutor.ts). The
// conversation lives on this screen only: leaving or "New conversation" starts again, nothing is
// saved or scored.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, GraduationCap, RotateCcw, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { MAX_CHARS, MAX_TURNS, type TutorTurn } from "@/lib/tutor";
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

// Opened from a card, it starts on that card straight away and offers a way back to it.
export function Tutor({restaurantId, restaurantName, categories, card}: {restaurantId: string; restaurantName: string; categories: string[]; card?: {name: string; onBack: () => void}}) {
  const [turns, setTurns] = useState<TutorTurn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [off, setOff] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({block: "end", behavior: "smooth"}); }, [turns, busy]);
  const started = useRef(false);

  async function ask(text: string) {
    const content = text.trim().slice(0, MAX_CHARS);
    if (!content || busy || !supabase) return;
    const next: TutorTurn[] = [...turns, {role: "user", content}];
    setTurns(next); setDraft(""); setBusy(true); setError("");
    try {
      const {data: session} = await supabase.auth.getSession();
      const result = await fetch("/api/tutor", {
        method: "POST",
        headers: {"Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token ?? ""}`},
        body: JSON.stringify({restaurantId, messages: next.slice(-MAX_TURNS), lang: currentLang()}),
      }).then(r => r.json()).catch(() => null) as {reply?: string; configured?: boolean; error?: string} | null;
      if (result?.configured === false) { setOff(true); setTurns(turns); return; }
      if (!result?.reply) { setError(result?.error ?? "Couldn't reach the tutor. Check your connection and try again."); setTurns(turns); setDraft(content); return; }
      setTurns([...next, {role: "assistant", content: result.reply}]);
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

  return <section className="tutor mx-auto max-w-2xl">
    {card && <button type="button" className="btn secondary mb-4" onClick={card.onBack}><ArrowLeft size={16} /><span data-no-translate>{card.name}</span></button>}
    <ScreenHeader
      eyebrow={restaurantName}
      title="Tutor"
      info="Study by talking. The tutor asks you about the menu, the restaurant's story and its standards, and corrects you from the cards. Nothing here is saved or scored. Allergens: it only repeats what the cards say; when in doubt, ask the chef or a manager."
      action={turns.length > 0 && <button type="button" className="btn secondary shrink-0" disabled={busy} onClick={() => {setTurns([]); setError("");}}><RotateCcw size={15} />New conversation</button>}
    />
    {off && <p className="panel mt-4 p-4 text-sm">The tutor isn’t switched on yet. The app’s owner needs to add the tutor’s key (ANTHROPIC_API_KEY) in Vercel.</p>}
    <Notice text={error} error />
    {!turns.length && !off && <div className="mt-5">
      <p className="tutor-hello"><GraduationCap size={20} aria-hidden="true" />What would you like to study today?</p>
      <div className="word-chips mt-3" role="group" aria-label="Topics">
        {categories.map(name => <button key={name} type="button" className="word-chip" disabled={busy} onClick={() => void ask(studyTopic(name))}><span data-no-translate>{name}</span></button>)}
        {EXTRA_TOPICS.map(t => <button key={t.label} type="button" className="word-chip" disabled={busy} onClick={() => void ask(currentLang() === "es" ? t.es : t.en)}>{t.label}</button>)}
      </div>
      <p className="muted mt-3 text-xs">Or ask anything about the menu below.</p>
    </div>}
    {turns.length > 0 && <div className="tutor-chat mt-5" aria-live="polite" data-no-translate>
      {turns.map((t, i) => <p key={i} className={`tutor-bubble ${t.role}`}>{t.content}</p>)}
      {busy && <p className="tutor-bubble assistant muted" role="status">…</p>}
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
