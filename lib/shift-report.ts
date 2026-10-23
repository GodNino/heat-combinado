// The end-of-shift report (migration 038): its words, and the email upper management receives.
// Kept free of React and Supabase so the screen, the email route and the tests share one copy.

export const MOODS = {great: "Great", ok: "OK", rough: "Rough"} as const;
export type Mood = keyof typeof MOODS;

export const ISSUE_KINDS = {
  complaint: "Guest complaint or comp",
  allergy: "Allergy incident",
  injury: "Injury or safety",
  equipment: "Equipment",
  staff: "Staff",
  other: "Other",
} as const;
export type IssueKind = keyof typeof ISSUE_KINDS;
export const URGENT_KINDS: readonly IssueKind[] = ["allergy", "injury"];

export const SERVICES = ["Brunch", "Lunch", "Dinner"] as const;

export type FromHeat = {
  eighty_six?: {name: string; status: string; detail?: string}[];
  checklists?: {total: number; done: number; missing: string[]} | null;
  on_floor?: string[];
  quizzes?: number;
};
export type ShiftReport = {
  id: string;
  restaurant_id: string;
  service_date: string;
  label: string;
  mood: Mood;
  covers: number | null;
  sales: number | string | null;
  issues: {kind: IssueKind; note: string}[];
  urgent: boolean;
  low_stock: string;
  shoutouts: string;
  next_shift: string;
  notes: string;
  from_heat: FromHeat;
  /** Who wrote it (sending again doesn't change it, 046). */
  submitted_by?: string;
  submitted_at: string;
  /** Who changed it last, and when (046). */
  updated_by?: string | null;
  updated_at?: string | null;
};

// "2026-10-17" is a calendar day, not a moment: read it in local time so it never shifts a day.
export function serviceDay(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {weekday: "short", month: "short", day: "numeric"});
}

export function money(value: number | string | null) {
  if (value === null || value === "") return null;
  return Number(value).toLocaleString("en-US", {style: "currency", currency: "USD", maximumFractionDigits: 0});
}

// One line per thing HEAT recorded, for the screen and the email alike.
export function heatLines(from: FromHeat) {
  const lines: string[] = [];
  const out = from.eighty_six ?? [];
  if (out.length) lines.push(`86'd or low: ${out.map(e => e.status === "86" ? e.name : `${e.name} (low)`).join(", ")}`);
  const lists = from.checklists;
  if (lists && lists.total) lines.push(`Checklists: ${lists.done} of ${lists.total} jobs done${lists.missing.length ? ` · not done: ${lists.missing.join(", ")}` : ""}`);
  if (from.on_floor?.length) lines.push(`On the floor: ${from.on_floor.join(", ")}`);
  if (from.quizzes) lines.push(`Quizzes taken today: ${from.quizzes}`);
  return lines;
}

const escape = (text: string) => text.replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"}[c]!));

// The email: problems first, then the numbers, then everything else. Plain HTML that every mail
// app renders, and a text version for the ones that don't.
export function reportEmail(report: ShiftReport, restaurantName: string, appUrl: string) {
  const day = serviceDay(report.service_date);
  const subject = `${report.urgent ? "URGENT · " : ""}${restaurantName} · ${report.label} report · ${day}`;
  const numbers = [`Night: ${MOODS[report.mood]}`, report.covers !== null ? `Covers: ${report.covers}` : "", money(report.sales) ? `Sales: ${money(report.sales)}` : ""].filter(Boolean);
  const sections: [string, string[]][] = [
    ["Issues", report.issues.map(i => `${ISSUE_KINDS[i.kind]}${URGENT_KINDS.includes(i.kind) ? " (urgent)" : ""}: ${i.note || "no details"}`)],
    ["Service", numbers],
    ["From HEAT", heatLines(report.from_heat)],
    ["Low stock / to order", report.low_stock ? [report.low_stock] : []],
    ["Shout-outs", report.shoutouts ? [report.shoutouts] : []],
    ["For the next shift", report.next_shift ? [report.next_shift] : []],
    ["Notes", report.notes ? [report.notes] : []],
  ];
  const filled = sections.filter(([, lines]) => lines.length);
  const text = [subject, "", ...filled.flatMap(([title, lines]) => [title.toUpperCase(), ...lines.map(l => `- ${l}`), ""]), `Open in HEAT: ${appUrl}`].join("\n");
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:600px;margin:0 auto;color:#121212">
<p style="font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#5c5c57;margin:0 0 6px">${escape(restaurantName)} · ${escape(report.label)}</p>
<h1 style="font-size:22px;margin:0 0 4px">${escape(day)}${report.urgent ? ' <span style="font-size:13px;border:1px solid #121212;border-radius:999px;padding:2px 8px;vertical-align:middle">URGENT</span>' : ""}</h1>
${filled.map(([title, lines]) => `<h2 style="font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#5c5c57;margin:22px 0 6px">${escape(title)}</h2>
<ul style="margin:0;padding-left:18px;font-size:14px;line-height:1.55">${lines.map(l => `<li style="white-space:pre-wrap">${escape(l)}</li>`).join("")}</ul>`).join("\n")}
<p style="margin:28px 0 0"><a href="${escape(appUrl)}" style="background:#c7f24a;color:#121212;text-decoration:none;font-weight:600;padding:9px 16px;border-radius:999px;display:inline-block">Open in HEAT</a></p>
</div>`;
  return {subject, text, html};
}

// The service day on this phone. Until 5 am it is still last night: a dinner that closes after
// midnight belongs to the day it started. (The database clock is UTC, so it can't decide this.)
export function serviceDate(now = new Date()) {
  const shifted = new Date(now.getTime() - 5 * 3_600_000);
  return `${shifted.getFullYear()}-${String(shifted.getMonth() + 1).padStart(2, "0")}-${String(shifted.getDate()).padStart(2, "0")}`;
}
