"use client";
// Dashboards: the trend and the comparison that Home's tiles don't show.
//   ManagerDashboard  one location: coverage by library and by person, quizzes per week (036)
//   BrandDashboard    every location of a brand side by side, for the brand's owner
//   MyActivity        the signed-in person's own weeks and sections, under My progress
// Same rules as everywhere else in HEAT: latest result per item, accuracy weighted by answered
// questions, review below 80%. Charts are one series in the app's own ink; numbers are always
// written out next to the bars, so nothing depends on reading a colour.
import { createContext, useContext, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { MenuItem } from "@/lib/menu";
import { CONTENT_TYPES, categoryOf, contentTypeOf, type ContentType } from "@/lib/categories";
import type { ProgressRow } from "./quiz";
import type { Organization } from "./locations";
import { useTaxonomy } from "./taxonomy";
import { SectionInfo } from "./ui";
import { OperationsDashboard, type OpsView } from "./ops-dashboard";

type Week = {week_start: string; quizzes: number; learners: number};
type LibraryStats = {content_type: ContentType; items: number; learners: number; taken: number; correct: number; total: number; needs_review: number; active_7d: number};
type Person = {user_id: string; name: string; role: string; is_owner: boolean; items_taken: number; correct_sum: number; total_sum: number; needs_review: number; last_attempt_at: string | null};
type LocationRow = {restaurant_id: string; name: string; items: number; learners: number; taken: number; correct: number; total: number; needs_review: number; active_7d: number; quizzes_28d: number};

const percent = (part: number, whole: number) => whole > 0 ? Math.round(part / whole * 100) : null;
const shown = (value: number | null) => value === null ? "—" : `${value}%`;
// "2026-10-12" is a calendar date, not a moment: read it in local time so it never shifts a day.
const weekLabel = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, {month: "short", day: "numeric"});
};
const sinceLabel = (at: string | null) => {
  if (!at) return "No quizzes yet";
  const days = Math.floor((Date.now() - new Date(at).getTime()) / 86_400_000);
  return days <= 0 ? "Active today" : days === 1 ? "Active yesterday" : `Active ${days} days ago`;
};
const NEEDS_UPDATE = "These numbers need database update 036. Ask whoever set up HEAT to apply it.";

// Where the numbers come from: the database, unless a page supplies sample rows instead
// (the read-only previews do, so the charts can be shown without an account).
type RpcResult = {data: unknown; error: {message: string} | null};
export const DashboardSource = createContext<((name: string, args: Record<string, unknown>) => PromiseLike<RpcResult>) | null>(null);

