"use client";
// My shift: one card with everything a server or S.A. needs for today's service -- their section,
// who they work with, and their opening, running and closing side work. It reads the floor plan (050)
// and the side work sent from Tonight (051). Nothing sent for today means no card.
import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { FloorTable, defaultService, helpers, localDate, type FloorRow } from "./floor-plan";

type Plan = {service: string; rows: FloorRow[]};
type Mine = {title: string; phase: "opening" | "closing"; done_at: string | null; shift_id: string};
type Shift = {id: string; label: string};

export function MyShiftCard({restaurantId, userId: given, onOpen}: {restaurantId: string; userId?: string; onOpen?: () => void}) {
  const [userId, setUserId] = useState(given ?? "");
  const [plans, setPlans] = useState<Plan[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [mine, setMine] = useState<Mine[]>([]);
  const [showFloor, setShowFloor] = useState(false);
  useEffect(() => { if (!given && supabase) void supabase.auth.getUser().then(({data}) => setUserId(data.user?.id ?? "")); }, [given]);
  useEffect(() => {
    if (!supabase || !userId) return;
    let live = true;
    const today = localDate();
    void (async () => {
      const [floor, posted] = await Promise.all([
        supabase!.from("floor_plans").select("service, rows").eq("restaurant_id", restaurantId).eq("service_date", today),
        supabase!.from("checklist_shifts").select("id, label").eq("restaurant_id", restaurantId).eq("shift_date", today).neq("status", "draft"),
      ]);
      const ids = ((posted.data ?? []) as Shift[]).map(s => s.id);
      const jobs = ids.length ? await supabase!.from("checklist_assignments").select("title, phase, done_at, shift_id").in("shift_id", ids).eq("user_id", userId).not("phase", "is", null).order("sort_order") : {data: []};
      if (!live) return;
      setPlans((floor.data ?? []) as Plan[]);
      setShifts((posted.data ?? []) as Shift[]);
      setMine((jobs.data ?? []) as Mine[]);
    })();
    return () => { live = false; };
  }, [restaurantId, userId]);

  // The service this person is on: the one where they have a row or jobs, tonight's first.
  const order = defaultService() === "Dinner" ? ["Dinner", "Lunch"] : ["Lunch", "Dinner"];
  const service = order.find(s => plans.some(p => p.service === s && p.rows.some(r => r.server_id === userId || r.sa.some(h => h.id === userId)))
    || mine.some(m => shifts.find(x => x.id === m.shift_id)?.label === s));
  if (!userId || !service) return null;
  const plan = plans.find(p => p.service === service);
  const row = plan?.rows.find(r => r.server_id === userId || r.sa.some(h => h.id === userId));
  const asServer = row?.server_id === userId;
  const sectionsAsSA = plan?.rows.filter(r => r.sa.some(h => h.id === userId)).map(r => r.section).filter(Boolean) ?? [];
  const jobs = mine.filter(m => shifts.find(x => x.id === m.shift_id)?.label === service);
  const opening = jobs.filter(j => j.phase === "opening");
  const closing = jobs.filter(j => j.phase === "closing");

  return <section className="panel my-shift mb-4" aria-label="My shift">
    <p className="eyebrow muted">{`My shift · ${service}`}</p>
    {row && <div className="my-shift-floor">
      <b>{asServer ? (row.section ? `Section ${row.section}` : "No section") : (sectionsAsSA.length ? `Sections ${sectionsAsSA.join("/")}` : "No section")}</b>
      <span className="muted">{asServer ? (row.sa.length ? `S.A.: ${helpers(row.sa)}` : "No S.A. assigned") : `Server: ${row.server_name || "Team member"}`}</span>
    </div>}
    <div className="my-shift-phases">
      {opening.length > 0 && <div><small className="muted">Opening</small>{opening.map((j, i) => <p key={i}>{j.title}{j.done_at ? " ✓" : ""}</p>)}</div>}
      {asServer && row?.task && <div><small className="muted">During the shift</small><p>{row.task}</p></div>}
      {closing.length > 0 && <div><small className="muted">Closing</small>{closing.map((j, i) => <p key={i}>{j.title}{j.done_at ? " ✓" : ""}</p>)}</div>}
    </div>
    <div className="my-shift-links">
      {plan && <button type="button" aria-expanded={showFloor} onClick={() => setShowFloor(v => !v)}>{showFloor ? "Hide the floor" : "See the whole floor"}</button>}
      {onOpen && jobs.length > 0 && <button type="button" onClick={onOpen}>Open my side work</button>}
    </div>
    {showFloor && plan && <FloorTable rows={plan.rows} highlight={userId} />}
  </section>;
}
