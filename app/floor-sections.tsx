"use client";
// Tonight > Sections: the manager draws tonight's sections on the restaurant's floor map and gives
// each one its server and S.A.s. Tap tables (they turn lime), tap Create section, then tap the
// section and the people. An S.A. can cover two sections ("1/2"). Posts without tables (hot and cold
// runner) sit under the list.
//
// The map is the restaurant's floor_maps row (058). Sections are saved, on every change, as the rows
// of that service's floor plan (050), which My shift already shows to each server and S.A.
import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Plus, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Notice } from "./ui";
import { closers, roleOf, type OnShift, type SideRoles } from "@/lib/sidework-plan";
import { localDate, type FloorRow } from "./floor-plan";
import { DownloadSheet } from "./sheet-download";
import { notify } from "./notifications";
import { sectionsSheet } from "@/lib/sheets";

// Shapes: r round, s square, w long (a booth or a long table), c a seat at a counter; and two things on the
// floor that aren't tables, bar and host (the host stand), drawn for reference and never in a section.
// turned stands a long shape on end.
type Table = {id: string; label: string; x: number; y: number; shape: "r" | "s" | "w" | "c" | "bar" | "host"; group?: string; turned?: boolean};
export type FloorLayout = {width: number; height: number; walls: string[]; labels: {x: number; y: number; text: string}[]; tables: Table[]; spots?: [number, number][]};
type Person = {id: string; name: string};
// A section on the map (n is its number) or a post without tables (n is 0, name says what it is).
type Section = {n: number; name: string; tables: string[]; server: Person | null; sas: Person[]};

const POSTS = ["Hot runner", "Cold runner"];
const isPost = (s: Section) => s.n === 0;
// Half the width and half the height of each shape.
const dims = (shape: Table["shape"]): [number, number] => shape === "c" ? [15, 15] : shape === "r" ? [26, 26] : shape === "w" ? [50, 28] : shape === "bar" ? [110, 22] : shape === "host" ? [36, 20] : [30, 30];
const dimsOf = (t: Pick<Table, "shape" | "turned">): [number, number] => { const [w, h] = dims(t.shape); return t.turned ? [h, w] : [w, h]; };
const isFixture = (t: Pick<Table, "shape">) => t.shape === "bar" || t.shape === "host";
const isRound = (t: Pick<Table, "shape">) => t.shape === "r" || t.shape === "c";
const EMPTY_MAP: FloorLayout = {width: 1000, height: 640, walls: [], labels: [], tables: []};

// One table on the map: its shape and its number.
function TableMark({t}: {t: Table}) {
  const [w, h] = dimsOf(t);
  if (isFixture(t)) return <g className="fs-fixture"><rect x={t.x - w} y={t.y - h} width={w * 2} height={h * 2} rx={4} />
    <text x={t.x} y={t.y} transform={t.turned ? `rotate(-90 ${t.x} ${t.y})` : undefined}>{t.label || (t.shape === "bar" ? "BAR" : "HOST")}</text></g>;
  return <>{isRound(t) ? <circle cx={t.x} cy={t.y} r={w} /> : <rect x={t.x - w} y={t.y - h} width={w * 2} height={h * 2} rx={6} />}
    {t.label && <text x={t.x} y={t.y}>{t.label}</text>}</>;
}

