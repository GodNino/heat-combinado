"use client";
// Checklists, History: look back at any shift -- who did which job, when they finished, and
// what they wrote. For coaching, and for being fair about who gets the jobs nobody loves.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Notice } from "./ui";
import { clock } from "./checklist-mine";

type Person = {user_id: string; name: string};
type Shift = {id: string; label: string; shift_date: string};
type Row = {shift_id: string; title: string; steps: string[]; user_id: string | null; steps_done: number[]; done_at: string | null; note: string; sort_order: number};

const localDate = () => {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
};
// The first day still kept: today and the six days before it.
function oldestKept() {
  const d = new Date();
  d.setDate(d.getDate() - 6);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
// Anything older than a week is deleted, so History never grows. Only managers can do this;
// for anyone else it quietly does nothing.
export async function trimOld(restaurantId: string) {
  if (!supabase || !restaurantId) return;
  try { await supabase.from("checklist_shifts").delete().eq("restaurant_id", restaurantId).lt("shift_date", oldestKept()); } catch { /* try again next time */ }
}
function dayLabel(date: string) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {weekday: "short", month: "short", day: "numeric"});
}

export function History({restaurantId}: {restaurantId: string}) {
  const [people, setPeople] = useState<Person[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [open, setOpen] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    (async () => {
      if (!supabase || !restaurantId) return;
      try {
        const names = await supabase.rpc("checklist_names", {rid: restaurantId});
        if (names.error) throw names.error;
        const past = await supabase.from("checklist_shifts").select("id, label, shift_date").eq("restaurant_id", restaurantId).neq("status", "draft").gte("shift_date", oldestKept())
          .order("shift_date", {ascending: false}).order("created_at", {ascending: false}).limit(40);
        if (past.error) throw past.error;
        const list = (past.data ?? []) as Shift[];
        let jobs: Row[] = [];
        if (list.length) {
          const found = await supabase.from("checklist_assignments").select("shift_id, title, steps, user_id, steps_done, done_at, note, sort_order").in("shift_id", list.map(s => s.id)).order("sort_order");
          if (found.error) throw found.error;
          jobs = (found.data ?? []) as Row[];
        }
        if (!live) return;
        setPeople((names.data ?? []) as Person[]); setShifts(list); setRows(jobs);
      } catch (e) {
        const text = e instanceof Error ? e.message : String((e as {message?: string})?.message ?? e);
        if (live) setError(/checklist_|PGRST205|42P01/.test(text) ? "Checklists can’t be saved yet: the database update (033) hasn’t been run in Supabase." : text);
      }
      if (live) setLoading(false);
    })();
    return () => { live = false; };
  }, [restaurantId]);

  const nameOf = (id: string | null) => people.find(p => p.user_id === id)?.name ?? "Someone";
  // A meal with no jobs left in it (everything was deleted) is not worth listing.
  const days = shifts.filter(s => rows.some(row => row.shift_id === s.id));
  if (loading) return <p className="muted py-6" role="status">Loading…</p>;
  return <div className="mt-5">
    <div><Notice text={error} error /></div>
    <p className="muted mb-3 text-sm">The last 7 days. Older days are removed on their own.</p>
    {!days.length && !error && <div className="panel p-6"><p className="muted">No jobs yet. Jobs you assign are kept here for 7 days.</p></div>}
    <div className="space-y-2">{days.map(shift => {
      const jobs = rows.filter(row => row.shift_id === shift.id);
      const done = jobs.filter(row => row.done_at).length;
      const all = jobs.length > 0 && done === jobs.length;
      const shown = open === shift.id;
      return <div key={shift.id} className="panel" style={{padding: 0}}>
        <button type="button" aria-expanded={shown} onClick={() => setOpen(shown ? "" : shift.id)} className="flex w-full items-center gap-3 text-left" style={{padding: "14px 16px"}}>
          <span className="min-w-0 flex-1 font-semibold">{dayLabel(shift.shift_date)} · {shift.label}{shift.shift_date === localDate() && <span className="muted ml-2 text-xs font-normal">Today</span>}</span>
          <span style={{flexShrink: 0, padding: "2px 10px", borderRadius: 999, fontSize: 12, fontWeight: 700, color: all ? "var(--c-ok)" : "var(--c-warning)", background: all ? "var(--c-ok-bg)" : "var(--c-warning-bg)", border: "1px solid " + (all ? "var(--c-ok-line)" : "var(--c-warning-line)")}}>{all ? "✓ " : ""}{done} of {jobs.length}</span>
        </button>
        {shown && <div style={{padding: "0 16px 16px"}}>
          <div className="space-y-2">{jobs.map((row, i) => <div key={i}>
            <div className="flex items-baseline justify-between gap-3 text-sm"><span><b>{row.title}</b> · {nameOf(row.user_id)}</span><span className="muted shrink-0 text-xs">{row.done_at ? clock(row.done_at) : row.steps_done.length + " of " + row.steps.length + " steps"}</span></div>
            {!!row.note.trim() && <p className="muted mt-1 text-xs">Note from {nameOf(row.user_id)}: {row.note}</p>}
          </div>)}</div>
        </div>}
      </div>;
    })}</div>
  </div>;
}
