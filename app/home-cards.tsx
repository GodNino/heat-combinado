"use client";
// What waits for a manager, at the top of Home: every pending decision in one strip, each with its
// count and a tap straight to where it's decided. Each count asks the database only for what this
// person may see, so a Pre-shift manager without Team access simply gets fewer chips.
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight, ArrowLeftRight, CalendarOff, RotateCcw, UserRound } from "lucide-react";
import { supabase } from "@/lib/supabase";

export type AttentionTarget = "shift_changes" | "released" | "time_off" | "positions" | "retakes" | "urgent";
type Counts = Record<AttentionTarget, number>;

export function ManagerAttention({restaurantId, canTeam, canSchedule = canTeam, canReports, onOpen}: {
  restaurantId: string; canTeam: boolean; canSchedule?: boolean; canReports: boolean; onOpen: (target: AttentionTarget) => void;
}) {
  const [counts, setCounts] = useState<Counts | null>(null);
  useEffect(() => {
    let live = true;
    const db = supabase!;
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    // Anything that fails (an update not run yet, no access) counts as nothing rather than breaking Home.
    const count = async (work: () => PromiseLike<number>) => { try { return await work(); } catch { return 0; } };
    const changes = canSchedule ? Promise.resolve(db.rpc("shift_change_list", {rid: restaurantId})).then(({data, error}) => error ? [] : (data ?? []) as {status: string}[], () => []) : Promise.resolve([] as {status: string}[]);
    void Promise.all([
      changes.then(list => list.filter(c => c.status === "pending").length),
      changes.then(list => list.filter(c => c.status === "open").length),
      canSchedule ? count(async () => { const {count, error} = await db.from("time_off_requests").select("id", {count: "exact", head: true}).eq("restaurant_id", restaurantId).eq("status", "pending"); return error ? 0 : count ?? 0; }) : 0,
      canTeam ? count(async () => { const {data, error} = await db.rpc("team_without_position", {rid: restaurantId}); return error ? 0 : (data ?? []).length; }) : 0,
      count(async () => { const {data, error} = await db.rpc("quiz_retake_requests", {rid: restaurantId}); return error ? 0 : (data ?? []).length; }),
      canReports ? count(async () => { const {count, error} = await db.from("shift_reports").select("id", {count: "exact", head: true}).eq("restaurant_id", restaurantId).eq("urgent", true).gte("service_date", since); return error ? 0 : count ?? 0; }) : 0,
    ]).then(([shift_changes, released, time_off, positions, retakes, urgent]) => {
      if (live) setCounts({shift_changes, released, time_off, positions, retakes, urgent});
    });
    return () => {live = false;};
  }, [restaurantId, canTeam, canSchedule, canReports]);
  if (!counts) return null;
  const chips: [AttentionTarget, number, string, React.ReactNode][] = ([
    ["urgent", counts.urgent, counts.urgent === 1 ? "urgent shift report" : "urgent shift reports", <AlertTriangle key="i" size={16} aria-hidden="true" />],
    ["shift_changes", counts.shift_changes, counts.shift_changes === 1 ? "shift change to approve" : "shift changes to approve", <ArrowLeftRight key="i" size={16} aria-hidden="true" />],
    ["time_off", counts.time_off, counts.time_off === 1 ? "time off request" : "time off requests", <CalendarOff key="i" size={16} aria-hidden="true" />],
    ["released", counts.released, counts.released === 1 ? "released shift nobody took" : "released shifts nobody took", <ArrowLeftRight key="i" size={16} aria-hidden="true" />],
    ["positions", counts.positions, counts.positions === 1 ? "new person needs a position" : "new people need a position", <UserRound key="i" size={16} aria-hidden="true" />],
    ["retakes", counts.retakes, counts.retakes === 1 ? "quiz retake to approve" : "quiz retakes to approve", <RotateCcw key="i" size={16} aria-hidden="true" />],
  ] as [AttentionTarget, number, string, React.ReactNode][]).filter(([, n]) => n > 0);
  return <section className="panel attention mb-4" aria-label="Waiting for you">
    <p className="eyebrow muted">Waiting for you</p>
    {chips.length ? <ul className="attention-list">{chips.map(([key, n, words, icon]) => <li key={key}>
      <button type="button" className={`attention-chip ${key === "urgent" ? "urgent" : ""}`} onClick={() => onOpen(key)}>
        {icon}<b>{n}</b><span className="min-w-0 flex-1">{words}</span><ArrowRight size={15} aria-hidden="true" />
      </button>
    </li>)}</ul> : <p className="mt-1 text-sm">All caught up. Nothing is waiting for a decision.</p>}
  </section>;
}
