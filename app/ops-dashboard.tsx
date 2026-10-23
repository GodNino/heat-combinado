"use client";
// The manager's dashboard, operations first: labor from the schedule and the service from the shift
// reports, this week (the restaurant's own week) against last. Training stays underneath it.
// Everything is read with the manager's own access; nothing here writes.
import { useEffect, useState } from "react";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { addDays, colorFor, dayKey, formatHours, readSettings, weekDays, weekStart, type ScheduleSettings, type Shift, type ShiftChange, type TimeOff } from "@/lib/schedule";
import { ISSUE_KINDS, MOODS, money, type ShiftReport } from "@/lib/shift-report";
import { change, laborSummary, mostOut, serviceSummary } from "@/lib/ops-stats";
import { SectionInfo } from "./ui";

type Person = {user_id: string; name: string; role: string};
type Loaded = {
  settings: ScheduleSettings; start: Date; shifts: Shift[]; names: Map<string, string>;
  released: number; timeOff: TimeOff[]; reports: ShiftReport[];
};

const range = (start: Date) => `${start.toLocaleDateString("en-US", {month: "short", day: "numeric"})} – ${addDays(start, 6).toLocaleDateString("en-US", {month: "short", day: "numeric"})}`;
const dateLabel = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"}); };

function Tile({value, label, note, alert = false}: {value: string; label: string; note?: string | null; alert?: boolean}) {
  return <div className={`dash-tile ${alert ? "alert" : ""}`}><b>{value}</b><span>{label}</span>{note && <small>{note}</small>}</div>;
}

