"use client";
import { learningStatus } from '@/lib/learning';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type TouchEvent,
  type ReactNode,
} from "react";
import { HeatLogo, HeatIcon } from "./heat-logo";
import type { User } from "@supabase/supabase-js";
import {
  ChevronDown,
  RotateCcw,
  BarChart3,
  LayoutDashboard,
  CircleHelp,
  FileText,
  CalendarDays,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Check,
  ClipboardList,
  ImagePlus,
  Home as HomeIcon,
  Menu,
  Search,
  LogOut,
  Pencil,
  Plus,
  ShieldCheck,
  ShieldAlert,
  SlidersHorizontal,
  Languages,
  ListChecks,
  Store,
  Utensils,
  Users,
  X,
} from "lucide-react";
import { allergenBadge, serviceSummary, dishDescription, composeDishDescription } from "@/lib/menu-summary";
import { EmployeeHome, SHIFT_STATUS_LABELS, shiftAge, type ShiftBoardEntry, type ShiftBoardResponse } from "./employee-home";
import { QuizPanel, QuizEditor, RetakeRequests, RecentCompletions, CompletionDot, CompletionLine, LearningProgress, type Completion, type ProgressRow } from "./quiz";
import { assessAllergies, assessAllergy, menuAllergies, type AllergyResult } from "@/lib/allergies";
import { detailEntries, detailFields, detailsFromForm, timeLabel } from "@/lib/detail-fields";
import { cardEntries, detailsToSave, hiddenCore, type CardFieldRow } from "@/lib/card-fields";
import { CardFieldInputs, CardRowsContext, CoreField, useCardRows } from "./card-fields-editor";
import { DownloadSheet, loadPhoto } from "./sheet-download";
import { dishCard, allergySheet, preshiftSheet, employeeSheet } from "@/lib/sheets";
import { termsFor, mergeTerms, type Term, type CustomTerm } from "@/lib/glossary";
import { CONTENT_TYPES, categoryOf, contentTypeOf, filterContent, type ContentType } from "@/lib/categories";
import { TaxonomyContext, useTaxonomy, namesIn, wordsIn, type SectionWords, type MenuCategoryRow, type Taxonomy } from "./taxonomy";
import { Notice, Field, InfoRow, ScreenHeader, SectionInfo } from "./ui";
import { AssignDishes } from "./assign-dishes";
import { TodayFigures, TodayStatus } from "./today";
import { photoLinks, shrinkPhoto, forgetPhotoLinks } from "./photos";
import { WordsManager } from "./words";
import { Standards } from "./standards";
import { Story } from "./story";
import { Checklists } from "./checklists";
import { Locations, setUpLibraries, type Organization } from "./locations";
import { BrandDashboard, ManagerDashboard, MyActivity } from "./dashboards";
import { Tour, tourSeen, tourSteps } from "./tour";
import { LastShiftNote, ShiftReports } from "./shift-report";
import { LanguageSwitch, currentLang, setLang } from "./language";
import { NotificationSwitch, notify } from "./notifications";
import { MyWeek, NextShift, Schedule, ShiftChangesWaiting, TodayRoster, type ScheduleTab } from "./schedule";
import { FOH_POSITIONS, KITCHEN_POSITIONS, POSITIONS } from "@/lib/schedule";
import { ManagerAttention, type AttentionTarget } from "./home-cards";

// Every screen the workspace can show. Named once: it used to be spelled out in two places.
type View = "tostudy" | "home" | "library" | "allergy" | "review" | "progress" | "team" | "preshift" | "words" | "standards" | "story" | "library-settings" | "checklists" | "locations" | "dashboard" | "reports" | "schedule";
import { supabase } from "@/lib/supabase";
import {
  expandCrossContamination,
  listFromText,
  validatePhoto,
  type MenuItem,
  type Restaurant,
} from "@/lib/menu";

// What was picked on the Allergy screen. It lives one level up so that opening a dish from a result and coming back leaves the same allergies selected.
type AllergyMemory = {allergies: string[]; filter: string; type: ContentType};
const ALLERGY_START: AllergyMemory = {allergies: [], filter: "all", type: "food"};
function AllergyView({items, loading, refresh, shift, restaurantName, memory, onMemory, onOpen}: {items: MenuItem[]; loading: boolean; refresh: () => Promise<void>; shift: Record<string, ShiftBoardEntry>; restaurantName: string; memory: AllergyMemory; onMemory: (next: (current: AllergyMemory) => AllergyMemory) => void; onOpen: (item: MenuItem) => void}) {
  const selectedAllergies = memory.allergies;
  const resultFilter = memory.filter;
  const contentType = memory.type;
  const setSelectedAllergies = (next: string[] | ((current: string[]) => string[])) => onMemory(current => ({...current, allergies: typeof next === "function" ? next(current.allergies) : next}));
  const setResultFilter = (filter: string) => onMemory(current => ({...current, filter}));
  const setContentType = (type: ContentType) => onMemory(current => ({...current, type}));
  const cardRows = useCardRows();
  const menuItems = items.filter(item => contentTypeOf(item) === contentType);
  const options = menuAllergies(menuItems);
  const allergies = selectedAllergies.filter(allergy => options.includes(allergy));
  // Results follow the restaurant's own section order, not the order the database returns.
  const {namesFor, labelFor} = useTaxonomy();
  const allergyOrder = namesFor(contentType);
  const results = allergies.length
    ? menuItems.slice().sort((a, b) => allergyOrder.indexOf(categoryOf(a)) - allergyOrder.indexOf(categoryOf(b))).map(item => ({item, ...assessAllergies(item, allergies)}))
    : [];
  // Every verdict the allergy check can return needs a section here. The map is keyed by the
  // verdict itself, so a new verdict cannot be added without a section, and none can fall through.
  const groupsByStatus: Record<AllergyResult["status"], {title: string; detail: string; color: string; mark: string}> = {
    "no-match": {title: "No allergen found", detail: "These are candidates to discuss with the kitchen, not confirmed safe items. Check all ingredients, sauces, substitutions, and preparation before offering.", color: "var(--c-good)", mark: "\u2713"},
    "avoid": {title: "Do not offer", detail: "A matching note, cross-contamination risk, or possible recipe source is recorded. Do not offer this item for any of the selected allergies.", color: "var(--c-danger)", mark: "\u2717"},
    "cross-contact": {title: "Cross-contamination risk — confirm with the kitchen", detail: "Shared equipment or preparation is recorded for a selected allergy. The allergen is not a recorded ingredient, but contact is possible. Do not offer without checking with the kitchen first.", color: "var(--c-gold)", mark: "!"},
    "unknown": {title: "Needs kitchen review", detail: "Information is incomplete. Do not recommend these items until the kitchen checks them.", color: "var(--c-warning)", mark: "?"},
  };
  const groups = (Object.keys(groupsByStatus) as AllergyResult["status"][]).map(status => ({status, ...groupsByStatus[status]}));
  return <section>
    <ScreenHeader
      inlineAction
      eyebrow="Guest allergy check"
      title="Allergy"
      info="Choose food, cocktails or wine & sake, then select all of the guest’s allergies. This checks recorded notes only — always confirm with the kitchen before offering."
      action={<>{!!allergies.length && <DownloadSheet label="Download this allergy sheet" build={async () => allergySheet({allergies, items: menuItems}, {restaurant: restaurantName})} />}<button type="button" className="icon-chip" aria-label="Refresh allergen information" title="Refresh" onClick={() => void refresh()} disabled={loading}><RotateCcw size={15} /></button></>}
    />
    <div className="library-switch mb-4" aria-label="Content type">{CONTENT_TYPES.map(type => <button key={type} type="button" aria-pressed={contentType === type} onClick={() => {if (type !== contentType) {setContentType(type);setSelectedAllergies([]);setResultFilter("all");}}}>{labelFor(type).name}</button>)}</div>
    {loading ? <p role="status" className="muted py-8">Loading allergen information…</p> : <>
      <fieldset className="panel allergy-picker p-5"><legend className="font-semibold">Allergens and dietary flags in this menu</legend><p className="muted mb-4 text-sm">Select as many as needed. Tap a selected allergy again to remove it.</p><div className="allergy-choices">{options.map(option => <button key={option} type="button" aria-pressed={allergies.includes(option)} className={`allergy-choice ${allergies.includes(option) ? "selected" : ""}`} onClick={() => {setSelectedAllergies(current => current.includes(option) ? current.filter(value => value !== option) : [...current, option]);setResultFilter("all");}}>{option}</button>)}</div>{allergies.length > 0 && <button type="button" className="btn secondary mt-4" onClick={() => {setSelectedAllergies([]);setResultFilter("all");}}>Clear selections ({allergies.length})</button>}{!options.length && <p className="muted">No allergen information is available. Ask the manager to complete the menu records.</p>}</fieldset>
      {!allergies.length ? <p className="muted py-8">{`Choose one or more allergies above to see ${labelFor(contentType).item_many} results.`}</p> : <>
        <div className="my-7" aria-live="polite"><InfoRow info={<>{results.filter(r => r.status === "avoid").length} do not offer · {results.filter(r => r.status === "cross-contact").length} cross-contamination risk · {results.filter(r => r.status === "unknown").length} need review · {results.filter(r => r.status === "no-match").length} with no allergen found</>}><h2 className="text-xl font-semibold">{allergies.join(" + ")} · {results.length} {labelFor(contentType).item_many} checked</h2></InfoRow></div>
        <label htmlFor="allergy-result-filter">Show results</label><select className="mb-7" id="allergy-result-filter" value={resultFilter} onChange={e => setResultFilter(e.target.value)}><option value="all">All results</option>{groups.map(g => <option key={g.status} value={g.status}>{g.title} ({results.filter(r=>r.status===g.status).length})</option>)}</select>
        {groups.filter(g => resultFilter === "all" || resultFilter === g.status).map(group => <section className="mb-9" key={group.status} aria-label={group.title}>
          <InfoRow info={group.detail} className="mb-4"><h3 className="text-lg font-semibold" style={{color:group.color}}>{group.title} ({results.filter(r=>r.status===group.status).length})</h3></InfoRow>
          <div className="menu-list grid items-start gap-2">{results.filter(r=>r.status===group.status).map(({item,reasons}) => <button type="button" key={item.id} className={`panel compact-menu-row allergy-row is-${group.status} w-full text-left`} onClick={() => onOpen(item)}>
            {item.photo_url ? <img src={item.photo_url} alt="" loading="lazy" decoding="async" className="h-12 w-12 shrink-0 rounded-lg object-cover"/> : <BookOpen size={24} className="muted shrink-0"/>}
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.name}</span><ShiftFlag entry={shift[item.id]} /><span className="muted mt-1 block text-xs uppercase tracking-wider">{categoryOf(item)}{summaryFor(item, cardRows) && ` · ${summaryFor(item, cardRows)}`}</span></span>
            <span className="menu-side"><span className="menu-badges" aria-label="Recorded allergen notes">{badgeCodes(item.allergens).slice(0,3).map((badge,index)=><span key={index} className={`menu-badge ${badge.cc?'cc':''}`} title={badge.text} aria-label={badge.text}>{badge.code}</span>)}{badgeCodes(item.allergens).length>3&&<span className="muted text-xs">+{badgeCodes(item.allergens).length-3}</span>}{!item.allergens.length&&<span className="menu-badge unknown" title="Allergen information not yet provided" aria-label="Allergen information not yet provided">?</span>}</span><span className={`allergy-mark is-${group.status}`} role="img" aria-label={group.title} title={group.title}>{group.mark}</span></span>
            {group.status !== "no-match" && !!reasons.length && <span className="allergy-reason">{reasons.map((reason,i) => <span key={i} className="block">{expandCrossContamination(reason)}</span>)}</span>}
          </button>)}</div>
          {!results.some(r=>r.status===group.status) && <p className="muted text-sm">No items in this group.</p>}
        </section>)}
      </>}
    </>}
  </section>;
}

