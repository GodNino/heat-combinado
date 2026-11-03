"use client";
// Assistant: a manager asks about the restaurant -- the schedule and hours, the team's study, the
// shift reports -- and gets an answer from the app's own data, as it is written (app/api/assistant,
// lib/assistant.ts). It can propose giving study to people; nothing changes until the manager
// confirms the card, and then the app's own assign_menu_items does it with their access. The
// conversation lives on this screen only.
import { useEffect, useRef, useState, type FormEvent } from "react";
import { Check, ChevronRight, RotateCcw, Send } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Proposal } from "@/lib/assistant";
import { MAX_CHARS, MAX_TURNS } from "@/lib/tutor";
import { Notice, ScreenHeader } from "./ui";
import { currentLang } from "./language";

type Turn = {role: "user" | "assistant"; content: string; proposal?: Proposal; decided?: "done" | "cancelled"};
const es = () => currentLang() === "es";
const FAILED = "Couldn't reach the assistant. Check your connection and try again.";

// The starters, grouped as on the mockup: schedule and hours, the team's study, shift reports.
const GROUPS: {title: string; questions: {en: string; es: string}[]}[] = [
  {title: "Schedule and hours", questions: [
    {en: "Who's working today and who closes?", es: "¿Quién trabaja hoy y quién cierra?"},
    {en: "Who's close to overtime this week?", es: "¿Quién se acerca a horas extra esta semana?"},
    {en: "Any time-off requests or shift changes waiting?", es: "¿Hay días libres o cambios de turno pendientes?"},
  ]},
  {title: "Team study", questions: [
    {en: "Who's struggling with allergens?", es: "¿Quién falla en alérgenos?"},
    {en: "Who hasn't studied lately?", es: "¿Quién no ha estudiado últimamente?"},
    {en: "Give study to whoever needs it", es: "Asigna estudio a quien lo necesite"},
  ]},
  {title: "Shift reports", questions: [
    {en: "Sum up this week's shift reports", es: "Resume los reportes de turno de esta semana"},
    {en: "What problems keep coming up?", es: "¿Qué problemas se repiten?"},
  ]},
];
const WORKING: Record<string, string> = {schedule: "Looking at the schedule…", team: "Looking at the team's study…", reports: "Reading the shift reports…", menu: "Looking at the menu…", proposal: "Preparing a proposal…", other: "Working on it…"};

