// The public site. The app itself lives at /app; the demo kitchen at /demo; the free trial at /trial.
// Same colours, type and pieces as the app, so moving from here into it feels like one product.
import { ArrowLeftRight, BarChart3, Bell, BookOpen, CalendarDays, ClipboardCheck, ClipboardList, FileText, Globe, Languages, ListChecks, ShieldAlert, Store, Users } from "lucide-react";
import { HeatLogo } from "./heat-logo";
import { AuthForward } from "./auth-forward";
import { LanguageSwitch } from "./language";

const STEPS = [
  {title: "Create your restaurant", text: "Start a free trial and name your restaurant. Each location gets a workspace of its own."},
  {title: "Add your menu", text: "Dishes, cocktails and wine, with photos, ingredients, allergens, prices and fire times."},
  {title: "Invite your team", text: "Share one link and pick each person's position, front or back of house. Publish the week and everyone has their shifts, their studying and tonight's pre-shift on their phone."},
];

// Two halves of the same night: what the team has to know, and what the managers have to run.
const KNOW = [
  {icon: BookOpen, title: "Menu library", text: "Every dish, cocktail and wine on a card the team can swipe through, in your menu's own sections and order."},
  {icon: ShieldAlert, title: "Allergy check", text: "Pick a guest's allergies and see what to avoid, what needs a word with the kitchen, and what has no listed match. It never calls a dish safe."},
  {icon: ListChecks, title: "Quizzes that grade themselves", text: "Questions for every item, graded by the database rather than the phone. Assign what to study; retakes go through the manager."},
  {icon: Languages, title: "Words to know", text: "How to say it and what it means, for every term a guest might ask about."},
  {icon: Store, title: "Standards and story", text: "Your service standards and the story of the house, written once and read by everyone."},
  {icon: FileText, title: "Printable sheets", text: "Dish cards, allergy sheets, the pre-shift and the week's schedule, as clean PDFs for the pass or the wall."},
];

const RUN = [
  {icon: CalendarDays, title: "Schedule", text: "Build the week by dragging shifts, copy last week, and publish to every phone. Hours, overtime and conflicts show as you go."},
  {icon: ArrowLeftRight, title: "Shift changes and time off", text: "Release, offer or swap a shift from the phone. Only people who can cover it see it, and a manager always approves."},
  {icon: ClipboardList, title: "Pre-shift board", text: "Tonight's 86 list, the dishes to push and a note, sent to everyone or only to who's working today."},
  {icon: ClipboardCheck, title: "Checklists", text: "Opening, running and closing jobs, handed out for lunch or dinner, with a record of who did what."},
  {icon: FileText, title: "End-of-shift report", text: "Covers, sales, issues and what to order. HEAT fills in the 86 list and checklists; urgent ones reach the owners' phones."},
  {icon: BarChart3, title: "Labor and service dashboard", text: "Hours by position, overtime, covers and the issues that keep coming back, next to the same days last week."},
];

const SCHEDULE = [
  "Drag a shift to another day or person; hold Alt to copy it",
  "Overtime, double-booking and time off flagged before you publish",
  "A released shift only reaches people in the same position who stay under overtime",
  "The floor manager builds front of house; the head chef or sous chef builds the kitchen",
];

const MORE = [
  {icon: Users, title: "Team and access", text: "Positions grouped front and back of house. Decide per person who can change the menu, the pre-shift, the team or each side of the schedule."},
  {icon: Bell, title: "Phone notifications", text: "Published schedules, offered shifts, approvals, time off, tonight's pre-shift and urgent reports, as they happen."},
  {icon: Globe, title: "English and Spanish", text: "Every screen in either language, one tap away. What you write, like dish names and notes, stays as you wrote it."},
];

const GROUPS = [
  "Each location keeps its own dishes, team, schedule and pre-shift",
  "Open a new location and bring over only the dishes it shares",
  "One account moves between the locations it belongs to",
  "A location's team only ever sees its own restaurant",
  "The owner compares every location side by side",
];