function Brand() {
  return (
    <a
      href="/app"
      className="inline-flex items-center gap-2 text-2xl font-black tracking-tighter"
      aria-label="HEAT home"
    >
      <HeatLogo />
    </a>
  );
}
// The owner's reminder of where their trial stands. Counted in whole days, rounded up, so the last day reads "1 day left".
function trialLabel(endsAt: string) {
  const days = Math.ceil((new Date(endsAt).getTime() - Date.now()) / 86_400_000);
  return days > 0 ? `Free trial · ${days} ${days === 1 ? "day" : "days"} left` : "Your free trial has ended · Contact HEAT to keep your restaurant";
}
function Auth({ invitation, trial }: { invitation: string; trial: boolean }) {
  // A trial visitor came from "Start free trial": they are setting up a restaurant, so they start on the sign-up form.
  const [signup, setSignup] = useState(trial && !invitation);
  const [forgot, setForgot] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    const data = new FormData(event.currentTarget);
    const credentials = {
      email: String(data.get("email")).trim(),
      password: String(data.get("password")),
    };
    try {
      // Forgotten password: Supabase emails a link that brings them back to set a new one.
      if (forgot) {
        const reset = await supabase.auth.resetPasswordForEmail(credentials.email, { redirectTo: `${window.location.origin}/app?reset=1` });
        if (reset.error) throw reset.error;
        setMessage("If there's a HEAT account for that email, a reset link is on its way. Check your inbox and spam folder.");
        return;
      }
      const result = signup
        ? await supabase.auth.signUp({
            ...credentials,
            options: {
              data: {
                display_name: String(data.get("display-name") || "").trim(),
                onboarding_role: invitation
                  ? "employee"
                  : trial || data.get("account-role") === "manager"
                    ? "manager"
                    : "employee",
              },
              emailRedirectTo:
                window.location.origin +
                (invitation
                  ? `/app?invite=${encodeURIComponent(invitation)}`
                  : trial ? "/app?start=trial" : "/app"),
            },
          })
        : await supabase.auth.signInWithPassword(credentials);
      if (result.error) throw result.error;
      if (signup && !result.data.session)
        setMessage(
          "Check your email to confirm your account, then come back here to sign in. If you already have an account, sign in instead.",
        );
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Unable to sign in. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      <aside className="brand-aside relative flex flex-col justify-between p-7 text-white lg:min-h-screen lg:p-14">
        <Brand />
        <div className="my-12 hidden max-w-lg lg:my-24 lg:block">
          <p className="eyebrow mb-5 text-[#a4a49f]">Ready for service</p>
          <h1 className="text-2xl leading-[1.05] font-semibold tracking-tight lg:text-7xl">
            Great service
            <br />
            starts with
            <br />
            <span className="text-[#8f8f8a]">knowing the menu.</span>
          </h1>
          <p className="mt-6 max-w-sm text-lg text-white/75">
            Your dishes, ingredients, and allergens.
            <br />
            One place for the whole team.
          </p>
        </div>
        <div className="hidden items-center gap-3 border-t border-white/20 pt-6 text-sm text-white/75 lg:flex">
          <Utensils size={19} /> Built around the people on the floor.
        </div>
      </aside>
      <main className="flex items-center justify-center px-6 py-12 lg:p-14">
        <div className="w-full max-w-md enter">
          <div className="mb-6 flex justify-end"><div className="w-28"><LanguageSwitch compact /></div></div>
          <div className="mb-7 inline-flex rounded-2xl bg-surface p-4 text-heat shadow-sm">
            <HeatIcon />
          </div>
          <p className="eyebrow muted mb-3">
            {invitation ? "Your team is waiting" : trial ? "14-day free trial" : "Your menu workspace"}
          </p>
          <h2 className="text-2xl font-semibold tracking-tight">
            {forgot ? "Reset your password" : trial && signup ? "Start your free trial" : signup ? "Create your account" : "Welcome to HEAT"}
          </h2>
          <p className="muted mt-3 mb-8">
            {invitation
              ? "Sign in or create an account to join your restaurant."
              : trial
                ? "Create your account, then set up your restaurant with its own menu. No card needed."
                : "Sign in to prepare your team for the next service."}
          </p>
          {!supabase ? (
            <div className="panel p-6">
              <h3 className="font-semibold">
                Your workspace is ready to connect
              </h3>
              <p className="muted mt-3 text-sm leading-relaxed">
                HEAT needs its Supabase project before you can create an account
                or save a menu. The setup guide included with this project walks
                you through it.
              </p>
              <a href="/preview" className="btn mt-5 w-full">
                Preview the employee screen
              </a>
              <p className="muted mt-3 text-xs">
                Preview uses sample content. Nothing is saved.
              </p>
            </div>
          ) : (
            <>
              <Notice text={error} error />
              <Notice text={message} />
              <form onSubmit={submit}>
                {signup && <Field label="Your name"><input id="display-name" name="display-name" autoComplete="given-name" required maxLength={60} /></Field>}
                <Field label="Email address">
                  <input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="email"
                    required
                    maxLength={254}
                    placeholder="you@restaurant.com"
                  />
                </Field>
                {signup && !invitation && !trial && (
                  <Field label="I’m joining as">
                    <select
                      id="account-role"
                      name="account-role"
                      defaultValue="employee"
                    >
                      <option value="employee">
                        Employee — join my restaurant
                      </option>
                      <option value="manager">
                        Manager — set up a restaurant
                      </option>
                    </select>
                  </Field>
                )}
                {!forgot && <><Field label="Password">
                  <input
                    id="password"
                    name="password"
                    type="password"
                    autoComplete={signup ? "new-password" : "current-password"}
                    minLength={signup ? 8 : undefined}
                    maxLength={128}
                    required
                    placeholder={
                      signup ? "At least 8 characters" : "Your password"
                    }
                  />
                </Field>
                {!signup && <p className="-mt-3 mb-5 text-right text-sm"><button type="button" className="btn secondary" onClick={() => {setForgot(true);setError("");setMessage("");}}>Forgot password?</button></p>}</>}
                <button className="btn w-full" disabled={busy}>
                  {busy
                    ? "Please wait…"
                    : forgot
                      ? "Send reset link"
                      : signup
                      ? "Create account"
                      : "Sign in"}
                </button>
              </form>
              {forgot ? <p className="muted mt-6 text-center text-sm"><button type="button" className="btn secondary" onClick={() => {setForgot(false);setError("");setMessage("");}}>Back to sign in</button></p> : <p className="muted mt-6 text-center text-sm">
                {signup ? "Already have an account?" : "New to HEAT?"}{" "}
                <button
                  type="button"
                  className="font-semibold text-heat underline underline-offset-4"
                  onClick={() => {
                    setSignup(!signup);
                    setError("");
                    setMessage("");
                  }}
                >
                  {signup ? "Sign in" : "Create account"}
                </button>
              </p>}
              {!invitation && <p className="muted mt-3 text-center text-sm">Just looking? <a href="/demo" className="font-semibold text-heat underline underline-offset-4">Open the demo kitchen</a></p>}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

// Shown after someone opens the reset link from their email.
function NewPassword({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    const data = new FormData(event.currentTarget);
    const password = String(data.get("new-password") || "");
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (password !== String(data.get("confirm-password") || "")) return setError("The two passwords don't match.");
    setBusy(true); setError("");
    const result = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (result.error) return setError(result.error.message);
    onDone();
  }
  return <main className="flex min-h-screen items-center justify-center px-6 py-12">
    <div className="w-full max-w-md enter">
      <p className="eyebrow muted mb-3">Your account</p>
      <h2 className="text-2xl font-semibold tracking-tight">Choose a new password</h2>
      <p className="muted mt-3 mb-8">You're almost back in. Pick a new password for your HEAT account.</p>
      <Notice text={error} error />
      <form onSubmit={submit}>
        <Field label="New password"><input id="new-password" name="new-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required placeholder="At least 8 characters" /></Field>
        <Field label="Repeat the new password"><input id="confirm-password" name="confirm-password" type="password" autoComplete="new-password" minLength={8} maxLength={128} required /></Field>
        <button className="btn w-full" disabled={busy}>{busy ? "Saving…" : "Save new password"}</button>
      </form>
    </div>
  </main>;
}

function CardNavigation({items, current, onOpen}: {items: MenuItem[]; current: MenuItem; onOpen: (item: MenuItem) => void}) {
  const index = items.findIndex(item => item.id === current.id);
  const previous = index > 0 ? items[index - 1] : undefined;
  const next = index >= 0 ? items[index + 1] : undefined;
  return <nav className="card-navigation" aria-label="Browse menu cards">
    <button type="button" className="btn secondary" disabled={!previous} onClick={() => previous && onOpen(previous)} title={previous?.name} aria-label="Previous card"><ArrowLeft size={18} aria-hidden="true"/></button>
    <span className="muted text-xs" aria-live="polite">{index >= 0 ? index + 1 : 1} of {index >= 0 ? items.length : 1}</span>
    <button type="button" className="btn secondary" disabled={!next} onClick={() => next && onOpen(next)} title={next?.name} aria-label="Next card"><ArrowRight size={18} aria-hidden="true"/></button>
  </nav>;
}

function CardQuizScore({score}: {score?: ProgressRow}) {
  if (!score || score.total <= 0) return null;
  const percent = Math.round(score.correct / score.total * 100);
  const color = !score.needs_review && score.correct / score.total >= 0.8 ? "score-good" : percent >= 50 ? "score-mid" : "score-low";
  return <span className={`inline-flex shrink-0 rounded px-1.5 py-0.5 text-xs font-semibold ${color}`} aria-label={`Your last quiz score: ${percent}%${score.needs_review ? ". Quiz updated; review needed" : ""}`} title={learningStatus(score)}>{score.needs_review ? "Previous: " : ""}{percent}%</span>;
}

function DeleteMenuItem({item, busy, onDelete}: {item: MenuItem; busy: boolean; onDelete: () => Promise<void>}) {
  const [confirming, setConfirming] = useState(false);
  return confirming ? <section className="panel w-full p-5" aria-label="Confirm menu item deletion">
    <h2 className="font-semibold">Delete {item.name}?</h2>
    <p className="muted mt-2">This permanently removes the card, its quizzes and saved quiz history, study assignments, and pre-shift board entries. This cannot be undone.</p>
    <div className="mt-4 flex flex-wrap gap-3">
      <button className="btn secondary" disabled={busy} onClick={() => setConfirming(false)}>Cancel</button>
      <button className="btn secondary" disabled={busy} onClick={() => void onDelete()}>{busy ? "Deleting…" : "Delete permanently"}</button>
    </div>
  </section> : <button className="btn secondary card-admin-danger" disabled={busy} onClick={() => setConfirming(true)}>Delete</button>;
}

// The restaurant's words: built-ins plus the manager's own, shared with every card.
const GlossaryContext = createContext<Term[]>([]);
// Terms from the dish itself, explained without leaving the dish.
function WordsToKnow({item}: {item: MenuItem}) {
  const glossary = useContext(GlossaryContext);
  const terms = termsFor([item.name, ...item.ingredients, item.description], glossary);
  const [open, setOpen] = useState("");
  if (!terms.length) return null;
  const shown = terms.find(term => term.term === open);
  return <details className="team-fold words-fold my-5">
    <summary>Words to know</summary>
    <div className="team-fold-body">
      <div className="word-chips">{terms.map(term => <button key={term.term} type="button" className="word-chip" aria-pressed={open === term.term} onClick={() => setOpen(open === term.term ? "" : term.term)}>{term.term}</button>)}</div>
      {shown && <div className="word-bubble" role="status">
        {shown.say && <p className="word-say">{shown.say}</p>}
        <p className={shown.say ? "mt-1" : undefined}>{shown.means}</p>
        {shown.note && <p className="word-note mt-2">{shown.note}</p>}
      </div>}
    </div>
  </details>;
}
// Where a manager names their own libraries and the sections inside them.
// Every word here belongs to the restaurant; the app ships none of it.
function LibrarySettings({restaurantId, taxonomy, items, onChanged, onItemsChanged}: {restaurantId: string; taxonomy: Taxonomy; items: MenuItem[]; onChanged: () => Promise<void>; onItemsChanged: () => Promise<void>}) {
  const [type, setType] = useState<ContentType>("food");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [newName, setNewName] = useState("");
  const [renaming, setRenaming] = useState<{from: string; draft: string} | null>(null);
  const [confirmDelete, setConfirmDelete] = useState("");
  const [section, setSection] = useState<SectionWords>(wordsIn(taxonomy, type));
  useEffect(() => { setSection(wordsIn(taxonomy, type)); setRenaming(null); setConfirmDelete(""); }, [taxonomy, type]);
  const rows = taxonomy.categories.filter(row => row.content_type === type).sort((a, b) => a.sort_order - b.sort_order);
  const countOf = (name: string) => items.filter(item => contentTypeOf(item) === type && categoryOf(item) === name).length;
  async function run(work: () => Promise<void>, done: string) {
    if (!supabase) return;
    setBusy(true); setError(""); setMessage("");
    try { await work(); await onChanged(); setMessage(done); }
    catch (e) { setError(e instanceof Error ? e.message : "That did not save. Please try again."); }
    finally { setBusy(false); }
  }
  const saveSection = () => run(async () => {
    const result = await supabase!.from("menu_sections").upsert({restaurant_id: restaurantId, content_type: type,
      name: section.name.trim() || wordsIn(taxonomy, type).name, heading: section.heading.trim(), about: section.about.trim(),
      item_one: section.item_one.trim() || "item", item_many: section.item_many.trim() || "items",
      updated_at: new Date().toISOString()});
    if (result.error) throw result.error;
  }, "Saved. Your team sees the new wording straight away.");
  const addCategory = () => run(async () => {
    const name = newName.trim();
    if (!name) throw new Error("Give the section a name.");
    const result = await supabase!.from("menu_categories").insert({restaurant_id: restaurantId, content_type: type,
      name, sort_order: (rows.at(-1)?.sort_order ?? 0) + 1});
    if (result.error) throw new Error(/duplicate|unique/i.test(result.error.message) ? `"${name}" is already a section here.` : result.error.message);
    setNewName("");
  }, "Section added.");
  const saveRename = (from: string) => run(async () => {
    const to = (renaming?.draft ?? "").trim();
    if (!to) throw new Error("Give the section a name.");
    if (to === from) { setRenaming(null); return; }
    const named = await supabase!.from("menu_categories").update({name: to})
      .eq("restaurant_id", restaurantId).eq("content_type", type).eq("name", from);
    if (named.error) throw new Error(/duplicate|unique/i.test(named.error.message) ? `"${to}" is already a section here.` : named.error.message);
    // Every item filed under the old name moves with it, or it would vanish from the library.
    const moved = await supabase!.from("menu_items").update({category: to})
      .eq("restaurant_id", restaurantId).eq("content_type", type).eq("category", from);
    if (moved.error) throw moved.error;
    await onItemsChanged();
    setRenaming(null);
  }, "Renamed, and every item moved with it.");
  const move = (name: string, delta: number) => run(async () => {
    const order = rows.map(row => row.name);
    const from = order.indexOf(name), to = from + delta;
    if (from < 0 || to < 0 || to >= order.length) return;
    order[from] = order[to]; order[to] = name;
    for (let index = 0; index < order.length; index++) {
      const result = await supabase!.from("menu_categories").update({sort_order: index + 1})
        .eq("restaurant_id", restaurantId).eq("content_type", type).eq("name", order[index]);
      if (result.error) throw result.error;
    }
  }, "Order saved.");
  const setArchived = (name: string, archived: boolean) => run(async () => {
    const result = await supabase!.from("menu_categories").update({archived})
      .eq("restaurant_id", restaurantId).eq("content_type", type).eq("name", name);
    if (result.error) throw result.error;
  }, archived ? "Archived. Its items keep their label but the section is off the menu." : "Back on the menu.");
  const remove = (name: string) => run(async () => {
    const held = countOf(name);
    if (held > 0) throw new Error(`"${name}" still holds ${held} item${held === 1 ? "" : "s"}. Move them to another section first, then delete it.`);
    const result = await supabase!.from("menu_categories").delete()
      .eq("restaurant_id", restaurantId).eq("content_type", type).eq("name", name);
    if (result.error) throw result.error;
    setConfirmDelete("");
  }, "Section deleted.");
  return <section className="mx-auto max-w-3xl">
    <p className="eyebrow muted">Manager workspace</p>
    <h1 className="mt-3 text-2xl font-semibold">Library settings</h1>
    <p className="muted mt-3">What you call each library and the sections inside it. Servers see these words everywhere.</p>
    <div className="mt-4"><Notice text={error} error /><Notice text={message} /></div>
    <div className="library-switch my-5" aria-label="Library">{CONTENT_TYPES.map(one => <button key={one} type="button" aria-pressed={type === one} onClick={() => setType(one)}>{wordsIn(taxonomy, one).name}</button>)}</div>

    <form className="panel p-6" onSubmit={event => {event.preventDefault(); void saveSection();}}>
      <fieldset disabled={busy} className="space-y-4">
        <h2 className="text-xl font-semibold">Wording</h2>
        <Field label="What this library is called"><input id="section-name" maxLength={40} value={section.name} onChange={e => setSection({...section, name: e.target.value})} /></Field>
        <Field label="Heading above the list (optional)"><input id="section-heading" maxLength={60} value={section.heading} onChange={e => setSection({...section, heading: e.target.value})} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="One item is called"><input id="section-one" maxLength={30} value={section.item_one} onChange={e => setSection({...section, item_one: e.target.value})} /></Field>
          <Field label="Several are called"><input id="section-many" maxLength={30} value={section.item_many} onChange={e => setSection({...section, item_many: e.target.value})} /></Field>
        </div>
        <Field label="About this library (optional)"><textarea id="section-about" maxLength={600} value={section.about} onChange={e => setSection({...section, about: e.target.value})} placeholder="A few lines your team reads above the list." /></Field>
        <button className="btn" type="submit">{busy ? "Saving…" : "Save wording"}</button>
      </fieldset>
    </form>

    <h2 className="mt-8 text-xl font-semibold">Sections</h2>
    <p className="muted mt-2 text-sm">Renaming a section moves every item in it, and their quizzes are flagged for review. Archiving takes it off the menu and keeps the items. Deleting only works once a section is empty.</p>
    <form className="mt-4 flex flex-wrap gap-3" onSubmit={event => {event.preventDefault(); void addCategory();}}>
      <input className="min-w-0 flex-1" aria-label="New section name" maxLength={40} value={newName} onChange={e => setNewName(e.target.value)} placeholder="Add a section — Happy Hour, Specials…" />
      <button className="btn" type="submit" disabled={busy || !newName.trim()}>Add</button>
    </form>

    <div className="mt-4 space-y-2">{rows.map((row, index) => <div key={row.name} className={`panel word-row${row.archived ? " is-hidden" : ""}`}>
      <div className="min-w-0 flex-1">
        {renaming?.from === row.name
          ? <input aria-label={`New name for ${row.name}`} maxLength={40} value={renaming.draft} onChange={e => setRenaming({from: row.name, draft: e.target.value})} />
          : <p className="font-semibold">{row.name}{row.archived && <span className="muted text-sm"> · archived</span>}</p>}
        <p className="muted mt-1 text-sm">{countOf(row.name)} item{countOf(row.name) === 1 ? "" : "s"}</p>
      </div>
      <div className="word-actions">
        {renaming?.from === row.name
          ? <><button className="btn secondary" disabled={busy} onClick={() => void saveRename(row.name)}>Save name</button><button className="btn secondary" onClick={() => setRenaming(null)}>Cancel</button></>
          : confirmDelete === row.name
            ? <><button className="btn secondary card-admin-danger" disabled={busy} onClick={() => void remove(row.name)}>Delete for good</button><button className="btn secondary" onClick={() => setConfirmDelete("")}>Keep</button></>
            : <>
              <button className="btn secondary" disabled={busy || index === 0} aria-label={`Move ${row.name} up`} onClick={() => void move(row.name, -1)}>↑</button>
              <button className="btn secondary" disabled={busy || index === rows.length - 1} aria-label={`Move ${row.name} down`} onClick={() => void move(row.name, 1)}>↓</button>
              <button className="btn secondary" disabled={busy} onClick={() => setRenaming({from: row.name, draft: row.name})}>Rename</button>
              <button className="btn secondary" disabled={busy} onClick={() => void setArchived(row.name, !row.archived)}>{row.archived ? "Restore" : "Archive"}</button>
              <button className="btn secondary" disabled={busy} onClick={() => setConfirmDelete(row.name)}>Delete</button>
            </>}
      </div>
    </div>)}{!rows.length && <p className="muted py-6">No sections yet. Add the first one above.</p>}</div>
  </section>;
}
// Menu order, everywhere a list of dishes is offered: the restaurant's own section order.
function inMenuOrder<T extends {category?: string; content_type?: string}>(list: T[], order: readonly string[]) {
  return list.slice().sort((a, b) => order.indexOf(categoryOf(a)) - order.indexOf(categoryOf(b)));
}
// Tonight’s 86 board, shown wherever a server meets a dish — not only on the home screen.
// Two notes can share a code (Sesame and Sesame oil). The badge row shows each code once.
function badgeCodes(allergens: string[]) {
  const out: ReturnType<typeof allergenBadge>[] = [];
  for (const note of allergens) {
    const badge = allergenBadge(note);
    if (!out.some(seen => seen.code === badge.code)) out.push(badge);
  }
  return out;
}
function ShiftFlag({entry}: {entry?: ShiftBoardEntry}) {
  if (!entry) return null;
  return <span className={`shift-flag${entry.status === "86" ? " out" : ""}`}>{SHIFT_STATUS_LABELS[entry.status]}{entry.detail ? ` · ${entry.detail}` : ""}</span>;
}
// Cocktail method and glassware have their own fields now; hide the old copies in the description text.
// What follows the category on a card and in the menu list. A price or time the library has hidden is left out.
function summaryFor(item: MenuItem, rows: readonly CardFieldRow[]) {
  const off = hiddenCore(contentTypeOf(item), rows);
  return serviceSummary({price: off.has("price") ? null : item.price, price_label: off.has("price_label") ? null : item.price_label, fire_minutes: off.has("fire") ? null : item.fire_minutes});
}
function withoutDetailLines(item: MenuItem, rows: readonly CardFieldRow[] = []) {
  if (contentTypeOf(item) !== "cocktails") return item.description;
  // Only a field the card actually shows can stand in for its old copy in the description text.
  const live = new Set(cardEntries("cocktails", item.details, rows, "team").map(entry => entry.field.id));
  const labels = [["method", "Method"], ["glassware", "Glassware"]].filter(([id]) => live.has(id)).map(([, label]) => label);
  if (!labels.length) return item.description;
  return item.description.replace(new RegExp(`(^|\\n)[ \\t]*(${labels.join("|")})[ \\t]*:[^\\n]*`, "gi"), "").replace(/\n{3,}/g, "\n\n").trim();
}
export function DishCard({ item, score, shift }: { item: MenuItem; score?: ProgressRow; shift?: ShiftBoardEntry }) {
  // The eyebrow names the section in the restaurant’s own words. Hard-coding a noun here
  // is how a sake card came to say “Know the wine”: one section can hold more than one kind.
  const {labelFor} = useTaxonomy();
  // An imported "Source: … Menu Description…" line stays in the data but is not shown on the card.
  const cardRows = useCardRows();
  const entries = cardEntries(contentTypeOf(item), item.details, cardRows, "team");
  const specText = entries.find(entry => entry.field.id === "spec")?.value ?? "";
  const {intro, observation, recipes} = dishDescription(withoutDetailLines(item, cardRows));
  // The built-in extras this library has hidden stay off the card; the item keeps what it holds.
  const off = hiddenCore(contentTypeOf(item), cardRows);
  const observations = off.has("observations") ? "" : item.observations?.trim() || observation;
  const summary = summaryFor(item, cardRows);
  return (
    <article className="panel dish-card overflow-hidden enter">
      {item.photo_url ? (
        <img
          src={item.photo_url}
          alt={item.name}
          loading="lazy"
          decoding="async"
          className="aspect-[16/10] w-full object-cover"
        />
      ) : contentTypeOf(item) === "wine" ? null : (
        <div className="flex aspect-[16/7] items-center justify-center gap-3 bg-raised text-muted">
          <Utensils size={24} />
          <span className="text-sm">Photo unavailable</span>
        </div>
      )}
      <div className="p-6">
        <p className="eyebrow muted mb-2">{`Know your ${labelFor(contentTypeOf(item)).name}`}</p>
        <div className="flex items-center gap-2"><h2 className="text-2xl font-semibold tracking-tight">{item.name}</h2><CardQuizScore score={score} /></div>
        <ShiftFlag entry={shift} /><p className="muted mt-2 text-xs uppercase tracking-wide">{categoryOf(item)}{summary && ` · ${summary}`}</p>
        <p className="muted mt-3 whitespace-pre-line leading-relaxed">{intro}</p>
        <dl className="dish-facts">
          <div><dt>Ingredients</dt><dd>{item.ingredients.join(", ")}{item.ingredients.length && !/[.!?]$/.test(item.ingredients.at(-1)!) ? "." : ""}</dd></div>
          {entries.filter(entry => entry.field.id !== "spec").map(entry => <div key={entry.field.id}><dt>{entry.field.label}</dt><dd>{entry.value}</dd></div>)}
          {item.table_setting && !off.has("table_setting") && <div><dt>Table setting</dt><dd>{item.table_setting}</dd></div>}
          {observations && <div><dt>Observations</dt><dd className="dish-observation">{observations}</dd></div>}
        </dl>
        {/* The build sits behind a fold rather than a permission: a bartender opens it every
          time and knows where it is, a server never has to scroll past it to reach the rest. */}
        {!!specText && <details className="team-fold my-5">
          <summary>Spec</summary>
          <div className="team-fold-body"><p className="whitespace-pre-line">{specText}</p></div>
        </details>}
        <section className="dish-allergens" aria-label="Allergen notes">
          <h3>Allergens</h3>
          {item.allergens.some(note => /^\s*(none|no allergens?)\s*$/i.test(note)) ? <p className="mt-2 text-sm">No allergens recorded. The kitchen or bar checked this item. Confirm preparation before offering.</p> : item.allergens.length ? <ul>{item.allergens.map((note,i)=>{const badge=allergenBadge(note);return <li key={i} className={badge.cc?'cross-contact':''}><strong>{badge.code}</strong><span aria-hidden="true"> · </span>{badge.text}</li>;})}</ul> : <p className="mt-2 text-sm">Allergen information not yet provided. Manager review required.</p>}
          {item.details?.reviewed_by && <p className="allergen-reviewed">Reviewed by {item.details.reviewed_by}{item.details.reviewed_on ? ` · ${new Date(`${item.details.reviewed_on}T12:00:00Z`).toLocaleDateString(undefined, {month: "short", day: "numeric", year: "numeric", timeZone: "UTC"})}` : ""}</p>}
          <p className="dish-allergen-help">Confirm all guest allergies and preparation with the kitchen. Notes marked with ! indicate cross-contamination (CC).</p>
        </section>
        {recipes.length>0&&!off.has("sauce")&&<section className="sauce-breakdown"><h3>Sauce breakdown</h3>{recipes.map((recipe,i)=><div className="sauce-recipe" key={i}><h4>{recipe.name}</h4><p>{recipe.details}</p></div>)}</section>}

        <WordsToKnow item={item} />
      </div>
    </article>
  );
}

function AddDish({
  restaurant,
  item,
  defaultContentType = "food",
  cards,
  items,
  onCardRows,
  onRefresh,
  onSaved,
  onCancel,
}: {
  restaurant: Restaurant;
  item?: MenuItem;
  defaultContentType?: ContentType;
  // The restaurant's card-field settings. ready is false until the card_fields table exists.
  cards: {ready: boolean; rows: CardFieldRow[]};
  items: MenuItem[];
  onCardRows: (rows: CardFieldRow[]) => void;
  onRefresh: () => Promise<void>;
  onSaved: (contentType: ContentType) => Promise<void>;
  onCancel: () => void;
}) {
  const details = dishDescription(item ? withoutDetailLines(item, cards.rows) : "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [formType, setFormType] = useState<ContentType>(item ? contentTypeOf(item) : defaultContentType);
  // The version of this item the save is checked against. Deleting a field for good rewrites the items
  // that had an answer in it, so it is read again afterwards instead of failing the save as "changed elsewhere".
  const [stamp, setStamp] = useState(item?.updated_at);
  // Mirrors of the fields the Allergy check reads. The inputs stay uncontrolled -- saving still
  // reads the form, not these -- so this can only ever show what is about to be saved, never change it.
  const [seeIngredients, setSeeIngredients] = useState(item?.ingredients.join(", ") ?? "");
  const [seeAllergens, setSeeAllergens] = useState(item?.allergens.map(expandCrossContamination).join(", ") ?? "");
  const [seeNone, setSeeNone] = useState(item?.allergens.some(note => /^\s*(none|no allergens?)\s*$/i.test(note)) ?? false);
  // The dish as the Allergy check would see it, from what is in the boxes right now.
  const allergyPreview = useMemo(() => {
    const draft = {id: "", restaurant_id: "", name: "", description: "", photo_path: null, content_type: formType,
      ingredients: listFromText(seeIngredients),
      allergens: seeNone ? ["None"] : listFromText(seeAllergens)} as MenuItem;
    return menuAllergies([draft])
      .map(label => ({label, result: assessAllergy(draft, label)}))
      .filter(row => row.result.status === "avoid" || row.result.status === "cross-contact")
      .map(row => {
        // A reason that repeats the label is the note being read back. Say where it came from instead.
        const fromRecipe = row.result.reasons.some(reason => /^Possible |^Recipe mentions/.test(reason));
        const fromNote = row.result.reasons.some(reason => !/^Possible |^Recipe mentions/.test(reason));
        // Only the genuinely ambiguous records carry a sentence: a nut with no type, an allium with no name.
        const confirm = row.result.reasons.find(reason => /unspecified|needs confirmation|confirm with the kitchen/.test(reason));
        return {...row, fromRecipe, fromNote, confirm: confirm && /unspecified|needs confirmation|without saying which/.test(confirm) ? confirm : ""};
      });
  }, [seeIngredients, seeAllergens, seeNone, formType]);
  // Found in the recipe but never named in the allergen note -- the note is what a server reads out loud.
  const notInNote = allergyPreview.filter(row => row.fromRecipe && !row.fromNote).map(row => row.label);
  const {namesFor, labelFor} = useTaxonomy();
  // What this item is called on the form: dish, cocktail, or wine / sake.
  const noun = formType === "wine" ? "wine or sake" : formType === "cocktails" ? "cocktail" : "dish";
  const Noun = noun.charAt(0).toUpperCase() + noun.slice(1);
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview);
    },
    [preview],
  );
  // The built-in extras this library has hidden are not on the form, so the item keeps what it holds.
  const hid = cards.ready ? hiddenCore(formType, cards.rows) : new Set<string>();
  const many = formType === "wine" ? "wines and sakes" : formType === "cocktails" ? "cocktails" : "dishes";
  const scope = {restaurantId: restaurant.id, contentType: formType, rows: cards.rows, onRows: onCardRows, many};
  async function afterDelete() {
    if (item && supabase) {
      const fresh = await supabase.from("menu_items").select("updated_at").eq("id", item.id).maybeSingle();
      if (fresh.data?.updated_at) setStamp(fresh.data.updated_at as string);
    }
    await onRefresh();
  }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!supabase || busy) return;
    setError("");
    const form = new FormData(event.currentTarget);
    const ingredients = listFromText(String(form.get("ingredients")));
    // The "No allergens" tick replaces the list with one explicit note, so the app can tell "checked" from "blank".
    const allergens = form.get("no-allergens") ? ["None"] : listFromText(String(form.get("allergens")));
    // Signed at save, every save. The date can never describe ingredients that were changed later.
    let review: Record<string, string> = {};
    if (form.get("allergens-reviewed")) {
      const who = await supabase.auth.getUser();
      review = {
        reviewed_by: String(who.data.user?.user_metadata?.display_name || who.data.user?.user_metadata?.full_name || who.data.user?.email || "Manager"),
        reviewed_on: new Date().toISOString().slice(0, 10),
      };
    }
    const name = String(form.get("name")).trim();
    const priceText = String(form.get("price") || "").trim();
    const fireText = String(form.get("fire-minutes") || "").trim();
    const price = hid.has("price") ? item?.price ?? null : priceText === "" ? null : Number(priceText);
    const fire_minutes = hid.has("fire") ? item?.fire_minutes ?? null : fireText === "" ? null : Number(fireText);
    if (!hid.has("price") && price !== null && (!Number.isFinite(price) || price < 0 || price > 999999.99 || Math.abs(price*100-Math.round(price*100))>0.000001)) return setError("Enter a valid price with at most two decimal places.");
    if (!hid.has("fire") && fire_minutes !== null && (!Number.isInteger(fire_minutes) || fire_minutes < 1 || fire_minutes > 240)) return setError(`Enter ${timeLabel(formType) === "Fire time" ? "a fire time" : "an elaboration time"} between 1 and 240 minutes.`);
    const intro = String(form.get("description") || "").trim();
    const recipeText = hid.has("sauce") ? details.recipeText : String(form.get("sauce-recipes") || "").trim();
    const description = item && !details.observation && intro === details.intro && recipeText === details.recipeText
      ? item.description
      : composeDishDescription(intro, recipeText, details.source);
    if (description.length > 2000) return setError("Keep the description and sauce recipes together under 2,000 characters.");
    if (!name || !description || !ingredients.length)
      return setError("Add a name, description, and at least one ingredient.");
    if (ingredients.length > 50 || allergens.length > 30)
      return setError("Use at most 50 ingredients and 30 allergens.");
    if (!file && !item && formType !== "wine") return setError("Choose a photo for this dish.");
    if (file) {
      const photoError = validatePhoto(file);
      if (photoError) return setError(photoError);
    }
    setBusy(true);
    const photo = file ? await shrinkPhoto(file) : null;
    const extension = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    }[photo?.type ?? ""];
    const path = photo
      ? `${restaurant.id}/${crypto.randomUUID()}.${extension}`
      : item?.photo_path ?? null;
    let uploaded = false;
    let saved = false;
    try {
      if (photo) {
        const upload = await supabase.storage
          .from("menu-photos")
          .upload(path!, photo, { contentType: photo.type, cacheControl: "31536000" });
        if (upload.error) throw upload.error;
        uploaded = true;
      }
      const values = {
        price,
        price_label: hid.has("price_label") ? item?.price_label ?? null : String(form.get("price-label") || "").trim() || null,
        fire_minutes,
        table_setting: hid.has("table_setting") ? item?.table_setting ?? null : String(form.get("table-setting") || "").trim() || null,
        observations: hid.has("observations") ? item?.observations?.trim() || details.observation : String(form.get("observations") || "").trim(),
        name,
        description,
        ingredients,
        allergens,
        photo_path: path,
        category: String(form.get("category") || "Other"),
        content_type: formType,
        details: {...(cards.ready
          ? detailsToSave(formType, id => String(form.get(`detail-${id}`) || ""), item?.details, cards.rows)
          : detailsFromForm(formType, id => String(form.get(`detail-${id}`) || ""))), ...review},
      };
      if (item && !item.updated_at)
        throw new Error(
          "Editing setup is not ready. Apply database migration 002 and refresh the menu.",
        );
      const result = item
        ? await supabase
            .from("menu_items")
            .update(values)
            .eq("id", item.id)
            .eq("restaurant_id", restaurant.id)
            .eq("updated_at", stamp!)
            .select("id")
            .maybeSingle()
        : await supabase
            .from("menu_items")
            .insert({ ...values, restaurant_id: restaurant.id })
            .select("id")
            .single();
      if (result.error) throw result.error;
      if (!result.data)
        throw new Error(
          `This ${noun} changed in another session. Go back, refresh the menu, and reopen it before saving.`,
        );
      saved = true;
      // Keep the previous photo: another open employee session may still display it.
      await onSaved(formType);
    } catch (e) {
      if (uploaded && !saved)
        await supabase.storage.from("menu-photos").remove([path!]);
      setError(
        e instanceof Error
          ? e.message
          : `The ${noun} could not be saved. Please try again.`,
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel mx-auto max-w-3xl p-6 md:p-9 enter">
      <button className="btn secondary mb-6" onClick={onCancel} disabled={busy}>
        <ArrowLeft size={16} />
        Back to menu
      </button>
      <h1 className="text-2xl font-semibold">
        {item ? "Edit menu item" : "Add a menu item"}
      </h1>
      <p className="muted mt-2 mb-7">
        Give your team what they need to describe this menu item.
      </p>
      <Notice text={error} error />
      <form onSubmit={submit}>
        <fieldset disabled={busy}>
          <Field label="Item name">
            <input
              id="dish-name"
              name="name"
              defaultValue={item?.name}
              required
              maxLength={100}
              placeholder="The name as it reads on your menu"
            />
          </Field>
          <Field label="Library"><select id="item-library" value={formType} onChange={e => setFormType(e.target.value as ContentType)}>{CONTENT_TYPES.map(type => <option key={type} value={type}>{labelFor(type).name}</option>)}</select></Field>
          <Field label="Category">
            <select key={formType} id="dish-category" name="category" defaultValue={item && contentTypeOf(item) === formType ? categoryOf(item) : "Other"} required>
              {namesFor(formType).map(category => <option key={category} value={category}>{category}</option>)}
            </select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2"><CoreField id="price" name="Price" label="Price (USD, optional)" ready={cards.ready} scope={scope}><input id="dish-price" name="price" type="number" inputMode="decimal" min="0" max="999999.99" step="0.01" defaultValue={item?.price ?? ""} placeholder="32.00"/></CoreField>{formType !== "wine" && <CoreField id="fire" name={timeLabel(formType)} label={`${timeLabel(formType)} (minutes, optional)`} ready={cards.ready} scope={scope}><input id="dish-fire" name="fire-minutes" type="number" inputMode="numeric" min="1" max="240" step="1" defaultValue={item?.fire_minutes ?? ""} placeholder="10"/></CoreField>}</div>
          <CoreField id="price_label" name="Alternative price label" label="Alternative price label (optional; replaces numeric price)" ready={cards.ready} scope={scope}><input id="price-label" name="price-label" maxLength={40} defaultValue={item?.price_label ?? ""} placeholder="Market price, or $60 / $120" /></CoreField>
          <CardFieldInputs part="shipped" restaurantId={restaurant.id} contentType={formType} rows={cards.rows} ready={cards.ready} items={items} many={many} values={item?.details} onRows={onCardRows} onDeleted={afterDelete} />
          <Field label="Description">
            <textarea
              id="description"
              name="description"
              defaultValue={details.intro}
              required
              maxLength={2000}
              placeholder={formType === "wine" ? "How would you describe this wine or sake to a guest?" : "How would you describe this dish to a guest?"}
            />
          </Field>
          {formType !== "wine" && <><CoreField id="sauce" name="Sauce breakdown" label="Sauce breakdown (optional)" info="Add each sauce on a new line as Name: details. The app keeps the section heading and design for you." ready={cards.ready} scope={scope}><textarea id="sauce-recipes" name="sauce-recipes" maxLength={2000} defaultValue={details.recipeText} placeholder={"Sauce name: ingredients and preparation\nAnother sauce: ingredients and preparation"}/></CoreField></>}
          <Field label={formType === "wine" ? "Grapes or rice (and anything added)" : "Ingredients"} info={formType === "wine" ? "The grapes (or rice for sake), separated by commas. Used for search, quizzes and the Allergy check." : formType === "cocktails" ? "Separate ingredients with commas or new lines. The Allergy check reads these, not the spec, so whatever you list in the spec needs to be here too." : "Separate ingredients with commas or new lines."}>
            <textarea
              id="ingredients"
              name="ingredients"
              defaultValue={item?.ingredients.join(", ")}
              onChange={event => setSeeIngredients(event.target.value)}
              required
              maxLength={5000}
              placeholder={formType === "wine" ? "Pinot Noir, Chardonnay · or for sake: Yamada Nishiki rice" : "Salmon, citrus sauce, sesame, scallions"}
            />
          </Field>
          <CoreField id="table_setting" name="Table setting" label="Table setting (optional)" ready={cards.ready} scope={scope}><textarea id="table-setting" name="table-setting" maxLength={2000} defaultValue={item?.table_setting ?? ""} placeholder={formType === "wine" ? "Glass type, decanting, bottle presentation…" : "Utensils and how to serve this item"} /></CoreField>
          <CoreField id="observations" name="Observations" label="Observations (optional)" ready={cards.ready} scope={scope}><textarea id="observations" name="observations" maxLength={2000} defaultValue={item?.observations?.trim() || details.observation} placeholder={formType === "wine" ? "Service notes: pouring, storage, when to recommend it…" : formType === "cocktails" ? "Cocktail-specific service notes and preparation restrictions" : "Dish-specific service notes and preparation restrictions"} /></CoreField>
          <Field label="Allergens" info="Separate with commas. Leave blank if information is not yet available; employees will see that review is required.">
            <input
              id="allergens"
              name="allergens"
              defaultValue={item?.allergens
                .map(expandCrossContamination)
                .join(", ")}
              onChange={event => setSeeAllergens(event.target.value)}
              maxLength={2000}
              placeholder="e.g. Fish, sesame"
            />
          </Field>
          <InfoRow className="mb-5" info="The kitchen or bar checked this item. Ticking this replaces whatever is written above."><label className="check-row">
            <input type="checkbox" name="no-allergens" defaultChecked={item?.allergens.some(note => /^\s*(none|no allergens?)\s*$/i.test(note)) ?? false} onChange={event => setSeeNone(event.target.checked)} />
            <span>No allergens</span>
          </label></InfoRow>
          {/* The Allergy check already reads the ingredients as well as the note. This runs it while
            the manager can still change their mind, instead of a server meeting the answer first. */}
          {!seeNone && <section className="panel mb-5 p-4" aria-label="What the Allergy check will say">
            <p className="eyebrow muted mb-3">What a server will be told</p>
            {allergyPreview.length
              ? <ul className="space-y-2">{allergyPreview.map(row => <li key={row.label}>
                  <span className="flex items-center gap-2">
                    <span className={`menu-badge shrink-0${row.result.status === "cross-contact" ? " cc" : ""}`}>{row.label}</span>
                    <span className="muted text-xs">{row.fromNote && row.fromRecipe ? "in your note and the ingredients" : row.fromRecipe ? "in the ingredients" : "in your note"}</span>
                  </span>
                  {!!row.confirm && <span className="word-note mt-1 block pl-1">{row.confirm}</span>}
                </li>)}</ul>
              : <p className="muted text-sm">Nothing found yet. Type the ingredients and the allergens, and HEAT shows what it reads in them.</p>}
            {!!notInNote.length && <p className="word-note mt-3">Your allergen note does not mention {notInNote.join(", ").toLowerCase()} — the ingredients do. HEAT warns about them either way, but the note is the line a server reads out loud.</p>}
            <p className="muted mt-3 text-xs">Nothing here is saved or changed for you. It is what the Allergy check will say about this item once you save it.</p>
          </section>}
          <InfoRow className="mb-5" info="Your name and today’s date are recorded, and refresh every time you save with this ticked."><label className="check-row">
            <input type="checkbox" name="allergens-reviewed" defaultChecked={!!item?.details?.reviewed_by} />
            <span>Allergens reviewed by me as a chef or manager</span>
          </label></InfoRow>
          <label htmlFor="photo">
            {item ? `${Noun} photo (optional replacement)` : formType === "wine" ? `${Noun} photo (optional)` : `${Noun} photo`}
          </label>
          <div className="mb-5 rounded-xl border border-dashed border-line bg-raised p-5">
            {(preview || item?.photo_url) && (
              <img
                src={preview || item?.photo_url}
                alt={`Your selected ${noun} photo`}
                className="mb-4 h-48 w-full rounded-lg object-cover"
              />
            )}
            <div className="mb-3 flex items-center gap-2 text-sm">
              <ImagePlus size={19} />
              JPG, PNG, or WebP · up to 5 MB{formType === "wine" ? " · optional for wine & sake" : ""}
            </div>
            <input
              id="photo"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              required={!item && formType !== "wine"}
              onChange={(event) => {
                const selected = event.target.files?.[0];
                setError("");
                setFile(null);
                setPreview("");
                if (!selected) return;
                const issue = validatePhoto(selected);
                if (issue) {
                  setError(issue);
                  event.target.value = "";
                  return;
                }
                setFile(selected);
                setPreview(URL.createObjectURL(selected));
              }}
            />
          </div>
          <CardFieldInputs part="extra" restaurantId={restaurant.id} contentType={formType} rows={cards.rows} ready={cards.ready} items={items} many={many} values={item?.details} onRows={onCardRows} onDeleted={afterDelete} />
          <label className="mb-6 flex items-start gap-3 font-normal">
            <input className="mt-1 !w-4" type="checkbox" required />I have
            checked the ingredients and allergen information with the kitchen.
          </label>
          <button className="btn w-full sm:w-auto" disabled={busy}>
            {busy ? `Saving ${noun}…` : item ? "Save changes" : "Save menu item"}
            <Check size={18} />
          </button>
        </fieldset>
      </form>
    </section>
  );
}

// A pre-shift with ten focus items is no focus at all; the database refuses more than this too.
const FOCUS_LIMIT = 10;
function TodayActions({canAssign, onAssign, onLibrary}: {canAssign: boolean; onAssign: () => void; onLibrary: () => void}) {
  return <div className="today-chips">
    {canAssign && <button type="button" className="btn secondary" onClick={onAssign}>Assign study</button>}
    <button type="button" className="btn secondary" onClick={onLibrary}>Open library</button>
  </div>;
}
// The posted pre-shift on Today: the note and what to push or watch, with the button to print it.
// Nothing posted, no card. The row above it (green dot, pencil) is the way in to edit.
function PostedPreShiftCard({restaurantId, items, restaurantName}: {restaurantId: string; items: MenuItem[]; restaurantName: string}) {
  const [board, setBoard] = useState<ShiftBoardResponse["board"]>(null);
  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    void supabase.rpc("get_preshift_board", {rid: restaurantId}).then(({data}) => {
      if (!alive) return;
      const next = (data as ShiftBoardResponse | null)?.board ?? null;
      setBoard(next && next.restaurant_id === restaurantId ? next : null);
    });
    return () => {alive = false;};
  }, [restaurantId]);
  const focusIds = board?.focus_item_ids?.length ? board.focus_item_ids : board?.focus_item_id ? [board.focus_item_id] : [];
  // An emptied board is a row with nothing in it, not a missing row.
  if (!board || !(board.note.trim() || board.entries.length || focusIds.length)) return null;
  const nameOf = (id: string) => items.find(item => item.id === id)?.name ?? "Menu item unavailable";
  return <section className="panel today-card">
    <div className="posted-head">
      <h2 className="text-sm font-semibold">Today’s pre-shift</h2>
      <DownloadSheet label="Print today’s pre-shift" build={async () => preshiftSheet({serviceDate: board.service_date, note: board.note, postedBy: board.posted_by_name?.trim(), updated: board.updated_at, focus: focusIds.map(id => items.find(item => item.id === id)?.name).filter((name): name is string => !!name), groups: Object.entries(SHIFT_STATUS_LABELS).map(([status, label]) => ({label, entries: board.entries.filter(entry => entry.status === status).map(entry => ({name: nameOf(entry.menu_item_id), status, detail: entry.detail}))}))}, {restaurant: restaurantName})} />
    </div>
    {!!board.note.trim() && <p className="muted guide-blurb mt-3 text-xs">{board.note}</p>}
    {(!!focusIds.length || !!board.entries.length) && <div className="board-pills mt-3">
      {focusIds.map(id => <span key={id} className="board-pill">{nameOf(id)} · Focus</span>)}
      {board.entries.map(entry => <span key={entry.menu_item_id} className={`board-pill${entry.status === "86" ? " out" : entry.status === "low" ? " low" : ""}`}>{nameOf(entry.menu_item_id)} · {SHIFT_STATUS_LABELS[entry.status]}</span>)}
    </div>}
  </section>;
}
function PreShiftManager({restaurant, items, itemsLoading, refreshItems, onPosted}: {restaurant: Restaurant; items: MenuItem[]; itemsLoading: boolean; refreshItems: () => Promise<void>; onPosted: () => void}) {
  const {namesFor, labelFor} = useTaxonomy();
  const [serviceDate, setServiceDate] = useState("");
  // What is actually on the board right now, as opposed to what is being typed.
  const [posted, setPosted] = useState<ShiftBoardResponse["board"]>(null);
  // What is on the board right now: the list, or the single item a board posted before today’s change.
  const postedFocusIds = posted?.focus_item_ids?.length ? posted.focus_item_ids : posted?.focus_item_id ? [posted.focus_item_id] : [];
  const [confirmClear, setConfirmClear] = useState(false);
  const [note, setNote] = useState("");
  const [focusIds, setFocusIds] = useState<string[]>([]);
  const [entries, setEntries] = useState<ShiftBoardEntry[]>([]);
  const [itemId, setItemId] = useState("");
  const [status, setStatus] = useState<ShiftBoardEntry["status"]>("86");
  const [detail, setDetail] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [teamOptions, setTeamOptions] = useState<{user_id: string; name: string}[]>([]);
  const [audience, setAudience] = useState<"everyone" | "working" | "pick">("everyone");
  const [recipientIds, setRecipientIds] = useState<string[]>([]);
  // Who has a published shift today: one tap sends the board to just them.
  const [workingIds, setWorkingIds] = useState<string[]>([]);
  const sequence = useRef(0);
  const loadBoard = useCallback(async (prefill = false) => {
    const request = ++sequence.current;
    setLoading(true);setError("");setMessage("");
    try {
      if (!supabase) throw new Error("Please connect to your workspace and try again.");
      const [result, team, working] = await Promise.all([
        supabase.rpc("get_preshift_board", {rid: restaurant.id}),
        supabase.rpc("shift_team_options", {rid: restaurant.id}),
        supabase.rpc("preshift_working_today", {rid: restaurant.id}),
      ]);
      if (result.error) throw new Error(result.error.message);
      if (team.error) throw new Error(team.error.message);
      if (working.error) throw new Error(working.error.message);
      const data = result.data as ShiftBoardResponse;
      const recipients = data.board ? await supabase.rpc("shift_recipients", {note_id: data.board.id}) : {data: [], error: null};
      if (recipients.error) throw new Error(recipients.error.message);
      if (request !== sequence.current) return;
      const selected = (recipients.data as {user_id: string; name: string}[]).map(person => person.user_id);
      const onToday = (working.data as {user_id: string}[]).map(person => person.user_id);
      setTeamOptions(team.data as {user_id: string; name: string}[]);
      setWorkingIds(onToday);
      setRecipientIds(prefill ? selected : []);
      // A board sent to exactly today's people reopens on "Working today".
      const sameAsToday = selected.length > 0 && selected.length === onToday.length && selected.every(id => onToday.includes(id));
      // A new board starts on "Working today" when someone has a shift; with nobody scheduled it stays on Everyone.
      setAudience(!prefill ? (onToday.length ? "working" : "everyone") : !selected.length ? "everyone" : sameAsToday ? "working" : "pick");
      setServiceDate(data.service_date);
      setNote(prefill ? data.board?.note ?? "" : "");
      // A board saved before the focus list existed still has its single item.
      setFocusIds(!prefill ? [] : data.board?.focus_item_ids?.length ? data.board.focus_item_ids : data.board?.focus_item_id ? [data.board.focus_item_id] : []);
      setEntries(prefill ? data.board?.entries ?? [] : []);
      setPosted(data.board ?? null);
      setItemId("");setDetail("");
      if (prefill) setMessage("Editing today’s board. Change what you need, then post it again.");
    } catch (e) {
      if (request === sequence.current) {setServiceDate("");setError(e instanceof Error ? e.message : "Could not load the pre-shift board.");}
    } finally {
      if (request === sequence.current) setLoading(false);
    }
  }, [restaurant.id]);
  useEffect(() => {void loadBoard();return () => {sequence.current++;};}, [loadBoard]);
  function addEntry(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!items.some(item => item.id === itemId) || busy) return;
    if (entries.some(entry => entry.menu_item_id === itemId)) {setError("This item is already on the board. Remove its row before adding a replacement.");return;}
    setEntries(current => [...current, {menu_item_id: itemId, status, detail: detail.trim()}]);
    setItemId("");setDetail("");setError("");setMessage("");
  }
  async function clearBoard() {
    if (!supabase || busy || loading || !serviceDate) return;
    setBusy(true);setError("");setMessage("");
    try {
      // A real delete, not an empty board posted over the top: the row goes and its
      // 86 rows and focus items go with it, so tomorrow starts from nothing.
      const result = await supabase.from("shift_notes").delete().eq("restaurant_id", restaurant.id).eq("service_date", serviceDate);
      if (result.error) throw new Error(result.error.message);
      setNote("");setFocusIds([]);setEntries([]);setItemId("");setDetail("");setConfirmClear(false);
      await loadBoard();
      setMessage("Today’s board is down. Your team no longer sees it.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "The board could not be taken down. Please try again.");
    } finally {setBusy(false);}
  }
  async function post() {
    if (!supabase || busy || loading || !serviceDate) return;
    if (itemId || detail.trim()) {setError("Add the pending row or clear its fields before posting.");return;}
    if (!note.trim() && !focusIds.length && !entries.length) {setError("Write a note or add something first. To remove today’s board, use Delete.");return;}
    if (audience === "working" && !workingIds.length) {setError("No one has a published shift today. Send it to everyone, or pick who's on.");return;}
    setBusy(true);setError("");setMessage("");
    try {
      const result = await supabase.rpc("save_preshift_board", {
        rid: restaurant.id, board_date: serviceDate, board_note: note,
        focus_ids: focusIds,
        board_entries: entries.map(entry => ({menu_item_id: entry.menu_item_id, status: entry.status, detail: entry.detail})),
      });
      if (result.error) throw new Error(result.error.message);
      const selected = audience === "everyone" ? [] : audience === "working" ? workingIds : recipientIds;
      try {
        const saved = await supabase.rpc("set_shift_recipients", {note_id: result.data, learner_ids: selected});
        if (saved.error) throw new Error(saved.error.message);
      } catch (e) {
        throw new Error(`The board content was saved, but the audience could not be updated. The previous audience still applies; a new board is visible to the whole team. Retry Post to save your selection. ${e instanceof Error ? e.message : ""}`);
      }
      const names = selected.map(id => teamOptions.find(person => person.user_id === id)?.name || "Team member");
      const recipients = names.length <= 2 ? names.join(" and ") : `${names.slice(0, 2).join(", ")} and ${names.length - 2} ${names.length === 3 ? "other" : "others"}`;
      await loadBoard();
      notify("preshift_posted", result.data as string);
      setMessage(audience === "working" ? `Posted to the ${selected.length} ${selected.length === 1 ? "person" : "people"} working today.` : names.length ? `Posted to ${recipients}.` : "Posted to the whole team.");
      onPosted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "The board could not be posted. Please try again.");
    } finally {setBusy(false);}
  }
  const itemOptions = CONTENT_TYPES.map(type => <optgroup key={type} label={labelFor(type).heading}>{inMenuOrder(items.filter(item => contentTypeOf(item) === type), namesFor(type)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</optgroup>);
  return <section className="preshift mx-auto max-w-3xl">
    <p className="eyebrow muted">Manager workspace · {restaurant.name}</p>
    <h1 className="mt-3 text-2xl font-semibold">Pre-shift</h1>
    {serviceDate && <p className="muted mt-2 mb-5"><time dateTime={serviceDate}>{new Date(`${serviceDate}T12:00:00Z`).toLocaleDateString(undefined, {dateStyle: "full", timeZone: "UTC"})}</time></p>}
    <Notice text={error} error /><Notice text={message} />
    {loading ? <p role="status" className="muted py-8">Loading today’s board…</p> : !serviceDate ? <button className="btn secondary" onClick={() => void loadBoard()}>Try again</button> : <>
      {posted && (posted.note.trim() || postedFocusIds.length || posted.entries.length) ? <section className="panel mb-6 p-5" aria-label="Board posted today">
        <div className="posted-head"><h2 className="text-xl font-semibold">On the board today</h2></div>
        {posted.note.trim() && <p className="mt-3 whitespace-pre-wrap">{posted.note}</p>}
        {(!!postedFocusIds.length || !!posted.entries.length) && <div className="board-pills mt-3">
          {postedFocusIds.map(id => <span key={id} className="board-pill">{items.find(item => item.id === id)?.name ?? "Menu item unavailable"} · Focus</span>)}
          {posted.entries.map(entry => <span key={entry.menu_item_id} className={`board-pill${entry.status === "86" ? " out" : entry.status === "low" ? " low" : ""}`}>{items.find(item => item.id === entry.menu_item_id)?.name ?? "Menu item unavailable"} · {SHIFT_STATUS_LABELS[entry.status]}{entry.detail ? ` · ${entry.detail}` : ""}</span>)}
        </div>}
        {!confirmClear && <div className="posted-actions"><button type="button" className="btn secondary card-admin-danger" disabled={busy} onClick={() => setConfirmClear(true)}>Delete</button><button type="button" className="btn secondary posted-edit" disabled={busy} onClick={() => void loadBoard(true)}><Pencil size={14} aria-hidden="true" />Edit</button></div>}
        {confirmClear && <div className="mt-5 border-t border-line pt-4"><p>Delete today’s board? It comes off every phone. The note, the focus and the 86 board go with it. You can write a new one straight after.</p><div className="mt-3 flex flex-wrap gap-3"><button type="button" className="btn secondary card-admin-danger" disabled={busy} onClick={() => void clearBoard()}>{busy ? "Deleting\u2026" : "Yes, delete"}</button><button type="button" className="btn secondary" disabled={busy} onClick={() => setConfirmClear(false)}>Keep it</button></div></div>}
      </section> : null}
      <fieldset disabled={busy} className="panel mb-6 p-5">
        <InfoRow info="A short message every employee sees at the top of today’s board." className="mb-3"><h2 className="text-lg font-semibold">Note to the floor</h2></InfoRow>
        <textarea id="shift-note" aria-label="Note to the floor" maxLength={2000} value={note} onChange={e => {setNote(e.target.value);setMessage("");}} aria-describedby="shift-note-count" placeholder="Two VIPs at 8pm on table 12, both shellfish allergies…" />
        <p id="shift-note-count" className="muted mt-2 text-right text-xs">{note.length}/2000</p>
      </fieldset>
      <fieldset disabled={busy} className="panel mb-6 p-5">
        <InfoRow info={`Up to ${FOCUS_LIMIT} dishes you want the team to push today.`} className="mb-3"><h2 className="text-lg font-semibold">{`Focus items${focusIds.length ? ` · ${focusIds.length} of ${FOCUS_LIMIT}` : ""}`}</h2></InfoRow>
        <label htmlFor="shift-focus" className="sr-only">Focus items</label>
        <DishPicker id="shift-focus" items={items} disabled={itemsLoading || focusIds.length >= FOCUS_LIMIT} excludedIds={focusIds} placeholder={focusIds.length >= FOCUS_LIMIT ? "That’s " + FOCUS_LIMIT + " — remove one to add another" : focusIds.length ? "Type another dish" : "Type a dish to add it"} onPick={item => {setFocusIds(current => current.includes(item.id) ? current : [...current, item.id]); setMessage("");}} />
        {focusIds.length ? <div className="mt-3 flex flex-wrap gap-2">{focusIds.map(id => <button key={id} type="button" className="dish-chip" disabled={busy} aria-label={`Remove ${items.find(item => item.id === id)?.name ?? "focus item"} from today’s focus`} onClick={() => {setFocusIds(current => current.filter(value => value !== id));setMessage("");}}>{items.find(item => item.id === id)?.name ?? "Menu item unavailable"}<X size={13} aria-hidden="true" /></button>)}</div> : <p className="muted mt-2 text-sm">No focus today.</p>}
        {itemsLoading && <p role="status" className="muted mt-2">Loading menu items…</p>}
      </fieldset>
      <section className="panel mb-6 p-5" aria-label="86 board">
        <InfoRow info="Dishes that are out, running low, changed or new today. Your team sees them on today’s board." className="mb-3"><h2 className="text-lg font-semibold">86 board</h2></InfoRow>
        <form onSubmit={addEntry}>
          <fieldset disabled={busy || itemsLoading}>
            <div className="field"><label htmlFor="shift-item" className="sr-only">Menu item</label>{itemId ? <button type="button" id="shift-item" className="dish-chip" aria-label="Remove chosen item" onClick={() => {setItemId(""); setMessage("");}}>{items.find(item => item.id === itemId)?.name ?? "Chosen item"}<X size={13} aria-hidden="true" /></button> : <DishPicker id="shift-item" items={items} placeholder="Type a dish name" onPick={item => {setItemId(item.id); setMessage("");}} />}</div>
            <div className="category-tabs" role="group" aria-label="Status">{Object.entries(SHIFT_STATUS_LABELS).map(([value,label]) => <button key={value} type="button" aria-pressed={status === value} onClick={() => setStatus(value as ShiftBoardEntry["status"])}>{label}</button>)}</div>
            <div className="preshift-row">
              <div className="field"><label htmlFor="shift-detail" className="sr-only">Detail (optional)</label><input id="shift-detail" maxLength={200} placeholder="Detail (optional)" value={detail} onChange={e => {setDetail(e.target.value);setMessage("");}} /></div>
              <button type="submit" className="btn secondary" style={{fontWeight: 700, border: "1.5px solid var(--c-text)"}} disabled={!itemId} aria-label="Add row">Add</button>
            </div>
          </fieldset>
        </form>
        {!!entries.length && <ul className="mt-5 space-y-3">{entries.map(entry => <li key={entry.menu_item_id} className="flex items-start justify-between gap-3 border-t border-line pt-3">
          <div className="min-w-0"><p className="font-semibold">{items.find(item => item.id === entry.menu_item_id)?.name ?? "Menu item unavailable"}</p><span className={`menu-badge ${entry.status === "low" ? "cc" : ""}`}>{SHIFT_STATUS_LABELS[entry.status]}</span>{entry.detail && <p className="muted mt-2 whitespace-pre-wrap">{entry.detail}</p>}</div>
          <button type="button" className="icon-chip" disabled={busy} aria-label={`Remove ${items.find(item => item.id === entry.menu_item_id)?.name ?? "item"}`} onClick={() => {setEntries(current => current.filter(row => row.menu_item_id !== entry.menu_item_id));setMessage("");}}><X size={14} aria-hidden="true" /></button>
        </li>)}</ul>}
      </section>
      <fieldset disabled={busy} className="panel mb-6 p-5" aria-labelledby="shift-audience-heading">
        <InfoRow info="Choose who sees today’s board: everyone, the people on today’s published schedule, or only the people you pick." className="mb-3"><h2 id="shift-audience-heading" className="text-lg font-semibold">Who gets it</h2></InfoRow>
        <div className="category-tabs" aria-label="Board audience">
          <button type="button" aria-pressed={audience === "everyone"} onClick={() => {setAudience("everyone");setMessage("");}}>Everyone</button>
          <button type="button" aria-pressed={audience === "working"} onClick={() => {setAudience("working");setMessage("");}}>{`Working today${workingIds.length ? ` · ${workingIds.length}` : ""}`}</button>
          {audience === "pick" && <button type="button" aria-pressed onClick={() => {setAudience("pick");setMessage("");}}>Pick who's on</button>}
        </div>
        {audience === "everyone" ? <p className="muted mt-3">Every employee will see today's board.</p> : audience === "working" ? (workingIds.length ? <>
          <p className="muted mt-3">Only the people with a published shift today will see it.</p>
          <div className="board-pills mt-3">{workingIds.map(id => <span key={id} className="board-pill">{teamOptions.find(person => person.user_id === id)?.name || "Team member"}</span>)}</div>
        </> : <p className="muted mt-3">No one has a published shift today. Publish today's schedule first, or send it to everyone.</p>) : <>
          <div className="my-3 flex gap-2">
            <button type="button" className="btn secondary" onClick={() => {setRecipientIds(teamOptions.map(person => person.user_id));setMessage("");}}>Select all</button>
            <button type="button" className="btn secondary" onClick={() => {setRecipientIds([]);setMessage("");}}>Clear</button>
          </div>
          <ul className="space-y-2">{teamOptions.map(person => <li key={person.user_id}>
            <label className="!flex min-h-11 cursor-pointer items-center gap-3">
              <input className="!w-4 shrink-0 !p-0" type="checkbox" checked={recipientIds.includes(person.user_id)} onChange={e => {setRecipientIds(current => e.target.checked ? [...current, person.user_id] : current.filter(id => id !== person.user_id));setMessage("");}} />
              <span className="employee-avatar" aria-hidden="true">{(person.name || "Team member").trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase()}</span>
              <span className="min-w-0 break-words">{person.name || "Team member"}</span>
            </label>
          </li>)}</ul>
          <p className="muted mt-3" role="status">{recipientIds.length} of {teamOptions.length} selected</p>
          {!recipientIds.length && <p className="muted mt-2">No one selected means the whole team will see today's board.</p>}
        </>}
      </fieldset>
      <div className="preshift-post"><button type="button" className="btn" disabled={busy || itemsLoading} onClick={() => void post()}>{busy ? "Posting…" : "Post to the floor"}</button></div>
      {error && <button type="button" className="btn secondary ml-4" disabled={busy} onClick={() => {void loadBoard();void refreshItems().catch(e => setError(e instanceof Error ? e.message : "Could not load menu items."));}}>Reload saved board</button>}
      
    </>}
  </section>;
}

// Light or dark, remembered on this phone. "Match my phone" is the default, so a server
// who already prefers light screens gets one without finding a setting.
type Theme = "system" | "light" | "dark";
function ThemeChoice() {
  const [theme, setTheme] = useState<Theme>("system");
  useEffect(() => {
    let saved: Theme = "system";
    try { saved = (localStorage.getItem("heat-theme") as Theme) || "system"; } catch {}
    setTheme(saved);
  }, []);
  function choose(next: Theme) {
    setTheme(next);
    try { localStorage.setItem("heat-theme", next); } catch {}
    const root = document.documentElement;
    if (next === "system") root.removeAttribute("data-theme");
    else root.setAttribute("data-theme", next);
  }
  return <div className="theme-choice mt-6">
    <p className="eyebrow muted mb-2">Appearance</p>
    <div className="category-tabs" role="group" aria-label="Appearance">
      {([["system", "Auto"], ["light", "Light"], ["dark", "Dark"]] as const).map(([value, label]) =>
        <button key={value} type="button" aria-pressed={theme === value} onClick={() => choose(value)}>{label}</button>)}
    </div>
  </div>;
}
// The owner can rename themselves. Employees are renamed by a manager from the Team tab.
function AccountName({user}: {user: User}) {
  const saved = String(user.user_metadata?.display_name || user.user_metadata?.full_name || "").trim();
  const [name, setName] = useState(String(user.user_metadata?.display_name || user.user_metadata?.full_name || ""));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function save() {
    if (!supabase || busy) return;
    const trimmed = name.trim();
    if (!trimmed) {setError("Enter the name your team should see."); return;}
    setBusy(true); setError(""); setMessage("");
    const result = await supabase.auth.updateUser({data: {display_name: trimmed}});
    setBusy(false);
    if (result.error) {setError(result.error.message); return;}
    setMessage("Name updated.");
  }
  // Once a name exists this is done with: change it later from the Team tab.
  if (saved && !message) return null;
  return <section className="panel mt-7 p-5" aria-label="Your account">
    <h2 className="text-xl font-semibold">Your name</h2>
    <p className="muted mt-2 text-sm">What your team sees on the board, and beside anything you review. You can change it later from the Team tab.</p>
    <Notice text={error} error /><Notice text={message} />
    <div className="account-name-row mt-4">
      <input id="account-name" aria-label="Your name" maxLength={80} value={name} disabled={busy} onChange={e => {setName(e.target.value); setMessage(""); setError("");}} />
      <button type="button" className="btn secondary" disabled={busy} onClick={() => void save()}>{busy ? "Saving\u2026" : "Save"}</button>
    </div>
  </section>;
}
type TeamMember = {user_id: string; name: string; role: string; is_owner: boolean; items_taken: number; correct_sum: number; total_sum: number; needs_review: number; last_attempt_at: string | null};
type TeamAttempt = {attempt_count: number; menu_item_id: string; item_name: string; correct: number; total: number; created_at: string; needs_review: boolean};
type TeamAssignment = {id: string; menu_item_id: string; item_name: string; note: string; due_on: string | null; created_at: string};
// Suggestions, not a list to choose from: every kitchen names its jobs differently,
// and a restaurant that calls somebody a captain should be able to type captain.
const TEAM_ROLES = POSITIONS;
const POSITION_GROUPS = [
  {key: "foh", label: "FOH", title: "Front of house", positions: FOH_POSITIONS},
  {key: "boh", label: "BOH", title: "Kitchen", positions: KITCHEN_POSITIONS},
] as const;
const samePosition = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

// Positions in two short groups: FOH and BOH. Tapping one shows its positions; the group holding the
// chosen position starts open and says which one it is. "Other" is for whatever this restaurant calls the job.
function PositionChips({value, otherOn, onPick, onOther, before}: {value: string; otherOn: boolean; onPick: (position: string) => void; onOther: () => void; before?: ReactNode}) {
  const holder = POSITION_GROUPS.find(g => g.positions.some(p => samePosition(p, value)));
  const [open, setOpen] = useState<"foh" | "boh" | null>(holder?.key ?? null);
  const shown = POSITION_GROUPS.find(g => g.key === open);
  return <>
    <div className="word-chips">
      {before}
      {POSITION_GROUPS.map(group => {
        const picked = group.positions.find(p => samePosition(p, value));
        return <button key={group.key} type="button" className="word-chip position-group" aria-expanded={open === group.key} aria-pressed={!!picked && !otherOn} title={group.title}
          onClick={() => setOpen(open === group.key ? null : group.key)}>
          <b>{group.label}</b>{picked && !otherOn ? <span>{` · ${picked}`}</span> : <small>{group.title}</small>}<ChevronDown size={14} aria-hidden="true" className={open === group.key ? "rotate-180" : ""} />
        </button>;
      })}
      <button type="button" className="word-chip" aria-pressed={otherOn} onClick={onOther}><Plus size={14} />Other</button>
    </div>
    {shown && <div className="word-chips position-list" role="group" aria-label={shown.title}>
      {shown.positions.map(position => <button key={position} type="button" className="word-chip" aria-pressed={!otherOn && samePosition(position, value)} onClick={() => onPick(position)}>{position}</button>)}
    </div>}
  </>;
}

// Which job an invite link is for (migration 042). "Anyone" is the restaurant's plain link; each
// position has a link of its own, and whoever joins with it starts in that position.
function InviteFor({restaurantId, busy, action, current, onAnyone, onPick}: {restaurantId: string; busy: boolean; action: (work: () => Promise<void>) => Promise<void>; current: string; onAnyone: () => void; onPick: (role: string, token: string) => void}) {
  const [typing, setTyping] = useState(false);
  const [custom, setCustom] = useState("");
  const pick = (role: string, fresh = false) => void action(async () => {
    if (!supabase) throw new Error("Please reconnect to your workspace.");
    const result = await supabase.rpc("create_position_invite", {rid: restaurantId, member_role: role, fresh});
    if (result.error) throw new Error(result.error.message.includes("create_position_invite") ? "Invite links for a position need database update 042." : result.error.message);
    onPick(role, result.data as string);
  });
  const isChip = TEAM_ROLES.some(value => value.toLowerCase() === current.toLowerCase());
  return <fieldset className="mb-4" disabled={busy}>
    <legend className="mb-2 block text-sm font-semibold">Link for</legend>
    <PositionChips value={current} otherOn={typing || (!!current && !isChip)} onPick={value => {setTyping(false);pick(value);}} onOther={() => setTyping(true)}
      before={<button type="button" className="word-chip" aria-pressed={!current && !typing} onClick={() => {setTyping(false);onAnyone();}}>Anyone</button>} />
    {typing && <form className="mt-3 flex gap-2" onSubmit={event => {event.preventDefault();if (custom.trim()) {setTyping(false);pick(custom.trim());}}}>
      <input id="invite-position" aria-label="Position for this link" maxLength={40} value={custom} placeholder="Captain, maître d’, expo…" onChange={e => setCustom(e.target.value)} />
      <button className="btn secondary shrink-0" disabled={!custom.trim()}>Create link</button>
    </form>}
    <p className="muted mt-3 text-sm">{current ? `Whoever joins with this link starts as ${current}.` : "Whoever joins with this link starts as Server until you choose their position below."}</p>
    {current && <button type="button" className="btn secondary mt-3" onClick={() => pick(current, true)}>Replace this link</button>}
  </fieldset>;
}
function teamLastActive(value: string | null) {
  if (!value) return "Not started yet";
  const date = new Date(value), today = new Date();
  const day = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  const days = Math.max(0, Math.round((day(today) - day(date)) / 86400000));
  return days === 0 ? "Today" : days === 1 ? "Yesterday" : days < 7 ? `${days} days ago` : `${Math.floor(days / 7)} ${days < 14 ? "week" : "weeks"} ago`;
}
function TeamSummary({member, total}: {member: TeamMember; total: number}) {
  return <div className="team-summary"><p className="text-sm">{member.items_taken} of {total} completed · {member.total_sum ? `${Math.round(member.correct_sum / member.total_sum * 100)}% accuracy` : "No quiz results"}</p><p className="muted mt-1 text-xs">{teamLastActive(member.last_attempt_at)}</p></div>;
}
// Five areas, because those are the five places anything can be changed.
// Allergy is not one of them: it is a lookup screen everybody already reads, and
// allergens are typed on the dish card -- so the content library chip is the allergen chip.
const ACCESS_AREAS: {key: string; label: string}[] = [
  {key: "library", label: "Content library"},
  {key: "words", label: "Words, Guides & Our story"},
  {key: "standards", label: "Standards"},
  {key: "preshift", label: "Pre-shift"},
  {key: "team", label: "Team"},
  {key: "schedule_foh", label: "Schedule: front of house"},
  {key: "schedule_boh", label: "Schedule: kitchen"},
];
// Team access builds the whole schedule, so it can also hand out the two schedule chips (048).
const canGive = (key: string, mine: string[]) => mine.includes(key) || (key.startsWith("schedule_") && mine.includes("team"));
function accessSummary(held: string[]) {
  if (held.length >= ACCESS_AREAS.length) return "Full access";
  if (!held.length) return "Read only";
  return held.length === 1 ? "1 area" : held.length + " areas";
}
// Reading is not a chip: everyone reads everything, which is what HEAT is for.
// A chip means "can change things here", and nothing ticked is what a new hire gets.
function AccessPanel({restaurantId, member, current, myAccess, meId, busy, action, setMessage, onSaved}: {restaurantId: string; member: TeamMember; current: string[]; myAccess: string[]; meId: string; busy: boolean; action: (work: () => Promise<void>) => Promise<void>; setMessage: (text: string) => void; onSaved: () => Promise<void>}) {
  const saved = [...current].sort().join(",");
  const [picked, setPicked] = useState<string[]>(current);
  // A different person, or a save that went through, resets what is ticked.
  useEffect(() => {setPicked(current);}, [saved, member.user_id]);
  const firstName = member.name.trim().split(/\s+/)[0] || "They";
  const self = member.user_id === meId;
  const missing = ACCESS_AREAS.some(area => !canGive(area.key, myAccess));
  if (member.is_owner) return <section className="panel my-5 p-5"><h3 className="text-lg font-semibold">Can change</h3><p className="muted mt-2 text-sm">Everything. The owner&rsquo;s access is not a setting, so there is nothing here to switch off.</p></section>;
  return <section className="panel my-5 p-5">
    <h3 className="text-lg font-semibold">Can change</h3>
    <p className="muted mt-2 text-sm">{firstName} reads everything either way. Tick where they can add, edit and delete.</p>
    <div className="word-chips mt-4">{ACCESS_AREAS.map(area => {
      const held = picked.includes(area.key);
      return <button key={area.key} type="button" className="word-chip" aria-pressed={held} disabled={busy || self || !canGive(area.key, myAccess)} onClick={() => setPicked(held ? picked.filter(key => key !== area.key) : [...picked, area.key])}>{area.label}</button>;
    })}</div>
    <p className="muted mt-4 text-sm"><strong>Content library</strong> covers dishes, cocktails, wine &amp; sake &mdash; and their allergens. Anyone with it can change what a guest with an allergy is told.</p>
    <p className="muted mt-2 text-sm"><strong>Schedule</strong>: a floor manager gets front of house, the head chef or sous chef gets kitchen. They build, publish and approve changes and time off for their side only. Team builds both.</p>
    {self && <p className="muted mt-2 text-sm">This is you. Nobody can change their own access &mdash; ask the owner or a GM.</p>}
    {!self && missing && <p className="muted mt-2 text-sm">Dimmed areas are ones you do not hold yourself. You can only hand out access you have.</p>}
    {!self && <button className="btn mt-4" disabled={busy || [...picked].sort().join(",") === saved} onClick={() => void action(async () => {
      if (!supabase) throw new Error("Please reconnect to your workspace.");
      const result = await supabase.rpc("set_member_access", {rid: restaurantId, learner_id: member.user_id, new_access: picked});
      if (result.error) throw new Error(result.error.message);
      await onSaved();setMessage("Access saved.");
    })}>Save access</button>}
  </section>;
}
function TeamWorkspace({restaurantId, restaurantName, items, itemsLoading, busy, action, setMessage, onOpenItem, myAccess, meId, onViewing, openMemberId, onOpened}: {restaurantId: string; restaurantName: string; items: MenuItem[]; itemsLoading: boolean; busy: boolean; action: (work: () => Promise<void>) => Promise<void>; setMessage: (text: string) => void; onOpenItem: (item: MenuItem) => void; myAccess: string[]; meId: string; onViewing: (id: string | null) => void; openMemberId?: string | null; onOpened?: () => void}) {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [accessRows, setAccessRows] = useState<Record<string, string[]>>({});
  const [learnerId, setLearnerId] = useState<string | null>(null);
  const [completions, setCompletions] = useState<Completion[]>([]);
  const [teamQuery, setTeamQuery] = useState("");
  // Members whose position nobody has chosen yet (042): asked for here instead of assumed to be Server.
  const [unplaced, setUnplaced] = useState<Set<string>>(new Set());
  // Opening somebody is a screen of its own: the page hides the invite panel while it is up.
  const openMember = (id: string | null) => {
    setLearnerId(id); onViewing(id);
    // Opening someone counts as seeing what they finished; a red one stays until it is dealt with.
    if (id && supabase) void Promise.resolve(supabase.rpc("mark_member_completions_seen", {rid: restaurantId, learner: id})).then(() => setCompletions(rows => rows.map(row => row.learner_id === id ? {...row, seen: true} : row)));
  };
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const loadRoster = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);setError("");
    try {
      if (!supabase) throw new Error("Please reconnect to your workspace.");
      const result = await supabase.rpc("team_learning_roster", {rid: restaurantId});
      if (result.error) throw new Error(result.error.message);
      if (request === sequence.current) setMembers(result.data as TeamMember[]);
      const rights = await supabase.rpc("team_access", {rid: restaurantId});
      if (rights.error) throw new Error(rights.error.message);
      const open = await supabase.rpc("team_without_position", {rid: restaurantId});
      if (!open.error && request === sequence.current) setUnplaced(new Set((open.data ?? []) as string[]));
      const done = await supabase.rpc("team_completions", {rid: restaurantId});
      if (!done.error && request === sequence.current) setCompletions((done.data ?? []) as Completion[]);
      if (request === sequence.current) {
        const map: Record<string, string[]> = {};
        for (const row of ((rights.data as {user_id: string; access: string[]}[]) || [])) map[row.user_id] = row.access || [];
        setAccessRows(map);
      }
    } catch (e) {
      if (request === sequence.current) setError(e instanceof Error ? e.message : "Could not load team progress.");
    } finally {if (request === sequence.current) setLoading(false);}
  }, [restaurantId]);
  useEffect(() => {void loadRoster();return () => {sequence.current++;};}, [loadRoster]);
  // Arriving from a line on Home: open that person straight away.
  useEffect(() => {if (openMemberId) {openMember(openMemberId); onOpened?.();}}, [openMemberId]);
  const member = members.find(row => row.user_id === learnerId);
  if (loading || itemsLoading) return <p role="status" className="muted py-8">Loading team progress…</p>;
  if (error) return <section className="panel my-6 p-5"><p role="alert">{error}</p><button className="btn secondary mt-3" onClick={() => void loadRoster()}>Try again</button></section>;
  if (member) return <TeamMemberDetail key={member.user_id} restaurantId={restaurantId} restaurantName={restaurantName} member={member} needsPosition={unplaced.has(member.user_id)} items={items} busy={busy} action={action} setMessage={setMessage} onBack={() => openMember(null)} onReload={loadRoster} onRemoved={async () => {openMember(null);await loadRoster();}} onOpenItem={onOpenItem} access={member.is_owner ? ACCESS_AREAS.map(area => area.key) : (accessRows[member.user_id] || [])} myAccess={myAccess} meId={meId} />;
  const needle = teamQuery.trim().toLowerCase();
  const shown = needle ? members.filter(row => row.name.toLowerCase().includes(needle) || row.role.toLowerCase().includes(needle)) : members;
  return <section className="mt-5" aria-label="Team roster"><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-xl font-semibold">Your team</h2><button type="button" className="icon-chip" aria-label="Refresh the team" title="Refresh" disabled={busy} onClick={() => void loadRoster()}><RotateCcw size={15} /></button></div>{!!members.length && <div className="team-search"><Search size={18} aria-hidden="true" /><input type="text" aria-label="Search your team" placeholder="Search your team" autoComplete="off" value={teamQuery} onChange={e => setTeamQuery(e.target.value)} />{teamQuery && <button type="button" className="team-search-clear" aria-label="Clear the search" onClick={() => setTeamQuery("")}><X size={16} aria-hidden="true" /></button>}</div>}{unplaced.size > 0 && <p className="notice mb-3">{unplaced.size === 1 ? "1 new person needs a position. Until you choose one, they show as Server on the schedule." : `${unplaced.size} new people need a position. Until you choose one, they show as Server on the schedule.`}</p>}<div className="space-y-2">{shown.map(row => <button key={row.user_id} className="panel compact-menu-row team-row w-full text-left" disabled={busy} onClick={() => {openMember(row.user_id);setMessage("");}}>
    <span className="employee-avatar" aria-hidden="true">{row.name.split(/\s+/).slice(0,2).map(part => part[0]).join("").toUpperCase()}</span>
    <span className="min-w-0 flex-1"><span className="block break-words font-semibold">{row.name}</span><span className="muted block text-xs">{unplaced.has(row.user_id) ? "No position yet" : row.role}{row.is_owner ? " · Owner" : ""}</span></span>
    {unplaced.has(row.user_id) && <span className="team-review-pill">Choose position</span>}
    {row.needs_review > 0 ? <span className="team-review-pill">{row.needs_review} to review</span> : null}
  </button>)}{!!members.length && !shown.length && <p className="muted py-6 text-center">No one matches “{teamQuery.trim()}”.</p>}</div></section>;
}
function TeamMemberDetail({restaurantId, restaurantName, member, needsPosition = false, items, busy, action, setMessage, onBack, onReload, onRemoved, onOpenItem, access, myAccess, meId}: {restaurantId: string; restaurantName: string; member: TeamMember; needsPosition?: boolean; items: MenuItem[]; busy: boolean; action: (work: () => Promise<void>) => Promise<void>; setMessage: (text: string) => void; onBack: () => void; onReload: () => Promise<void>; onRemoved: () => Promise<void>; onOpenItem: (item: MenuItem) => void; access: string[]; myAccess: string[]; meId: string}) {
  const {namesFor, labelFor, rank} = useTaxonomy();
  const [name, setName] = useState(member.name);
  // Name & role and Can change start closed, so what this person studies is the first thing you see.
  // Someone new with no position yet opens straight on it, with nothing picked for them.
  const [openPanel, setOpenPanel] = useState<"" | "profile" | "access">(needsPosition ? "profile" : "");
  const [role, setRole] = useState(needsPosition ? "" : member.role);
  // The box starts hidden unless this person already has a title none of the chips offer.
  const [typing, setTyping] = useState(!needsPosition && !TEAM_ROLES.some(value => value.toLowerCase() === member.role.trim().toLowerCase()));
  const [attempts, setAttempts] = useState<TeamAttempt[]>([]);
  const [assignments, setAssignments] = useState<TeamAssignment[]>([]);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const sequence = useRef(0);
  const loadDetail = useCallback(async () => {
    const request = ++sequence.current;
    setLoading(true);setError("");
    try {
      if (!supabase) throw new Error("Please reconnect to your workspace.");
      const [scores, assigned] = await Promise.all([
        supabase.rpc("team_member_print_progress", {rid: restaurantId, learner_id: member.user_id}),
        supabase.rpc("team_member_assignments", {rid: restaurantId, learner_id: member.user_id}),
      ]);
      if (scores.error) throw new Error(scores.error.message);
      if (assigned.error) throw new Error(assigned.error.message);
      if (request === sequence.current) {setAttempts(scores.data as TeamAttempt[]);setAssignments(assigned.data as TeamAssignment[]);}
    } catch (e) {
      if (request === sequence.current) setError(e instanceof Error ? e.message : "Could not load member details.");
    } finally {if (request === sequence.current) setLoading(false);}
  }, [restaurantId, member.user_id]);
  useEffect(() => {void loadDetail();return () => {sequence.current++;};}, [loadDetail]);
  // The sign-in email, so a manager can tell someone which one they used. If the database has not been updated yet, the line is simply left off.
  useEffect(() => {
    let live = true;
    if (supabase) void Promise.resolve(supabase.rpc("team_member_email", {rid: restaurantId, learner_id: member.user_id})).then(result => {
      if (live) setEmail(!result.error && typeof result.data === "string" ? result.data : "");
    });
    return () => {live = false;};
  }, [restaurantId, member.user_id]);
  const review = attempts.filter(row => learningStatus(row) !== "At target").sort((a,b) => a.correct / a.total - b.correct / b.total);
  // What happened with each assigned item. The scores above already know; the Assigned list just never asked.
  const assignmentStatus = (assignment: TeamAssignment) => {
    const score = attempts.find(row => row.menu_item_id === assignment.menu_item_id);
    if (!score || !score.total) return {done: false, label: "Not completed", tone: "unknown"};
    const passed = learningStatus(score) === "At target";
    // A pass from before the assignment does not finish it: the employee is being asked to study it again.
    if (passed && new Date(score.created_at).getTime() < new Date(assignment.created_at).getTime()) return {done: false, label: `Passed ${score.correct}/${score.total} before this was assigned`, tone: "unknown"};
    return {done: passed, label: `${score.needs_review ? "Previous: " : ""}${score.correct}/${score.total} · ${learningStatus(score)}`, tone: passed ? "ok" : "cc"};
  };
  // Still to do first, finished at the bottom; due date order holds inside each group.
  const assignmentRows = assignments.map(assignment => ({assignment, status: assignmentStatus(assignment)})).sort((a, b) => Number(a.status.done) - Number(b.status.done));
  const assignmentsDone = assignmentRows.filter(row => row.status.done).length;
  // Dishes already handed over and not finished: the list shows "Assigned" instead of a button.
  const assignedIds = new Set(assignmentRows.filter(row => !row.status.done).map(row => row.assignment.menu_item_id));
  const scores = new Map(attempts.filter(row => row.total > 0).map(row => [row.menu_item_id, `${learningStatus(row) === "At target" ? "Passed" : "Needs practice"} ${row.correct}/${row.total}`] as const));
  return <section className="mt-7">
    <div className="mb-5 flex items-center justify-between gap-3"><button className="btn secondary" disabled={busy} onClick={onBack}><ArrowLeft size={16} />Team</button>{!loading && !error && <DownloadSheet variant="button" buttonLabel="Summary" label="Download employee training summary" build={async () => employeeSheet({name: member.name, role: member.role, owner: member.is_owner, access: ACCESS_AREAS.filter(area => access.includes(area.key)).map(area => area.label), items, results: attempts, assignments}, {restaurant: restaurantName})} />}</div>
    <div className="mb-5 flex items-start gap-3"><span className="employee-avatar" aria-hidden="true">{member.name.split(/\s+/).slice(0,2).map(part => part[0]).join("").toUpperCase()}</span><div className="min-w-0"><h2 className="text-xl font-semibold break-words">{member.name}</h2><p className="muted mt-1 text-sm">{needsPosition ? "No position yet" : member.role}{member.is_owner ? " · Owner" : ""}</p><p className="muted mt-1 text-sm">{member.last_attempt_at ? `Last quiz ${teamLastActive(member.last_attempt_at).toLowerCase()}` : "No quizzes yet"}</p>{email && <p className="muted mt-1 text-sm">Signs in with <span className="break-all font-semibold" style={{color: "var(--c-text)"}}>{email}</span></p>}</div></div>
    <div className="team-chips" role="group" aria-label="Edit this person" style={{gap: 12, margin: "0 0 12px"}}>
      <button type="button" className="team-chip" aria-expanded={openPanel === "profile"} onClick={() => setOpenPanel(openPanel === "profile" ? "" : "profile")}>Name &amp; role<small>{needsPosition ? "Choose position" : member.role}</small></button>
      <button type="button" className="team-chip" aria-expanded={openPanel === "access"} onClick={() => setOpenPanel(openPanel === "access" ? "" : "access")}>Can change<small>{accessSummary(member.is_owner ? ACCESS_AREAS.map(area => area.key) : access)}</small></button>
    </div>
    <div hidden={openPanel !== "profile"}>
    <form className="panel my-5 p-5" onSubmit={event => {event.preventDefault();void action(async () => {
      if (!supabase) throw new Error("Please reconnect to your workspace.");
      const result = await supabase.rpc("set_member_profile", {rid: restaurantId, learner_id: member.user_id, name, member_role: role});
      if (result.error) throw new Error(result.error.message);
      // Renaming yourself here must also move the name in the header and on anything you sign.
      const me = await supabase.auth.getUser();
      if (me.data.user?.id === member.user_id) await supabase.auth.updateUser({data: {display_name: name.trim()}});
      await onReload();setMessage("Team member profile saved.");
    });}}><fieldset disabled={busy}><Field label="Name"><input id="team-member-name" maxLength={80} value={name} onChange={e => setName(e.target.value)} /></Field>
        {/* Chips, not a dropdown: a datalist filters its own suggestions against whatever is already
          typed, so somebody already called Server was only ever offered Server and Server assistant.
          The box is hidden until it is needed, because a chip already says what the title is. */}
        <fieldset className="field mt-4"><legend className="mb-2 block text-sm font-semibold">Role</legend>
          <PositionChips value={role} otherOn={typing} onPick={value => {setTyping(false);setRole(value);}} onOther={() => setTyping(true)} />
          {typing && <><input id="team-member-role" className="mt-3" maxLength={40} value={role} placeholder="Captain, maître d’, expo…" onChange={e => setRole(e.target.value)} /><p className="muted mt-2 text-xs">Whatever this restaurant calls the job.</p></>}
        </fieldset>
        {needsPosition && !role.trim() && <p className="muted mt-3 text-xs">Choose a position to save. It's what the schedule uses for their shifts.</p>}
        <button className="btn mt-4" type="submit" disabled={!role.trim()}>Save profile</button></fieldset></form></div>
    <div hidden={openPanel !== "access"}><AccessPanel restaurantId={restaurantId} member={member} current={access} myAccess={myAccess} meId={meId} busy={busy} action={action} setMessage={setMessage} onSaved={onReload} /></div>
    {loading ? <p role="status" className="muted py-8">Loading member details…</p> : error ? <div className="panel p-5"><p role="alert">{error}</p><button className="btn secondary mt-3" onClick={() => void loadDetail()}>Try again</button></div> : <>
      <AssignDishes items={items} practiceIds={new Set(review.map(row => row.menu_item_id))} quizzedIds={new Set(attempts.filter(row => row.total > 0).map(row => row.menu_item_id))} scores={scores} assignedIds={assignedIds} busy={busy} group={list => CONTENT_TYPES.map(type => ({key: type, heading: labelFor(type).heading, items: inMenuOrder(list.filter(item => contentTypeOf(item) === type), namesFor(type))})).filter(section => section.items.length)} onAssign={(ids, note, due) => action(async () => {
        if (!supabase) throw new Error("Please reconnect to your workspace.");
        const result = await supabase.rpc("assign_menu_items", {rid: restaurantId, learner_id: member.user_id, mids: ids, note, due: due || null});
        if (result.error) throw new Error(result.error.message);
        notify("study_assigned", restaurantId, member.user_id);
        await loadDetail();setMessage(ids.length === 1 ? "Study item assigned." : "Study items assigned.");
      })} />
      {!!assignments.length && <details className="panel team-fold" style={{margin: "12px 0"}}><summary>Assigned · {assignments.length}{assignmentsDone ? ` · ${assignmentsDone} done` : ""}</summary><div className="team-fold-body"><ul className="space-y-3">{assignmentRows.map(({assignment, status}) => <li key={assignment.id} className="flex items-start justify-between gap-3 border-t border-line pt-3"><div className="min-w-0"><p className="font-semibold">{assignment.item_name}</p><p className="mt-2"><span className={`menu-badge ${status.tone}`}>{status.label}</span></p>{assignment.note && <p className="muted mt-1 whitespace-pre-wrap">{assignment.note}</p>}{assignment.due_on && <p className="muted mt-1 text-xs">Due {new Date(`${assignment.due_on}T12:00:00`).toLocaleDateString(undefined,{weekday:"long",month:"short",day:"numeric"})}</p>}</div><button className="btn secondary shrink-0" disabled={busy} aria-label={`Remove assignment for ${assignment.item_name}`} onClick={() => void action(async () => {
          if (!supabase) throw new Error("Please reconnect to your workspace.");
          const result = await supabase.rpc("remove_assignment", {assignment_id: assignment.id});
          if (result.error) throw new Error(result.error.message);
          await loadDetail();setMessage("Assignment removed.");
        })}>Remove</button></li>)}</ul></div></details>}
    </>}
    {!member.is_owner && <section style={{marginTop: 12}}>{confirmRemove ? <div className="panel p-5"><p>Remove {member.name} from the team?</p><div className="mt-4 flex flex-wrap gap-3"><button className="btn secondary" disabled={busy} onClick={() => void action(async () => {
      if (!supabase) throw new Error("Please reconnect to your workspace.");
      const result = await supabase.rpc("remove_team_member", {rid: restaurantId, learner_id: member.user_id});
      if (result.error) throw new Error(result.error.message);
      await onRemoved();setMessage(`${member.name} removed from the team. Their study history is preserved.`);
    })}>Yes, remove</button><button className="btn secondary" disabled={busy} onClick={() => setConfirmRemove(false)}>Cancel</button></div></div> : <button className="btn secondary team-remove" disabled={busy} onClick={() => setConfirmRemove(true)}>Remove from team</button>}</section>}
  </section>;
}

function Workspace({
  user,
  invitation,
  clearInvite,
}: {
  user: User;
  invitation: string;
  clearInvite: () => void;
}) {
  const [restaurants, setRestaurants] = useState<Restaurant[]>([]);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [selected, setSelected] = useState("");
  const [items, setItems] = useState<MenuItem[]>([]);
  const [detailItem, setDetailItem] = useState<MenuItem | null>(null);
  const [quizEditing, setQuizEditing] = useState(false);
  const [quizItem, setQuizItem] = useState<MenuItem | null>(null);
  const [quizProgress, setQuizProgress] = useState<ProgressRow[]>([]);
  const [progressLoading, setProgressLoading] = useState(true);
  const [progressError, setProgressError] = useState("");
  const progressSequence = useRef(0);
  const loadProgress = useCallback(async () => {
    const sequence = ++progressSequence.current;
    setProgressLoading(true);setProgressError("");
    try {if(!selected){setQuizProgress([]);return;}const {data,error}=await supabase!.rpc("get_quiz_progress",{rid:selected});if(error)throw error;if(sequence===progressSequence.current)setQuizProgress(data as ProgressRow[]);}
    catch(e){if(sequence===progressSequence.current)setProgressError(e instanceof Error?e.message:"Could not load progress");}
    finally{if(sequence===progressSequence.current)setProgressLoading(false);}
  },[selected]);
  useEffect(()=>{setQuizItem(null);setQuizProgress([]);void loadProgress();},[loadProgress]);
  const [loading, setLoading] = useState(true);
  const [itemsLoading, setItemsLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [adding, setAdding] = useState(false);
  const [cards, setCards] = useState<{ready: boolean; rows: CardFieldRow[]}>({ready: false, rows: []});
  const [editing, setEditing] = useState<MenuItem | undefined>();
  const [creating, setCreating] = useState(
    user.user_metadata?.onboarding_role === "manager" && !invitation,
  );
  const [employeeView, setEmployeeView] = useState(false);
  const [view, setView] = useState<View>("home");
  // Where a card was opened from, so its back button can return there instead of
  // always landing in the library. Null is the old behaviour: back goes to the menu.
  const [cameFrom, setCameFrom] = useState<{view: View; label: string; search?: boolean} | null>(null);
  const [allergyPick, setAllergyPick] = useState<AllergyMemory>(ALLERGY_START);
  const allergyScroll = useRef(0);
  const [searchOpen, setSearchOpen] = useState(false);
  // What was typed and which dishes matched, kept so the card opened from a search can lead back to it.
  const [searchText, setSearchText] = useState("");
  const [searchMatches, setSearchMatches] = useState<MenuItem[] | null>(null);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [contentType, setContentType] = useState<ContentType>("food");
  const [category, setCategory] = useState("All");
  const [query, setQuery] = useState("");
  const [navOpen, setNavOpen] = useState(false);
  const [libraryExpanded, setLibraryExpanded] = useState(false);
  const [hideTaken, setHideTaken] = useState(false);
  const [studyType, setStudyType] = useState<ContentType>("food");
  const [shiftFlags, setShiftFlags] = useState<Record<string, ShiftBoardEntry>>({});
  const [customTerms, setCustomTerms] = useState<CustomTerm[]>([]);
  const [taxonomy, setTaxonomy] = useState<Taxonomy>({categories: [], sections: {}});
  const glossary = useMemo(() => mergeTerms(customTerms), [customTerms]);
  const libraryItems = items.filter(item => contentTypeOf(item) === contentType);
  const takenIds = new Set(quizProgress.map(row => row.menu_item_id));
  const categoryItems = filterContent(items, category, query, contentType);
  const notTakenCount = categoryItems.filter(item => !takenIds.has(item.id)).length;
  const categoryOrder = namesIn(taxonomy, contentType);
  // Menu order, not database order: the restaurant's own section order. Items inside a section keep the order they came in.
  const filteredItems = (hideTaken ? categoryItems.filter(item => !takenIds.has(item.id)) : categoryItems)
    .slice().sort((a, b) => categoryOrder.indexOf(categoryOf(a)) - categoryOrder.indexOf(categoryOf(b)));
  function openCard(item: MenuItem) {
    setDetailItem(item);
    window.scrollTo(0, 0);
  }
  // Swiping between cards, one-handed. The arrows stay: this is a second way through, not a replacement.
  const swipe = useRef<{x: number; y: number; lock: "" | "swipe" | "scroll"} | null>(null);
  const cardSwipe = {
    onTouchStart: (event: TouchEvent) => {
      const touch = event.touches[0];
      // One finger, and never from the screen edge — that belongs to the browser's own back gesture.
      swipe.current = event.touches.length === 1 && touch.clientX > 25 && touch.clientX < window.innerWidth - 25
        ? {x: touch.clientX, y: touch.clientY, lock: ""}
        : null;
    },
    onTouchMove: (event: TouchEvent) => {
      const start = swipe.current;
      if (!start) return;
      if (event.touches.length > 1) {swipe.current = null; return;}
      if (start.lock) return;
      const touch = event.touches[0];
      const across = Math.abs(touch.clientX - start.x), down = Math.abs(touch.clientY - start.y);
      // Decided once, early: a gesture that begins vertical is a scroll and stays a scroll,
      // so reading the ingredients can never flick you onto the next dish.
      if (across > 10 || down > 10) start.lock = down > across ? "scroll" : "swipe";
    },
    onTouchEnd: (event: TouchEvent) => {
      const start = swipe.current;
      swipe.current = null;
      if (!start || start.lock !== "swipe" || !detailItem) return;
      const across = event.changedTouches[0].clientX - start.x;
      if (Math.abs(across) < 60) return;
      const index = detailItems.findIndex(item => item.id === detailItem.id);
      if (index < 0) return;
      // Stop at the ends rather than looping: working through a list, wrapping around is disorienting.
      const wanted = across < 0 ? detailItems[index + 1] : detailItems[index - 1];
      if (wanted) openCard(wanted);
    },
  };

  const counts = namesIn(taxonomy, contentType).map(name => ({name, count: libraryItems.filter(i => categoryOf(i) === name).length}));
  function navigate(next: View, nextCategory = "All", nextType: ContentType = "food") {
    window.scrollTo(0, 0);
    if (next === "team" && view === "team") setTeamReset(count => count + 1);
    if (next !== "allergy" || view !== "allergy") setAllergyPick(ALLERGY_START);
    setDetailItem(null);setView(next); setContentType(nextType); setCategory(nextCategory); setQuery(""); setCameFrom(null);
    setQuizItem(null); setAdding(false); setEditing(undefined); setCreating(false); setNavOpen(false); setViewingMember(null);
    setError(""); setMessage(""); setScheduleTab(null); setReportsTab(null);
  }
  // Schedule straight on one of its tabs, from a chip on Home.
  const [scheduleTab, setScheduleTab] = useState<ScheduleTab | null>(null);
  function openSchedule(tab: ScheduleTab) { navigate("schedule"); setScheduleTab(tab); }
  // Shift reports straight on Past reports, from the Service part of the dashboard.
  const [reportsTab, setReportsTab] = useState<"past" | null>(null);
  function openPastReports() { navigate("reports"); setReportsTab("past"); }
  // The manager's Today, the first part of the Dashboard: what the day needs, in the order a manager asks.
  // Buttons and their dots, anything waiting (nothing shows when nothing waits), the posted pre-shift,
  // who is working, then the two doors out. Everything else that used to crowd Home waits underneath.
  function renderToday() {
    if (!restaurant) return null;
    const rid = restaurant.id;
    const canSchedule = can("team") || can("schedule_foh") || can("schedule_boh");
    return <div className="today">
      {(can("preshift") || can("team") || canSchedule) && <TodayFigures key={`figures-${rid}`} restaurantId={rid} canSchedule={canSchedule} />}
      {(can("team") || can("preshift") || can("library") || canSchedule) && <ManagerAttention key={`attention-${rid}`} restaurantId={rid} canTeam={can("team")} canSchedule={canSchedule} canReports={can("preshift") || can("team")} onOpen={openAttention} />}
      <TodayStatus key={`status-${rid}`} restaurantId={rid} canPreshift={can("preshift")} canReports={can("preshift") || can("team")} onPreshift={() => navigate("preshift")} onSideWork={() => navigate("checklists")} onReport={openPastReports} />
      {can("preshift") && <PostedPreShiftCard key={`posted-${rid}`} restaurantId={rid} items={items} restaurantName={restaurant.name} />}
      {itemsLoading ? <p role="status" className="muted py-10">Loading your library…</p> : <>
        <NextShift key={`shift-${rid}`} restaurantId={rid} userId={user.id} onOpen={() => navigate("schedule")} />
        {(can("preshift") || can("team")) && <LastShiftNote key={`last-${rid}`} restaurantId={rid} onOpen={() => navigate("reports")} />}
        {(can("preshift") || can("team") || canSchedule) && <TodayRoster key={`roster-${rid}`} restaurantId={rid} onOpen={() => openSchedule("week")} />}
        <TodayActions canAssign={can("team")} onAssign={() => navigate("team")} onLibrary={() => navigate("library")} />
        {can("team") && <RecentCompletions key={`recent-${rid}`} restaurantId={rid} onOpenMember={id => {setTeamOpenId(id);navigate("team");}} />}
        {!can("preshift") && <>
          <h2 className="text-xl font-semibold">Explore your menu</h2>
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">{counts.filter(c => c.count > 0).map(c => <button key={c.name} className="panel category-card flex items-center gap-2 p-3 text-left" onClick={() => navigate("library", c.name, contentType)}><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{c.name}</span><span className="muted mt-1 block text-xs">{c.count} {c.count === 1 ? wordsIn(taxonomy, contentType).item_one : wordsIn(taxonomy, contentType).item_many}</span></span><ArrowRight size={15} className="muted shrink-0" /></button>)}</div></>}
        {!items.length && <p className="panel muted p-6">{can("library") ? "Add your first dish to start building the library." : "Your manager hasn’t added content yet."}</p>}
        {can("library") && <div id="retake-requests"><RetakeRequests restaurantId={rid} /></div>}
        {isManager && <AccountName user={user} />}
      </>}
    </div>;
  }
  function openAttention(target: AttentionTarget) {
    if (target === "shift_changes" || target === "released") openSchedule("requests");
    else if (target === "time_off") openSchedule("timeoff");
    else if (target === "positions") navigate("team");
    else if (target === "urgent") navigate("reports");
    else document.getElementById("retake-requests")?.scrollIntoView({behavior: "smooth", block: "start"});
  }
  const [inviteLink, setInviteLink] = useState("");
  // The plain link stays at hand while the manager tries the position links (042).
  const [generalInvite, setGeneralInvite] = useState("");
  const [inviteRole, setInviteRole] = useState("");
  const [viewingMember, setViewingMember] = useState<string | null>(null);
  const [teamOpenId, setTeamOpenId] = useState<string | null>(null);
  // Tapping Team while already on Team starts the screen over, so an opened person closes and the roster comes back.
  const [teamReset, setTeamReset] = useState(0);
  const fetchSequence = useRef(0);
  const restaurant = restaurants.find((r) => r.id === selected);
  // The brand's owner runs every one of its locations, as the database already allows.
  const brand = organizations.find(o => o.id === restaurant?.organization_id);
  const ownsBrand = !!brand && brand.owner_id === user.id;
  const isOwner = restaurant?.owner_id === user.id || ownsBrand;
  const [dashboardScope, setDashboardScope] = useState<"location" | "brand">("location");
  // The guided tour: once for every new account, then on request from "Take the tour".
  const [touring, setTouring] = useState(false);
  const tourOffered = useRef(false);
  // The language chosen on another device comes along with the account.
  useEffect(() => {
    const saved = user.user_metadata?.heat_lang;
    if ((saved === "es" || saved === "en") && saved !== currentLang()) setLang(saved, false);
  }, [user]);
  useEffect(() => {
    if (tourOffered.current || loading || creating || !restaurant || tourSeen(user)) return;
    tourOffered.current = true;
    setTouring(true);
  }, [loading, creating, restaurant, user]);
  // Access is per person, not a rank: holding an area means "can change things here".
  // The owner holds every area and has no stored access to take away.
  const [access, setAccess] = useState<string[]>([]);
  useEffect(() => {
    if (!supabase || !restaurant || isOwner) {setAccess([]); return;}
    let live = true;
    void supabase.rpc("my_access", {rid: restaurant.id}).then(({data}) => {
      if (live) setAccess(Array.isArray(data) ? (data as string[]) : []);
    });
    return () => {live = false;};
  }, [restaurant?.id, isOwner]);
  // The manager home, its eyebrow and the employee-view preview belong to whoever runs the
  // content library. Somebody who only holds Pre-shift is a server with one extra tab, and
  // should still land on the employee home. manages ignores the employee-view toggle, so that
  // toggle can always switch itself back off.
  const manages = isOwner || access.includes("library");
  const isManager = manages && !employeeView;
  const can = (area: string) => !employeeView && (isOwner || access.includes(area));
  const learnerName = String(user.user_metadata?.display_name || user.user_metadata?.full_name || "Team member");
  // Weakest first, then menu order: the dish someone is actually lost on comes to the top.
  const reviewItems = items.filter(item => {const score=quizProgress.find(p=>p.menu_item_id===item.id);return score && (score.needs_review || score.correct/score.total<0.8);})
    .sort((a, b) => {
      const rate = (item: MenuItem) => {const row = quizProgress.find(p => p.menu_item_id === item.id); return row ? row.correct / row.total : 1;};
      return rate(a) - rate(b);
    });
  const detailItems = cameFrom?.search && searchMatches
    ? searchMatches
    : view === "review"
    ? reviewItems.filter(item => contentTypeOf(item) === contentTypeOf(detailItem ?? item))
    : view === "tostudy"
      ? items.filter(item => !takenIds.has(item.id) && contentTypeOf(item) === studyType)
      : filteredItems;
  const loadRestaurants = useCallback(async () => {
    if (!supabase) return;
    const result = await supabase
      .from("restaurants")
      // "*" rather than a column list, so the trial and demo columns are read when present without breaking a database that predates them.
      .select("*")
      .order("created_at");
    if (result.error) throw result.error;
    const list = result.data as Restaurant[];
    // The brands these restaurants belong to. Before migration 035 there are none, and nothing else changes.
    const brands = await supabase.from("organizations").select("id,name,owner_id");
    setOrganizations(brands.error ? [] : (brands.data as Organization[]));
    setRestaurants(list);
    if (list.length) setCreating(false);
    setSelected((current) =>
      list.some((r) => r.id === current) ? current : (list[0]?.id ?? ""),
    );
  }, []);
  useEffect(() => {
    loadRestaurants()
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [loadRestaurants]);
  const loadItems = useCallback(async () => {
    const sequence = ++fetchSequence.current;
    if (!supabase || !selected) {
      setItems([]);
      return;
    }
    setItemsLoading(true);
    setItems([]);
    try {
      const result = await supabase
        .from("menu_items")
        .select("*")
        .eq("restaurant_id", selected)
        .order("created_at", { ascending: false });
      if (result.error) throw result.error;
      const records = result.data as MenuItem[];
      const links = await photoLinks(records.map((i) => i.photo_path).filter((p): p is string => !!p));
      if (sequence === fetchSequence.current)
        setItems(
          records.map((item) => ({
            ...item,
            photo_url: item.photo_path ? links[item.photo_path] : undefined,
          })),
        );
    } finally {
      if (sequence === fetchSequence.current) setItemsLoading(false);
    }
  }, [selected]);
  // The 86 board is a nice-to-have on these screens: if it fails, the menu still loads.
  const loadShiftBoard = useCallback(async () => {
    if (!supabase || !selected) return;
    const result = await supabase.rpc("get_preshift_board", {rid: selected});
    if (result.error) return;
    const data = result.data as ShiftBoardResponse;
    const board = data?.board && data.board.service_date === data.service_date ? data.board : null;
    setShiftFlags(Object.fromEntries((board?.entries ?? []).map(entry => [entry.menu_item_id, entry])));
  }, [selected]);
  // The manager's own words. If they can't load, cards fall back to the built-in list.
  const loadGlossary = useCallback(async () => {
    if (!supabase || !selected) return;
    const result = await supabase.from("glossary_terms").select("id, term, say, means, note, also, hidden, story, photo_path").eq("restaurant_id", selected);
    if (!result.error) setCustomTerms((result.data ?? []) as CustomTerm[]);
  }, [selected]);
  useEffect(() => { setCustomTerms([]); void loadGlossary(); }, [loadGlossary]);
  // The restaurant's own section and category names. If they can't load, a neutral starter list is used.
  const loadTaxonomy = useCallback(async () => {
    if (!supabase || !selected) return;
    const [categories, sections] = await Promise.all([
      supabase.from("menu_categories").select("content_type, name, sort_order, archived").eq("restaurant_id", selected),
      supabase.from("menu_sections").select("content_type, name, heading, about, item_one, item_many").eq("restaurant_id", selected),
    ]);
    if (categories.error || sections.error) return;
    const words: Partial<Record<ContentType, SectionWords>> = {};
    for (const row of (sections.data ?? []) as (SectionWords & {content_type: ContentType})[]) words[row.content_type] = row;
    setTaxonomy({categories: (categories.data ?? []) as MenuCategoryRow[], sections: words});
  }, [selected]);
  useEffect(() => { setTaxonomy({categories: [], sections: {}}); void loadTaxonomy(); }, [loadTaxonomy]);
  // The restaurant's own card-field settings. Until the card_fields table exists the form simply shows
  // the fields the app ships with, exactly as before.
  const loadCardFields = useCallback(async () => {
    if (!supabase || !selected) return;
    const result = await supabase.from("card_fields").select("content_type, field_key, custom, label, kind, hidden, on_card, show_team, sort_order").eq("restaurant_id", selected);
    setCards(result.error ? {ready: false, rows: []} : {ready: true, rows: (result.data ?? []) as CardFieldRow[]});
  }, [selected]);
  useEffect(() => { setCards({ready: false, rows: []}); void loadCardFields(); }, [loadCardFields]);
  useEffect(() => {
    void loadShiftBoard();
    loadItems().catch((e) => setError(e.message));
    const timer = setInterval(
      () => {
        void loadShiftBoard();
        loadItems().catch((e) => setError(e.message));
      },
      50 * 60 * 1000,
    );
    return () => {
      clearInterval(timer);
      fetchSequence.current++;
    };
  }, [loadItems]);
  async function action(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await work();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Something went wrong. Please try again.",
      );
    } finally {
      setBusy(false);
    }
  }
  async function joinRestaurant(value: string) {
    await action(async () => {
      let token = value.trim();
      if (token.includes("://")) {
        try {
          token = new URL(token).searchParams.get("invite") ?? "";
        } catch {
          throw new Error("Paste the complete invite link from your manager.");
        }
      }
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          token,
        )
      ) {
        throw new Error("Paste the complete invite link from your manager.");
      }
      const result = await supabase!.rpc("join_restaurant", {
        invite_token: token,
      });
      if (result.error) throw result.error;
      await loadRestaurants();
      setSelected(result.data);
      setCreating(false);
      clearInvite();
      setMessage("You joined the restaurant. Your menu is ready below.");
    });
  }
  async function createRestaurant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const name = String(form.get("restaurant")).trim();
    const code = String(form.get("access-code") ?? "").trim();
    if (!name) return setError("Enter a restaurant name.");
    await action(async () => {
      // The code is checked in the database, not here: it decides whether the restaurant is created at all.
      // No code means a free trial, which the database also limits: one per account, 14 days.
      const result = code
        ? await supabase!.rpc("create_restaurant_with_code", {access_code: code, restaurant_name: name})
        : await supabase!.rpc("start_trial_restaurant", {restaurant_name: name});
      if (result.error) throw new Error(result.error.message);
      // Give the new restaurant its own libraries and a starter set of sections to edit.
      await setUpLibraries(result.data as string);
      await loadRestaurants();
      setSelected(result.data as string);
      setCreating(false);
      setMessage("Restaurant created. Add your first menu item.");
    });
  }
  return (
    <GlossaryContext.Provider value={glossary}>
    <TaxonomyContext.Provider value={taxonomy}>
    <CardRowsContext.Provider value={cards.rows}>
    <div className="min-h-screen">
      <header className="app-header border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-3 px-4 py-3 md:px-9">
          <div className="flex items-center gap-3">
            <button className="rounded-lg p-2 hover:bg-raised md:hidden" aria-label="Toggle navigation" aria-expanded={navOpen} aria-controls="workspace-navigation" onClick={event => {const header = event.currentTarget.closest("header"); if (header) document.documentElement.style.setProperty("--header-h", `${Math.round(header.getBoundingClientRect().bottom)}px`); setNavOpen(!navOpen);}}><Menu size={22} /></button>
            {restaurant && !isManager ? <div className="flex items-center gap-3"><button type="button" className="header-home" aria-label="Go to Home" onClick={() => navigate("home")}><HeatIcon /></button><div><p className="text-sm font-semibold">{learnerName}</p><p className="muted text-xs uppercase tracking-widest">{restaurant.name}</p></div></div> : <button type="button" className="header-home" aria-label="Go to Home" onClick={() => navigate("home")}><Brand /></button>}
          </div>
          <div className="flex items-center gap-2">
            <span className="muted hidden max-w-56 truncate text-sm md:inline">
              {user.email}
            </span>
            <button
              type="button"
              aria-label="Allergy check"
              title="Allergy check"
              className="rounded-lg p-3 hover:bg-raised"
              onClick={() => navigate("allergy")}
            >
              <ShieldCheck size={20} />
            </button>
            <button
              type="button"
              aria-label="Search the menu"
              title="Search the menu"
              className="rounded-lg p-3 hover:bg-raised"
              onClick={() => { setSearchText(""); setSearchOpen(true); }}
            >
              <Search size={20} />
            </button>
            <button
              aria-label="Sign out"
              title="Sign out"
              className="rounded-lg p-3 hover:bg-raised"
              disabled={busy}
              onClick={() => setConfirmSignOut(true)}
            >
              <LogOut size={20} />
            </button>
          </div>
        </div>
      </header>
      {confirmSignOut && (
        <div
          className="confirm-scrim"
          onClick={() => setConfirmSignOut(false)}
          onKeyDown={event => { if (event.key === "Escape") setConfirmSignOut(false); }}
        >
          <div
            className="confirm-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sign-out-title"
            onClick={event => event.stopPropagation()}
          >
            <h2 id="sign-out-title">Sign out of HEAT?</h2>
            <p className="muted">You will need your email and password to sign back in.</p>
            <div className="confirm-actions">
              <button type="button" className="btn" autoFocus onClick={() => setConfirmSignOut(false)}>
                Stay signed in
              </button>
              <button
                type="button"
                className="btn secondary"
                disabled={busy}
                onClick={() => {
                  setConfirmSignOut(false);
                  action(async () => {
                    forgetPhotoLinks();
                    const result = await supabase!.auth.signOut();
                    if (result.error) throw result.error;
                  });
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      )}
      {searchOpen && (
        <MenuSearch
          items={items}
          initialText={searchText}
          onClose={() => setSearchOpen(false)}
          onPick={(item, matches, text) => {
            setSearchOpen(false);
            navigate("library", "All", contentTypeOf(item));
            setSearchText(text);
            setSearchMatches(matches);
            setCameFrom({view: "library", label: "Search", search: true});
            openCard(item);
          }}
        />
      )}
      {/* A mode you can forget is a mode that bites. While the preview is on it says so across
        the top, and the way out is the bar itself. */}
      {/* The manager tour needs the screens it visits: the owner, or someone holding menu, pre-shift and team. */}
      {touring && restaurant && <Tour
        steps={tourSteps({
          manager: isOwner || ["library", "preshift", "team"].every(area => access.includes(area)),
          demo: !!user.is_anonymous,
          restaurantName: restaurant.name,
        })}
        onGo={next => navigate(next)}
        onClose={() => setTouring(false)}
        onFinishLink={async href => {if (user.is_anonymous) await supabase?.auth.signOut(); window.location.href = href;}}
      />}
      {employeeView && <button type="button" className="preview-bar" onClick={() => setEmployeeView(false)}>
        <BookOpen size={15} aria-hidden="true" />
        <span>Previewing as a server</span>
        <span className="preview-bar-exit">Back to your view</span>
      </button>}
      {/* A demo visitor is an anonymous account inside the shared demo kitchen. Saying so keeps them from
        mistaking it for their own restaurant, and the way to their own one is right there. */}
      {user.is_anonymous ? <div className="preview-bar" role="note">
        <span>Demo kitchen · Your own copy for 7 days</span>
        <a className="preview-bar-exit" href="/trial" onClick={async event => {event.preventDefault(); await supabase?.auth.signOut(); window.location.href = "/trial";}}>Start your own free trial</a>
      </div> : isOwner && restaurant?.trial_ends_at && <div className="preview-bar" role="note">
        <span>{trialLabel(restaurant.trial_ends_at)}</span>
      </div>}
      <div className="mx-auto grid max-w-7xl md:grid-cols-[225px_1fr]">
        <aside id="workspace-navigation" className={`mobile-drawer ${navOpen ? "block" : "hidden"} border-b border-line bg-surface p-5 md:sticky md:top-0 md:block md:h-screen md:self-start md:overflow-y-auto md:border-r md:border-b-0 md:p-6`}>
          <p className="eyebrow muted mb-3">Workspace</p>
          {restaurants.length > 0 && (
            <>
              <label htmlFor="restaurant-select" className="sr-only">
                Restaurant
              </label>
              <select
                id="restaurant-select"
                value={selected}
                onChange={(e) => {
                  setDetailItem(null);setSelected(e.target.value);
                  setCategory("All"); setQuery(""); setView("home"); setNavOpen(false);
                  setAdding(false);
                  setEditing(undefined);
                  setEmployeeView(false);
                  setInviteLink("");setGeneralInvite("");setInviteRole("");
                  setError("");
                  setMessage("");
                }}
              >
                {/* Locations of a brand sit together under its name; restaurants on their own come first. */}
                {restaurants.filter(r => !organizations.some(o => o.id === r.organization_id)).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
                {organizations.map(o => {
                  const inBrand = restaurants.filter(r => r.organization_id === o.id);
                  return inBrand.length ? <optgroup key={o.id} label={o.name}>
                    {inBrand.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </optgroup> : null;
                })}
              </select>
            </>
          )}
          <nav aria-label="Main navigation" className="mt-6 space-y-2" data-tour="nav">
            {!isManager && <button className={`nav-item ${view === "home" && !adding && !editing && !creating ? "active" : ""}`} aria-current={view === "home" && !adding && !editing && !creating ? "page" : undefined} onClick={() => navigate("home")}><HomeIcon size={19} />Home</button>}
            {isManager && <button className={`nav-item ${(view === "dashboard" || view === "home") && !adding && !editing && !creating ? "active" : ""}`} aria-current={(view === "dashboard" || view === "home") && !adding && !editing && !creating ? "page" : undefined} onClick={() => navigate("dashboard")}><LayoutDashboard size={19} />Dashboard</button>}
            <button data-tour="nav-schedule" className={`nav-item ${view === "schedule" && !adding && !editing && !creating ? "active" : ""}`} aria-current={view === "schedule" && !adding && !editing && !creating ? "page" : undefined} onClick={() => navigate("schedule")}><CalendarDays size={19} />Schedule</button>
            {(can("preshift") || can("team")) && <button data-tour="nav-reports" className={`nav-item ${view === "reports" && !adding && !editing && !creating ? "active" : ""}`} aria-current={view === "reports" && !adding && !editing && !creating ? "page" : undefined} onClick={() => navigate("reports")}><FileText size={19} />Shift report</button>}
            <button className={`nav-item ${view === "library" || adding || editing ? "active" : ""}`} aria-expanded={libraryExpanded} aria-controls="library-options" onClick={() => setLibraryExpanded(expanded => !expanded)}><BookOpen size={19} /><span className="flex-1">Content library</span><span aria-hidden="true">{libraryExpanded ? "⌃" : "⌄"}</span></button>
            <div id="library-options" hidden={!libraryExpanded} className="ml-5 space-y-1 border-l border-line pl-3" aria-label="Libraries">
              <button className={`category-nav ${view === "library" && contentType === "food" ? "active" : ""}`} aria-pressed={view === "library" && contentType === "food"} onClick={() => navigate("library", "All", "food")}>Food</button>
              <button className={`category-nav ${view === "library" && contentType === "cocktails" ? "active" : ""}`} aria-pressed={view === "library" && contentType === "cocktails"} onClick={() => navigate("library", "All", "cocktails")}>Cocktails</button>
              <button className={`category-nav ${view === "library" && contentType === "wine" ? "active" : ""}`} aria-pressed={view === "library" && contentType === "wine"} onClick={() => navigate("library", "All", "wine")}>Wine &amp; Sake</button>
            </div>
            <button className={`nav-item ${view === "allergy" && !adding && !editing && !creating ? "active" : ""}`} aria-current={view === "allergy" && !adding && !editing && !creating ? "page" : undefined} onClick={() => navigate("allergy")}><ShieldAlert size={19} />Allergy</button>
            {can("preshift") && <button className={`nav-item ${view === "preshift" && !adding && !editing && !creating ? "active" : ""}`} aria-current={view === "preshift" && !adding && !editing && !creating ? "page" : undefined} onClick={() => navigate("preshift")}><ClipboardList size={19} />Pre-shift</button>}
            <button className={`nav-item ${view === "checklists" && !adding && !editing && !creating ? "active" : ""}`} aria-current={view === "checklists" && !adding && !editing && !creating ? "page" : undefined} onClick={() => navigate("checklists")}><ListChecks size={19} />Side work</button>
            {can("team") && <button className={`nav-item ${view === "team" && !adding && !editing && !creating ? "active" : ""}`} aria-current={view === "team" && !adding && !editing && !creating ? "page" : undefined} onClick={() => navigate("team")}><Users size={19} />Team</button>}
            <button className={`nav-item ${view === "words" && !adding && !editing && !creating ? "active" : ""}`} aria-current={view === "words" && !adding && !editing && !creating ? "page" : undefined} onClick={() => navigate("words")}><Languages size={19} />Words</button>
            <button className={`nav-item ${view === "standards" && !adding && !editing && !creating ? "active" : ""}`} aria-current={view === "standards" && !adding && !editing && !creating ? "page" : undefined} onClick={() => navigate("standards")}><ClipboardList size={19} />Standards</button>
          </nav>
          {restaurant && <nav aria-label="Learning navigation" className="mt-2 space-y-2"><button className={`nav-item ${view==='progress'||view==='review'?'active':''}`} onClick={()=>navigate('progress')}><BarChart3 size={19}/>My progress</button><button className={`nav-item ${view === "story" && !adding && !editing && !creating ? "active" : ""}`} aria-current={view === "story" && !adding && !editing && !creating ? "page" : undefined} onClick={() => navigate("story")}><Store size={19} />Our story</button></nav>}
          {can("library") && <>
            <div className="mx-1.5 mt-4 h-px bg-line" />
            <nav aria-label="Restaurant settings" className="mt-3 space-y-2">
              <button className={`nav-item ${view === "library-settings" && !adding && !editing && !creating ? "active" : ""}`} aria-current={view === "library-settings" && !adding && !editing && !creating ? "page" : undefined} onClick={() => navigate("library-settings")}><SlidersHorizontal size={19} />Library settings</button>
              <button className={`nav-item ${view === "locations" && !adding && !editing && !creating ? "active" : ""}`} aria-current={view === "locations" && !adding && !editing && !creating ? "page" : undefined} onClick={() => navigate("locations")}><Store size={19} />Locations</button>
            </nav>
          </>}
          {!user.is_anonymous && restaurants.some((r) => r.owner_id === user.id) && (
            <button
              onClick={() => {
                setCreating(true);
                setNavOpen(false);
                setAdding(false);
                setEditing(undefined);
              }}
              className="muted mt-5 flex items-center gap-2 text-sm"
            >
              <Plus size={16} />
              Create restaurant
            </button>
          )}
          {manages && <div className="mt-6">
            <p className="eyebrow muted mb-2">Point of view</p>
            <button type="button" className={`nav-item ${employeeView ? "active" : ""}`} aria-pressed={employeeView} onClick={() => {setEmployeeView(!employeeView); setNavOpen(false);}}>
              <BookOpen size={19} />{employeeView ? "Back to your view" : "Preview as a server"}
            </button>
          </div>}
          {restaurant && <button type="button" data-tour="tour-button" className="nav-item mt-6" onClick={() => {setNavOpen(false); setTouring(true);}}>
            <CircleHelp size={19} />Take the tour
          </button>}
          <NotificationSwitch />
          <LanguageSwitch />
          <ThemeChoice />
        </aside>
        <main className="workspace-main min-w-0 p-4 md:p-9">
          <Notice text={error} error />
          <Notice text={message} />
          {invitation && (
            <section className="panel mb-6 p-5">
              <h2 className="font-semibold">
                You have a restaurant invitation
              </h2>
              <p className="muted mt-2 text-sm">
                Join to view your team’s menu and dish details.
              </p>
              <div className="mt-4 flex gap-3">
                <button
                  disabled={busy}
                  className="btn"
                  onClick={() => joinRestaurant(invitation)}
                >
                  Join restaurant
                </button>
                <button className="btn secondary" onClick={clearInvite}>
                  Dismiss
                </button>
              </div>
            </section>
          )}
          {loading ? (
            <p role="status" className="muted py-12">
              Loading your workspace…
            </p>
          ) : !restaurants.length && !creating ? (
            invitation ? null : (
              <section className="panel mx-auto max-w-lg p-7 md:mt-10">
                <Users className="mb-5 text-heat" size={30} />
                <h1 className="text-2xl font-semibold">Join your restaurant</h1>
                <p className="muted mt-3 mb-7">
                  Joining as an employee? Paste the invite link your manager
                  shared. You do not need to create a restaurant.
                </p>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    const value = String(
                      new FormData(event.currentTarget).get("invite-link"),
                    );
                    void joinRestaurant(value);
                  }}
                >
                  <Field label="Manager’s invite link">
                    <input
                      id="join-invite"
                      name="invite-link"
                      type="text"
                      required
                      placeholder="Paste your invite link"
                    />
                  </Field>
                  <button disabled={busy} className="btn w-full">
                    {busy ? "Joining…" : "Join restaurant"}
                  </button>
                </form>
                <p className="muted mt-5 text-sm">
                  Already confirmed your email? Use the same employee account
                  here.
                </p>
                <div className="mt-6 border-t border-line pt-5">
                  <p className="font-semibold">Setting up HEAT for your own restaurant?</p>
                  <p className="muted mt-2 text-sm">
                    Create it here, then add your menu, your words and your team.
                  </p>
                  <button
                    type="button"
                    className="btn secondary mt-4"
                    onClick={() => setCreating(true)}
                  >
                    Create a restaurant
                  </button>
                </div>
              </section>
            )
          ) : creating ? (
            <section className="panel mx-auto max-w-lg p-7 md:mt-10">
              <div className="mb-5 inline-flex rounded-xl bg-raised p-3">
                <Utensils size={27} />
              </div>
              <h1 className="text-2xl font-semibold">
                {restaurants.length ? "A new restaurant" : "Set the table."}
              </h1>
              <p className="muted mt-3 mb-7">
                Managers: create your restaurant to start building its menu.
              </p>
              <form onSubmit={createRestaurant}>
                <Field label="Restaurant name">
                  <input
                    id="restaurant-name"
                    name="restaurant"
                    placeholder="e.g. HEAT Demo Kitchen"
                    required
                    maxLength={100}
                  />
                </Field>
                <Field label="Access code (optional)">
                  <input
                    id="restaurant-code"
                    name="access-code"
                    placeholder="The code you were given"
                    autoCapitalize="characters"
                    autoComplete="off"
                    maxLength={40}
                  />
                </Field>
                <p className="muted -mt-3 mb-5 text-sm">No code? Leave it empty to start a 14-day free trial.</p>
                <button disabled={busy} className="btn w-full">
                  {busy ? "Creating…" : "Create restaurant"}
                </button>
              </form>
              {
                <button
                  className="muted mt-4 text-sm"
                  onClick={() => setCreating(false)}
                >
                  Cancel
                </button>
              }
            </section>
          ) : quizItem && restaurant ? (
            <>{quizEditing && can("library") ? <QuizEditor item={quizItem} restaurantName={restaurant.name} onClose={() => setQuizItem(null)} onSaved={async () => {
              // Saving a quiz is finishing a job: close the editor and land back in the menu, like saving a dish.
              const savedType = contentTypeOf(quizItem);
              await loadItems();await loadProgress();
              setQuizItem(null);setDetailItem(null);setQuizEditing(false);
              setView("library");setContentType(savedType);setCategory("All");setQuery("");
              setMessage("Quiz saved. Your team sees the new questions, and their earlier results are marked for review.");
              window.scrollTo(0, 0);
            }} /> : <QuizPanel key={quizItem.id} item={quizItem} onClose={() => {setQuizItem(null);window.scrollTo(0,0);}} onMenu={() => {setQuizItem(null);setDetailItem(null);setView("library");setContentType(contentTypeOf(quizItem));window.scrollTo(0,0);}} onSaved={loadProgress} items={items} progress={quizProgress} restaurantId={restaurant?.id} onNext={next => {setQuizItem(null);setDetailItem(next);window.scrollTo(0,0);}}>
              <LearningProgress items={items} progress={quizProgress} loading={progressLoading} error={progressError} onRetry={() => void loadProgress()} />
            </QuizPanel>}</>
          ) : (adding || editing) && restaurant ? (
            <AddDish
              key={editing?.id ?? "new"}
              restaurant={restaurant}
              item={editing}
              defaultContentType={contentType}
              cards={cards}
              items={items}
              onCardRows={rows => setCards({ready: true, rows})}
              onRefresh={async () => { await loadItems(); }}
              onCancel={() => {
                setAdding(false);
                setEditing(undefined);
              }}
              onSaved={async (savedType) => {
                setAdding(false);
                setEditing(undefined);
                setView("library"); setContentType(savedType); setCategory("All"); setQuery("");
                setMessage("Menu item saved. Your employees can now view it.");
                window.scrollTo(0, 0);
                await loadItems();
                await loadProgress();
              }}
            />
          ) : detailItem && restaurant ? (
            <section className="mx-auto max-w-2xl item-detail" {...cardSwipe}><div className="mb-4 flex items-center justify-between gap-3"><button className="btn secondary" onClick={()=>{const back=cameFrom;setDetailItem(null);setCameFrom(null);if(back){setView(back.view);if(back.search)setSearchOpen(true);}else{setView("library");setContentType(contentTypeOf(detailItem));}window.scrollTo(0,0);if(back?.view==="allergy"){const y=allergyScroll.current;setTimeout(()=>window.scrollTo(0,y),80);}}}><ArrowLeft size={16} />{cameFrom ? cameFrom.label : "Menu"}</button></div><CardNavigation items={detailItems} current={detailItem} onOpen={openCard}/><DishCard item={detailItem} shift={shiftFlags[detailItem.id]} score={!progressLoading&&!progressError ? quizProgress.find(row => row.menu_item_id === detailItem.id) : undefined}/><CardNavigation items={detailItems} current={detailItem} onOpen={openCard}/><button className="btn quiz-cta mt-5" onClick={()=>{setQuizEditing(false);setQuizItem(detailItem);window.scrollTo(0,0);}}>QUIZ ME</button>{can("library")&&<div className="card-admin"><p className="eyebrow muted mb-3">Manager only</p><div className="card-admin-actions"><button className="btn secondary" onClick={()=>{setQuizEditing(true);setQuizItem(detailItem);window.scrollTo(0,0);}}>Edit quiz</button><button className="btn secondary" onClick={()=>{setEditing(detailItem);setDetailItem(null);window.scrollTo(0,0);}}>Edit {contentTypeOf(detailItem) === "wine" ? "wine" : contentTypeOf(detailItem) === "cocktails" ? "drink" : "dish"}</button><DownloadSheet variant="button" label="Download this card" build={async () => dishCard({item: detailItem, photo: await loadPhoto(detailItem.photo_url), cardFields: cards.rows}, {restaurant: restaurant?.name ?? "HEAT"})} /><DeleteMenuItem key={detailItem.id} item={detailItem} busy={busy} onDelete={() => action(async () => {
              if (!supabase || !restaurant || !can("library")) throw new Error("Manager access required.");
              const item = detailItem;
              const result = await supabase.from("menu_items").delete().eq("id", item.id).eq("restaurant_id", restaurant.id).eq("updated_at", item.updated_at!).select("id");
              if (result.error) throw new Error(result.error.message);
              if (!result.data?.length) throw new Error("This item changed or is no longer available. Refresh the menu before trying again.");
              setDetailItem(null);setView("library");setContentType(contentTypeOf(item));
              await loadItems();await loadProgress();
              setMessage(`${item.name} was deleted.`);
            })}/></div></div>}</section>
          ) : (
            restaurant && (view === "preshift" ? (can("preshift") ? <PreShiftManager key={restaurant.id} restaurant={restaurant} items={items} itemsLoading={itemsLoading} refreshItems={loadItems} onPosted={() => navigate("home")} /> : null) : view === "library-settings" ? (can("library") ? <LibrarySettings key={restaurant.id} restaurantId={restaurant.id} taxonomy={taxonomy} items={items} onChanged={loadTaxonomy} onItemsChanged={loadItems} /> : null) : (view === "dashboard" || (view === "home" && isManager)) ? ((can("team") || isManager) ? <section className="mx-auto max-w-4xl">
              <p className="eyebrow muted">Dashboard</p>
              <h1 className="mt-3 mb-5 text-2xl font-semibold">{dashboardScope === "brand" && brand ? brand.name : restaurant.name}</h1>
              {/* The brand's owner can step back from one location to all of them. */}
              {ownsBrand && brand && <div className="library-switch mb-5" aria-label="Dashboard scope">
                <button type="button" aria-pressed={dashboardScope === "location"} onClick={() => setDashboardScope("location")}>{restaurant.name}</button>
                <button type="button" aria-pressed={dashboardScope === "brand"} onClick={() => setDashboardScope("brand")}>All {brand.name} locations</button>
              </div>}
              {dashboardScope === "brand" && ownsBrand && brand
                ? <BrandDashboard key={brand.id} organization={brand} currentId={restaurant.id} onOpen={id => {setSelected(id);setDashboardScope("location");window.scrollTo(0, 0);}} />
                : can("team") ? <ManagerDashboard key={restaurant.id} today={renderToday()} restaurantId={restaurant.id} restaurantName={restaurant.name} onOpenMember={id => {setTeamOpenId(id);navigate("team");}} onOpenSchedule={() => openSchedule("week")} onOpenReports={openPastReports} /> : renderToday()}
            </section> : null) : view === "schedule" ? <Schedule key={`${restaurant.id}-${scheduleTab ?? ""}`} initialTab={scheduleTab} restaurantId={restaurant.id} restaurantName={restaurant.name} userId={user.id} canManage={(can("team") || can("schedule_foh") || can("schedule_boh")) && !employeeView} access={{all: can("team"), foh: can("schedule_foh"), kitchen: can("schedule_boh")}} setMessage={setMessage} /> : view === "reports" ? (can("preshift") || can("team") ? <ShiftReports key={`${restaurant.id}-${reportsTab ?? ""}`} initialTab={reportsTab ?? undefined} restaurant={restaurant} restaurants={restaurants} brand={brand} ownsBrand={ownsBrand} canWrite={can("preshift")} canManageRecipients={can("team")} setMessage={setMessage} /> : null) : view === "locations" ? (can("library") ? <Locations key={restaurant.id} userId={user.id} restaurant={restaurant} restaurants={restaurants} organizations={organizations} items={items} canImport={can("library")} busy={busy} action={action} setMessage={setMessage} onChanged={loadRestaurants} onItemsChanged={loadItems} onOpen={id => {setDetailItem(null);setSelected(id);setCategory("All");setQuery("");setNavOpen(false);setEmployeeView(false);setInviteLink("");window.scrollTo(0, 0);}} /> : null) : view === "words" ? <WordsManager key={restaurant.id} restaurantId={restaurant.id} restaurantName={restaurant.name} custom={customTerms} onChanged={loadGlossary} canEdit={can("words")} /> : view === "story" ? <Story key={restaurant.id} restaurantId={restaurant.id} restaurantName={restaurant.name} canEdit={can("words")} /> : view === "standards" ? <Standards key={restaurant.id} restaurantId={restaurant.id} canEdit={can("standards")} restaurantName={restaurant.name} /> : view === "checklists" ? <Checklists key={restaurant.id} restaurantId={restaurant.id} canManage={can("preshift")} /> : view === "team" ? (can("team") ? <section className="mx-auto max-w-3xl"><p className="eyebrow muted">Manager workspace · {restaurant.name}</p>{!viewingMember && <h1 className="mt-3 text-2xl font-semibold">Team</h1>}{!viewingMember && <><section className="panel mt-5 mb-5 p-5"><InfoRow info={<>Create an invitation link and share it through WhatsApp, text, or email. Employees can create an account or sign in to join {restaurant.name}.<br /><br />Links expire after 7 days. Creating a replacement disables the previous link.</>}><h2 className="text-xl font-semibold">Invite an employee</h2></InfoRow>                    {can("team") && (
                      <button
                        disabled={busy}
                        className="btn mt-6"
                        data-tour="invite"
                        onClick={() =>
                          action(async () => {
                            const result = await supabase!.rpc(
                              "create_employee_invite",
                              { rid: selected },
                            );
                            if (result.error) throw result.error;
                            const link = `${window.location.origin}/app?invite=${result.data}`;
                            setInviteLink(link);
                            setGeneralInvite(link);
                            setInviteRole("");
                          })
                        }
                      >
                        <Users size={18} />
                        {inviteLink
                          ? "Replace invite link"
                          : "Invite employees"}
                      </button>
                    )}</section>                {inviteLink && !employeeView && (
                  <section className="panel mb-7 p-5">
                    <div className="flex justify-between">
                      <h2 className="font-semibold">Invite your team</h2>
                      <button
                        aria-label="Close invitation panel"
                        onClick={() => setInviteLink("")}
                      >
                        <X size={18} />
                      </button>
                    </div>
                    <p className="muted mt-2 mb-4 text-sm">
                      Share this link with your employees. It expires in 7 days.
                      Replacing it disables the previous link.
                    </p>
                    <InviteFor
                      restaurantId={restaurant.id}
                      busy={busy}
                      action={action}
                      current={inviteRole}
                      onAnyone={() => {setInviteRole("");setInviteLink(generalInvite);}}
                      onPick={(role, token) => {setInviteRole(role);setInviteLink(`${window.location.origin}/app?invite=${token}`);}}
                    />
                    <label htmlFor="invite-link" className="sr-only">
                      Employee invite link
                    </label>
                    <input
                      id="invite-link"
                      value={inviteLink}
                      readOnly
                      onFocus={(e) => e.target.select()}
                    />
                    <button
                      className="btn secondary mt-3"
                      onClick={() =>
                        action(async () => {
                          await navigator.clipboard.writeText(inviteLink);
                          setMessage("Invite link copied.");
                        })
                      }
                    >
                      Copy link
                    </button>
                  </section>
                )}</>}<TeamWorkspace key={`${restaurant.id}-${teamReset}`} restaurantId={restaurant.id} restaurantName={restaurant.name} items={items} itemsLoading={itemsLoading} busy={busy} myAccess={isOwner ? ACCESS_AREAS.map(area => area.key) : access} meId={user.id} onViewing={setViewingMember} openMemberId={teamOpenId} onOpened={() => setTeamOpenId(null)} action={action} setMessage={setMessage} onOpenItem={item => {navigate("library", "All", contentTypeOf(item));openCard(item);}} /></section> : <section><h1 className="text-2xl font-semibold">Team</h1><p className="muted mt-3">Employee invitations are managed by your restaurant manager.</p></section>) : view === "progress" || view === "review" ? <section><p className="eyebrow muted">Your learning</p><h1 className="mt-3 text-2xl font-semibold">My progress</h1>{!(itemsLoading||progressLoading)&&!progressError&&reviewItems.length>0&&<div className="mt-5"><SectionInfo heading={<>Needs review · {reviewItems.length}</>}>Quizzes below 80% or with updated questions. Your previous scores are saved. Study the details before your next attempt.</SectionInfo><div className="mt-3 space-y-2">{reviewItems.map(item=>{const score=quizProgress.find(p=>p.menu_item_id===item.id)!;return <button key={item.id} className="panel compact-menu-row w-full text-left" onClick={()=>{setView("review");setDetailItem(item);window.scrollTo(0,0);}}>{item.photo_url ? <img src={item.photo_url} alt="" loading="lazy" decoding="async" className="h-12 w-12 shrink-0 rounded-lg object-cover"/> : <BookOpen size={24} className="muted shrink-0"/>}<span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.name}</span><span className="muted mt-1 block text-xs uppercase tracking-wider">{categoryOf(item)}{` · ${learningStatus(score)}`}</span></span><span className="quiz-chip review menu-badge cc shrink-0">{score.correct}/{score.total}</span></button>})}</div></div>}<LearningProgress items={items} progress={quizProgress} loading={itemsLoading||progressLoading} error={progressError} onRetry={()=>void loadProgress()}/>{restaurant&&!progressLoading&&!progressError&&<MyActivity key={restaurant.id} restaurantId={restaurant.id} items={items} progress={quizProgress}/>}</section> : view === "tostudy" ? (() => {
            const left = items.filter(item => !takenIds.has(item.id));
            const types = CONTENT_TYPES.filter(type => type !== "wine" || items.some(item => contentTypeOf(item) === "wine"));
            const typeNames: Record<ContentType, string> = { food: "Food", cocktails: "Cocktails", wine: "Wine & Sake" };
            const typeLeft = left.filter(item => contentTypeOf(item) === studyType);
            const order = namesIn(taxonomy, studyType);
            const cats = Array.from(new Set(typeLeft.map(item => categoryOf(item)))).sort((a, b) => order.indexOf(a) - order.indexOf(b));
            return <section>
              <button className="btn secondary mb-5" onClick={() => navigate("home")}><ArrowLeft size={16} aria-hidden="true" />Back to Home</button>
              <h1 className="text-2xl font-semibold">Still to study</h1>
              {itemsLoading || progressLoading ? <p role="status" className="muted mt-4">Loading…</p> : progressError ? <p role="alert" className="mt-4">Progress could not load. <button className="btn secondary ml-2" onClick={() => void loadProgress()}>Try again</button></p> : <>
                <p className="muted mt-3">{left.length ? left.length + (left.length === 1 ? " dish" : " dishes") + " you haven’t taken the quiz for yet. Tap one to open it." : "You have taken every quiz. Nice work."}</p>
                {left.length > 0 && <div className="library-switch study-switch mt-5" role="group" aria-label="Menu section">{types.map(type => <button key={type} type="button" aria-pressed={studyType === type} onClick={() => setStudyType(type)}><span className="block">{typeNames[type]}</span><span className="study-switch-count block">{left.filter(item => contentTypeOf(item) === type).length} left</span></button>)}</div>}
                {left.length > 0 && !typeLeft.length && <p className="muted mt-5">Nothing left to take in {typeNames[studyType]}.</p>}
                {cats.map(cat => { const rows = typeLeft.filter(item => categoryOf(item) === cat); return <div key={cat}>
                  <p className="eyebrow muted mt-6 mb-2">{cat} · {rows.length}</p>
                  <div className="space-y-2">{rows.map(item => <button key={item.id} className="panel compact-menu-row w-full text-left" onClick={() => {setCameFrom({view: "tostudy", label: "Still to study"});openCard(item);}}>
                    {item.photo_url ? <img src={item.photo_url} alt="" loading="lazy" decoding="async" className="h-12 w-12 shrink-0 rounded-lg object-cover" /> : <BookOpen size={24} className="muted shrink-0" />}
                    <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.name}</span><span className="muted mt-1 block text-xs uppercase tracking-wider">{categoryOf(item)}</span></span>
                    <ArrowRight size={16} aria-hidden="true" className="muted shrink-0" />
                  </button>)}</div></div>; })}
              </>}
            </section>;
          })() : view === "home" ? (
              <section>
                {!isManager ? <EmployeeHome key={restaurant.id} waiting={<ShiftChangesWaiting key={`waiting-${restaurant.id}`} restaurantId={restaurant.id} userId={user.id} onOpen={() => openSchedule("mine")} setMessage={setMessage} />} schedule={<MyWeek key={`week-${restaurant.id}`} restaurantId={restaurant.id} userId={user.id} onOpen={() => navigate("schedule")} />} onProgress={() => navigate("progress")} onChecklists={() => navigate("checklists")} restaurantId={restaurant.id} canDownloadBoard={can("preshift")} restaurantName={restaurant.name} onFocusQuiz={item => {navigate("library", "All", contentTypeOf(item));setDetailItem(item);setQuizEditing(false);setQuizItem(item);}} onBoardItem={item => {navigate("library", "All", contentTypeOf(item));setCameFrom({view: "home", label: "Pre-shift board"});openCard(item);}} user={user} items={items} progress={quizProgress} loading={itemsLoading || progressLoading} error={progressError || error} onRetry={() => {void loadItems();void loadProgress();}} onStudy={(item, mode) => {if(item && mode === "list"){setStudyType(CONTENT_TYPES.find(type => items.some(other => contentTypeOf(other) === type && !takenIds.has(other.id))) ?? "food");navigate("tostudy");return;}navigate("library", item ? categoryOf(item) : "All", item ? contentTypeOf(item) : "food");setHideTaken(false);if(item)setQuery(item.name);}} /> : null}
              </section>
            ) : view === "allergy" ? <AllergyView key={restaurant.id} items={items} loading={itemsLoading} refresh={loadItems} shift={shiftFlags} restaurantName={restaurant.name} memory={allergyPick} onMemory={setAllergyPick} onOpen={item => {allergyScroll.current = window.scrollY; setContentType(contentTypeOf(item)); setCameFrom({view: "allergy", label: "Allergy"}); openCard(item);}} /> : <>
                {/* The switch below already says which library you are in, in coral.
                    A heading that has to be kept in step with it is a heading that can be wrong:
                    this one was written for two libraries and called wine "Cocktails" for months. */}
                <ScreenHeader
                  quiet={!can("library")}
                  eyebrow={can("library") ? "Manager workspace" : "Ready for service"}
                  title="Content library"
                  info={can("library") ? "The details your team needs. All in one place." : undefined}
                  description={can("library") ? undefined : "Get to know every dish before your next shift."}
                  action={can("library") && (
                    <button
                      className="btn"
                      data-tour="add-item"
                      onClick={() => {
                        setAdding(true);
                        setError("");
                        setMessage("");
                      }}
                    >
                      <Plus size={16} />
                      Add menu item
                    </button>
                  )}
                />


                <section aria-label="Filter content" className="mb-5 min-w-0">
                  <div className="library-switch mb-4" aria-label="Content type">{CONTENT_TYPES.map(type => <button key={type} aria-pressed={contentType === type} onClick={() => {setContentType(type);setCategory("All");setQuery("");}}>{wordsIn(taxonomy, type).name}</button>)}</div>
                  {wordsIn(taxonomy, contentType).about.trim() && <details className="panel about-kero mb-4"><summary className="cursor-pointer font-semibold">About {wordsIn(taxonomy, contentType).name}</summary><p className="muted text-sm">{wordsIn(taxonomy, contentType).about}</p></details>}
                  <label className="sr-only" htmlFor="content-search">Search content</label><input id="content-search" type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder={`Search ${libraryItems.length} ${wordsIn(taxonomy, contentType).item_many} or an ingredient…`} />
                  <div className="category-tabs mt-3" role="group" aria-label="Menu categories">{[{name:"All",count:libraryItems.length},...counts.filter(c => c.count > 0)].map(c => <button key={c.name} type="button" aria-pressed={category === c.name} onClick={() => setCategory(c.name)}>{c.name} <span className="tab-count">· {c.count}</span></button>)}
                  </div>
                </section>
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-sm font-semibold" aria-live="polite">
                    {category === "All" ? "All content" : category}{" "}
                    <span className="muted ml-2">
                      {filteredItems.length} {filteredItems.length === 1 ? "item" : "items"}
                    </span>
                  </h2>
                  <div className="results-actions">
                    <button type="button" className="not-taken-chip" aria-pressed={hideTaken} onClick={() => setHideTaken(value => !value)}>Not completed · {notTakenCount}</button>
                    <button
                      type="button"
                      className="icon-chip"
                      aria-label="Refresh the menu"
                      title="Refresh"
                      disabled={itemsLoading}
                      onClick={() => action(loadItems)}
                    >
                      <RotateCcw size={15} />
                    </button>
                  </div>
                </div>
                {itemsLoading ? (
                  <p role="status" className="muted py-12">
                    Loading the menu…
                  </p>
                ) : filteredItems.length ? (
                  <div className="menu-list grid items-start gap-2 xl:grid-cols-2">
                    {filteredItems.map((item) => (
                      <button key={item.id} className="panel compact-menu-row w-full text-left" onClick={()=>{setDetailItem(item);window.scrollTo(0,0);}}>
                        {item.photo_url ? <img src={item.photo_url} alt="" loading="lazy" decoding="async" className="h-12 w-12 shrink-0 rounded-lg object-cover"/> : <BookOpen size={24} className="muted shrink-0"/>}
                        <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.name}</span><ShiftFlag entry={shiftFlags[item.id]} /><span className="muted mt-1 block text-xs uppercase tracking-wider">{categoryOf(item)}{summaryFor(item, cards.rows) && ` · ${summaryFor(item, cards.rows)}`}</span></span>
                        <span className="menu-side">{!progressLoading&&!progressError&&<CardQuizScore score={quizProgress.find(row => row.menu_item_id === item.id)} />}<span className="menu-badges" aria-label="Some recorded allergen notes">{badgeCodes(item.allergens).slice(0,3).map((badge,index)=><span key={index} className={`menu-badge ${badge.cc?'cc':''}`} title={badge.text} aria-label={badge.text}>{badge.code}</span>)}{badgeCodes(item.allergens).length>3&&<span className="muted text-xs">+{badgeCodes(item.allergens).length-3}</span>}{!item.allergens.length&&<span className="menu-badge unknown" title="Allergen information not yet provided" aria-label="Allergen information not yet provided">?</span>}</span></span>
                      </button>
                    ))}
                  </div>
                ) : libraryItems.length ? (
                  <section className="panel px-6 py-14 text-center"><Search className="muted mx-auto mb-4" size={32} /><h2 className="text-xl font-semibold">No matching content</h2><p className="muted mt-3">Try another category or a different search.</p><button className="btn secondary mt-5" onClick={() => {setCategory("All");setQuery("");setHideTaken(false);}}>Clear filters</button></section>
                ) : (
                  <section className="panel px-6 py-14 text-center">
                    <BookOpen
                      className="mx-auto mb-5 text-muted"
                      size={36}
                    />
                    <h2 className="text-xl font-semibold">
                      {`The first ${wordsIn(taxonomy, contentType).item_one} starts here.`}
                    </h2>
                    <p className="muted mx-auto mt-3 max-w-sm">
                      {can("library")
                        ? "Add a photo, ingredients, and allergen notes to give your team a confident start."
                        : "Your manager hasn’t added any dishes yet. Check back before service."}
                    </p>
                    {can("library") && (
                      <button
                        className="btn mt-6"
                        data-tour="add-item"
                        onClick={() => setAdding(true)}
                      >
                        <Plus size={16} />
                        {`Add your first ${wordsIn(taxonomy, contentType).item_one}`}
                      </button>
                    )}
                  </section>
                )}
              </>
            )
          )}
        </main>
      </div>

    </div>
    </CardRowsContext.Provider>
    </TaxonomyContext.Provider>
    </GlossaryContext.Provider>
  );
}

