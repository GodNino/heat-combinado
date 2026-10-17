"use client";
// Checklists, as the person doing the job sees it: your job big with its steps, a button to say
// it is done, and the rest of the floor underneath so everyone knows when the room is ready.
// Managers who are on the floor see the same thing for their own job.
import { useCallback, useEffect, useState } from "react";
import { Check } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Notice } from "./ui";

type Person = {user_id: string; name: string};
type Shift = {id: string; label: string};
type Row = {id: string; shift_id: string; title: string; steps: string[]; user_id: string | null; steps_done: number[]; done_at: string | null; note: string; sort_order: number};

// The restaurant's own calendar day, not the server's.
function localDate() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const dayName = () => new Date().toLocaleDateString(undefined, {weekday: "long"});
export const clock = (when: string) => new Date(when).toLocaleTimeString([], {hour: "numeric", minute: "2-digit"});
const REFRESH_MS = 30000;
const MEALS = ["Brunch", "Lunch", "Dinner"];

// Jobs this person has already looked at, kept on their own phone, so a job that is new to them
// can say so on the Home screen.
const seenKey = (restaurantId: string, me: string) => "heat-seen-jobs:" + restaurantId + ":" + me;
export function seenJobs(restaurantId: string, me: string): string[] {
  try { return JSON.parse(window.localStorage.getItem(seenKey(restaurantId, me)) ?? "[]") as string[]; } catch { return []; }
}
export function markSeen(restaurantId: string, me: string, ids: string[]) {
  if (!me || !ids.length) return;
  try { window.localStorage.setItem(seenKey(restaurantId, me), JSON.stringify([...new Set([...seenJobs(restaurantId, me), ...ids])].slice(-200))); } catch { /* storage is off: the cue just stays */ }
}

export function Status({row}: {row: {done_at: string | null; steps_done: number[]}}) {
  const style = row.done_at
    ? {color: "var(--ink)", background: "var(--lime)", border: "1px solid var(--edge)"}
    : row.steps_done.length
      ? {color: "var(--c-warning)", background: "var(--c-warning-bg)", border: "1px solid var(--c-warning-line)"}
      : {color: "var(--c-muted)", background: "transparent", border: "1px solid var(--c-line-3)"};
  return <span style={{...style, flexShrink: 0, padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700}}>{row.done_at ? "✓ Done" : row.steps_done.length ? "In progress" : "Not yet"}</span>;
}

