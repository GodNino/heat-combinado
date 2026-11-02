"use client";
// The guided tour. It opens once for every new account — demo visitor, trial or live restaurant —
// and can be skipped at any step or replayed from "Take the tour" in the sidebar.
//
// Each step can move the app to a screen and point at one thing on it. The highlight never blocks
// the page: someone who wants to try "Add menu item" right there can, and Next still works after.
// A step whose target isn't on screen (a phone with the menu folded away, an empty library) simply
// shows its card in the middle instead.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { User } from "@supabase/supabase-js";

export type TourView = "home" | "library" | "allergy" | "preshift" | "team" | "dashboard" | "progress" | "reports" | "schedule";
type Step = {title: string; body: string; view?: TourView; target?: string; cta?: {label: string; href: string}};

// Bump when the tour changes enough that everyone should see it again.
export const TOUR_VERSION = 2;
const STORAGE_KEY = "heat-tour-seen";

export function tourSeen(user: User) {
  const saved = Number(user.user_metadata?.heat_tour ?? 0);
  let local = 0;
  try { local = Number(localStorage.getItem(STORAGE_KEY) ?? 0); } catch {}
  return Math.max(saved, local) >= TOUR_VERSION;
}

// Remembered on the account, so a skipped tour stays skipped on every device; and in the browser,
// so it stays skipped even if saving to the account fails.
async function rememberTourSeen() {
  try { localStorage.setItem(STORAGE_KEY, String(TOUR_VERSION)); } catch {}
  try { await supabase?.auth.updateUser({data: {heat_tour: TOUR_VERSION}}); } catch {}
}

export function tourSteps({manager, demo, restaurantName}: {manager: boolean; demo: boolean; restaurantName: string}): Step[] {
  const replay: Step = {title: "Need a refresher?", body: "Replay this tour any time from Take the tour, here in the menu.", view: "home", target: '[data-tour="tour-button"]'};
  const finish: Step = demo
    ? {title: "Ready for your own menu?", body: "Start a free trial and set up your restaurant with your own dishes and team. 14 days, no card.", cta: {label: "Start free trial", href: "/trial"}}
    : {title: "You're all set", body: manager ? "Start with your menu: the rest of HEAT builds on it." : "Good luck at your next service."};
  if (!manager) return [
    {title: "Welcome to HEAT", body: `A quick tour of how to get ready for service at ${restaurantName}. It takes about a minute.`},
    {title: "Your home", body: "Your next shifts, tonight's pre-shift, what to study next and your progress, all on one screen.", view: "home", target: '[aria-label="Your week"]'},
    {title: "Your schedule", body: "My shifts shows your week. Can't make one? Release it, offer it to someone or swap it; your manager approves. Mark when you can't work in My availability, and ask for days off in Time off.", view: "schedule", target: '[role="group"][aria-label="Schedule"]'},
    {title: "The menu", body: "Every dish, cocktail and wine. Tap one to see its card: ingredients, allergens and how it's served.", view: "library", target: ".menu-list > .compact-menu-row:first-child"},
    {title: "Quiz yourself", body: "Every card ends with QUIZ ME: a few questions, checked as you answer. 80% means you know it."},
    {title: "Allergy check", body: "Pick a guest's allergies to see what to avoid and what to confirm with the kitchen. HEAT never calls a dish safe: the kitchen always confirms.", view: "allergy", target: ".allergy-picker"},
    {title: "Your progress", body: "What you've covered, how accurate you are and what's worth another look.", view: "progress", target: '[aria-label="Your learning progress"]'},
    replay,
    finish,
  ];
  return [
    {title: "Welcome to HEAT", body: demo
      ? "This is your own copy of a sample restaurant. Change anything you like: it's yours for 7 days. This short tour shows you around."
      : `A short tour of the things you'll use every day at ${restaurantName}. Skip it now and replay it any time.`},
    {title: "Everything is here", body: "The menu takes you to the schedule, the library, the allergy check, pre-shift, side work, your team and more.", view: "home", target: '[data-tour="nav"]'},
    {title: "Today at a glance", body: "Who's working, the hours scheduled and the requests waiting for you, then whether pre-shift and side work are out yet. Tap a row to go straight to it.", view: "dashboard", target: ".today-status"},
    {title: "Add a dish", body: "Every dish, cocktail and wine lives in the library. Tap Add menu item: a name, ingredients, allergens and a photo is all it takes.", view: "library", target: '[data-tour="add-item"]'},
    {title: "Open any dish", body: "Tap a dish to see the card your team studies, with a QUIZ ME button at the end. The quiz writes itself from the card.", view: "library", target: ".menu-list > .compact-menu-row:first-child"},
    {title: "Allergy check", body: "Pick a guest's allergies to see what to avoid, what to confirm with the kitchen and what has no listed match. HEAT never calls a dish safe.", view: "allergy", target: ".allergy-picker"},
    {title: "Pre-shift", body: "Before service, post tonight's 86 list, the dishes to push and a note. Send it to everyone, or only to who's working today: it reaches their phones.", view: "preshift"},
    {title: "Build the week", body: "Drag shifts between days and people, copy last week, and see hours, overtime and conflicts as you go. Publish and everyone gets their shifts; Print gives you a sheet for the wall.", view: "schedule", target: ".sched-grid"},
    {title: "Requests and time off", body: "Releases, swaps and covers always wait for a manager, with overtime flagged before you approve. A floor manager runs the front of house; the head chef or sous chef runs the kitchen.", view: "schedule", target: '[role="group"][aria-label="Schedule"]'},
    {title: "Invite your team", body: "Tap Invite employees, copy the link and send it. Pick a position under FOH or BOH; whoever opens the link joins this restaurant, ready to study. Each person's access decides what they can change, schedules included.", view: "team", target: '[data-tour="invite"]'},
    {title: "See how it's going", body: "Labor shows hours and overtime by person and position; Service, the covers, sales and issues from shift reports; Training, who knows the menu. Each next to the period before.", view: "dashboard", target: '[aria-label="Dashboard view"]'},
    {title: "End-of-shift report", body: "After service, send the night's report from here. HEAT fills in the 86 list and checklists; you add covers, issues and notes, and it goes to the GM, managers and owners. Reports can be edited, printed or deleted, and show who wrote and changed them.", view: "reports", target: '[data-tour="nav-reports"]'},
    replay,
    finish,
  ];
}

