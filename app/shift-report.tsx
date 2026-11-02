"use client";
// The end-of-shift report: what used to be a free-text message to the GM, operations manager,
// managers and owners. HEAT fills in what it already knows; the manager adds the night in a few taps,
// and submitting saves it here and emails it (see app/api/shift-report/route.ts).
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Check, ChevronDown, Pencil, Plus, Trash2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { Restaurant } from "@/lib/menu";
import { ISSUE_KINDS, MOODS, SERVICES, URGENT_KINDS, heatLines, money, serviceDate, serviceDay, type FromHeat, type IssueKind, type Mood, type ShiftReport } from "@/lib/shift-report";
import type { Organization } from "./locations";
import { shiftReportSheet } from "@/lib/sheets";
import { Field, SectionInfo } from "./ui";
import { notify } from "./notifications";
import { DownloadSheet } from "./sheet-download";

type Tab = "tonight" | "past" | "recipients";

export function ShiftReports({restaurant, restaurants, brand, ownsBrand, canWrite, canManageRecipients, setMessage, initialTab}: {
  initialTab?: Tab;
  restaurant: Restaurant;
  restaurants: Restaurant[];
  brand?: Organization;
  ownsBrand: boolean;
  canWrite: boolean;
  canManageRecipients: boolean;
  setMessage: (text: string) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? (canWrite ? "tonight" : "past"));
  const tabs: [Tab, string][] = [
    ...(canWrite ? [["tonight", "Tonight's report"] as [Tab, string]] : []),
    ["past", "Past reports"],
    ...(canManageRecipients ? [["recipients", "Who gets it"] as [Tab, string]] : []),
  ];
  return <section className="mx-auto max-w-3xl">
    <p className="eyebrow muted">{`Shift report · ${restaurant.name}`}</p>
    <h1 className="mt-3 mb-5 text-2xl font-semibold">End of shift</h1>
    {tabs.length > 1 && <div className="library-switch report-switch mb-5" aria-label="Shift report">
      {tabs.map(([key, label]) => <button key={key} type="button" aria-pressed={tab === key} onClick={() => setTab(key)}>{label}</button>)}
    </div>}
    {tab === "tonight" && <TonightReport restaurant={restaurant} setMessage={setMessage} onSent={() => setTab("past")} />}
    {tab === "past" && <PastReports restaurant={restaurant} restaurants={restaurants} brand={ownsBrand ? brand : undefined} canEdit={canWrite || canManageRecipients} canDeleteAny={canManageRecipients} canWrite={canWrite} setMessage={setMessage} />}
    {tab === "recipients" && <Recipients restaurant={restaurant} />}
  </section>;
}

// Lunch before four in the afternoon, dinner after: the usual answer, changeable in one tap.
const likelyService = () => new Date().getHours() < 16 ? "Lunch" : "Dinner";

// What a manager types into a report: the same fields for tonight's and for correcting a past one.
type ReportValues = {label: string; mood: Mood | ""; covers: string; sales: string; issues: {kind: IssueKind; note: string}[]; low_stock: string; shoutouts: string; next_shift: string; notes: string};
const emptyReport = (): ReportValues => ({label: likelyService(), mood: "", covers: "", sales: "", issues: [], low_stock: "", shoutouts: "", next_shift: "", notes: ""});
const valuesOf = (report: ShiftReport): ReportValues => ({
  label: report.label, mood: report.mood, covers: report.covers === null ? "" : String(report.covers), sales: report.sales === null ? "" : String(report.sales),
  issues: report.issues.map(i => ({kind: i.kind, note: i.note})), low_stock: report.low_stock, shoutouts: report.shoutouts, next_shift: report.next_shift, notes: report.notes,
});
const payload = (v: ReportValues) => ({
  label: v.label, mood: v.mood, covers: v.covers.trim(), sales: v.sales.trim(),
  issues: v.issues.map(i => ({kind: i.kind, note: i.note.trim()})),
  low_stock: v.low_stock.trim(), shoutouts: v.shoutouts.trim(), next_shift: v.next_shift.trim(), notes: v.notes.trim(),
});

