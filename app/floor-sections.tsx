"use client";
// Tonight > Sections: the manager draws tonight's sections on the restaurant's floor map and gives
// each one its server and S.A.s. Tap tables (they turn lime), tap Create section, then tap the
// section and the people. An S.A. can cover two sections ("1/2"). Posts without tables (hot and cold
// runner) sit under the list.
//
// The map is the restaurant's floor_maps row (058). Sections are saved, on every change, as the rows
// of that service's floor plan (050), which My shift already shows to each server and S.A.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Notice } from "./ui";
import { closers, roleOf, type OnShift } from "@/lib/sidework-plan";
import { localDate, type FloorRow } from "./floor-plan";

type Table = {id: string; label: string; x: number; y: number; shape: "r" | "s" | "c"; group?: string};
export type FloorLayout = {width: number; height: number; walls: string[]; labels: {x: number; y: number; text: string}[]; tables: Table[]; spots?: [number, number][]};
type Person = {id: string; name: string};
// A section on the map (n is its number) or a post without tables (n is 0, name says what it is).
type Section = {n: number; name: string; tables: string[]; server: Person | null; sas: Person[]};

const POSTS = ["Hot runner", "Cold runner"];
const isPost = (s: Section) => s.n === 0;
const size = (shape: Table["shape"]) => shape === "c" ? 11 : shape === "r" ? 20 : 24;
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"});
const dayBefore = (day: string, days: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() - days); return localDate(d); };

