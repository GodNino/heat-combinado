"use client";
// The Home card: today's side work for everyone, with who has what and who is done. Your own
// job is marked and opens your checklist when tapped (new until you have opened it). Shows
// nothing at all when no jobs have been given out, so it never clutters.
import { useCallback, useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Status, markSeen, seenJobs } from "./checklist-mine";

type Row = {id: string; shift_id: string; title: string; steps: string[]; user_id: string | null; steps_done: number[]; done_at: string | null; sort_order: number; note: string};
type Shift = {id: string; label: string};
type Person = {user_id: string; name: string};

const MEALS = ["Brunch", "Lunch", "Dinner"];

// The restaurant's own calendar day, not the server's.
function localDate() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

// manager: every job is tappable and opens in Checklists (where the steps and note are).
export function MyJobCard({restaurantId, onOpen, manager = false}: {restaurantId: string; onOpen: () => void; manager?: boolean}) {
  const [me, setMe] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [seen, setSeen] = useState<string[]>([]);

  const load = useCallback(async () => {
    if (!supabase || !restaurantId) return;
    try {
      const who = await supabase.auth.getUser();
      const id = who.data.user?.id;
      if (!id) return;
      const today = await supabase.from("checklist_shifts").select("id, label").eq("restaurant_id", restaurantId).eq("shift_date", localDate()).neq("status", "draft");
      const list = ((today.data ?? []) as Shift[]).sort((a, b) => MEALS.indexOf(a.label) - MEALS.indexOf(b.label));
      if (today.error || !list.length) { setRows([]); return; }
      const jobs = await supabase.from("checklist_assignments").select("id, shift_id, title, steps, user_id, steps_done, done_at, sort_order, note").in("shift_id", list.map(s => s.id)).order("sort_order");
      if (jobs.error) { setRows([]); return; }
      const names = await supabase.rpc("checklist_names", {rid: restaurantId});
      setMe(id); setShifts(list); setSeen(seenJobs(restaurantId, id));
      setPeople(names.error ? [] : (names.data ?? []) as Person[]);
      setRows(((jobs.data ?? []) as Row[]).sort((a, b) => list.findIndex(s => s.id === a.shift_id) - list.findIndex(s => s.id === b.shift_id) || a.sort_order - b.sort_order));
    } catch { setRows([]); }
  }, [restaurantId]);
  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 30000);
    const again = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", again);
    return () => { window.clearInterval(timer); document.removeEventListener("visibilitychange", again); };
  }, [load]);

  if (!rows.length) return null;
  const many = shifts.length > 1;
  const labelOf = (row: Row) => shifts.find(s => s.id === row.shift_id)?.label ?? "";
  const nameOf = (id: string | null) => people.find(p => p.user_id === id)?.name ?? "Someone";
  const open = (row: Row) => {
    markSeen(restaurantId, me, [row.id]); setSeen(list => [...list, row.id]);
    if (manager) { try { window.sessionStorage.setItem("heat-open-job", row.id); } catch { /* it just opens the list */ } }
    onOpen();
  };

  return <section className="panel mb-4" style={{padding: "12px 16px"}} aria-label="Today’s side work">
    <p className="eyebrow muted">Today’s side work</p>
    <div>{rows.map((row, index) => {
      const yours = row.user_id === me;
      const tappable = yours || manager;
      const fresh = yours && !row.done_at && !seen.includes(row.id);
      const line = nameOf(row.user_id) + (many && labelOf(row) ? " · " + labelOf(row) : "") + (!row.done_at && yours && row.steps_done.length ? " · " + row.steps_done.length + " of " + row.steps.length + " steps" : "");
      const inside = <>
        <span className="min-w-0 flex-1 text-left">
          <span className="block font-semibold">{row.title}</span>
          <span className="muted block text-xs">{line}{yours && <span className="ml-2 align-middle" style={{padding: "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, color: fresh ? "var(--ink)" : undefined, background: fresh ? "var(--lime)" : undefined, border: "1px solid " + (fresh ? "var(--edge)" : "var(--c-line-3)")}}>{fresh ? "New for you" : "You"}</span>}{manager && !!row.note.trim() && <span className="ml-2 align-middle" style={{padding: "0 8px", borderRadius: 999, fontSize: 11, fontWeight: 700, border: "1px solid var(--c-line-3)"}}>Note</span>}</span>
        </span>
        <Status row={row} />
        {tappable ? <ChevronRight size={16} className="shrink-0" aria-hidden="true" /> : <span aria-hidden="true" className="shrink-0" style={{width: 16}} />}
      </>;
      const style = {padding: "5px 0", borderTop: index ? "1px solid var(--c-line)" : undefined};
      return tappable
        ? <button key={row.id} type="button" className="flex w-full items-center gap-3" style={style} onClick={() => open(row)}>{inside}</button>
        : <div key={row.id} className="flex items-center gap-3" style={style}>{inside}</div>;
    })}</div>
  </section>;
}
