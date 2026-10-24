"use client";

// Dashboard > Labor. Opens on Today. Four date buttons (Today, Yesterday, This week, Date range), a small search icon that
// opens a box to find one person, and a print icon for the report. Everyone: hours, people and the hours by position. One person: their hours, shifts, overtime and
// the list of their shifts. Read only, with the manager's own access, like the rest of the dashboard.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarDays, ChevronDown, Search, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { addDays, colorFor, dayKey, formatHours, shiftHours, shiftLabel, weekStart, type ScheduleSettings, type Shift, type TimeOff } from "@/lib/schedule";
import { change, laborRange, overtimeHours } from "@/lib/ops-stats";
import { laborSheet } from "@/lib/sheets";
import { SectionInfo, Stats, type StatNote } from "./ui";
import { DownloadSheet } from "./sheet-download";

type Person = {user_id: string; name: string; role: string};
type Preset = "today" | "yesterday" | "week" | "custom";

const toDate = (iso: string) => { const [y, m, d] = iso.split("-").map(Number); return new Date(y, m - 1, d); };
const dateLabel = (day: Date) => day.toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"});
const shortDate = (day: Date, year: boolean) => day.toLocaleDateString("en-US", {month: "short", day: "numeric", ...(year ? {year: "numeric"} : {})});
const plain = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
// A date shown as a small pill ("Oct 1, 2026"). The phone's own calendar opens from the invisible date box on top of it.
function DatePill({label, value, min, onChange}: {label: string; value: string; min?: string; onChange: (value: string) => void}) {
  return <label className="labor-pill"><span>{label}</span>
    <span className="labor-pill-box">{value ? toDate(value).toLocaleDateString("en-US", {month: "short", day: "numeric", year: "numeric"}) : "Pick a date"}<CalendarDays size={14} aria-hidden="true" />
      <input type="date" aria-label={label} value={value} min={min} onChange={event => onChange(event.target.value)} onClick={event => { try { event.currentTarget.showPicker?.(); } catch { /* the phone opens it by itself */ } }} />
    </span>
  </label>;
}
const PRESETS: [Preset, string][] = [["today", "Today"], ["yesterday", "Yesterday"], ["week", "This week"], ["custom", "Date range"]];