// Search from the header: one field across Food, Cocktails and Wine & Sake. Names, descriptions,
// ingredients and allergens, with the same matching rules as the library search.
function MenuSearch({ items, initialText = "", onClose, onPick }: { items: MenuItem[]; initialText?: string; onClose: () => void; onPick: (item: MenuItem, matches: MenuItem[], text: string) => void }) {
  const [text, setText] = useState(initialText);
  const q = text.trim();
  const results = useMemo(() => (q ? filterContent(items, "All", q).slice(0, 15) : []), [items, q]);
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => { field.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  const typeName: Record<ContentType, string> = { food: "Food", cocktails: "Cocktails", wine: "Wine & Sake" };
  return (
    <div className="menu-search" role="dialog" aria-label="Search the menu">
      <div className="menu-search-bar">
        <div className="menu-search-field">
          <Search size={18} aria-hidden="true" className="menu-search-lens" />
          <input
            ref={field}
            type="search"
            value={text}
            style={{ paddingLeft: 44, paddingRight: text ? 44 : 18 }}
            onChange={event => setText(event.target.value)}
            onKeyDown={event => { if (event.key === "Enter" && results[0]) onPick(results[0], results, text); }}
            placeholder="Search the menu"
            aria-label="Search dishes, drinks and ingredients"
          />
          {text && <button type="button" className="menu-search-clear" aria-label="Clear search" onClick={() => { setText(""); field.current?.focus(); }}><X size={14} /></button>}
        </div>
        <button type="button" className="menu-search-cancel" onClick={onClose}>Cancel</button>
      </div>
      {!q && <p className="muted menu-search-hint">Searches names and ingredients across Food, Cocktails and Wine &amp; Sake.</p>}
      {q && !results.length && <p className="muted menu-search-hint">No matches for “{q}”.</p>}
      {results.length > 0 && <>
        <p className="eyebrow menu-search-count">{results.length === 1 ? "1 match" : `${results.length} matches`}</p>
        <div className="menu-search-results">
          {results.map(item => (
            <button type="button" key={item.id} className="menu-search-row" onClick={() => onPick(item, results, text)}>
              {item.photo_url ? <img src={item.photo_url} alt="" loading="lazy" decoding="async" className="menu-search-thumb" /> : <span className="menu-search-thumb" aria-hidden="true" />}
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{item.name}</span>
                <span className="muted block text-xs uppercase tracking-wider">{[categoryOf(item), typeName[contentTypeOf(item)]].filter(Boolean).join(" · ")}</span>
              </span>
              <ArrowRight size={16} aria-hidden="true" className="muted" />
            </button>
          ))}
        </div>
      </>}
    </div>
  );
}

const dishKey = (text: string) => text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// Type-to-find field for managers: matches dish names only (not ingredients), shows a short list under the field.
function DishPicker({ id, items, placeholder, disabled, excludedIds, onPick }: { id: string; items: MenuItem[]; placeholder: string; disabled?: boolean; excludedIds?: string[]; onPick: (item: MenuItem) => void }) {
  const [text, setText] = useState("");
  const q = dishKey(text);
  const taken = excludedIds ?? [];
  const results = useMemo(() => {
    if (!q) return [];
    const hits = items.filter(item => dishKey(item.name).includes(q));
    return [...hits.filter(item => dishKey(item.name).startsWith(q)), ...hits.filter(item => !dishKey(item.name).startsWith(q))];
  }, [items, q]);
  const shown = results.slice(0, 8);
  const typeName: Record<ContentType, string> = { food: "Food", cocktails: "Cocktails", wine: "Wine & Sake" };
  const pick = (item: MenuItem) => { if (taken.includes(item.id)) return; onPick(item); setText(""); };
  return (
    <div className="dish-picker">
      <div className="dish-picker-field">
        <Search size={18} aria-hidden="true" className="dish-picker-lens" />
        <input
          id={id}
          type="search"
          autoComplete="off"
          disabled={disabled}
          value={text}
          style={{ paddingLeft: 44 }}
          placeholder={placeholder}
          onChange={event => setText(event.target.value)}
          onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); const first = shown.find(item => !taken.includes(item.id)); if (first) pick(first); } }}
        />
      </div>
      {q && !disabled && (shown.length ? (
        <div className="dish-picker-results">
          {shown.map(item => {
            const added = taken.includes(item.id);
            return (
              <button type="button" key={item.id} className="dish-picker-row" disabled={added} onClick={() => pick(item)}>
                <span className="min-w-0 flex-1">
                  <span className="block font-semibold">{item.name}</span>
                  <span className="muted block text-xs uppercase tracking-wider">{[categoryOf(item), typeName[contentTypeOf(item)]].filter(Boolean).join(" · ")}</span>
                </span>
                {added && <span className="muted text-xs uppercase tracking-wider">Added</span>}
              </button>
            );
          })}
          {results.length > shown.length && <p className="muted dish-picker-more">{results.length - shown.length} more — keep typing to narrow it down.</p>}
        </div>
      ) : <p className="muted dish-picker-empty">No dish called “{text.trim()}”.</p>)}
    </div>
  );
}