// Where a section's tag goes: the place nearest the middle of its tables that covers no table number, no
// section badge and no other tag (it may cover the edge of a table).
function placeTag(layout: FloorLayout, ts: Table[], w: number, taken: [number, number, number, number][], others: Table[] = []): [number, number] {
  const cx = ts.reduce((a, t) => a + t.x, 0) / ts.length, cy = ts.reduce((a, t) => a + t.y, 0) / ts.length;
  const boxes: [number, number, number, number][] = [...layout.tables.flatMap(t => {
    const [hw, hh] = dimsOf(t), c = isRound(t) ? 0.7 : 1, bx = t.x + hw * c, by = t.y - hh * c;
    if (isFixture(t)) return [[t.x - hw - 4, t.y - hh - 4, t.x + hw + 4, t.y + hh + 4] as [number, number, number, number]];
    const number: [number, number, number, number] = t.shape === "c" ? [t.x - hw, t.y - hh, t.x + hw, t.y + hh] : [t.x - 16, t.y - 10, t.x + 16, t.y + 10];
    return [number, [bx - 11, by - 11, bx + 11, by + 11] as [number, number, number, number]];
  }), ...taken];
  const free = (x: number, y: number) => x - w / 2 >= 0 && x + w / 2 <= layout.width && y - 13 >= 0 && y + 13 <= layout.height
    && boxes.every(([a, b, c, d]) => x + w / 2 < a || x - w / 2 > c || y + 13 < b || y - 13 > d);
  // ...and closer to one of its own tables than to any other table, so it reads as theirs.
  const near = (x: number, y: number, list: Table[]) => Math.min(...list.map(t => (t.x - x) ** 2 + (t.y - y) ** 2));
  const ours = (x: number, y: number) => !others.length || near(x, y, ts) < near(x, y, others);
  let best: [number, number] = [cx, cy], bestD = Infinity;
  for (let dx = -200; dx <= 200; dx += 10) for (let dy = -160; dy <= 160; dy += 10) {
    const d = dx * dx + dy * dy;
    if (d < bestD && free(cx + dx, cy + dy) && ours(cx + dx, cy + dy)) { bestD = d; best = [cx + dx, cy + dy]; }
  }
  return best;
}
const clock = (iso: string) => new Date(iso).toLocaleTimeString(undefined, {hour: "numeric", minute: "2-digit"});
const dayBefore = (day: string, days: number) => { const d = new Date(`${day}T12:00:00`); d.setDate(d.getDate() - days); return localDate(d); };

