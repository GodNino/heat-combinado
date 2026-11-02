"use client";
// The manager's dashboard, operations first: labor from the schedule and the service from the shift
// reports, this week (the restaurant's own week) against last. Training stays underneath it.
// Everything is read with the manager's own access; nothing here writes.
import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { addDays, dayKey, readSettings, weekDays, weekStart, type ScheduleSettings, type ShiftChange, type TimeOff } from "@/lib/schedule";
import { ISSUE_KINDS, MOODS, money, type ShiftReport } from "@/lib/shift-report";
import { mostOut, serviceSummary } from "@/lib/ops-stats";
import { SectionInfo, Stats, type StatNote } from "./ui";
import { LaborView } from "./labor-view";

type Person = {user_id: string; name: string; role: string};
type Loaded = {
  settings: ScheduleSettings; start: Date; people: Person[];
  released: number; timeOff: TimeOff[]; reports: ShiftReport[];
};

const range = (start: Date) => `${start.toLocaleDateString("en-US", {month: "short", day: "numeric"})} – ${addDays(start, 6).toLocaleDateString("en-US", {month: "short", day: "numeric"})}`;
const dateLabel = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"}); };

// "+5%", "−12%" or "0%" against before; null when there is nothing to compare with.
const delta = (now: number, before: number) => {
  if (!before) return null;
  const pct = Math.round((now - before) / before * 100);
  return pct === 0 ? "0%" : `${pct > 0 ? "+" : "−"}${Math.abs(pct)}%`;
};

// view: show one part (Labor, Service or Training) when a page puts chips above it; without it, show everything.
export type OpsView = "labor" | "service" | "training";
export function OperationsDashboard({restaurantId, restaurantName, onOpenReports, view}: {restaurantId: string; restaurantName: string; onOpenSchedule?: () => void; onOpenReports?: () => void; view?: OpsView}) {
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
      const [team, changes, off, reports] = await Promise.all([
        db.rpc("schedule_team", {rid: restaurantId}),
        db.rpc("shift_change_list", {rid: restaurantId}),
        db.from("time_off_requests").select("*").eq("restaurant_id", restaurantId).eq("status", "approved").gte("ends_on", today).lte("starts_on", dayKey(addDays(new Date(), 14))).order("starts_on"),
        db.from("shift_reports").select("*").eq("restaurant_id", restaurantId).gte("service_date", dayKey(addDays(start, -21))).lt("service_date", dayKey(addDays(start, 7))),
      ]);
      if (!live) return;
      if (reports.error) return setError(reports.error.message);
      setData({
        settings, start,
        people: (team.data ?? []) as Person[],
        released: ((changes.data ?? []) as ShiftChange[]).filter(c => c.status === "open").length,
        timeOff: (off.data ?? []) as TimeOff[],
        reports: (reports.data ?? []) as ShiftReport[],
      });
    })();
    return () => {live = false;};
  }, [restaurantId]);

  if (error) return <p className="panel p-5 muted">{error}</p>;
  if (!data) return <p className="muted mb-4" role="status">Loading this week…</p>;

  const {settings, start} = data;
  const days = weekDays(start).map(dayKey);
  const lastDays = weekDays(addDays(start, -7)).map(dayKey);
  // Last week only as far as this week has got, so a Wednesday isn't measured against a whole week.
  const today = dayKey(new Date());
  const sofar = Math.max(1, days.filter(d => d <= today).length);
  const service = serviceSummary(data.reports.filter(r => days.includes(r.service_date)), data.reports.filter(r => lastDays.slice(0, sofar).includes(r.service_date)), days);
  const out = mostOut(data.reports);
  const topCovers = Math.max(1, ...service.byDay.map(d => d.covers));
  const missing = service.byDay.filter(d => d.day < today && !d.reports).length;

  const coversDelta = delta(service.covers, service.lastCovers);
  const salesDelta = service.hasSales ? delta(service.sales, service.lastSales) : null;
  const serviceNotes: StatNote[] = [
    ...(coversDelta ? [{text: `Covers ${coversDelta} vs the same days last week`}] : []),
    ...(salesDelta ? [{text: `Sales ${salesDelta} vs the same days last week`}] : []),
    ...(missing ? [{tone: "fail" as const, text: `${missing} past ${missing === 1 ? "day" : "days"} without a report`}] : []),
    ...(service.urgent ? [{tone: "fail" as const, text: `${service.urgent} urgent ${service.urgent === 1 ? "report" : "reports"}: allergy incidents and injuries`}] : []),
  ];

  return <div className="ops-dash">
    {(!view || view === "labor") && <>
    {/* ── Labor ── */}
    <LaborView key={restaurantId} restaurantId={restaurantId} restaurantName={restaurantName} settings={settings} people={data.people} released={data.released} timeOff={data.timeOff} />
    </>}

    {(!view || view === "service") && <>
    {/* ── Service ── */}
    <div className="ops-head mt-8">
      <div className="min-w-0 flex-1">
        <p className="eyebrow muted">From the shift reports · {range(start)}</p>
        <h2 className="text-xl font-semibold">Service</h2>
      </div>
      {onOpenReports && <button type="button" className="btn secondary shrink-0" onClick={onOpenReports}>Shift reports<ArrowRight size={15} aria-hidden="true" /></button>}
    </div>
    <Stats items={[
      {value: service.covers.toLocaleString("en-US"), label: "Covers"},
      ...(service.hasSales ? [{value: money(service.sales) ?? "$0", label: "Sales"}] : []),
      {value: String(service.reports), label: "Reports", alert: missing > 0},
      {value: String(service.urgent), label: "Urgent", alert: service.urgent > 0},
    ]} notes={serviceNotes} />

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

    </>}

    {!view && <div className="ops-head mt-8">
      <div className="min-w-0 flex-1">
        <p className="eyebrow muted">Menu knowledge</p>
        <h2 className="text-xl font-semibold">Training</h2>
      </div>
    </div>}
  </div>;
}