export default function Landing() {
  return <div className="site">
    <AuthForward />
    <header className="site-nav">
      <div className="site-wrap site-nav-inner">
        <a href="/" className="site-logo" aria-label="HEAT home"><HeatLogo /></a>
        <nav className="site-links" aria-label="Sections">
          <a href="#how">How it works</a>
          <a href="#features">Features</a>
          <a href="#schedule">Schedule</a>
          <a href="#groups">For groups</a>
        </nav>
        <div className="site-lang"><LanguageSwitch compact /></div>
        <div className="site-actions">
          <a href="/app" className="btn secondary">Sign in</a>
          <a href="/trial" className="btn">Start free trial</a>
        </div>
      </div>
    </header>

    <main>
      <section className="site-hero brand-aside">
        <div className="site-wrap site-hero-grid">
          <div className="enter">
            <p className="eyebrow mb-5 text-[#a4a49f]">Menu training and shift tools for restaurant teams</p>
            <h1 className="site-title">Great service<br />starts with<br /><span className="text-[#8f8f8a]">knowing the menu.</span></h1>
            <p className="mt-6 max-w-md text-lg text-white/75">Dishes, drinks, wine and allergens your team actually learns, and the schedule, pre-shift, checklists and end-of-shift report that run the night. Built with a working restaurant team, in service every day.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/trial" className="btn">Start free trial</a>
              <a href="/demo" className="btn secondary">Try the demo kitchen</a>
            </div>
            <p className="mt-4 text-xs text-white/60">14 days free · No card needed · The demo needs no account</p>
          </div>
          <SampleCard />
        </div>
      </section>

      <section id="how" className="site-section">
        <div className="site-wrap">
          <p className="eyebrow muted">How it works</p>
          <h2 className="site-heading">Ready for service in three steps</h2>
          <ol className="site-steps">
            {STEPS.map((step, index) => <li key={step.title} className="panel p-6">
              <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="mt-3 text-lg font-semibold">{step.title}</h3>
              <p className="muted mt-2">{step.text}</p>
            </li>)}
          </ol>
        </div>
      </section>

      <section id="features" className="site-section site-sunken">
        <div className="site-wrap">
          <p className="eyebrow muted">Features</p>
          <h2 className="site-heading">Everything the floor needs before the first table</h2>
          <h3 className="site-subheading">Know the menu</h3>
          <Features list={KNOW} />
          <h3 className="site-subheading">Run the shift</h3>
          <Features list={RUN} />
          <h3 className="site-subheading">For the whole team</h3>
          <Features list={MORE} />
        </div>
      </section>

      <section id="schedule" className="site-section">
        <div className="site-wrap site-groups">
          <div>
            <p className="eyebrow muted">Schedule</p>
            <h2 className="site-heading">A schedule the whole team can work with</h2>
            <p className="muted mt-4 max-w-lg">Build the week on one screen and publish it to every phone. When someone can't make a shift, they release it, offer it or swap it from their phone, and the manager approves with the hours and overtime in front of them.</p>
          </div>
          <ul className="site-list">
            {SCHEDULE.map(line => <li key={line} className="panel px-5 py-4">{line}</li>)}
          </ul>
        </div>
      </section>

      <section id="groups" className="site-section site-sunken">
        <div className="site-wrap site-groups">
          <div>
            <p className="eyebrow muted">One brand, many locations</p>
            <h2 className="site-heading">Every location has its own menu</h2>
            <p className="muted mt-4 max-w-lg">Restaurants in a group share a name, not a menu. In HEAT each location is its own workspace, so a new opening starts with its own dishes and its own team from day one.</p>
          </div>
          <ul className="site-list">
            {GROUPS.map(line => <li key={line} className="panel px-5 py-4">{line}</li>)}
          </ul>
        </div>
      </section>

      <section className="site-section">
        <div className="site-wrap">
          <div className="panel site-final p-8 md:p-12">
            <p className="eyebrow muted">See it for yourself</p>
            <h2 className="site-heading">Walk through a real restaurant in two minutes</h2>
            <p className="muted mt-3 max-w-lg">The demo kitchen is the real app with a sample menu, team and week of shifts. When you're ready, start a trial with your own.</p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="/demo" className="btn">Try the demo kitchen</a>
              <a href="/trial" className="btn secondary">Start free trial</a>
            </div>
          </div>
        </div>
      </section>
    </main>

    <footer className="site-footer">
      <div className="site-wrap site-footer-inner">
        <span className="site-logo site-logo-small"><HeatLogo /></span>
        <span className="muted text-xs">Know your menu.</span>
        <a href="/app" className="muted ml-auto text-xs underline underline-offset-4">Sign in</a>
      </div>
    </footer>
  </div>;
}

function Features({list}: {list: {icon: typeof BookOpen; title: string; text: string}[]}) {
  return <div className="site-features site-features-tight">
    {list.map(({icon: Icon, title, text}) => <article key={title} className="panel p-6">
      <Icon size={22} aria-hidden="true" />
      <h3 className="mt-4 font-semibold">{title}</h3>
      <p className="muted mt-2 text-sm">{text}</p>
    </article>)}
  </div>;
}

// A dish card the way the team sees it, drawn here rather than imported so the public page stays small.
function SampleCard() {
  return <div className="site-sample" aria-label="Example dish card">
    <div className="site-sample-card">
      <p className="eyebrow muted">Raw bar · $24 · 8 min</p>
      <h3 className="mt-2 text-lg font-semibold">Yellowtail Tiradito</h3>
      <p className="muted mt-2 text-sm">Thin-sliced yellowtail, citrus soy, sliced chili, cilantro, toasted sesame.</p>
      <div className="mt-4 flex flex-wrap gap-2">
        <span className="site-badge">FISH</span>
        <span className="site-badge">SOY</span>
        <span className="site-badge">GLUTEN</span>
        <span className="site-badge cc">SESAME · CC</span>
      </div>
      <div className="site-sample-row mt-5"><span>Your quiz</span><b>5/6</b></div>
    </div>
    <div className="site-sample-card site-sample-small">
      <p className="eyebrow muted">Allergy check · Shellfish</p>
      <div className="site-sample-row mt-3"><span>Do not offer</span><b>3</b></div>
      <div className="site-sample-row"><span>Needs kitchen review</span><b>1</b></div>
      <div className="site-sample-row"><span>No listed match</span><b>22</b></div>
    </div>
    <div className="site-sample-card site-sample-small">
      <p className="eyebrow muted">Your next shift · Fri</p>
      <div className="site-sample-row mt-3"><span>Server</span><b>5p–11p</b></div>
      <div className="site-sample-row"><span>Swap with Ana</span><b>Waiting on manager</b></div>
    </div>
  </div>;
}