// The outline around a group of tables: each table padded into a rounded box, and neighbours joined by a
// thick round band (the shortest links that connect them all), drawn twice, the outer copy in ink and the
// inner one in the fill, so only the outside edge shows as a line. It hugs the tables instead of a straight
// polygon that would cross other tables.
const PAD = 14, LINK = 210, NEAR = 130;
function Outline({tables, className}: {tables: Table[]; className: string}) {
  if (!tables.length) return null;
  const links: [Table, Table][] = [];
  const joined = new Set<string>([tables[0].id]);
  while (joined.size < tables.length) {
    let best: [Table, Table] | null = null, bestD = Infinity;
    for (const a of tables) if (joined.has(a.id)) for (const b of tables) if (!joined.has(b.id)) {
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (d < bestD) { bestD = d; best = [a, b]; }
    }
    if (!best) break;
    joined.add(best[1].id);
    if (bestD <= LINK) links.push(best);
  }
  // Close neighbours are joined too, so a block of tables reads as one area, without notches between them.
  for (let i = 0; i < tables.length; i++) for (let j = i + 1; j < tables.length; j++) {
    const a = tables[i], b = tables[j];
    if (Math.hypot(a.x - b.x, a.y - b.y) <= NEAR && !links.some(([x, y]) => (x === a && y === b) || (x === b && y === a))) links.push([a, b]);
  }
  const shape = (grow: number) => <>
    {tables.map(t => { const [w, h] = dimsOf(t); const p = PAD + grow; return <rect key={t.id} x={t.x - w - p} y={t.y - h - p} width={2 * (w + p)} height={2 * (h + p)} rx={Math.min(w, h) + p} />; })}
    {links.map(([a, b]) => { const band = 2 * (Math.min(...dimsOf(a), ...dimsOf(b)) + PAD + grow); return <line key={`${a.id}-${b.id}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={band} strokeLinecap="round" />; })}
  </>;
  return <g className={`fs-outline ${className}`} aria-hidden="true"><g className="fs-outline-edge">{shape(2)}</g><g className="fs-outline-fill">{shape(0)}</g></g>;
}

// Where a section's tables are, in words: their numbers, then the counters by name.
function whereOf(layout: FloorLayout, ids: string[]) {
  const tables = ids.map(id => layout.tables.find(t => t.id === id)).filter((t): t is Table => !!t && !isFixture(t));
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

export function FloorSections({restaurantId, day, service, people, roles = {}}: {restaurantId: string; day: string; service: string; people: OnShift[]; roles?: SideRoles}) {
  const [layout, setLayout] = useState<FloorLayout | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [drawing, setDrawing] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState("");
  // True while the manager is moving and adding tables (Edit map).
  const [editing, setEditing] = useState(false);
  // When tonight's sections were sent to the team (059); until then nobody sees them in My shift.
  const [postedAt, setPostedAt] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const explain = (e: unknown) => {
    const text = e instanceof Error ? e.message : String((e as {message?: string})?.message ?? e);
    return /floor_maps|PGRST205|42P01/.test(text) ? "Sections need database update 058." : /posted_at|42703/.test(text) ? "Sections need database update 059." : text;
  };

  const load = useCallback(async () => {
    if (!supabase) return;
    setLoading(true); setError(""); setSaved(""); setDrawing(new Set()); setSelected(null);
    try {
      const [map, plan] = await Promise.all([
        supabase.from("floor_maps").select("layout").eq("restaurant_id", restaurantId).maybeSingle(),
        supabase.from("floor_plans").select("rows, posted_at").eq("restaurant_id", restaurantId).eq("service_date", day).eq("service", service).maybeSingle(),
      ]);
      if (map.error) throw map.error;
      if (plan.error) throw plan.error;
      const found = (map.data as {layout: FloorLayout} | null)?.layout;
      setLayout(found?.tables?.length ? found : null);
      setSections(fromRows(((plan.data as {rows: FloorRow[]} | null)?.rows ?? []).filter(r => r.tables || !/^\d+$/.test(r.section))));
      setPostedAt((plan.data as {posted_at?: string | null} | null)?.posted_at ?? null);
    } catch (e) { setError(explain(e)); }
    finally { setLoading(false); }
  }, [restaurantId, day, service]);
  useEffect(() => { void load(); }, [load]);

  const servers = useMemo(() => people.filter(p => roleOf(p.shift_position, roles) === "server").sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.name.localeCompare(b.name)), [people]);
  const sas = useMemo(() => people.filter(p => roleOf(p.shift_position, roles) === "sa").sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at) || a.name.localeCompare(b.name)), [people, roles]);
  const closing = useMemo(() => new Set([...closers(servers), ...closers(sas)]), [servers, sas]);

  async function save(next: Section[]) {
    setSections(next);
    if (!supabase || !layout) return;
    setError(""); setSaved("");
    const {data: who} = await supabase.auth.getUser();
    const rows = toRows(layout, next);
    const res = await supabase.from("floor_plans").upsert({restaurant_id: restaurantId, service_date: day, service, rows, updated_by: who.user?.id, updated_at: new Date().toISOString()}, {onConflict: "restaurant_id,service_date,service"});
    if (res.error) setError(explain(res.error)); else setSaved(postedAt ? "Saved. The team sees the change in My shift." : "Saved. The team sees it once you send it.");
  }

  // Send: the sections show in each person's My shift and everyone named in them gets a notification.
  async function sendSections() {
    if (!supabase || !layout || sending) return;
    setSending(true); setError(""); setSaved("");
    const {data: who} = await supabase.auth.getUser();
    const now = new Date().toISOString();
    const res = await supabase.from("floor_plans").upsert({restaurant_id: restaurantId, service_date: day, service, rows: toRows(layout, sections), posted_at: now, updated_by: who.user?.id, updated_at: now}, {onConflict: "restaurant_id,service_date,service"}).select("id").single();
    setSending(false);
    if (res.error) { setError(/posted_at|42703/.test(res.error.message) ? "Sending sections needs database update 059." : explain(res.error)); return; }
    setPostedAt(now);
    const id = (res.data as {id: string} | null)?.id;
    if (id) notify("sections_posted", id);
    setSaved("Sent. Each server and S.A. sees their section in My shift.");
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

  // A free table goes into the section being drawn. A table already in a section can't be picked again:
  // tapping it opens its section instead (delete that section to draw its tables again). The bar and the host
  // stand are only there to find your way.
  function tapTable(id: string) {
    setSaved("");
    const t = layout?.tables.find(x => x.id === id);
    if (!t || isFixture(t)) return;
    const own = sectionOf(id);
    if (own) { setDrawing(new Set()); setSelected(String(own.n)); return; }
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

  async function saveMap(next: FloorLayout) {
    if (!supabase) return false;
    setError("");
    const {data: who} = await supabase.auth.getUser();
    const res = await supabase.from("floor_maps").upsert({restaurant_id: restaurantId, layout: next, updated_by: who.user?.id, updated_at: new Date().toISOString()}, {onConflict: "restaurant_id"});
    if (res.error) { setError(explain(res.error)); return false; }
    setLayout(next); setEditing(false); setSaved("Floor map saved.");
    return true;
  }

  if (loading) return <p className="muted py-6" role="status">Loading the floor map…</p>;
  if (editing) return <><Notice text={error} error /><MapEditor start={layout ?? EMPTY_MAP} onCancel={() => setEditing(false)} onSave={saveMap} /></>;
  if (!layout) return <><Notice text={error} error />{!error && <div className="swb-card"><p className="muted text-sm">This restaurant has no floor map yet. Place your tables once, then you draw tonight&apos;s sections on it here.</p>
    <div><button type="button" className="btn secondary" onClick={() => setEditing(true)}>Create the floor map</button></div></div>}</>;

  // Each section's tag, in the free spot nearest its tables. (No outline: each table carries its section's number.)
  const placed: [number, number, number, number][] = [];
  // The tag is one line, the section's number and its server; the S.A.s are in the list next to the map.
  const tagWidth = (s: Section) => (s.server?.name ?? "Pick-up").length * 8 + 44;
  const shapes = onMap.map(s => ({s, ts: s.tables.map(id => layout.tables.find(t => t.id === id)).filter((t): t is Table => !!t)})).filter(x => x.ts.length).map(({s, ts}) => {
    const others = layout.tables.filter(t => !s.tables.includes(t.id) && !isFixture(t));
    const w = tagWidth(s), spot = placeTag(layout, ts, w, placed, others);
    placed.push([spot[0] - w / 2 - 4, spot[1] - 17, spot[0] + w / 2 + 4, spot[1] + 17]);
    return {s, spot};
  });

  // The sheet to pin up on the floor: the map with each section, and the list of who works what.
  const printSections = async () => {
    const named = await supabase?.from("restaurants").select("name").eq("id", restaurantId).maybeSingle();
    const restaurant = (named?.data as {name: string} | null)?.name ?? "";
    const title = `${new Date(`${day}T12:00:00`).toLocaleDateString("en-US", {weekday: "long", month: "long", day: "numeric"})} · ${service}`;
    const helpers = new Map<string, {name: string; covers: string[]}>();
    for (const s of sections) for (const h of s.sas) {
      const entry = helpers.get(h.id) ?? {name: h.name || "Team member", covers: []};
      entry.covers.push(isPost(s) ? s.name : String(s.n));
      helpers.set(h.id, entry);
    }
    return sectionsSheet({
      title, day, service, width: layout.width, height: layout.height,
      tables: layout.tables.map(t => { const [hw, hh] = dimsOf(t); return {label: isFixture(t) ? (t.label || (t.shape === "bar" ? "BAR" : "HOST")) : t.label, x: t.x, y: t.y, round: isRound(t), hw, hh, section: sectionOf(t.id)?.n ?? null, fixture: isFixture(t)}; }),
      tags: shapes.map(({s, spot: [x, y]}) => ({n: s.n, name: s.server?.name ?? "Pick-up", x, y})),
      sections: onMap.map(s => ({n: s.n, server: s.server?.name ?? "Pick-up", sas: s.sas.map(h => h.name), where: whereOf(layout, s.tables)})),
      helpers: [...helpers.values()].map(h => ({name: h.name, covers: h.covers.join("/")})),
    }, {restaurant});
  };

  return <><Notice text={error} error /><div className="swb-grid fs-grid">
    <section className="swb-card fs-map" aria-label="Floor map">
      <div className="swb-card-head"><p className="section-chip">Floor map</p><span className="muted text-xs">{drawing.size ? "Drawing a section" : "Tap tables to draw a section"}</span></div>
      <div className="fs-scroll">
        <svg viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label="Floor map with tonight's sections">
          {layout.walls.map((d, i) => <path key={i} className="fs-wall" d={d} />)}
          {layout.labels.map((l, i) => <text key={i} className="fs-area" x={l.x} y={l.y}>{l.text}</text>)}
          {/* Each section's outline, and the one growing around the tables being picked. */}
          {onMap.map(s => { const ts = s.tables.map(id => layout.tables.find(t => t.id === id)).filter((t): t is Table => !!t);
            return <Outline key={`o-${s.n}`} tables={ts} className={selected === String(s.n) && !drawing.size ? "sel" : ""} />; })}
          {drawing.size > 0 && <Outline tables={layout.tables.filter(t => drawing.has(t.id))} className="drawing" />}
          {layout.tables.map(t => {
            const own = sectionOf(t.id);
            const cls = drawing.has(t.id) ? " drawing" : own ? (selected === String(own.n) ? " in sel" : " in") : "";
            return <g key={t.id} className={`fs-table${cls}`} role="button" tabIndex={0} aria-label={`Table ${t.label || t.group || t.id}`} aria-pressed={drawing.has(t.id)}
              onClick={() => tapTable(t.id)} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); tapTable(t.id); } }}>
              <TableMark t={t} />
              {/* Which section the table is in: a small number on its corner. */}
              {own && !drawing.has(t.id) && (() => { const [w, h] = dimsOf(t); const c = isRound(t) ? 0.7 : 1;
                return <g className="fs-badge" data-no-translate><circle cx={t.x + w * c} cy={t.y - h * c} r={10} /><text x={t.x + w * c} y={t.y - h * c}>{own.n}</text></g>; })()}
            </g>;
          })}
          {shapes.map(({s, spot: [x, y]}) => {
            const name = s.server?.name ?? "Pick-up", helpers = s.sas.map(h => h.name).join(" · ") || "No S.A.";
            const w = tagWidth(s);
            return <g key={`tag-${s.n}`} className="fs-tag" onClick={() => { if (!drawing.size) setSelected(String(s.n)); }} data-no-translate>
              <title>{helpers}</title>
              <rect x={x - w / 2} y={y - 13} width={w} height={26} rx={13} />
              <circle cx={x - w / 2 + 13} cy={y} r={9} /><text className="fs-tag-n" x={x - w / 2 + 13} y={y}>{s.n}</text>
              <text className="fs-tag-name" x={x - w / 2 + 28} y={y}>{name}</text>
            </g>;
          })}
        </svg>
      </div>
      <div className="fs-foot">
        <span className="muted text-xs">{drawing.size ? <><b data-no-translate>{whereOf(layout, [...drawing])}</b></> : saved || (postedAt ? `Sent at ${clock(postedAt)}. Changes go out as you make them.` : "Tap free tables to draw a section. Tap a table that's already in one to open its section.")}</span>
        <span className="fs-actions">
          {drawing.size > 0 && <button type="button" className="btn secondary" onClick={() => setDrawing(new Set())}>Cancel</button>}
          {drawing.size > 0 ? <button type="button" className="btn" onClick={() => void createSection()}>{`Create section ${nextNumber}`}</button>
            : <><DownloadSheet variant="button" buttonLabel="Print" busyLabel="Preparing the sections" label="Download tonight's sections to print" build={printSections} />
              <button type="button" className="btn secondary" onClick={() => {setSaved(""); setEditing(true);}}>Edit map</button><button type="button" className="btn secondary" onClick={() => void copyLastWeek()}>Copy from a week ago</button>
              {/* The one lime button while nobody is drawing. Once sent, changes go out as they're made. */}
              {!postedAt && <button type="button" className="btn" disabled={sending || !onMap.length} onClick={() => void sendSections()}>{sending ? "Sending…" : "Send to the team"}</button>}</>}
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
            {!servers.length && <p className="muted text-xs">No servers on the published schedule for this service. Which positions count as servers is set in Schedule, Settings.</p>}
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

// Edit map: drag tables to move them, add tables, and change a table's number, shape or area. Nothing is
// saved until Save map; sections already drawn keep their tables (a deleted table just drops out of them).
function MapEditor({start, onCancel, onSave}: {start: FloorLayout; onCancel: () => void; onSave: (layout: FloorLayout) => Promise<boolean>}) {
  const [map, setMap] = useState<FloorLayout>(start);
  const [picked, setPicked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const svg = useRef<SVGSVGElement>(null);
  // A press on a table: a tap opens it to edit; holding and moving drags it.
  const drag = useRef<{id: string; dx: number; dy: number; sx: number; sy: number; moved: boolean} | null>(null);
  const numberInput = useRef<HTMLInputElement>(null);
  const [focusNumber, setFocusNumber] = useState(0);
  useEffect(() => { if (focusNumber) { numberInput.current?.focus(); numberInput.current?.select(); } }, [focusNumber]);
  const table = map.tables.find(t => t.id === picked) ?? null;
  const snap = (v: number) => Math.round(v / 5) * 5;

  const toMap = (e: ReactPointerEvent) => {
    const el = svg.current, m = el?.getScreenCTM();
    if (!el || !m) return {x: 0, y: 0};
    const p = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
    return {x: p.x, y: p.y};
  };
  const change = (id: string, patch: Partial<Table>) => setMap(m => ({...m, tables: m.tables.map(t => t.id === id ? {...t, ...patch} : t)}));

  function startDrag(e: ReactPointerEvent, t: Table) {
    e.preventDefault();
    const p = toMap(e);
    drag.current = {id: t.id, dx: p.x - t.x, dy: p.y - t.y, sx: e.clientX, sy: e.clientY, moved: false};
  }
  function moveDrag(e: ReactPointerEvent) {
    const d = drag.current;
    if (!d) return;
    // Only a real move (more than a few pixels) starts dragging; a tap stays a tap.
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 6) return;
      d.moved = true;
      setPicked(d.id);
      svg.current?.setPointerCapture(e.pointerId);
    }
    const p = toMap(e), t = map.tables.find(x => x.id === d.id);
    if (!t) return;
    const [w, h] = dimsOf(t);
    change(d.id, {x: Math.min(map.width - w, Math.max(w, snap(p.x - d.dx))), y: Math.min(map.height - h, Math.max(h, snap(p.y - d.dy)))});
  }
  function addTable() {
    const numbers = map.tables.filter(t => !isFixture(t)).map(t => Number(t.label)).filter(n => Number.isFinite(n) && n > 0);
    const label = String(numbers.length ? Math.max(...numbers) + 1 : 1);
    const id = `t${Date.now().toString(36)}`;
    // A little apart from the last table added, so several new ones don't sit on top of each other.
    const offset = (map.tables.filter(t => t.id.startsWith("t")).length % 6) * 30;
    setMap(m => ({...m, tables: [...m.tables, {id, label, x: snap(m.width / 2 + offset), y: snap(m.height / 2 + offset), shape: "s"}]}));
    setPicked(id);
  }
  function removeTable(id: string) {
    setMap(m => ({...m, tables: m.tables.filter(t => t.id !== id)}));
    setPicked(null);
  }
  async function save() {
    setBusy(true);
    const clean = {...map, tables: map.tables.map(t => ({...t, label: t.label.trim().slice(0, 8), group: t.group?.trim().slice(0, 30) || undefined}))};
    await onSave(clean);
    setBusy(false);
  }

  return <div className="swb-grid fs-grid">
    <section className="swb-card fs-map" aria-label="Edit the floor map">
      <div className="swb-card-head"><p className="section-chip">Edit map</p><span className="muted text-xs">{`${map.tables.length} ${map.tables.length === 1 ? "table" : "tables"}`}</span></div>
      <div className="fs-scroll">
        <svg ref={svg} className="fs-edit" viewBox={`0 0 ${map.width} ${map.height}`} role="img" aria-label="Floor map, editing"
          onPointerMove={moveDrag} onPointerCancel={() => { drag.current = null; }}
          onPointerUp={() => { const d = drag.current; drag.current = null; if (d && !d.moved) { setPicked(d.id); setFocusNumber(n => n + 1); } }}>
          <defs><pattern id="fs-dots" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r="1" className="fs-dot" /></pattern></defs>
          <rect className="fs-grid-bg" x="0" y="0" width={map.width} height={map.height} fill="url(#fs-dots)" onPointerDown={() => setPicked(null)} />
          {map.tables.map(t => <g key={t.id} className={`fs-table fs-move${picked === t.id ? " picked" : ""}`} role="button" tabIndex={0} aria-label={`Table ${t.label || t.group || t.id}`} aria-pressed={picked === t.id}
            onPointerDown={e => startDrag(e, t)}
            onKeyDown={e => {
              const step = e.shiftKey ? 20 : 5, moves: Record<string, [number, number]> = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]};
              if (moves[e.key]) { e.preventDefault(); change(t.id, {x: t.x + moves[e.key][0], y: t.y + moves[e.key][1]}); }
              if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setPicked(t.id); setFocusNumber(n => n + 1); }
            }}>
            <TableMark t={t} />
          </g>)}
        </svg>
      </div>
      <div className="fs-foot">
        <span className="muted text-xs">Drag a table to move it. Tap it to change its number or shape.</span>
        <span className="fs-actions">
          <button type="button" className="btn secondary" onClick={addTable}><Plus size={14} aria-hidden="true" />Add table</button>
          <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>Cancel</button>
          <button type="button" className="btn" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save map"}</button>
        </span>
      </div>
    </section>

    <div className="fs-side">
      <section className="swb-card" aria-label="Table">
        <div className="swb-card-head"><b>{table ? (isFixture(table) ? (table.shape === "bar" ? "Bar" : "Host stand") : table.label ? `Table ${table.label}` : "Seat") : "Pick a table"}</b>
          {table && <button type="button" className="icon-chip" aria-label="Delete table" title="Delete table" onClick={() => removeTable(table.id)}><Trash2 size={14} /></button>}</div>
        {!table ? <p className="muted text-sm">Tap a table on the map to change it, or add a new one.</p> : <>
          <label className="fs-people"><span className="fs-plabel">{isFixture(table) ? "Name on the map" : "Number"}</span>
            <input ref={numberInput} className="fs-input" value={table.label} maxLength={8} inputMode="text" onChange={e => change(table.id, {label: e.target.value})} placeholder="Leave empty for a counter seat" /></label>
          <div className="fs-people"><span className="fs-plabel">Shape</span>
            <div className="fs-chips">
              {([["r", "Round"], ["s", "Square"], ["w", "Long"], ["c", "Seat"], ["bar", "Bar"], ["host", "Host stand"]] as [Table["shape"], string][]).map(([shape, name]) =>
                <button key={shape} type="button" className="fs-chip" aria-pressed={table.shape === shape} onClick={() => change(table.id, {shape,
                  // The bar and the host stand are named, not numbered.
                  ...(shape === "bar" || shape === "host" ? (/^\d*$/.test(table.label) ? {label: shape === "bar" ? "BAR" : "HOST"} : {}) : (/^(BAR|HOST)$/.test(table.label) ? {label: ""} : {}))})}>{name}</button>)}
              {(table.shape === "w" || isFixture(table)) && <button type="button" className="fs-chip" aria-pressed={!!table.turned} onClick={() => change(table.id, {turned: !table.turned})}>Stand it on end</button>}
            </div>
          </div>
          <label className="fs-people"><span className="fs-plabel">Area (optional)</span>
            <input className="fs-input" value={table.group ?? ""} maxLength={30} onChange={e => change(table.id, {group: e.target.value})} placeholder="Like Sushi counter" /></label>
          <p className="muted text-xs">Seats without a number show by their area in the list of sections.</p>
        </>}
      </section>
    </div>
  </div>;
}