function ReportForm({initial, before, busy, error, submitText, footer, onSubmit, onCancel}: {
  initial: ReportValues; before?: ReactNode; busy: boolean; error: string; submitText: (label: string) => string; footer?: string;
  onSubmit: (values: ReportValues) => void; onCancel?: () => void;
}) {
  const [v, setV] = useState<ReportValues>(initial);
  const set = (change: Partial<ReportValues>) => setV(current => ({...current, ...change}));
  const services = SERVICES.includes(v.label as typeof SERVICES[number]) ? SERVICES : [v.label, ...SERVICES];
  // Optional notes start as "+" buttons (like the flags above) and open into a field; a field that already has text stays open.
  const optional = [
    {key: "low_stock" as const, label: "Low stock / to order", id: "report-low", rows: 2, max: 1000, hint: "e.g. Uni, yuzu, Albariño"},
    {key: "shoutouts" as const, label: "Shout-outs", id: "report-shout", rows: 2, max: 1000, hint: "Who did great today"},
    {key: "notes" as const, label: "Anything else", id: "report-notes", rows: 4, max: 4000, hint: "Write it the way you always have"},
  ];
  const [open, setOpen] = useState({low_stock: initial.low_stock !== "", shoutouts: initial.shoutouts !== "", notes: initial.notes !== ""});
  return <form onSubmit={event => {event.preventDefault(); onSubmit(v);}}>
    {before}
    <div className="panel dash-panel">
      <div className="report-service">
        <p className="report-label">Service</p>
        <div className="category-tabs" role="radiogroup" aria-label="Service">{services.map(s => <button key={s} type="button" role="radio" aria-checked={v.label === s} aria-pressed={v.label === s} onClick={() => set({label: s})}>{s}</button>)}</div>
      </div>
      <div className="report-row report-row-2">
        <Field label="Covers"><input id="report-covers" type="number" inputMode="numeric" min={0} max={100000} placeholder="e.g. 180" value={v.covers} onChange={e => set({covers: e.target.value})} /></Field>
        <Field label="Sales (optional)"><input id="report-sales" type="number" inputMode="decimal" min={0} step="0.01" placeholder="e.g. 14250" value={v.sales} onChange={e => set({sales: e.target.value})} /></Field>
      </div>
      <p className="report-label">How did the service go?</p>
      <div className="library-switch report-switch" role="radiogroup" aria-label="How did the service go?">
        {(Object.keys(MOODS) as Mood[]).map(key => <button key={key} type="button" role="radio" aria-checked={v.mood === key} aria-pressed={v.mood === key} onClick={() => set({mood: key})}>{MOODS[key]}</button>)}
      </div>
    </div>

    <div className="panel dash-panel">
      <SectionInfo heading="Anything to flag?">Tap what happened and add a line. Allergy incidents and injuries mark the report urgent.</SectionInfo>
      <div className="report-chips report-flags">{(Object.keys(ISSUE_KINDS) as IssueKind[]).map(kind => { const on = v.issues.some(issue => issue.kind === kind); return <button key={kind} type="button" className={`btn secondary${on ? " report-flag-on" : ""}`} aria-pressed={on} onClick={() => set({issues: [...v.issues, {kind, note: ""}]})}>{on ? <Check size={14} /> : <Plus size={14} />}{kind === "complaint" ? "Guest complaint" : ISSUE_KINDS[kind]}</button>; })}</div>
      {v.issues.map((issue, index) => <div key={index} className="report-issue">
        <div className="flex items-center gap-2">
          <b className="text-sm">{ISSUE_KINDS[issue.kind]}</b>
          {URGENT_KINDS.includes(issue.kind) && <span className="report-urgent">Urgent</span>}
          <button type="button" className="ml-auto muted" aria-label={`Remove ${ISSUE_KINDS[issue.kind]}`} onClick={() => set({issues: v.issues.filter((_, i) => i !== index)})}><X size={16} /></button>
        </div>
        <textarea aria-label={`${ISSUE_KINDS[issue.kind]}: what happened`} rows={2} maxLength={1000} value={issue.note} placeholder="What happened, and what you did about it"
          onChange={e => set({issues: v.issues.map((item, i) => i === index ? {...item, note: e.target.value} : item)})} />
      </div>)}
    </div>

    <div className="panel dash-panel">
      <Field label="For the next shift"><textarea id="report-next" rows={3} maxLength={1000} placeholder="What the opening manager needs to know" value={v.next_shift} onChange={e => set({next_shift: e.target.value})} /></Field>
      <div className="report-folds">{optional.map(n => <div key={n.key} className="report-fold">
        <button type="button" className="report-fold-head" aria-expanded={open[n.key]} aria-controls={n.id} onClick={() => setOpen(current => ({...current, [n.key]: !current[n.key]}))}><span>{n.label}</span><ChevronDown size={18} aria-hidden="true" /></button>
        {open[n.key] && <textarea id={n.id} aria-label={n.label} rows={n.rows} maxLength={n.max} placeholder={n.hint} value={v[n.key]} onChange={e => set(n.key === "low_stock" ? {low_stock: e.target.value} : n.key === "shoutouts" ? {shoutouts: e.target.value} : {notes: e.target.value})} />}
      </div>)}</div>
    </div>

    {error && <p role="alert" className="notice bad mb-4">{error}</p>}
    <div className="flex gap-2">
      <button className="btn flex-1" disabled={busy}>{busy ? "Saving…" : submitText(v.label)}</button>
      {onCancel && <button type="button" className="btn secondary" disabled={busy} onClick={onCancel}>Cancel</button>}
    </div>
    {footer && <p className="muted mt-3 text-center text-xs">{footer}</p>}
  </form>;
}

