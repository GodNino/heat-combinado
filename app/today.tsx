"use client";

// The top of the manager's Today: three figures for the day, then one compact card with a row for
// Pre-shift, Side work and the last shift report. A row says what it needs in one look:
// a red "Not posted" button, an amber "In progress" button, or a green dot once it is done.
import { useEffect, useState, type ReactNode } from "react";
import { ChevronRight, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { formatHours, shiftHours, shortTime } from "@/lib/schedule";
import { serviceDay } from "@/lib/shift-report";
import { Stats } from "./ui";
import type { ShiftBoardResponse } from "./employee-home";

const localDay = (d = new Date()) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");

// People on today's schedule, the hours they add up to, and the requests waiting on a manager.
export function TodayFigures({restaurantId, canSchedule}: {restaurantId: string; canSchedule: boolean}) {
  const [figures, setFigures] = useState<{people: number; hours: number; requests: number} | null>(null);
  useEffect(() => {
    const db = supabase;
    if (!db) return;
    let alive = true;
    const from = new Date(); from.setHours(0, 0, 0, 0);
    const to = new Date(from); to.setDate(to.getDate() + 1);
    const quiet = async <T,>(work: () => PromiseLike<T>, fallback: T) => { try { return await work(); } catch { return fallback; } };
    void Promise.all([
      quiet(async () => { const {data, error} = await db.from("schedule_shifts").select("user_id,starts_at,ends_at").eq("restaurant_id", restaurantId).gte("starts_at", from.toISOString()).lt("starts_at", to.toISOString()); return error ? [] : (data ?? []) as {user_id: string; starts_at: string; ends_at: string}[]; }, [] as {user_id: string; starts_at: string; ends_at: string}[]),
      canSchedule ? quiet(async () => { const {data, error} = await db.rpc("shift_change_list", {rid: restaurantId}); return error ? 0 : ((data ?? []) as {status: string}[]).filter(c => c.status === "pending").length; }, 0) : 0,
      canSchedule ? quiet(async () => { const {count, error} = await db.from("time_off_requests").select("id", {count: "exact", head: true}).eq("restaurant_id", restaurantId).eq("status", "pending"); return error ? 0 : count ?? 0; }, 0) : 0,
    ]).then(([shifts, changes, timeOff]) => {
      if (alive) setFigures({people: new Set(shifts.map(s => s.user_id)).size, hours: shifts.reduce((sum, s) => sum + shiftHours(s), 0), requests: changes + timeOff});
    });
    return () => {alive = false;};
  }, [restaurantId, canSchedule]);
  if (!figures) return null;
  return <Stats items={[
    {value: String(figures.people), label: "People today"},
    {value: formatHours(figures.hours), label: "Scheduled"},
    {value: String(figures.requests), label: "Requests", alert: figures.requests > 0},
  ]} />;
}

type SideWork = {total: number; done: number};
// A first post stamps both times within a blink; anything past a few seconds apart is a real edit.
const EDIT_GAP = 5000;

function Row({title, sub, dot, right, onClick}: {title: string; sub: string; dot?: boolean; right?: ReactNode; onClick: () => void}) {
  return <li><button type="button" className="today-row" onClick={onClick}>
    <span className="today-row-text"><b>{title}{dot && <i className="today-state on" aria-hidden="true" />}</b><small>{sub}</small></span>
    {right}
  </button></li>;
}

export function TodayStatus({restaurantId, canPreshift, canReports, onPreshift, onSideWork, onReport}: {
  restaurantId: string; canPreshift: boolean; canReports: boolean; onPreshift: (edit: boolean) => void; onSideWork: () => void; onReport: () => void;
}) {
  const [board, setBoard] = useState<ShiftBoardResponse["board"] | undefined>(undefined);
  const [side, setSide] = useState<SideWork | undefined>(undefined);
  const [report, setReport] = useState<{service_date: string; label: string; submitted_at: string; id: string} | null>(null);
  const [writer, setWriter] = useState("");
  useEffect(() => {
    const db = supabase;
    if (!db) return;
    let alive = true;
    if (canPreshift) {
      void db.rpc("get_preshift_board", {rid: restaurantId}).then(({data}) => {
        if (alive) setBoard((data as ShiftBoardResponse | null)?.board ?? null);
      });
      void (async () => {
        try {
          const shifts = await db.from("checklist_shifts").select("id").eq("restaurant_id", restaurantId).eq("shift_date", localDay());
          if (shifts.error || !shifts.data?.length) {if (alive) setSide({total: 0, done: 0});return;}
          const jobs = await db.from("checklist_assignments").select("done_at").in("shift_id", shifts.data.map(row => row.id as string));
          const rows = jobs.error ? [] : (jobs.data ?? []) as {done_at: string | null}[];
          if (alive) setSide({total: rows.length, done: rows.filter(row => !!row.done_at).length});
        } catch {if (alive) setSide({total: 0, done: 0});}
      })();
    }
    if (canReports) {
      const since = new Date(Date.now() - 3 * 86_400_000).toISOString().slice(0, 10);
      void Promise.resolve(db.from("shift_reports").select("id,service_date,label,submitted_at").eq("restaurant_id", restaurantId).gte("service_date", since)
        .order("service_date", {ascending: false}).order("submitted_at", {ascending: false}).limit(1)).then(async ({data}) => {
        const latest = (data?.[0] as {id: string; service_date: string; label: string; submitted_at: string} | undefined) ?? null;
        if (!alive) return;
        setReport(latest);
        if (!latest) return;
        const names = await db.rpc("shift_report_names", {report_id: latest.id});
        if (alive) setWriter((((names.data ?? []) as {written_by: string}[])[0]?.written_by) ?? "");
      }, () => {});
    }
    return () => {alive = false;};
  }, [restaurantId, canPreshift, canReports]);
  const posted = !!board && board.restaurant_id === restaurantId && (!!board.note.trim() || !!board.entries.length || !!board.focus_item_ids?.length || !!board.focus_item_id);
  const edited = posted && !!board?.created_at && !!board?.updated_at && new Date(board.updated_at).getTime() - new Date(board.created_at).getTime() > EDIT_GAP;
  const by = board?.posted_by_name?.trim();
  const when = board?.created_at ? shortTime(new Date(board.created_at)) : "";
  const preSub = posted
    ? `${by ? `Posted by ${by}` : "Posted"}${when ? ` · ${when}` : ""}${edited && board?.updated_at ? ` · Edited ${shortTime(new Date(board.updated_at))}` : ""}`
    : "Your team sees nothing yet";
  const arrow = <ChevronRight size={14} aria-hidden="true" />;
  const sideSub = !side || !side.total ? "No jobs handed out yet" : side.done >= side.total ? `${side.total} ${side.total === 1 ? "job" : "jobs"} · all finished` : `${side.total} ${side.total === 1 ? "job" : "jobs"} · ${side.done} done`;
  const rows: ReactNode[] = [];
  if (canPreshift && board !== undefined) rows.push(<Row key="pre" title="Pre-shift" sub={preSub} dot={posted} onClick={() => onPreshift(posted)}
    right={posted ? <span className="icon-chip" aria-label="Edit today’s pre-shift"><Pencil size={14} aria-hidden="true" /></span> : <span className="today-pill fail">Not posted{arrow}</span>} />);
  if (canPreshift && side) rows.push(<Row key="side" title="Side work" sub={sideSub} dot={!!side.total && side.done >= side.total} onClick={onSideWork}
    right={!side.total ? <span className="today-pill fail">Not posted{arrow}</span> : side.done < side.total ? <span className="today-pill warn">In progress{arrow}</span> : undefined} />);
  if (canReports && report) rows.push(<Row key="report" title="Last shift report" sub={`${serviceDay(report.service_date)} ${report.label}${writer ? ` · Filed by ${writer}` : ""}`} onClick={onReport}
    right={<span className="today-more">{arrow}</span>} />);
  if (!rows.length) return null;
  return <section className="panel today-card today-status" aria-label="Today"><ul>{rows}</ul></section>;
}
