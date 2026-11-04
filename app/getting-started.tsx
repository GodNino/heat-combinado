"use client";
// Getting started: the first card on a new restaurant's Dashboard. Six steps that make HEAT work for the
// team, each checked against the restaurant's own data, with a button straight to where it's done. It goes
// away once everything is done, or when the manager hides it (on this device). Nothing here changes data.
import { useEffect, useState } from "react";
import { Check, ChevronRight } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { roleOf } from "@/lib/sidework-plan";

export type StartPlace = "library" | "team" | "schedule" | "checklists";
type Step = {key: string; title: string; hint: string; done: boolean; go: StartPlace; button: string};
const HIDDEN_KEY = (rid: string) => `heat-getting-started-hidden-${rid}`;

export function GettingStarted({restaurantId, menuCount, onGo}: {restaurantId: string; menuCount: number; onGo: (place: StartPlace) => void}) {
  const [steps, setSteps] = useState<Step[] | null>(null);
  const [hidden, setHidden] = useState(true);
  useEffect(() => { try { setHidden(localStorage.getItem(HIDDEN_KEY(restaurantId)) === "1"); } catch { setHidden(false); } }, [restaurantId]);

  useEffect(() => {
    if (!supabase) return;
    let live = true;
    const db = supabase;
    // Each check stands alone: one that can't be read (an older database, no access) just counts as not done.
    const count = async (run: () => PromiseLike<{count: number | null; error: unknown}>) => { try { const r = await run(); return r.error ? 0 : r.count ?? 0; } catch { return 0; } };
    void (async () => {
      const [team, settings, published, map, jobs] = await Promise.all([
        Promise.resolve(db.rpc("schedule_team", {rid: restaurantId})).then(r => (r.error ? [] : r.data ?? []) as {user_id: string; role: string}[]).catch(() => []),
        Promise.resolve(db.from("schedule_settings").select("server_positions, sa_positions").eq("restaurant_id", restaurantId).maybeSingle()).then(r => r.error ? null : r.data as {server_positions: string[] | null; sa_positions: string[] | null} | null).catch(() => null),
        count(() => db.from("schedule_shifts").select("id", {count: "exact", head: true}).eq("restaurant_id", restaurantId).eq("published", true)),
        count(() => db.from("floor_maps").select("restaurant_id", {count: "exact", head: true}).eq("restaurant_id", restaurantId)),
        count(() => db.from("checklist_jobs").select("id", {count: "exact", head: true}).eq("restaurant_id", restaurantId).eq("archived", false)),
      ]);
      if (!live) return;
      const roles = settings ?? {};
      const hasServers = team.some(p => roleOf(p.role ?? "", roles) === "server");
      setSteps([
        {key: "menu", title: "Add your menu", hint: "Dishes, cocktails and wines with their ingredients and allergens. The quizzes and the tutor are made from them.", done: menuCount > 0, go: "library", button: "Open the library"},
        {key: "team", title: "Invite your team", hint: "Send the invite link by WhatsApp or text. Each person joins with their position.", done: team.length > 1, go: "team", button: "Invite"},
        {key: "roles", title: "Say who your servers and S.A.s are", hint: "In Schedule, tap the gear and pick the positions your restaurant uses, so side work and sections find the right people.", done: !!(settings?.server_positions?.length || settings?.sa_positions?.length) || hasServers, go: "schedule", button: "Open the schedule"},
        {key: "schedule", title: "Publish a schedule", hint: "Everyone gets their shifts on their phone, and Tonight knows who is working.", done: published > 0, go: "schedule", button: "Open the schedule"},
        {key: "jobs", title: "Set up side work", hint: "Opening, during the shift and closing jobs, once. Every night you give them out on Tonight.", done: jobs > 0, go: "checklists", button: "Open side work"},
        {key: "map", title: "Draw your floor map", hint: "Place your tables once, tracing a photo of your plan. Then draw tonight's sections on it.", done: map > 0, go: "checklists", button: "Open sections"},
      ]);
    })();
    return () => { live = false; };
  }, [restaurantId, menuCount]);

  if (hidden || !steps) return null;
  const done = steps.filter(s => s.done).length;
  if (done === steps.length) return null;
  const next = steps.find(s => !s.done);
  return <section className="panel getting-started mb-4" aria-label="Getting started">
    <div className="getting-started-head">
      <div><p className="section-chip">Getting started</p><b>{`${done} of ${steps.length} done`}</b></div>
      <button type="button" className="btn secondary" onClick={() => { setHidden(true); try { localStorage.setItem(HIDDEN_KEY(restaurantId), "1"); } catch { /* storage unavailable */ } }}>Hide</button>
    </div>
    <ol className="getting-started-steps">
      {steps.map((step, i) => <li key={step.key} className={step.done ? "done" : step === next ? "next" : ""}>
        <span className="gs-mark" aria-hidden="true">{step.done ? <Check size={14} /> : i + 1}</span>
        <span className="gs-text"><b>{step.title}</b>{!step.done && <small>{step.hint}</small>}</span>
        {!step.done && <button type="button" className="btn secondary" onClick={() => onGo(step.go)}>{step.button}<ChevronRight size={14} aria-hidden="true" /></button>}
        {step.done && <span className="sr-only">Done</span>}
      </li>)}
    </ol>
  </section>;
}