function TonightReport({restaurant, setMessage, onSent}: {restaurant: Restaurant; setMessage: (text: string) => void; onSent: () => void}) {
  const [draft, setDraft] = useState<FromHeat | null>(null);
  const [draftError, setDraftError] = useState("");
  const [day] = useState(serviceDate);
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

  async function submit(v: ReportValues) {
    if (!v.mood) return setError("Choose how the night went.");
    setBusy(true); setError("");
    try {
      const saved = await supabase!.rpc("submit_shift_report", {rid: restaurant.id, report: {service_date: day, ...payload(v)}});
      if (saved.error) throw new Error(saved.error.message);
      // An allergy incident or an injury reaches managers' phones right away, not just their inbox.
      if (v.issues.some(issue => URGENT_KINDS.includes(issue.kind))) notify("urgent_report", saved.data as string);
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
  return <ReportForm initial={emptyReport()} busy={busy} error={error} onSubmit={v => void submit(v)}
    submitText={() => "Submit report"}
    footer={`Goes to the owners and everyone who manages ${restaurant.name}. Sending again tonight replaces it.`}
    before={<div className="panel dash-panel">
      <SectionInfo heading="Already in HEAT tonight">Taken from tonight's pre-shift, checklists and quizzes when you submit. Nothing to type.</SectionInfo>
      {draftError ? <p className="muted mt-3">{draftError}</p>
        : !draft ? <p className="muted mt-3" role="status">Loading…</p>
        : known.length ? <ul className="report-lines">{known.map(line => <li key={line}>{line}</li>)}</ul>
        : <p className="muted mt-3">No pre-shift, checklists or quizzes recorded today.</p>}
    </div>} />;
}

// "Oct 21, 10:14 AM": when a report was last changed.
const stamp = (iso: string) => new Date(iso).toLocaleString("en-US", {month: "short", day: "numeric", hour: "numeric", minute: "2-digit"});

function PastReports({restaurant, restaurants, brand, canEdit, canDeleteAny, canWrite, setMessage}: {
  restaurant: Restaurant; restaurants: Restaurant[]; brand?: Organization; canEdit: boolean; canDeleteAny: boolean; canWrite: boolean; setMessage: (text: string) => void;
}) {
  const [scope, setScope] = useState<"location" | "brand">("location");
  const [reports, setReports] = useState<ShiftReport[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [me, setMe] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => { void supabase!.auth.getUser().then(({data}) => setMe(data.user?.id ?? "")); }, []);
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
  }, [restaurant.id, scope, brand, reload]);
  const nameOf = (id: string) => restaurants.find(r => r.id === id)?.name ?? "";
  return <div>
    {brand && <div className="library-switch report-switch mb-4" aria-label="Which reports">
      <button type="button" aria-pressed={scope === "location"} onClick={() => setScope("location")}>{restaurant.name}</button>
      <button type="button" aria-pressed={scope === "brand"} onClick={() => setScope("brand")}>All {brand.name} locations</button>
    </div>}
    {error ? <p className="panel p-5 muted">{error.includes("shift_report") ? "Shift reports need database update 038." : error}</p>
      : !reports ? <p className="muted" role="status">Loading…</p>
      : !reports.length ? <p className="panel p-5 muted">No reports yet. The first one appears here after tonight's service.</p>
      : <ul className="space-y-2">{reports.map(report => {
        const expanded = open === report.id;
        const facts = [MOODS[report.mood], report.covers !== null ? `${report.covers} covers` : "", money(report.sales) ?? "", report.issues.length ? `${report.issues.length} ${report.issues.length === 1 ? "issue" : "issues"}` : ""].filter(Boolean);
        const here = report.restaurant_id === restaurant.id;
        if (editing === report.id) return <li key={report.id}><EditReport report={report} onCancel={() => setEditing(null)} onSaved={message => {setEditing(null);setMessage(message);setReload(n => n + 1);}} /></li>;
        return <li key={report.id} className="panel report-card">
          <button type="button" className="report-head" aria-expanded={expanded} onClick={() => setOpen(expanded ? null : report.id)}>
            <span className="min-w-0 flex-1">
              <b>{serviceDay(report.service_date)} · {report.label}{scope === "brand" ? ` · ${nameOf(report.restaurant_id)}` : ""}</b>
              <small>{facts.join(" · ")}</small>
            </span>
            {report.urgent && <span className="report-urgent">Urgent</span>}
          </button>
          {expanded && <ReportBody report={report} restaurantName={nameOf(report.restaurant_id) || restaurant.name}
            canEdit={here && canEdit} canDelete={here && (canDeleteAny || (canWrite && report.submitted_by === me))}
            onEdit={() => setEditing(report.id)}
            onDeleted={() => {setOpen(null);setMessage("Report deleted.");setReload(n => n + 1);}} />}
        </li>;
      })}</ul>}
  </div>;
}