export default function Home() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(!supabase);
  const [invitation, setInvitation] = useState("");
  const [trial, setTrial] = useState(false);
  const [authError, setAuthError] = useState("");
  const [recovering, setRecovering] = useState(false);
  useEffect(() => {
    // Password reset: the email link lands on /?reset=1. An expired link comes back with an error instead.
    if (new URLSearchParams(window.location.search).get("reset") === "1") setRecovering(true);
    const linkError = new URLSearchParams(window.location.hash.slice(1)).get("error_code");
    if (linkError) setAuthError(linkError === "otp_expired" ? "That link has expired. Ask for a new one with “Forgot password?”." : "That link isn't valid anymore. Please try again.");
    const incoming = new URLSearchParams(window.location.search).get("invite");
    if (incoming) sessionStorage.setItem("heat-invite", incoming);
    setInvitation(incoming || sessionStorage.getItem("heat-invite") || "");
    setTrial(new URLSearchParams(window.location.search).get("start") === "trial");
    if (!supabase) return;
    let active = true;
    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (!active) return;
        if (error) setAuthError(error.message);
        setUser(data.session?.user ?? null);
        setReady(true);
      })
      .catch(() => {
        if (active) {
          setAuthError("Unable to connect. Please refresh to try again.");
          setReady(true);
        }
      });
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === "PASSWORD_RECOVERY") setRecovering(true);
      if (active) {
        setUser(session?.user ?? null);
        setReady(true);
      }
    });
    return () => {
      active = false;
      data.subscription.unsubscribe();
    };
  }, []);
  if (!ready)
    return (
      <main
        className="flex min-h-screen items-center justify-center"
        role="status"
      >
        Opening HEAT…
      </main>
    );
  return (
    <>
      {authError && <Notice text={authError} error />}
      {user && recovering ? (
        <NewPassword onDone={() => {setRecovering(false);window.history.replaceState({}, "", "/app");}} />
      ) : user ? (
        <Workspace
          key={user.id}
          user={user}
          invitation={invitation}
          clearInvite={() => {
            sessionStorage.removeItem("heat-invite");
            setInvitation("");
            window.history.replaceState({}, "", "/app");
          }}
        />
      ) : (
        <Auth key={trial ? "trial" : "sign-in"} invitation={invitation} trial={trial} />
      )}
    </>
  );
}