export function OperationsDashboard({restaurantId, onOpenSchedule, onOpenReports}: {restaurantId: string; onOpenSchedule?: () => void; onOpenReports?: () => void}) {
  const [data, setData] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void (async () => {
      const db = supabase!;
      const saved = await db.from("schedule_settings").select("*").eq("restaurant_id", restaurantId).maybeSingle();
      const settings = readSettings(saved.error ? null : saved.data);
      const start = weekStart(new Date(), settings.week_start);
      const today = dayKey(new Date());
      const [shifts, team, changes, off, reports] = await Promise.all([
        db.from("schedule_shifts").select("*").eq("restaurant_id", restaurantId).gte("starts_at", addDays(start, -7).toISOString()).lt("starts_at", addDays(start, 7).toISOString()),
        db.rpc("schedule_team", {rid: restaurantId}),
        db.rpc("shift_change_list", {rid: restaurantId}),
        db.from("time_off_requests").select("*").eq("restaurant_id", restaurantId).eq("status", "approved").gte("ends_on", today).lte("starts_on", dayKey(addDays(new Date(), 14))).order("starts_on"),
        db.from("shift_reports").select("*").eq("restaurant_id", restaurantId).gte("service_date", dayKey(addDays(start, -21))).lt("service_date", dayKey(addDays(start, 7))),
      ]);
      if (!live) return;
      if (shifts.error && reports.error) return setError(shifts.error.message);
      setData({
        settings, start,
        shifts: (shifts.data ?? []) as Shift[],
        names: new Map(((team.data ?? []) as Person[]).map(p => [p.user_id, p.name || "Team member"])),
        released: ((changes.data ?? []) as ShiftChange[]).filter(c => c.status === "open").length,
        timeOff: (off.data ?? []) as TimeOff[],
        reports: (reports.data ?? []) as ShiftReport[],
      });
    })();
    return () => {live = false;};
  }, [restaurantId]);

  if (error) return <p className="panel p-5 muted">{error}</p>;
  if (!data) return <p className="muted mb-4" role="status">Loading this week…</p>;

  const {settings, start, shifts, names} = data;
  const inWeek = (s: Shift, from: Date) => Date.parse(s.starts_at) >= from.getTime() && Date.parse(s.starts_at) < addDays(from, 7).getTime();
  const labor = laborSummary(shifts.filter(s => inWeek(s, start)), shifts.filter(s => inWeek(s, addDays(start, -7))), settings);
  const days = weekDays(start).map(dayKey);
  const lastDays = weekDays(addDays(start, -7)).map(dayKey);
  // Last week only as far as this week has got, so a Wednesday isn't measured against a whole week.
  const today = dayKey(new Date());
  const sofar = Math.max(1, days.filter(d => d <= today).length);
  const service = serviceSummary(data.reports.filter(r => days.includes(r.service_date)), data.reports.filter(r => lastDays.slice(0, sofar).includes(r.service_date)), days);
  const out = mostOut(data.reports);
  const topCovers = Math.max(1, ...service.byDay.map(d => d.covers));
  const missing = service.byDay.filter(d => d.day < today && !d.reports).length;

  return <div className="ops-dash">
    {/* ── Labor ── */}
    <div className="ops-head">
      <div className="min-w-0 flex-1">
        <p className="eyebrow muted">This week · {range(start)}</p>
        <h2 className="text-xl font-semibold">Labor</h2>
      </div>
      {onOpenSchedule && <button type="button" className="btn secondary shrink-0" onClick={onOpenSchedule}>Schedule<ArrowRight size={15} aria-hidden="true" /></button>}
    </div>
    <div className="dash-tiles">
      <Tile value={formatHours(labor.hours)} label="Scheduled hours" note={change(labor.hours, labor.lastHours)} />
      <Tile value={String(labor.people)} label="People scheduled" />
      <Tile value={String(labor.overtime.length)} label="In overtime" note={`Past ${settings.overtime_weekly}h a week${settings.overtime_daily ? ` or ${settings.overtime_daily}h a day` : ""}`} alert={labor.overtime.length > 0} />
      <Tile value={String(labor.drafts)} label="Draft shifts" note={labor.drafts ? "Not published yet" : "Everything is published"} alert={labor.drafts > 0} />
    </div>

    <div className="panel dash-panel">
      <SectionInfo heading="Hours by position">This week against last, drafts included. People counts everyone with at least one shift.</SectionInfo>
      {labor.byPosition.length ? <table className="dash-table">
        <thead><tr><th scope="col">Position</th><th scope="col" className="num">This week</th><th scope="col" className="num">Last week</th><th scope="col" className="num">People</th></tr></thead>
        <tbody>{labor.byPosition.map(p => { const color = colorFor(p.position, settings.position_colors); return <tr key={p.position}>
          <th scope="row"><span className={`ops-position ${color ? `pos-${color}` : ""}`}><i aria-hidden="true" />{p.position}</span></th>
          <td className="num">{formatHours(p.hours)}</td>
          <td className="num muted">{formatHours(p.lastHours)}</td>
          <td className="num">{p.people}</td>
        </tr>; })}</tbody>
      </table> : <p className="muted mt-3">Nothing is scheduled this week or last.</p>}
    </div>

    {(labor.overtime.length > 0 || data.released > 0 || data.timeOff.length > 0) && <div className="panel dash-panel">
      <SectionInfo heading="Keep an eye on">Overtime this week, shifts someone released and nobody took yet, and time off in the next two weeks.</SectionInfo>
      <ul className="ops-list">
        {labor.overtime.map(o => <li key={o.user_id} className="warn"><AlertTriangle size={14} aria-hidden="true" /><b>{names.get(o.user_id) ?? "Team member"}</b><span>{o.daily ? `Over ${settings.overtime_daily}h in a day` : `${formatHours(o.hours)} this week`}</span></li>)}
        {data.released > 0 && <li><b>{data.released === 1 ? "1 released shift" : `${data.released} released shifts`}</b><span>Nobody has taken it yet</span></li>}
        {data.timeOff.map(t => <li key={t.id}><b>{names.get(t.user_id) ?? "Team member"}</b><span>{`Time off · ${t.starts_on === t.ends_on ? dateLabel(t.starts_on) : `${dateLabel(t.starts_on)} – ${dateLabel(t.ends_on)}`}`}</span></li>)}
      </ul>
    </div>}

    {/* ── Service ── */}
    <div className="ops-head mt-8">
      <div className="min-w-0 flex-1">
        <p className="eyebrow muted">From the shift reports · {range(start)}</p>
        <h2 className="text-xl font-semibold">Service</h2>
      </div>
      {onOpenReports && <button type="button" className="btn secondary shrink-0" onClick={onOpenReports}>Shift reports<ArrowRight size={15} aria-hidden="true" /></button>}
    </div>
    <div className="dash-tiles">
      <Tile value={service.covers.toLocaleString("en-US")} label="Covers" note={change(service.covers, service.lastCovers, "the same days last week")} />
      {service.hasSales && <Tile value={money(service.sales) ?? "$0"} label="Sales" note={change(service.sales, service.lastSales, "the same days last week")} />}
      <Tile value={String(service.reports)} label="Reports sent" note={missing ? `${missing} past ${missing === 1 ? "day" : "days"} without one` : "None missing so far"} alert={missing > 0} />
      <Tile value={String(service.urgent)} label="Urgent reports" note="Allergy incidents and injuries" alert={service.urgent > 0} />
    </div>

    <div className="panel dash-panel">
      <SectionInfo heading="Covers by day">From each day's shift reports. A day without a report shows nothing, not zero guests.</SectionInfo>
      <figure className="dash-weeks">
        <div className="dash-weeks-plot">
          <span className="dash-weeks-max">{topCovers}</span>
          {service.byDay.map(d => <div key={d.day} className={`dash-col ${d.day === today ? "current" : ""}`} tabIndex={0} aria-label={`${dateLabel(d.day)}: ${d.reports ? `${d.covers} covers` : "no report"}`}>
            <span className="dash-col-tip">{d.reports ? `${d.covers} covers${service.hasSales && d.sales ? ` · ${money(d.sales)}` : ""}` : "No report"}</span>
            {d.reports > 0 && <span className="dash-col-value">{d.covers}</span>}
            <span className="dash-col-bar" style={{height: `${d.covers / topCovers * 100}%`}} />
          </div>)}
        </div>
        <div className="dash-weeks-axis" aria-hidden="true">{service.byDay.map(d => <span key={d.day}>{dateLabel(d.day).split(",")[0]}</span>)}</div>
      </figure>
    </div>

    <div className="ops-grid">
      <div className="panel dash-panel">
        <SectionInfo heading="How the nights went">What managers chose in each report this week.</SectionInfo>
        {service.reports ? <ul className="ops-list">{(Object.keys(MOODS) as (keyof typeof MOODS)[]).map(mood => <li key={mood}><b>{MOODS[mood]}</b><span>{service.moods[mood]}</span></li>)}</ul>
          : <p className="muted mt-3">No reports this week yet.</p>}
      </div>
      <div className="panel dash-panel">
        <SectionInfo heading="Issues">Everything flagged in this week's reports, by kind.</SectionInfo>
        {service.issues.length ? <ul className="ops-list">{service.issues.map(i => <li key={i.kind} className={i.kind === "allergy" || i.kind === "injury" ? "warn" : ""}><b>{ISSUE_KINDS[i.kind]}</b><span>{i.count}</span></li>)}</ul>
          : <p className="muted mt-3">Nothing flagged this week.</p>}
      </div>
      <div className="panel dash-panel">
        <SectionInfo heading="What runs out">Dishes most often 86&apos;d or low in the last four weeks. Worth a look when ordering.</SectionInfo>
        {out.length ? <ul className="ops-list">{out.map(o => <li key={o.name}><b>{o.name}</b><span>{[o.out ? `86'd ${o.out}×` : "", o.low ? `low ${o.low}×` : ""].filter(Boolean).join(" · ")}</span></li>)}</ul>
          : <p className="muted mt-3">Nothing ran out in the last four weeks.</p>}
      </div>
    </div>

    <div className="ops-head mt-8">
      <div className="min-w-0 flex-1">
        <p className="eyebrow muted">Menu knowledge</p>
        <h2 className="text-xl font-semibold">Training</h2>
      </div>
    </div>
  </div>;
}
