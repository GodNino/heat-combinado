"use client";
// The end-of-shift report: what used to be a free-text message to the GM, operations manager,
// managers and owners. HEAT fills in what it already knows; the manager adds the night in a few taps,
// and submitting saves it here and emails it (see app/api/shift-report/route.ts).
import { useEffect, useState, type FormEvent } from "react";
import { Plus, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Restaurant } from "@/lib/menu";
import { ISSUE_KINDS, MOODS, SERVICES, URGENT_KINDS, heatLines, money, serviceDate, serviceDay, type FromHeat, type IssueKind, type Mood, type ShiftReport } from "@/lib/shift-report";
import type { Organization } from "./locations";
import { Field, SectionInfo } from "./ui";

type Tab = "tonight" | "past" | "recipients";

export function ShiftReports({restaurant, restaurants, brand, ownsBrand, canWrite, canManageRecipients, setMessage}: {
  restaurant: Restaurant;
  restaurants: Restaurant[];
  brand?: Organization;
  ownsBrand: boolean;
  canWrite: boolean;
  canManageRecipients: boolean;
  setMessage: (text: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(canWrite ? "tonight" : "past");
  const tabs: [Tab, string][] = [
    ...(canWrite ? [["tonight", "Tonight's report"] as [Tab, string]] : []),
    ["past", "Past reports"],
    ...(canManageRecipients ? [["recipients", "Who gets it"] as [Tab, string]] : []),
  ];
  return <section className="mx-auto max-w-3xl">
    <p className="eyebrow muted">Shift report · {restaurant.name}</p>
    <h1 className="mt-3 mb-5 text-2xl font-semibold">End of shift</h1>
    {tabs.length > 1 && <div className="library-switch mb-5" aria-label="Shift report">
      {tabs.map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
    </div>}
    {tab === "tonight" && <TonightReport restaurant={restaurant} setMessage={setMessage} onSent={() => setTab("past")} />}
    {tab === "past" && <PastReports restaurant={restaurant} restaurants={restaurants} brand={ownsBrand ? brand : undefined} />}
    {tab === "recipients" && <Recipients restaurant={restaurant} />}
  </section>;
}

// Lunch before four in the afternoon, dinner after: the usual answer, changeable in one tap.
const likelyService = () => new Date().getHours() < 16 ? "Lunch" : "Dinner";

function TonightReport({restaurant, setMessage, onSent}: {restaurant: Restaurant; setMessage: (text: string) => void; onSent: () => void}) {
  const [draft, setDraft] = useState<FromHeat | null>(null);
  const [draftError, setDraftError] = useState("");
  const [label, setLabel] = useState(likelyService());
  const [day] = useState(serviceDate);
  const [mood, setMood] = useState<Mood | "">("");
  const [issues, setIssues] = useState<{kind: IssueKind; note: string}[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void supabase!.rpc("shift_report_draft", {rid: restaurant.id, day}).then(({data, error}) => {
      if (!live) return;
      if (error) setDraftError(error.message); else setDraft(data as FromHeat);
    });
    return () => {live = false;};
  }, [restaurant.id, day]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!mood) return setError("Choose how the night went.");
    const form = new FormData(event.currentTarget);
    const text = (name: string) => String(form.get(name) ?? "").trim();
    setBusy(true); setError("");
    try {
      const saved = await supabase!.rpc("submit_shift_report", {rid: restaurant.id, report: {
        service_date: day, label, mood, covers: text("covers"), sales: text("sales"),
        issues: issues.map(i => ({kind: i.kind, note: i.note.trim()})),
        low_stock: text("low_stock"), shoutouts: text("shoutouts"), next_shift: text("next_shift"), notes: text("notes"),
      }});
      if (saved.error) throw new Error(saved.error.message);
      // Saving is what matters; the email is a courtesy on top. If it fails, the report is still here.
      const {data: session} = await supabase!.auth.getSession();
      const sent = await fetch("/api/shift-report", {
        method: "POST",
        headers: {"Content-Type": "application/json", Authorization: `Bearer ${session.session?.access_token ?? ""}`},
        body: JSON.stringify({reportId: saved.data}),
      }).then(r => r.json()).catch(() => null) as {sent?: number; configured?: boolean; error?: string} | null;
      setMessage(sent?.sent
        ? `Report saved and emailed to ${sent.sent} ${sent.sent === 1 ? "person" : "people"}.`
        : sent?.configured === false
          ? "Report saved. Email isn't set up yet, so it's here in Past reports for now."
          : `Report saved, but the email didn't go out${sent?.error ? `: ${sent.error}` : ""}. It's in Past reports.`);
      onSent();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The report could not be saved.");
    } finally {
      setBusy(false);
    }
  }

  const known = draft ? heatLines(draft) : [];
  return <form onSubmit={submit}>
    <div className="panel dash-panel">
      <SectionInfo heading="Already in HEAT tonight">Taken from tonight's pre-shift, checklists and quizzes when you submit. Nothing to type.</SectionInfo>
      {draftError ? <p className="muted mt-3">{draftError}</p>
        : !draft ? <p className="muted mt-3" role="status">Loading…</p>
        : known.length ? <ul className="report-lines">{known.map(line => <li key={line}>{line}</li>)}</ul>
        : <p className="muted mt-3">No pre-shift, checklists or quizzes recorded today.</p>}
    </div>

    <div className="panel dash-panel">
      <div className="report-row">
        <Field label="Service"><select id="report-service" value={label} onChange={e => setLabel(e.target.value)}>{SERVICES.map(s => <option key={s}>{s}</option>)}</select></Field>
        <Field label="Covers"><input id="report-covers" name="covers" type="number" inputMode="numeric" min={0} max={100000} placeholder="e.g. 180" /></Field>
        <Field label="Sales (optional)"><input id="report-sales" name="sales" type="number" inputMode="decimal" min={0} step="0.01" placeholder="e.g. 14250" /></Field>
      </div>
      <p className="report-label">How did the night go?</p>
      <div className="library-switch" role="radiogroup" aria-label="How did the night go?">
        {(Object.keys(MOODS) as Mood[]).map(key => <button key={key} type="button" role="radio" aria-checked={mood === key} aria-pressed={mood === key} onClick={() => setMood(key)}>{MOODS[key]}</button>)}
      </div>
    </div>

    <div className="panel dash-panel">
      <SectionInfo heading="Anything to flag?">Tap what happened and add a line. Allergy incidents and injuries mark the report urgent.</SectionInfo>
      <div className="report-chips">{(Object.keys(ISSUE_KINDS) as IssueKind[]).map(kind => <button key={kind} type="button" className="btn secondary" onClick={() => setIssues(list => [...list, {kind, note: ""}])}><Plus size={14} />{ISSUE_KINDS[kind]}</button>)}</div>
      {issues.map((issue, index) => <div key={index} className="report-issue">
        <div className="flex items-center gap-2">
          <b className="text-sm">{ISSUE_KINDS[issue.kind]}</b>
          {URGENT_KINDS.includes(issue.kind) && <span className="report-urgent">Urgent</span>}
          <button type="button" className="ml-auto muted" aria-label={`Remove ${ISSUE_KINDS[issue.kind]}`} onClick={() => setIssues(list => list.filter((_, i) => i !== index))}><X size={16} /></button>
        </div>
        <textarea aria-label={`${ISSUE_KINDS[issue.kind]}: what happened`} rows={2} maxLength={1000} value={issue.note} placeholder="What happened, and what you did about it"
          onChange={e => setIssues(list => list.map((item, i) => i === index ? {...item, note: e.target.value} : item))} />
      </div>)}
    </div>

    <div className="panel dash-panel">
      <Field label="Low stock / to order"><textarea id="report-low" name="low_stock" rows={2} maxLength={1000} placeholder="e.g. Uni, yuzu, Albariño" /></Field>
      <Field label="Shout-outs"><textarea id="report-shout" name="shoutouts" rows={2} maxLength={1000} placeholder="Who did great tonight" /></Field>
      <Field label="For the next shift"><textarea id="report-next" name="next_shift" rows={2} maxLength={1000} placeholder="What the opening manager needs to know" /></Field>
      <Field label="Anything else"><textarea id="report-notes" name="notes" rows={4} maxLength={4000} placeholder="Write it the way you always have" /></Field>
    </div>

    {error && <p role="alert" className="notice bad mb-4">{error}</p>}
    <button className="btn w-full" disabled={busy}>{busy ? "Sending…" : `Submit ${label.toLowerCase()} report`}</button>
    <p className="muted mt-3 text-center text-xs">Goes to the owners and everyone who manages {restaurant.name}. Sending again tonight replaces it.</p>
  </form>;
}

function PastReports({restaurant, restaurants, brand}: {restaurant: Restaurant; restaurants: Restaurant[]; brand?: Organization}) {
  const [scope, setScope] = useState<"location" | "brand">("location");
  const [reports, setReports] = useState<ShiftReport[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    setReports(null); setError("");
    const query = scope === "brand" && brand
      ? supabase!.rpc("brand_shift_reports", {oid: brand.id, days: 30})
      : supabase!.from("shift_reports").select("*").eq("restaurant_id", restaurant.id).order("service_date", {ascending: false}).order("submitted_at", {ascending: false}).limit(30);
    void query.then(({data, error}) => {
      if (!live) return;
      if (error) setError(error.message); else setReports((data ?? []) as ShiftReport[]);
    });
    return () => {live = false;};
  }, [restaurant.id, scope, brand]);
  const nameOf = (id: string) => restaurants.find(r => r.id === id)?.name ?? "";
  return <div>
    {brand && <div className="library-switch mb-4" aria-label="Which reports">
      <button type="button" aria-pressed={scope === "location"} onClick={() => setScope("location")}>{restaurant.name}</button>
      <button type="button" aria-pressed={scope === "brand"} onClick={() => setScope("brand")}>All {brand.name} locations</button>
    </div>}
    {error ? <p className="panel p-5 muted">{error.includes("shift_report") ? "Shift reports need database update 038." : error}</p>
      : !reports ? <p className="muted" role="status">Loading…</p>
      : !reports.length ? <p className="panel p-5 muted">No reports yet. The first one appears here after tonight's service.</p>
      : <ul className="space-y-2">{reports.map(report => {
        const expanded = open === report.id;
        const facts = [MOODS[report.mood], report.covers !== null ? `${report.covers} covers` : "", money(report.sales) ?? "", report.issues.length ? `${report.issues.length} ${report.issues.length === 1 ? "issue" : "issues"}` : ""].filter(Boolean);
        return <li key={report.id} className="panel report-card">
          <button type="button" className="report-head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : report.id)}>
            <span className="min-w-0 flex-1">
              <b>{serviceDay(report.service_date)} · {report.label}{scope === "brand" ? ` · ${nameOf(report.restaurant_id)}` : ""}</b>
              <small>{facts.join(" · ")}</small>
            </span>
            {report.urgent && <span className="report-urgent">Urgent</span>}
          </button>
          {expanded && <ReportBody report={report} />}
        </li>;
      })}</ul>}
  </div>;
}