function useRpc<T>(name: string, args: Record<string, unknown> | null) {
  const sample = useContext(DashboardSource);
  const [state, setState] = useState<{data: T[] | null; error: string}>({data: null, error: ""});
  const key = JSON.stringify(args);
  useEffect(() => {
    const call = sample ?? (supabase ? (n: string, a: Record<string, unknown>) => supabase!.rpc(n, a) : null);
    if (!args || !call) return;
    let live = true;
    setState({data: null, error: ""});
    void call(name, args).then(({data, error}) => {
      if (live) setState(error ? {data: null, error: error.message} : {data: (data ?? []) as T[], error: ""});
    });
    return () => {live = false;};
    // The arguments are compared by value through key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, key, sample]);
  return state;
}

function Tile({value, label, note}: {value: string; label: string; note?: string}) {
  return <div className="dash-tile"><b>{value}</b><span>{label}</span>{note && <small>{note}</small>}</div>;
}

// A filled bar for a percentage, the number beside it. Accuracy marks its 80% target; coverage has none.
function Meter({value, label, target = false}: {value: number | null; label: string; target?: boolean}) {
  return <span className="dash-meter" role="img" aria-label={`${label}: ${shown(value)}`}>
    <span className="dash-meter-track"><span className="dash-meter-fill" style={{width: `${value ?? 0}%`}} />{target && <span className="dash-meter-target" />}</span>
    <span className="dash-meter-value">{shown(value)}</span>
  </span>;
}

// Quizzes per week as columns on one baseline. Hovering or focusing a column shows its numbers;
// the latest week is always labelled, so the chart reads without hovering at all.
function WeeksChart({weeks, unit}: {weeks: Week[]; unit: "team" | "me"}) {
  const top = Math.max(1, ...weeks.map(w => w.quizzes));
  const total = weeks.reduce((sum, w) => sum + w.quizzes, 0);
  const detail = (w: Week) => `${w.quizzes} ${w.quizzes === 1 ? "quiz" : "quizzes"}${unit === "team" ? ` · ${w.learners} ${w.learners === 1 ? "person" : "people"}` : ""}`;
  return <figure className="dash-weeks">
    <div className="dash-weeks-plot">
      <span className="dash-weeks-max">{top}</span>
      {weeks.map((w, index) => {
        const last = index === weeks.length - 1;
        return <div key={w.week_start} className={`dash-col ${last ? "current" : ""}`} tabIndex={0} aria-label={`Week of ${weekLabel(w.week_start)}: ${detail(w)}`}>
          <span className="dash-col-tip">{detail(w)}</span>
          {last && <span className="dash-col-value">{w.quizzes}</span>}
          <span className="dash-col-bar" style={{height: `${w.quizzes / top * 100}%`}} />
        </div>;
      })}
    </div>
    <div className="dash-weeks-axis" aria-hidden="true">{weeks.map((w, index) => <span key={w.week_start}>{index === weeks.length - 1 ? "This week" : index % 2 === weeks.length % 2 ? weekLabel(w.week_start) : ""}</span>)}</div>
    <figcaption className="muted mt-2 text-xs">{`${total} completed ${total === 1 ? "quiz" : "quizzes"} in the last ${weeks.length} weeks`}</figcaption>
  </figure>;
}

export function ManagerDashboard({restaurantId, restaurantName, onOpenMember, onOpenSchedule, onOpenReports}: {restaurantId: string; restaurantName: string; onOpenMember: (id: string) => void; onOpenSchedule?: () => void; onOpenReports?: () => void}) {
  const {labelFor} = useTaxonomy();
  // The read-only previews supply sample training numbers only; operations need a real restaurant.
  const sample = useContext(DashboardSource);
  const libraries = useRpc<LibraryStats>("location_summary", {rid: restaurantId});
  const weeks = useRpc<Week>("location_activity", {rid: restaurantId, weeks: 8});
  const roster = useRpc<Person>("team_learning_roster", {rid: restaurantId});
  // One part at a time: Labor and Service from the schedule and reports, Training from the quizzes.
  const [view, setView] = useState<OpsView>("labor");
  if (libraries.error) return <p className="panel p-5 muted">{NEEDS_UPDATE}</p>;
  const libs = libraries.data ?? [];
  const learners = libs[0]?.learners ?? 0;
  const items = libs.reduce((sum, l) => sum + l.items, 0);
  const taken = libs.reduce((sum, l) => sum + l.taken, 0);
  const covered = percent(taken, items * learners);
  const accuracy = percent(libs.reduce((s, l) => s + l.correct, 0), libs.reduce((s, l) => s + l.total, 0));
  const review = libs.reduce((sum, l) => sum + l.needs_review, 0);
  const people = (roster.data ?? []).filter(p => !p.is_owner)
    .map(p => ({...p, covered: percent(Number(p.items_taken), items) ?? 0, accuracy: percent(Number(p.correct_sum), Number(p.total_sum))}))
    .sort((a, b) => a.covered - b.covered || a.name.localeCompare(b.name));
  const loading = !libraries.data;
  return <section aria-label={`${restaurantName} dashboard`}>
    {!sample && <div className="category-tabs mb-4" role="group" aria-label="Dashboard view">{([["labor", "Labor"], ["service", "Service"], ["training", "Training"]] as [OpsView, string][]).map(([key, label]) => <button key={key} type="button" aria-pressed={view === key} onClick={() => setView(key)}>{label}</button>)}</div>}
    {!sample && <OperationsDashboard restaurantId={restaurantId} onOpenSchedule={onOpenSchedule} onOpenReports={onOpenReports} view={view} />}
    {(sample || view === "training") && <>
    <div className="dash-tiles">
      <Tile value={loading ? "…" : String(learners)} label="Team members" />
      <Tile value={loading ? "…" : shown(covered)} label="Menu covered" note="Items each person has quizzed on" />
      <Tile value={loading ? "…" : shown(accuracy)} label="Quiz accuracy" note="Latest results · target 80%" />
      <Tile value={loading ? "…" : `${libs[0]?.active_7d ?? 0} of ${learners}`} label="Active this week" note={review ? `${review} ${review === 1 ? "result needs" : "results need"} review` : undefined} />
    </div>

    <div className="panel dash-panel">
      <SectionInfo heading="Quizzes per week">Completed quizzes by the team, retakes included. The owner&apos;s own practice is left out.</SectionInfo>
      {weeks.error ? <p className="muted mt-3">{NEEDS_UPDATE}</p> : !weeks.data ? <p className="muted mt-3" role="status">Loading…</p> : <WeeksChart weeks={weeks.data} unit="team" />}
    </div>

    <div className="panel dash-panel">
      <SectionInfo heading="By library">How much of each library the team has covered, and how well. Covered counts each person once per item.</SectionInfo>
      <table className="dash-table">
        <thead><tr><th scope="col">Library</th><th scope="col">Covered</th><th scope="col">Accuracy</th><th scope="col" className="num">Review</th></tr></thead>
        <tbody>{CONTENT_TYPES.map(type => {
          const row = libs.find(l => l.content_type === type);
          if (!row || !row.items) return null;
          return <tr key={type}>
            <th scope="row">{labelFor(type).name}<small>{row.items} {row.items === 1 ? labelFor(type).item_one : labelFor(type).item_many}</small></th>
            <td><Meter value={percent(row.taken, row.items * row.learners)} label="Covered" /></td>
            <td><Meter value={percent(row.correct, row.total)} label="Accuracy" target /></td>
            <td className="num">{row.needs_review}</td>
          </tr>;
        })}</tbody>
      </table>
      {!loading && !items && <p className="muted mt-3">The menu is empty. Coverage starts once the first item is added.</p>}
    </div>

    <div className="panel dash-panel">
      <SectionInfo heading="By person">Least covered first. Tap a name to open their progress in Team.</SectionInfo>
      {roster.error ? <p className="muted mt-3">The team could not load: {roster.error}</p>
        : !roster.data ? <p className="muted mt-3" role="status">Loading…</p>
        : !people.length ? <p className="muted mt-3">Nobody has joined yet. Invite your team from Team.</p>
        : <table className="dash-table">
          <thead><tr><th scope="col">Person</th><th scope="col">Covered</th><th scope="col">Accuracy</th><th scope="col" className="num">Review</th></tr></thead>
          <tbody>{people.map(p => <tr key={p.user_id}>
            <th scope="row"><button type="button" className="dash-name" onClick={() => onOpenMember(p.user_id)}>{p.name}</button><small>{p.role} · {sinceLabel(p.last_attempt_at)}</small></th>
            <td><Meter value={p.covered} label="Covered" /></td>
            <td><Meter value={p.accuracy} label="Accuracy" target /></td>
            <td className="num">{p.needs_review}</td>
          </tr>)}</tbody>
        </table>}
    </div>
    </>}
  </section>;
}

export function BrandDashboard({organization, currentId, onOpen}: {organization: Organization; currentId: string; onOpen: (restaurantId: string) => void}) {
  const summary = useRpc<LocationRow>("brand_summary", {oid: organization.id});
  if (summary.error) return <p className="panel p-5 muted">{NEEDS_UPDATE}</p>;
  const rows = summary.data ?? [];
  const seats = rows.reduce((sum, r) => sum + r.items * r.learners, 0);
  const covered = percent(rows.reduce((s, r) => s + r.taken, 0), seats);
  const accuracy = percent(rows.reduce((s, r) => s + r.correct, 0), rows.reduce((s, r) => s + r.total, 0));
  const loading = !summary.data;
  return <section aria-label={`${organization.name} locations`}>
    <div className="dash-tiles">
      <Tile value={loading ? "…" : String(rows.length)} label="Locations" />
      <Tile value={loading ? "…" : String(rows.reduce((s, r) => s + r.learners, 0))} label="Team members" />
      <Tile value={loading ? "…" : shown(covered)} label="Menu covered" note="Across every location" />
      <Tile value={loading ? "…" : shown(accuracy)} label="Quiz accuracy" note="Latest results · target 80%" />
    </div>
    <div className="panel dash-panel">
      <SectionInfo heading="Locations side by side">Each location against its own menu. Quizzes counts the last four weeks.</SectionInfo>
      {loading ? <p className="muted mt-3" role="status">Loading…</p> : <table className="dash-table">
        <thead><tr><th scope="col">Location</th><th scope="col">Covered</th><th scope="col">Accuracy</th><th scope="col" className="num">Active</th><th scope="col" className="num">Quizzes</th></tr></thead>
        <tbody>{rows.map(r => <tr key={r.restaurant_id}>
          <th scope="row">{r.restaurant_id === currentId ? <span className="dash-name">{r.name}</span> : <button type="button" className="dash-name" onClick={() => onOpen(r.restaurant_id)}>{r.name}</button>}<small>{r.learners} {r.learners === 1 ? "person" : "people"} · {r.items} {r.items === 1 ? "item" : "items"}</small></th>
          <td><Meter value={percent(r.taken, r.items * r.learners)} label="Covered" /></td>
          <td><Meter value={percent(r.correct, r.total)} label="Accuracy" target /></td>
          <td className="num">{r.active_7d}/{r.learners}</td>
          <td className="num">{r.quizzes_28d}</td>
        </tr>)}</tbody>
      </table>}
    </div>
  </section>;
}

// Under My progress: the person's own weeks, and their sections from weakest to strongest.
export function MyActivity({restaurantId, items, progress}: {restaurantId: string; items: MenuItem[]; progress: ProgressRow[]}) {
  const weeks = useRpc<Week>("my_activity", {rid: restaurantId, weeks: 8});
  const {labelFor} = useTaxonomy();
  // A section is a library and a category together: Food's "Other" is not Cocktails' "Other".
  const keyOf = (item: MenuItem) => `${contentTypeOf(item)}\u0000${categoryOf(item)}`;
  const sections = [...new Set(items.map(keyOf))].map(key => {
    const inSection = items.filter(item => keyOf(item) === key);
    const scores = progress.filter(row => inSection.some(item => item.id === row.menu_item_id));
    const [type, category] = key.split("\u0000") as [ContentType, string];
    return {
      key, name: `${category} · ${labelFor(type).name}`, items: inSection.length, taken: scores.length,
      accuracy: percent(scores.reduce((s, r) => s + r.correct, 0), scores.reduce((s, r) => s + r.total, 0)),
    };
  }).filter(section => section.taken > 0)
    .sort((a, b) => (a.accuracy ?? 0) - (b.accuracy ?? 0) || a.name.localeCompare(b.name));
  return <>
    {!weeks.error && <div className="panel dash-panel">
      <SectionInfo heading="Your quizzes per week">Every quiz you finished, retakes included.</SectionInfo>
      {!weeks.data ? <p className="muted mt-3" role="status">Loading…</p> : <WeeksChart weeks={weeks.data} unit="me" />}
    </div>}
    {sections.length > 0 && <div className="panel dash-panel">
      <SectionInfo heading="Your sections">Weakest first: the place to study next. Only sections you have quizzed on.</SectionInfo>
      <table className="dash-table">
        <thead><tr><th scope="col">Section</th><th scope="col">Covered</th><th scope="col">Accuracy</th></tr></thead>
        <tbody>{sections.map(s => <tr key={s.key}>
          <th scope="row">{s.name}<small>{s.taken} of {s.items}</small></th>
          <td><Meter value={percent(s.taken, s.items)} label="Covered" /></td>
          <td><Meter value={s.accuracy} label="Accuracy" target /></td>
        </tr>)}</tbody>
      </table>
    </div>}
  </>;
}