export function LaborView({restaurantId, settings, people, released, timeOff, restaurantName}: {restaurantId: string; restaurantName: string; settings: ScheduleSettings; people: Person[]; released: number; timeOff: TimeOff[]}) {
  const [preset, setPreset] = useState<Preset>("today");
  const [fromText, setFromText] = useState(() => dayKey(weekStart(new Date(), settings.week_start)));
  const [toText, setToText] = useState(() => dayKey(addDays(weekStart(new Date(), settings.week_start), 6)));
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [person, setPerson] = useState<Person | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);
  const [shifts, setShifts] = useState<Shift[] | null>(null);
  const [error, setError] = useState("");

  // The days being looked at: the first day, the last day, and how many that is.
  const {from, to, count} = useMemo(() => {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    let a = today, b = today;
    if (preset === "yesterday") a = b = addDays(today, -1);
    else if (preset === "week") { a = weekStart(today, settings.week_start); b = addDays(a, 6); }
    else if (preset === "custom") {
      a = toDate(fromText || dayKey(today)); b = toDate(toText || fromText || dayKey(today));
      if (b.getTime() < a.getTime()) [a, b] = [b, a];
    }
    return {from: a, to: b, count: Math.round((b.getTime() - a.getTime()) / 86_400_000) + 1};
  }, [preset, fromText, toText, settings.week_start]);
  const before = addDays(from, -count);

  useEffect(() => {
    let live = true;
    void (async () => {
      const db = supabase!;
      setShifts(null); setError("");
      // The database hands back 1000 rows at a time; a long stretch of days can be more.
      const rows: Shift[] = [];
      for (let page = 0; page < 20; page++) {
        const {data, error: failed} = await db.from("schedule_shifts").select("*").eq("restaurant_id", restaurantId)
          .gte("starts_at", before.toISOString()).lt("starts_at", addDays(to, 1).toISOString()).order("starts_at").range(page * 1000, page * 1000 + 999);
        if (failed) { if (live) setError(failed.message); return; }
        rows.push(...((data ?? []) as Shift[]));
        if ((data ?? []).length < 1000) break;
      }
      if (live) setShifts(rows);
    })();
    return () => {live = false;};
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, from.getTime(), to.getTime()]);

  const names = useMemo(() => new Map(people.map(p => [p.user_id, p.name || "Team member"])), [people]);
  const matches = useMemo(() => {
    const q = plain(query);
    return q ? people.filter(p => plain(p.name || "").includes(q)).slice(0, 5) : [];
  }, [query, people]);

  if (error) return <p className="panel p-5 muted">{error}</p>;
  const thisYear = new Date().getFullYear();
  const withYear = from.getFullYear() !== thisYear || to.getFullYear() !== thisYear;
  const rangeText = count === 1 ? dateLabel(from) : `${shortDate(from, withYear)} – ${shortDate(to, withYear)}`;
  const against = preset === "week" ? "last week" : count === 1 ? "the day before" : `the ${count} days before`;
  const emptyWord = preset === "today" ? "today" : preset === "yesterday" ? "yesterday" : preset === "week" ? "this week" : "in these dates";

  const closeSearch = () => {setSearching(false); setQuery("");};
  const controls = (print: ReactNode) => <div className="labor-controls">
    <div className="category-tabs" role="group" aria-label="Dates">
      {PRESETS.map(([key, label]) => <button key={key} type="button" aria-pressed={preset === key} onClick={() => setPreset(key)}>{label}</button>)}
    </div>
    {preset === "custom" && <div className="labor-dates">
      <DatePill label="From" value={fromText} onChange={setFromText} />
      <DatePill label="To" value={toText} min={fromText} onChange={setToText} />
    </div>}
    {person ? <div className="labor-line">
      <span className="muted labor-range">{rangeText}</span>
      <span className="labor-icons">
        <button type="button" className="btn secondary" onClick={() => {setPerson(null); setQuery("");}} aria-label={`Show everyone, not only ${person.name}`}>{person.name}<X size={14} aria-hidden="true" /></button>
        {print}
      </span>
    </div> : searching ? <>
      <div className="labor-line">
        <div className="labor-search"><Search size={14} aria-hidden="true" />
          <input type="search" autoFocus autoComplete="off" aria-label="Find a person" placeholder="Find a person" value={query} onChange={event => setQuery(event.target.value)} />
        </div>
        <button type="button" className="icon-chip" aria-label="Close search" onClick={closeSearch}><X size={14} aria-hidden="true" /></button>
      </div>
      {query.trim() !== "" && <div className="panel labor-matches">{matches.length ? <ul>{matches.map(p => <li key={p.user_id}>
        <button type="button" onClick={() => {setPerson(p); closeSearch();}}><b>{p.name || "Team member"}</b>{p.role && <small>{p.role}</small>}</button>
      </li>)}</ul> : <p className="muted">{`No one called “${query.trim()}”.`}</p>}</div>}
    </> : <div className="labor-line">
      <span className="muted labor-range">{preset === "custom" && count > 1 ? `${rangeText} · ${count} days` : rangeText}</span>
      <span className="labor-icons">
        <button type="button" className="icon-chip" aria-label="Find a person" onClick={() => setSearching(true)}><Search size={14} aria-hidden="true" /></button>
        {print}
      </span>
    </div>}
  </div>;

  const head = <div className="ops-head"><div className="min-w-0 flex-1"><h2 className="text-xl font-semibold">Labor</h2></div></div>;
  if (!shifts) return <>{head}{controls(null)}<p className="muted" role="status">Loading…</p></>;

  const inRange = (s: Shift) => Date.parse(s.starts_at) >= from.getTime() && Date.parse(s.starts_at) < addDays(to, 1).getTime();
  const nowShifts = shifts.filter(inRange), beforeShifts = shifts.filter(s => !inRange(s));

  if (person) {
    const mine = nowShifts.filter(s => s.user_id === person.user_id).sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at));
    const hours = mine.reduce((total, s) => total + shiftHours(s), 0);
    const over = overtimeHours(mine, settings);
    const personFigures = [{value: formatHours(hours), label: "Hours"}, {value: String(mine.length), label: "Shifts"}, {value: formatHours(over), label: "Overtime"}];
    const personNote = over > 0 ? `Over the ${settings.overtime_weekly}h weekly limit by ${formatHours(over)}` : `Under the ${settings.overtime_weekly}h weekly limit`;
    const print = <DownloadSheet label="Print this report" build={async () => laborSheet({
      range: rangeText, start: dayKey(from), end: dayKey(to), person: person.name || "Team member", figures: personFigures, notes: [personNote], positions: [], overtime: [],
      shifts: mine.map(s => ({day: dateLabel(new Date(s.starts_at)), detail: `${shiftLabel(s)} · ${s.position}${s.published ? "" : " · Draft"}`, hours: formatHours(shiftHours(s))})),
    }, {restaurant: restaurantName})} />;
    return <>{head}{controls(print)}
      <Stats items={[{value: formatHours(hours), label: "Hours"}, {value: String(mine.length), label: "Shifts"}, {value: formatHours(over), label: "Overtime", alert: over > 0}]}
        notes={[over > 0 ? {tone: "fail", text: `Over the ${settings.overtime_weekly}h weekly limit by ${formatHours(over)}`} : {tone: "pass", text: `Under the ${settings.overtime_weekly}h weekly limit`}]} />
      {mine.length ? <section className="panel labor-shifts"><ul>{mine.map(s => <li key={s.id}>
        <span><b>{dateLabel(new Date(s.starts_at))}</b><small>{`${shiftLabel(s)} · ${s.position}${s.published ? "" : " · Draft"}`}</small></span>
        <b className="labor-hours">{formatHours(shiftHours(s))}</b>
      </li>)}</ul></section> : <p className="panel p-5 muted">{`${person.name} has no shifts in these dates.`}</p>}
    </>;
  }

  const labor = laborRange(nowShifts, beforeShifts, settings);
  const notes: StatNote[] = labor.overtime.length || labor.drafts
    ? [
      ...(labor.overtime.length ? [{tone: "fail" as const, text: `${labor.overtime.length} in overtime (past ${settings.overtime_weekly}h a week${settings.overtime_daily ? ` or ${settings.overtime_daily}h a day` : ""})`}] : []),
      ...(labor.drafts ? [{tone: "fail" as const, text: `${labor.drafts} draft ${labor.drafts === 1 ? "shift" : "shifts"} not published yet`}] : []),
    ]
    : [{tone: "pass", text: "All clear"}];
  const emptyPositions = labor.byPosition.filter(p => !p.hours && !p.people);
  const livePositions = showEmpty ? labor.byPosition : labor.byPosition.filter(p => p.hours || p.people);
  const figures = [{value: formatHours(labor.hours), label: "Scheduled hours", note: change(labor.hours, labor.lastHours, against) ?? undefined}, {value: String(labor.people), label: "People scheduled"}];
  const print = <DownloadSheet label="Print this report" build={async () => laborSheet({
    range: rangeText, start: dayKey(from), end: dayKey(to), figures, notes: notes.map(n => String(n.text)),
    positions: labor.byPosition.filter(p => p.hours || p.people).map(p => ({position: p.position, hours: formatHours(p.hours), people: p.people})),
    shifts: [], overtime: labor.overtime.map(o => ({name: names.get(o.user_id) ?? "Team member", detail: o.daily ? `Over ${settings.overtime_daily}h in a day` : `${formatHours(o.hours)} in a week`})),
  }, {restaurant: restaurantName})} />;
  return <>{head}{controls(print)}
    <Stats items={[{value: formatHours(labor.hours), label: "Scheduled hours", note: change(labor.hours, labor.lastHours, against)}, {value: String(labor.people), label: "People scheduled"}]} notes={notes} />

    <div className="panel dash-panel">
      <SectionInfo heading="Hours by position">Drafts included. People counts everyone with at least one shift.</SectionInfo>
      {labor.byPosition.length ? <><table className="dash-table">
        <thead><tr><th scope="col">Position</th><th scope="col" className="num">Hours</th><th scope="col" className="num">People</th></tr></thead>
        <tbody>{livePositions.map(p => { const color = colorFor(p.position, settings.position_colors); return <tr key={p.position}>
          <th scope="row"><span className={`ops-position ${color ? `pos-${color}` : ""}`}><i aria-hidden="true" />{p.position}</span></th>
          <td className="num">{formatHours(p.hours)}</td>
          <td className="num">{p.people}</td>
        </tr>; })}</tbody>
      </table>
      {emptyPositions.length > 0 && <button type="button" className="btn secondary dash-more" aria-expanded={showEmpty} onClick={() => setShowEmpty(value => !value)}>{showEmpty ? "Hide positions with no shifts" : `${emptyPositions.length} ${emptyPositions.length === 1 ? "position" : "positions"} with no shifts ${emptyWord}`}<ChevronDown size={16} aria-hidden="true" /></button>}</>
        : <p className="muted mt-3 text-sm">No shifts in these dates.</p>}
    </div>

    {(labor.overtime.length > 0 || released > 0 || timeOff.length > 0) && <div className="panel dash-panel">
      <SectionInfo heading="Keep an eye on">Overtime in these dates, shifts someone released and nobody took yet, and time off in the next two weeks.</SectionInfo>
      <ul className="ops-list">
        {labor.overtime.map(o => <li key={o.user_id} className="warn"><AlertTriangle size={14} aria-hidden="true" /><b>{names.get(o.user_id) ?? "Team member"}</b><span>{o.daily ? `Over ${settings.overtime_daily}h in a day` : `${formatHours(o.hours)} in a week`}</span></li>)}
        {released > 0 && <li><b>{released === 1 ? "1 released shift" : `${released} released shifts`}</b><span>Nobody has taken it yet</span></li>}
        {timeOff.map(t => <li key={t.id}><b>{names.get(t.user_id) ?? "Team member"}</b><span>{`Time off · ${t.starts_on === t.ends_on ? dateLabel(toDate(t.starts_on)) : `${dateLabel(toDate(t.starts_on))} – ${dateLabel(toDate(t.ends_on))}`}`}</span></li>)}
      </ul>
    </div>}
  </>;
}