function ReportBody({report}: {report: ShiftReport}) {
  const sections: [string, string[]][] = [
    ["Issues", report.issues.map(i => `${ISSUE_KINDS[i.kind]}: ${i.note || "no details"}`)],
    ["From HEAT", heatLines(report.from_heat)],
    ["Low stock / to order", report.low_stock ? [report.low_stock] : []],
    ["Shout-outs", report.shoutouts ? [report.shoutouts] : []],
    ["For the next shift", report.next_shift ? [report.next_shift] : []],
    ["Notes", report.notes ? [report.notes] : []],
  ];
  const filled = sections.filter(([, lines]) => lines.length);
  return <div className="report-body">
    {filled.length ? filled.map(([title, lines]) => <div key={title}>
      <p className="eyebrow muted">{title}</p>
      <ul className="report-lines">{lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
    </div>) : <p className="muted text-sm">Nothing else was added to this report.</p>}
  </div>;
}

function Recipients({restaurant}: {restaurant: Restaurant}) {
  const [emails, setEmails] = useState<string[] | null>(null);
  const [error, setError] = useState("");
  const load = async () => {
    const {data, error} = await supabase!.from("shift_report_recipients").select("email").eq("restaurant_id", restaurant.id).order("email");
    if (error) setError(error.message); else setEmails((data ?? []).map(r => r.email as string));
  };
  useEffect(() => {void load();}, [restaurant.id]); // eslint-disable-line react-hooks/exhaustive-deps
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const email = String(new FormData(form).get("recipient") ?? "").trim().toLowerCase();
    setError("");
    const {error} = await supabase!.from("shift_report_recipients").insert({restaurant_id: restaurant.id, email});
    if (error) return setError(error.code === "23505" ? "That address is already on the list." : error.code === "23514" ? "That doesn't look like an email address." : error.message);
    form.reset();
    await load();
  }
  async function remove(email: string) {
    const {error} = await supabase!.from("shift_report_recipients").delete().eq("restaurant_id", restaurant.id).eq("email", email);
    if (error) setError(error.message); else await load();
  }
  return <div className="panel dash-panel">
    <SectionInfo heading="Who gets the report">Everyone who manages {restaurant.name} in HEAT gets it automatically: the owner, the brand owner, and anyone with Pre-shift or Team access. Add anyone else here, like an owner who doesn't use HEAT.</SectionInfo>
    {error && <p role="alert" className="notice bad mt-3">{error}</p>}
    {emails && emails.length > 0 && <ul className="report-recipients">{emails.map(email => <li key={email}>
      <span className="min-w-0 flex-1">{email}</span>
      <button type="button" className="muted" aria-label={`Remove ${email}`} onClick={() => void remove(email)}><X size={16} /></button>
    </li>)}</ul>}
    <form className="mt-4 flex gap-2" onSubmit={add}>
      <label htmlFor="report-recipient" className="sr-only">Email address</label>
      <input id="report-recipient" name="recipient" type="email" required maxLength={254} placeholder="name@restaurant.com" />
      <button className="btn">Add</button>
    </form>
  </div>;
}

// On the manager's home: what the last shift left for this one. Shown for two days, then it's old news.
export function LastShiftNote({restaurantId, onOpen}: {restaurantId: string; onOpen: () => void}) {
  const [report, setReport] = useState<Pick<ShiftReport, "service_date" | "label" | "next_shift" | "urgent"> | null>(null);
  useEffect(() => {
    let live = true;
    const since = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
    void supabase!.from("shift_reports").select("service_date,label,next_shift,urgent").eq("restaurant_id", restaurantId)
      .gte("service_date", since).neq("next_shift", "").order("service_date", {ascending: false}).order("submitted_at", {ascending: false}).limit(1)
      .then(({data}) => {if (live) setReport((data?.[0] as typeof report) ?? null);});
    return () => {live = false;};
  }, [restaurantId]);
  if (!report) return null;
  return <button type="button" className="panel report-handover" onClick={onOpen}>
    <span className="eyebrow muted">From the last shift · {serviceDay(report.service_date)} {report.label}{report.urgent ? " · Urgent report" : ""}</span>
    <span className="mt-1 block text-sm">{report.next_shift}</span>
  </button>;
}