function hull(points: [number, number][]) {
  const pts = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower: [number, number][] = [], upper: [number, number][] = [];
  for (const p of pts) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop(); lower.push(p); }
  for (const p of [...pts].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop(); upper.push(p); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

// Where a section's tables are, in words: their numbers, then the counters by name.
function whereOf(layout: FloorLayout, ids: string[]) {
  const tables = ids.map(id => layout.tables.find(t => t.id === id)).filter((t): t is Table => !!t);
  const numbers = tables.filter(t => t.label).map(t => t.label);
  const groups = [...new Set(tables.filter(t => !t.label && t.group).map(t => t.group!))];
  return [...numbers, ...groups].join(", ");
}

// The floor plan rows <-> sections. Rows keep the names, so the plan reads the same to everyone.
function toRows(layout: FloorLayout, sections: Section[]): FloorRow[] {
  return sections.filter(s => !isPost(s) || s.sas.length).map(s => ({
    server_id: s.server?.id ?? null, server_name: s.server?.name ?? (isPost(s) ? "" : "Pick-up"), sa: s.sas, section: isPost(s) ? s.name : String(s.n), task: "",
    tables: s.tables, where: whereOf(layout, s.tables),
  }));
}
function fromRows(rows: FloorRow[]): Section[] {
  const sections: Section[] = rows.map(r => /^\d+$/.test(r.section)
    ? {n: Number(r.section), name: "", tables: r.tables ?? [], server: r.server_id ? {id: r.server_id, name: r.server_name} : null, sas: r.sa}
    : {n: 0, name: r.section, tables: [], server: null, sas: r.sa});
  for (const name of POSTS) if (!sections.some(s => isPost(s) && s.name === name)) sections.push({n: 0, name, tables: [], server: null, sas: []});
  return sections;
}

export function FloorSections({restaurantId, day, service, people}: {restaurantId: string; day: string; service: string; people: OnShift[]}) {
  const [layout, setLayout] = useState<FloorLayout | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [drawing, setDrawing] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");

  const explain = (e: unknown) => {
    const text = e instanceof Error ? e.message : String((e as {message?: string})?.message ?? e);
    return /floor_maps|PGRST205|42P01/.test(text) ? "Sections need database update 058." : text;
  };

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true); setError(""); setSaved(""); setDrawing(new Set()); setSelected(null);
    try {
      const [map, plan] = await Promise.all([
        supabase.from("floor_maps").select("layout").eq("restaurant_id", restaurantId).maybeSingle(),
        supabase.from("floor_plans").select("rows").eq("restaurant_id", restaurantId).eq("service_date", day).eq("service", service).maybeSingle(),
      ]);
      if (map.error) throw map.error;
      if (plan.error) throw plan.error;
      const found = (map.data as {layout: FloorLayout} | null)?.layout;
      setLayout(found?.tables?.length ? found : null);
      setSections(fromRows(((plan.data as {rows: FloorRow[]} | null)?.rows ?? []).filter(r => r.tables || !/^\d+$/.test(r.section))));
    } catch (e) { setError(explain(e)); }
    finally { setLoading(false); }
  }, [restaurantId, day, service]);
  useEffect(() => { void load(); }, [load]);

  const servers = useMemo(() => people.filter(p => roleOf(p.shift_position) === "server").sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.name.localeCompare(b.name)), [people]);
  const sas = useMemo(() => people.filter(p => roleOf(p.shift_position) === "sa").sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.name.localeCompare(b.name)), [people]);
  const closing = useMemo(() => new Set([...closers(servers), ...closers(sas)]), [servers, sas]);

  async function save(next: Section[]) {
    setSections(next);
    if (!supabase || !layout) return;
    setError(""); setSaved("");
    const {data: who} = await supabase.auth.getUser();
    const rows = toRows(layout, next);
    const res = await supabase.from("floor_plans").upsert({restaurant_id: restaurantId, service_date: day, service, rows, updated_by: who.user?.id, updated_at: new Date().toISOString()}, {onConflict: "restaurant_id,service_date,service"});
    if (res.error) setError(explain(res.error)); else setSaved("Saved. Each server and S.A. sees their section in My shift.");
  }

  // Copy the sections from the same service a week ago; people not working tonight are left out.
  async function copyLastWeek() {
    if (!supabase) return;
    const from = dayBefore(day, 7);
    const res = await supabase.from("floor_plans").select("rows").eq("restaurant_id", restaurantId).eq("service_date", from).eq("service", service).maybeSingle();
    if (res.error) { setError(explain(res.error)); return; }
    const rows = ((res.data as {rows: FloorRow[]} | null)?.rows ?? []).filter(r => r.tables || !/^\d+$/.test(r.section));
    if (!rows.some(r => r.tables?.length)) { setError("There are no sections from a week ago to copy."); return; }
    const here = new Set(people.map(p => p.user_id));
    const copied = fromRows(rows).map(s => ({...s, server: s.server && here.has(s.server.id) ? s.server : null, sas: s.sas.filter(h => here.has(h.id))}));
    setSelected(null); setDrawing(new Set());
    await save(copied);
  }

  const onMap = sections.filter(s => !isPost(s));
  const nextNumber = Math.max(0, ...onMap.map(s => s.n)) + 1;
  const keyOf = (s: Section) => isPost(s) ? `post-${s.name}` : String(s.n);
  const current = sections.find(s => keyOf(s) === selected) ?? null;
  const sectionOf = (id: string) => onMap.find(s => s.tables.includes(id));
  const saCovers = (id: string) => sections.filter(s => s.sas.some(h => h.id === id)).map(s => isPost(s) ? s.name : String(s.n));

  function tapTable(id: string) {
    setSaved("");
    setDrawing(d => { const next = new Set(d); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }
  async function createSection() {
    if (!drawing.size) return;
    const taken = [...drawing];
    const next = sections.map(s => ({...s, tables: s.tables.filter(t => !drawing.has(t))})).filter(s => isPost(s) || s.tables.length);
    next.push({n: nextNumber, name: "", tables: taken, server: null, sas: []});
    next.sort((a, b) => (isPost(a) ? 1 : 0) - (isPost(b) ? 1 : 0) || a.n - b.n);
    setDrawing(new Set()); setSelected(String(nextNumber));
    await save(next);
  }
  async function deleteSection(s: Section) {
    setSelected(null);
    await save(sections.filter(x => x !== s));
  }
  async function setServer(s: Section, p: Person | null) {
    // A server works one section: giving them this one takes them off any other.
    await save(sections.map(x => x === s ? {...x, server: p} : p && x.server?.id === p.id ? {...x, server: null} : x));
  }
  async function toggleSA(s: Section, p: Person) {
    await save(sections.map(x => x === s ? {...x, sas: x.sas.some(h => h.id === p.id) ? x.sas.filter(h => h.id !== p.id) : [...x.sas, p]} : x));
  }

  if (loading) return <p className="muted py-6" role="status">Loading the floor map…</p>;
  if (!layout) return <><Notice text={error} error />{!error && <div className="swb-card"><p className="muted text-sm">This restaurant has no floor map yet. Once it&apos;s set up, you draw tonight&apos;s sections on it here.</p></div>}</>;

  // Each section's outline and tag. The tag sits in the free spot nearest its tables.
  const used = new Set<number>();
  const shapes = onMap.filter(s => s.tables.length).map(s => {
    const ts = s.tables.map(id => layout.tables.find(t => t.id === id)).filter((t): t is Table => !!t);
    const pts = ts.flatMap(t => { const r = size(t.shape) + 16; return [[t.x - r, t.y - r], [t.x + r, t.y - r], [t.x + r, t.y + r], [t.x - r, t.y + r]] as [number, number][]; });
    const h = hull(pts);
    const cx = ts.reduce((a, t) => a + t.x, 0) / (ts.length || 1), cy = ts.reduce((a, t) => a + t.y, 0) / (ts.length || 1);
    let spot: [number, number] = [cx, cy], best = Infinity, bestI = -1;
    (layout.spots ?? []).forEach(([x, y], i) => { const d = (x - cx) ** 2 + (y - cy) ** 2; if (!used.has(i) && d < best && d < 160 ** 2) { best = d; bestI = i; spot = [x, y]; } });
    if (bestI >= 0) used.add(bestI);
    return {s, d: h.length ? `M${h.map(p => p.join(" ")).join(" L")} Z` : "", spot};
  });

  return <><Notice text={error} error /><div className="swb-grid fs-grid">
    <section className="swb-card fs-map" aria-label="Floor map">
      <div className="swb-card-head"><p className="section-chip">Floor map</p><span className="muted text-xs">{drawing.size ? "Drawing a section" : "Tap tables to draw a section"}</span></div>
      <div className="fs-scroll">
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="Floor map with tonight's sections">
          {layout.walls.map((d, i) => <path key={i} className="fs-wall" d={d} />)}
          {layout.labels.map((l, i) => <text key={i} className="fs-area" x={l.x} y={l.y}>{l.text}</text>)}
          {shapes.map(({s, d}) => d && <path key={s.n} className={`fs-hull${selected === String(s.n) && !drawing.size ? " sel" : ""}`} d={d} onClick={() => { if (!drawing.size) setSelected(String(s.n)); }} />)}
          {layout.tables.map(t => {
            const r = size(t.shape), cls = drawing.has(t.id) ? " drawing" : sectionOf(t.id) ? " in" : "";
            return <g key={t.id} className={`fs-table${cls}`} role="button" tabIndex={0} aria-label={`Table ${t.label || t.group || t.id}`} aria-pressed={drawing.has(t.id)}
              onClick={() => tapTable(t.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tapTable(t.id); } }}>
              {t.shape === "s" ? <rect x={t.x - r} y={t.y - r} width={r * 2} height={r * 2} rx={6} /> : <circle cx={t.x} cy={t.y} r={r} />}
              {t.label && <text x={t.x} y={t.y}>{t.label}</text>}
            </g>;
          })}
          {shapes.map(({s, spot: [x, y]}) => {
            const name = s.server?.name ?? "Pick-up", helpers = s.sas.map(h => h.name).join(" · ") || "No S.A.";
            const w = Math.max(name.length * 8 + 44, helpers.length * 7 + 20);
            return <g key={`tag-${s.n}`} className="fs-tag" onClick={() => { if (!drawing.size) setSelected(String(s.n)); }} data-no-translate>
              <rect x={x - w / 2} y={y - 19} width={w} height={38} rx={10} />
              <circle cx={x - w / 2 + 16} cy={y - 6} r={10} /><text className="fs-tag-n" x={x - w / 2 + 16} y={y - 6}>{s.n}</text>
              <text className="fs-tag-name" x={x - w / 2 + 32} y={y - 6}>{name}</text>
              <text className="fs-tag-sa" x={x - w / 2 + 10} y={y + 10}>{helpers}</text>
            </g>;
          })}
        </svg>
      </div>
      <div className="fs-foot">
        <span className="muted text-xs">{drawing.size ? <><b data-no-translate>{whereOf(layout, [...drawing])}</b></> : saved || "Tap a table to start a new section. A table that's already in a section moves to the new one."}</span>
        <span className="fs-actions">
          {drawing.size > 0 && <button type="button" className="btn secondary" onClick={() => setDrawing(new Set())}>Cancel</button>}
          {drawing.size > 0 ? <button type="button" className="btn" onClick={() => void createSection()}>{`Create section ${nextNumber}`}</button>
            : <button type="button" className="btn secondary" onClick={() => void copyLastWeek()}>Copy from a week ago</button>}
        </span>
      </div>
    </section>

    <div className="fs-side">
      <section className="swb-card" aria-label="Tonight's sections">
        <div className="swb-card-head"><b>Tonight&apos;s sections</b><span className="swb-count">{onMap.length}</span></div>
        {onMap.length ? null : <p className="muted text-sm">No sections yet. Tap tables on the map, then Create section.</p>}
        <div className="fs-list">
          {sections.map((s, i) => <div key={keyOf(s)}>
            {isPost(s) && (i === 0 || !isPost(sections[i - 1])) && <p className="swb-sub">Posts without tables</p>}
            <button type="button" className="fs-row" aria-pressed={selected === keyOf(s) && !drawing.size} onClick={() => { setDrawing(new Set()); setSelected(keyOf(s)); }}>
              <span className={`fs-n${isPost(s) ? " post" : ""}`}>{isPost(s) ? s.name[0] : s.n}</span>
              <span className="fs-what"><b>{isPost(s) ? s.name : `Section ${s.n}`}</b><small data-no-translate>{isPost(s) ? "" : whereOf(layout, s.tables)}</small></span>
              <span className="fs-who" data-no-translate>{isPost(s) ? "" : s.server?.name ?? "Pick-up"}<small>{s.sas.map(h => h.name).join(", ")}</small></span>
            </button>
          </div>)}
        </div>
      </section>

      <section className="swb-card" aria-label="Who works it">
        <div className="swb-card-head"><b>{current ? (isPost(current) ? current.name : `Section ${current.n}: who works it?`) : "Pick a section"}</b>
          {current && !isPost(current) && <button type="button" className="icon-chip" aria-label={`Delete section ${current.n}`} title="Delete section" onClick={() => void deleteSection(current)}><Trash2 size={14} /></button>}</div>
        {!current ? <p className="muted text-sm">Tap a section on the map or in the list.</p> : <>
          {!isPost(current) && <div className="fs-people">
            <span className="fs-plabel">Server</span>
            <div className="fs-chips">
              {servers.map(p => { const other = onMap.find(s => s.server?.id === p.user_id && s !== current);
                return <button key={p.user_id} type="button" className="fs-chip" aria-pressed={current.server?.id === p.user_id} onClick={() => void setServer(current, current.server?.id === p.user_id ? null : {id: p.user_id, name: p.name || "Team member"})}>
                  <span data-no-translate>{p.name || "Team member"}{closing.has(p.user_id) ? " ©" : ""}</span><small>{other ? String(other.n) : clock(p.starts_at)}</small></button>; })}
              <button type="button" className="fs-chip" aria-pressed={!current.server} onClick={() => void setServer(current, null)}>Pick-up</button>
            </div>
            {!servers.length && <p className="muted text-xs">No servers on the published schedule for this service.</p>}
          </div>}
          <div className="fs-people">
            <span className="fs-plabel">{isPost(current) ? "S.A." : "S.A. (one can cover two sections)"}</span>
            <div className="fs-chips">
              {sas.map(p => { const covers = saCovers(p.user_id);
                return <button key={p.user_id} type="button" className="fs-chip" aria-pressed={current.sas.some(h => h.id === p.user_id)} onClick={() => void toggleSA(current, {id: p.user_id, name: p.name || "Team member"})}>
                  <span data-no-translate>{p.name || "Team member"}{closing.has(p.user_id) ? " ©" : ""}</span><small data-no-translate>{covers.length ? covers.join("/") : clock(p.starts_at)}</small></button>; })}
            </div>
            {!sas.length && <p className="muted text-xs">No S.A.s on the published schedule for this service.</p>}
          </div>
        </>}
      </section>
    </div>
  </div></>;
}