function ReportBody({report, restaurantName, canEdit, canDelete, onEdit, onDeleted}: {
  report: ShiftReport; restaurantName: string; canEdit: boolean; canDelete: boolean; onEdit: () => void; onDeleted: () => void;
}) {
  const [names, setNames] = useState<{written_by: string; changed_by: string | null} | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    void supabase!.rpc("shift_report_names", {report_id: report.id}).then(({data}) => {
      if (live) setNames(((data ?? []) as {written_by: string; changed_by: string | null}[])[0] ?? null);
    });
    return () => {live = false;};
  }, [report.id, report.updated_at]);
  async function remove() {
    setBusy(true); setError("");
    const {error} = await supabase!.rpc("delete_shift_report", {report_id: report.id});
    setBusy(false);
    if (error) return setError(error.message.includes("delete_shift_report") ? "Deleting reports needs database update 046." : error.message);
    onDeleted();
  }
  const print = async () => shiftReportSheet({
    serviceDate: report.service_date, day: serviceDay(report.service_date), label: report.label, urgent: report.urgent,
    mood: MOODS[report.mood], covers: report.covers === null ? "" : String(report.covers), sales: money(report.sales) ?? "",
    issues: report.issues.map(i => ({kind: ISSUE_KINDS[i.kind], note: i.note, urgent: URGENT_KINDS.includes(i.kind)})),
    fromHeat: heatLines(report.from_heat), lowStock: report.low_stock, shoutouts: report.shoutouts, nextShift: report.next_shift, notes: report.notes,
    writtenBy: names?.written_by ?? "Team member", changedBy: names?.changed_by ?? null, changedAt: report.updated_at ? stamp(report.updated_at) : null,
    updated: report.updated_at ?? report.submitted_at,
  }, {restaurant: restaurantName});
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
    {names && <p className="muted text-xs">{`Written by ${names.written_by}`}{names.changed_by && report.updated_at ? ` · ${`Last changed by ${names.changed_by}, ${stamp(report.updated_at)}`}` : ""}</p>}
    {filled.length ? filled.map(([title, lines]) => <div key={title}>
      <p className="eyebrow muted">{title}</p>
      <ul className="report-lines">{lines.map((line, i) => <li key={i}>{line}</li>)}</ul>
    </div>) : <p className="muted text-sm">Nothing else was added to this report.</p>}
    <div className="report-actions">
      <DownloadSheet variant="button" buttonLabel="Print" busyLabel="Preparing the report" label="Download this report to print" build={print} />
      {canEdit && <button type="button" className="btn secondary" onClick={onEdit}><Pencil size={15} />Edit</button>}
      {canDelete && !confirming && <button type="button" className="btn secondary" onClick={() => setConfirming(true)}><Trash2 size={15} />Delete</button>}
    </div>
    {confirming && <div className="report-confirm" role="alert">
      <p className="text-sm">Delete this report for good? It can't be brought back.</p>
      <div className="mt-2 flex gap-2">
        <button type="button" className="btn" disabled={busy} onClick={() => void remove()}>{busy ? "Deleting…" : "Yes, delete"}</button>
        <button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirming(false)}>Keep</button>
      </div>
    </div>}
    {error && <p role="alert" className="verdict-bad mt-2 text-sm">{error}</p>}
  </div>;
}

// Correcting a past report. What HEAT recorded at the time stays as it was.
function EditReport({report, onCancel, onSaved}: {report: ShiftReport; onCancel: () => void; onSaved: (message: string) => void}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(v: ReportValues) {
    if (!v.mood) return setError("Choose how the night went.");
    setBusy(true); setError("");
    const {data, error} = await supabase!.rpc("update_shift_report", {report_id: report.id, report: payload(v)});
    setBusy(false);
    if (error) return setError(error.message.includes("update_shift_report") ? "Editing reports needs database update 046." : error.message);
    // Newly urgent: managers' phones hear about it now, as they would have on the night.
    if (data && !report.urgent) notify("urgent_report", report.id);
    onSaved("Report updated. It now shows you as the last to change it.");
  }
  return <div className="report-edit">
    <p className="eyebrow muted mb-2">{`Editing · ${serviceDay(report.service_date)} · ${report.label}`}</p>
    <ReportForm initial={valuesOf(report)} busy={busy} error={error} onSubmit={v => void save(v)} onCancel={onCancel} submitText={() => "Save changes"}
      footer="What HEAT recorded that night (86 list, checklists, who was on the floor) stays as it was." />
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