type Box = {top: number; left: number; width: number; height: number};

export function Tour({steps, onGo, onClose, onFinishLink}: {
  steps: Step[];
  onGo: (view: TourView) => void;
  onClose: () => void;
  onFinishLink?: (href: string) => void;
}) {
  const [index, setIndex] = useState(0);
  const [box, setBox] = useState<Box | null>(null);
  const [cardHeight, setCardHeight] = useState(220);
  const card = useRef<HTMLDivElement>(null);
  const step = steps[index];
  const last = index === steps.length - 1;

  const close = useCallback(() => {
    void rememberTourSeen();
    onClose();
  }, [onClose]);

  // Move the app to the step's screen, then wait for its target to appear (screens load their data
  // first). Up to a second and a half; after that the card simply shows in the middle.
  useEffect(() => {
    if (step.view) onGo(step.view);
    setBox(null);
    if (!step.target) return;
    let tries = 0, timer = 0, live = true;
    const find = () => {
      if (!live) return;
      const el = document.querySelector<HTMLElement>(step.target!);
      const rect = el?.getBoundingClientRect();
      if (el && rect && rect.width > 0 && rect.height > 0) {
        el.scrollIntoView({block: "center", behavior: "instant" as ScrollBehavior});
        const r = el.getBoundingClientRect();
        setBox({top: r.top, left: r.left, width: r.width, height: r.height});
      } else if (++tries < 15) {
        timer = window.setTimeout(find, 100);
      }
    };
    timer = window.setTimeout(find, 60);
    return () => {live = false; window.clearTimeout(timer);};
    // Each step moves the app once; onGo changing identity on re-render must not move it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // Keep the highlight on its target while the page scrolls or the window changes size.
  useEffect(() => {
    if (!step.target) return;
    const follow = () => {
      const el = document.querySelector<HTMLElement>(step.target!);
      const r = el?.getBoundingClientRect();
      if (r && r.width > 0) setBox({top: r.top, left: r.left, width: r.width, height: r.height});
    };
    window.addEventListener("resize", follow);
    window.addEventListener("scroll", follow, true);
    return () => {window.removeEventListener("resize", follow); window.removeEventListener("scroll", follow, true);};
  }, [step.target]);

  useLayoutEffect(() => {
    if (card.current) setCardHeight(card.current.offsetHeight);
    card.current?.focus();
  }, [index, box]);

  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      if (event.key === "ArrowRight" && !last) setIndex(i => i + 1);
      if (event.key === "ArrowLeft" && index > 0) setIndex(i => i - 1);
    };
    window.addEventListener("keydown", keys);
    return () => window.removeEventListener("keydown", keys);
  }, [close, index, last]);

  // Below the target when it fits, above it when it doesn't, centred when there is no target.
  const gap = 12, pad = 6;
  const width = typeof window === "undefined" ? 360 : Math.min(360, window.innerWidth - 32);
  let position: React.CSSProperties = {top: "50%", left: "50%", transform: "translate(-50%, -50%)"};
  if (box && typeof window !== "undefined") {
    const below = box.top + box.height + pad + gap;
    const top = below + cardHeight <= window.innerHeight - 16 ? below : Math.max(16, box.top - pad - gap - cardHeight);
    const left = Math.min(Math.max(16, box.left), window.innerWidth - width - 16);
    position = {top, left};
  }

  return <div className="tour-layer" role="presentation">
    {box
      ? <div className="tour-spotlight" style={{top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2}} />
      : <div className="tour-backdrop" />}
    <div ref={card} className="tour-card" style={{...position, width}} role="dialog" aria-modal="false" aria-labelledby="tour-title" aria-describedby="tour-body" tabIndex={-1}>
      <p className="eyebrow muted">Tour · {index + 1} of {steps.length}</p>
      <h2 id="tour-title" className="mt-2 text-lg font-semibold">{step.title}</h2>
      <p id="tour-body" className="muted mt-2 text-sm">{step.body}</p>
      <div className="tour-dots" aria-hidden="true">{steps.map((_, i) => <span key={i} className={i === index ? "on" : ""} />)}</div>
      <div className="tour-actions">
        {!last && <button type="button" className="tour-skip" onClick={close}>Skip tour</button>}
        <span className="ml-auto" />
        {index > 0 && <button type="button" className="btn secondary" onClick={() => setIndex(i => i - 1)}>Back</button>}
        {last && step.cta
          ? <button type="button" className="btn" onClick={() => {void rememberTourSeen(); onFinishLink?.(step.cta!.href);}}>{step.cta.label}</button>
          : <button type="button" className="btn" onClick={() => last ? close() : setIndex(i => i + 1)}>{last ? "Finish" : "Next"}</button>}
      </div>
      {last && step.cta && <button type="button" className="tour-skip mt-3" onClick={close}>Keep exploring the demo</button>}
    </div>
  </div>;
}