export function Assistant({restaurantId, restaurantName}: {restaurantId: string; restaurantName: string}) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [working, setWorking] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [off, setOff] = useState(false);
  const [confirming, setConfirming] = useState(-1);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({block: "end", behavior: "smooth"}); }, [turns, busy, working]);

  async function ask(text: string) {
    const content = text.trim().slice(0, MAX_CHARS);
    if (!content || busy || !supabase) return;
    const next: Turn[] = [...turns, {role: "user", content}];
    const undo = (why: string) => { setTurns(turns); setDraft(content); setError(why); };
    setTurns(next); setDraft(""); setBusy(true); setError(""); setMessage(""); setWorking("");
    try {
      const {data: session} = await supabase.auth.getSession();
      const response = await fetch("/api/assistant", {
        method: "POST",
        headers: {"Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token ?? ""}`},
        body: JSON.stringify({restaurantId, messages: next.slice(-MAX_TURNS).map(t => ({role: t.role, content: t.content}))}),
      }).catch(() => null);
      if (!response) return undo(FAILED);
      // Plain JSON means the assistant never started: not switched on, or the request was refused.
      if (!response.body || (response.headers.get("content-type") ?? "").includes("application/json")) {
        const result = await response.json().catch(() => null) as {configured?: boolean; error?: string} | null;
        if (result?.configured === false) { setOff(true); setTurns(turns); return; }
        return undo(result?.error ?? FAILED);
      }
      // One JSON object per line: pieces of the answer, what it is looking at, a proposal, or why it stopped.
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "", reply = "", stopped = "";
      let proposal: Proposal | undefined;
      const show = () => setTurns([...next, {role: "assistant", content: reply, proposal}]);
      for (;;) {
        const {value, done} = await reader.read().catch(() => ({value: undefined, done: true}));
        buffer += decoder.decode(value, {stream: !done});
        const lines = buffer.split("\n");
        buffer = done ? "" : lines.pop() ?? "";
        for (const line of lines) {
          const piece = (() => { try { return JSON.parse(line) as {text?: string; working?: string; proposal?: Proposal; error?: string}; } catch { return null; } })();
          if (piece?.working) setWorking(WORKING[piece.working] ?? WORKING.other);
          if (piece?.text) { reply += piece.text; setWorking(""); show(); }
          if (piece?.proposal) { proposal = piece.proposal; show(); }
          if (piece?.error) stopped = piece.error;
        }
        if (done) break;
      }
      if (!reply.trim() && !proposal) return undo(stopped || FAILED);
      if (stopped) setError(stopped);
    } finally { setBusy(false); setWorking(""); }
  }
  const send = (event: FormEvent) => { event.preventDefault(); void ask(draft); };

  // Confirming does the assigning, as this manager, through the app's own function.
  async function confirm(index: number) {
    const turn = turns[index];
    if (!turn?.proposal || !supabase || confirming >= 0) return;
    setConfirming(index); setError(""); setMessage("");
    try {
      for (const learner of turn.proposal.learners) {
        const result = await supabase.rpc("assign_menu_items", {rid: restaurantId, learner_id: learner.id, mids: turn.proposal.items.map(i => i.id), note: turn.proposal.note});
        if (result.error) throw result.error;
      }
      const count = turn.proposal.learners.length;
      const names = turn.proposal.learners.map(l => l.name).join(", ");
      const done = es() ? `Listo: asigné ${turn.proposal.items.length === 1 ? "la ficha" : `${turn.proposal.items.length} fichas`} a ${names}. Les aparece en su inicio.`
        : `Done: I assigned ${turn.proposal.items.length === 1 ? "the card" : `${turn.proposal.items.length} cards`} to ${names}. They'll see it on their Home.`;
      setTurns(current => [...current.map((t, i) => i === index ? {...t, decided: "done" as const} : t), {role: "assistant", content: done}]);
      setMessage(`Assigned to ${count} ${count === 1 ? "person" : "people"}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String((e as {message?: string})?.message ?? e));
    } finally { setConfirming(-1); }
  }
  const cancel = (index: number) => setTurns(current => current.map((t, i) => i === index ? {...t, decided: "cancelled" as const} : t));
  const waiting = busy && (turns.at(-1)?.role === "user" || !!working);
  // One lime button on screen: while a proposal waits, Confirm is it and Send steps back.
  const pending = turns.some(t => t.proposal && !t.decided);

  return <section className="assistant mx-auto max-w-2xl">
    <ScreenHeader
      eyebrow={restaurantName}
      title="Assistant"
      info="Ask about the schedule, hours, the team's study and the shift reports. It only sees what your access lets you see, and it changes nothing until you confirm."
      action={turns.length > 0 && <button type="button" className="btn secondary shrink-0" disabled={busy} onClick={() => {setTurns([]); setError(""); setMessage("");}}><RotateCcw size={15} />New conversation</button>}
    />
    {off && <p className="panel mt-4 p-4 text-sm">The assistant isn’t switched on yet. The app’s owner needs to add the key (ANTHROPIC_API_KEY) in Vercel.</p>}
    <Notice text={error} error /><Notice text={message} />
    {!turns.length && !off && <div className="assistant-home mt-5">
      {GROUPS.map(group => <section key={group.title} className="tutor-step" aria-label={group.title}>
        <p className="section-chip">{group.title}</p>
        <div className="panel tutor-topics">
          {group.questions.map(q => <button key={q.en} type="button" className="tutor-topic" disabled={busy} onClick={() => void ask(es() ? q.es : q.en)}>
            <span className="flex-1 font-semibold">{q.en}</span>
            <ChevronRight size={16} className="muted shrink-0" aria-hidden="true" />
          </button>)}
        </div>
      </section>)}
    </div>}
    {turns.length > 0 && <div className="tutor-chat mt-5" aria-live="polite">
      {turns.map((t, i) => <div key={i} className={`assistant-turn ${t.role}`}>
        {t.content && <p className={`tutor-bubble ${t.role}`} data-no-translate>{t.content}</p>}
        {t.proposal && <section className="assistant-proposal" aria-label="Proposal">
          <p className="tutor-lead-eyebrow">Proposal · Give study</p>
          <dl>
            <dt>What</dt><dd data-no-translate>{t.proposal.items.map(item => item.name).join(", ")}</dd>
            <dt>Who</dt><dd data-no-translate>{t.proposal.learners.map(l => l.name).join(", ")}</dd>
            {t.proposal.note && <><dt>Note</dt><dd data-no-translate>{t.proposal.note}</dd></>}
            <dt>They see</dt><dd>It appears on their Home to study.</dd>
          </dl>
          {!t.decided ? <div className="assistant-proposal-actions">
            <button type="button" className="btn" disabled={confirming >= 0 || busy} onClick={() => void confirm(i)}>{confirming === i ? "Assigning…" : "Confirm"}</button>
            <button type="button" className="btn secondary" disabled={confirming >= 0} onClick={() => cancel(i)}>Cancel</button>
            <span className="muted text-xs">Nothing changes until you confirm.</span>
          </div> : t.decided === "done"
            ? <p className="assistant-proposal-done"><Check size={15} aria-hidden="true" />Assigned</p>
            : <p className="muted text-sm">Cancelled. Nothing was changed.</p>}
        </section>}
      </div>)}
      {waiting && <p className="tutor-bubble assistant muted" role="status">{working || "…"}</p>}
      <div ref={end} />
    </div>}
    {!off && <form className="tutor-input mt-4" onSubmit={send}>
      <textarea aria-label="Your question" rows={2} maxLength={MAX_CHARS} value={draft} placeholder="Ask anything about your restaurant" onChange={e => setDraft(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void ask(draft); } }} />
      <button type="submit" className={pending ? "btn secondary" : "btn"} disabled={busy || !draft.trim()} aria-label="Send"><Send size={16} /></button>
    </form>}
  </section>;
}