// showFloor off: only the person's own job, for a screen that lists the floor itself.
export function MyShift({restaurantId, showFloor = true}: {restaurantId: string; showFloor?: boolean}) {
  const [me, setMe] = useState("");
  const [people, setPeople] = useState<Person[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (quiet: boolean) => {
    if (!supabase || !restaurantId) return;
    if (!quiet) setLoading(true);
    try {
      const who = await supabase.auth.getUser();
      setMe(who.data.user?.id ?? "");
      const names = await supabase.rpc("checklist_names", {rid: restaurantId});
      if (names.error) throw names.error;
      setPeople((names.data ?? []) as Person[]);
      const today = await supabase.from("checklist_shifts").select("id, label")
        .eq("restaurant_id", restaurantId).eq("shift_date", localDate()).neq("status", "draft");
      if (today.error) throw today.error;
      const list = ((today.data ?? []) as Shift[]).sort((a, b) => MEALS.indexOf(a.label) - MEALS.indexOf(b.label));
      setShifts(list);
      if (list.length) {
        const jobs = await supabase.from("checklist_assignments").select("id, shift_id, title, steps, user_id, steps_done, done_at, note, sort_order")
          .in("shift_id", list.map(s => s.id)).order("sort_order");
        if (jobs.error) throw jobs.error;
        const found = ((jobs.data ?? []) as Row[]).sort((a, b) => list.findIndex(s => s.id === a.shift_id) - list.findIndex(s => s.id === b.shift_id) || a.sort_order - b.sort_order);
        setRows(found);
        // Opening the checklist counts as having seen the jobs that are yours.
        const mineNow = found.filter(row => row.user_id === (who.data.user?.id ?? "")).map(row => row.id);
        if (mineNow.length && showFloor) markSeen(restaurantId, who.data.user?.id ?? "", mineNow);
      } else setRows([]);
      setError("");
    } catch (e) {
      const text = e instanceof Error ? e.message : String((e as {message?: string})?.message ?? e);
      setError(/checklist_|PGRST205|42P01/.test(text) ? "Checklists aren’t ready yet." : text);
    }
    setLoading(false);
  }, [restaurantId, showFloor]);
  // The floor changes while you work, so look again now and then and whenever you come back.
  useEffect(() => {
    void load(false);
    const timer = window.setInterval(() => void load(true), REFRESH_MS);
    const again = () => { if (document.visibilityState === "visible") void load(true); };
    document.addEventListener("visibilitychange", again);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", again); };
  }, [load]);

  const labelOf = (row: Row) => shifts.find(s => s.id === row.shift_id)?.label ?? "";
  const nameOf = (id: string | null) => people.find(p => p.user_id === id)?.name ?? "Someone";
  const mine = rows.filter(row => row.user_id === me);
  const others = rows.filter(row => row.user_id !== me);
  const doneCount = rows.filter(row => row.done_at).length;
  const first = nameOf(me).split(" ")[0];

  async function tick(row: Row, step: number, on: boolean) {
    setRows(list => list.map(r => r.id === row.id ? {...r, steps_done: on ? [...r.steps_done, step].sort((a, b) => a - b) : r.steps_done.filter(n => n !== step)} : r));
    const result = await supabase!.rpc("checklist_tick_step", {aid: row.id, step, ticked: on});
    if (result.error) { setError(result.error.message); await load(true); }
  }
  async function finish(row: Row, finished: boolean) {
    setBusy(true); setError("");
    const result = await supabase!.rpc("checklist_finish_job", {aid: row.id, finished, job_note: notes[row.id] ?? row.note});
    if (result.error) setError(result.error.message);
    else setRows(list => list.map(r => r.id === row.id ? {...r, done_at: finished ? ((result.data as string | null) ?? new Date().toISOString()) : null, note: notes[row.id] ?? r.note} : r));
    setBusy(false);
  }

  if (loading) return !showFloor ? null : <p className="muted py-6" role="status">Loading…</p>;
  if (!shifts.length) return !showFloor ? null : <div>
    <div><Notice text={error} error /></div>
    <div className="panel mt-5 p-6">
      <h2 className="text-xl font-semibold">Nothing posted yet</h2>
      <p className="muted mt-1 text-sm">Your manager will post today’s jobs here.</p>
      <button className="btn secondary mt-4" onClick={() => void load(false)}>Check again</button>
    </div>
  </div>;

  const waiting = others.filter(row => !row.done_at);
  if (!showFloor && !mine.length) return null;
  return <div>
    <div><Notice text={error} error /></div>
    <p className="eyebrow muted mt-5">{dayName()}</p>
    {showFloor && !mine.length && <h2 className="mt-2 text-xl font-semibold">You don’t have a job today</h2>}
    {mine.map(row => {
      const total = row.steps.length;
      const ticked = row.steps_done.length;
      if (row.done_at) return <div key={row.id} className="panel mt-4 flex items-center gap-3 p-4">
        <Check size={20} className="shrink-0" aria-hidden="true" />
        <div className="min-w-0 flex-1"><h2 className="font-semibold">{row.title} done</h2><p className="muted text-sm">Nice work, {first}. Finished {clock(row.done_at)}.</p></div>
        <button type="button" className="shrink-0 text-sm underline" disabled={busy} onClick={() => void finish(row, false)}>Undo</button>
      </div>;
      return <div key={row.id} className="mt-2">
        <p className="muted text-sm">Your job today{shifts.length > 1 && labelOf(row) ? " · " + labelOf(row) : ""}</p>
        <div className="flex items-end justify-between gap-3">
          <h1 className="text-3xl font-semibold tracking-tight">{row.title}</h1>
          <span className="muted shrink-0 pb-1 text-sm font-semibold">{ticked} / {total}</span>
        </div>
        <div aria-hidden="true" className="mt-3" style={{height: 8, borderRadius: 999, background: "var(--c-line-3)", overflow: "hidden"}}>
          <div style={{width: (total ? Math.round(ticked / total * 100) : 0) + "%", height: "100%", background: "var(--ink)", transition: "width .2s"}} />
        </div>
        <div className="panel mt-4" style={{padding: 0}}>
          {row.steps.map((step, index) => {
            const on = row.steps_done.includes(index + 1);
            return <button key={index} type="button" role="checkbox" aria-checked={on} onClick={() => void tick(row, index + 1, !on)}
              className="flex w-full items-center gap-3 text-left" style={{padding: "14px 16px", borderBottom: index === total - 1 ? undefined : "1px solid var(--c-line)"}}>
              <span aria-hidden="true" style={{display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, flexShrink: 0, borderRadius: 8, color: "var(--ink)", background: on ? "var(--lime)" : "transparent", border: "1.5px solid " + (on ? "var(--edge)" : "var(--c-line-5)")}}>{on && <Check size={18} />}</span>
              <span className="min-w-0 flex-1">{step}</span>
            </button>;
          })}
        </div>
        <input className="mt-3" aria-label="A note for your manager" maxLength={300} value={notes[row.id] ?? row.note} onChange={e => setNotes({...notes, [row.id]: e.target.value})} placeholder="A note for your manager (optional)" />
        <button className="btn mt-3 w-full" disabled={busy} onClick={() => void finish(row, true)}>{busy ? "One moment…" : "Mark my job done"}</button>
      </div>;
    })}
    {showFloor && !!others.length && <div className="mt-6">
      <p className="eyebrow muted mb-2">Rest of the floor · {doneCount} of {rows.length} done</p>
      <div className="panel" style={{padding: 0}}>{others.map((row, index) => <div key={row.id} className="flex items-center gap-3" style={{padding: "12px 16px", borderBottom: index === others.length - 1 ? undefined : "1px solid var(--c-line)"}}>
        <span className="min-w-0 flex-1"><b>{nameOf(row.user_id)}</b> · {row.title}{shifts.length > 1 && labelOf(row) ? " · " + labelOf(row) : ""}</span>
        <Status row={row} />
      </div>)}</div>
      {!!mine.length && mine.every(row => row.done_at) && <p className="muted mt-3 text-sm">{waiting.length ? "Waiting on " + [...new Set(waiting.map(row => nameOf(row.user_id)))].join(", ") + ". Offer a hand if you are free." : "Everyone is done. Great shift."}</p>}
    </div>}
  </div>;
}
