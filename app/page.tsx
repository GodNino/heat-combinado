// The public site. The app itself lives at /app; the demo kitchen at /demo; the free trial at /trial.
// Same colours, type and pieces as the app, so moving from here into it feels like one product.
import { BookOpen, ClipboardList, FileText, Languages, ListChecks, ShieldAlert, Store, Users, Utensils } from "lucide-react";
import { HeatLogo } from "./heat-logo";
import { AuthForward } from "./auth-forward";
import { LanguageSwitch } from "./language";

const STEPS = [
  {title: "Create your restaurant", text: "Start a free trial and name your restaurant. Each location gets a workspace of its own."},
  {title: "Add your menu", text: "Dishes, cocktails and wine, with photos, ingredients, allergens, prices and fire times."},
  {title: "Invite your team", text: "Share one link. Staff study on their phones, take quizzes and read tonight's pre-shift."},
];

const FEATURES = [
  {icon: BookOpen, title: "Menu library", text: "Every dish, cocktail and wine on a card the team can swipe through, in your menu's own sections and order."},
  {icon: ShieldAlert, title: "Allergy check", text: "Pick a guest's allergies and see what to avoid, what needs a word with the kitchen, and what has no listed match. It never calls a dish safe."},
  {icon: ListChecks, title: "Quizzes that grade themselves", text: "Questions for every item, graded by the database rather than the phone. Retakes go through the manager."},
  {icon: ClipboardList, title: "Pre-shift board", text: "Tonight's 86 list, the dishes to push and the notes for each shift, ready before the doors open."},
  {icon: Utensils, title: "Checklists", text: "Opening, running and closing jobs, assigned by shift, with a record of who did what."},
  {icon: Languages, title: "Words to know", text: "How to say it and what it means, for every term a guest might ask about."},
  {icon: Store, title: "Standards and story", text: "Your service standards and the story of the house, written once and read by everyone."},
  {icon: FileText, title: "Printable sheets", text: "Dish cards, allergy sheets and the pre-shift, as clean PDFs for the pass or the binder."},
  {icon: Users, title: "Team and access", text: "Decide per person who can edit the menu, the words, the standards, the pre-shift or the team."},
];

const GROUPS = [
  "Each location keeps its own dishes, team and pre-shift",
  "Open a new location and bring over only the dishes it shares",
  "One account moves between the locations it belongs to",
  "A location's team only ever sees its own restaurant",
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
            <p className="eyebrow mb-5 text-[#a4a49f]">Menu training for restaurant teams</p>
            <h1 className="site-title">Great service<br />starts with<br /><span className="text-[#8f8f8a]">knowing the menu.</span></h1>
            <p className="mt-6 max-w-md text-lg text-white/75">Dishes, drinks, wine and allergens in one place, with quizzes, a pre-shift board and checklists. Built with a working restaurant team, in service every day.</p>
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
          <div className="site-features">
            {FEATURES.map(({icon: Icon, title, text}) => <article key={title} className="panel p-6">
              <Icon size={22} aria-hidden="true" />
              <h3 className="mt-4 font-semibold">{title}</h3>
              <p className="muted mt-2 text-sm">{text}</p>
            </article>)}
          </div>
        </div>
      </section>

      <section id="groups" className="site-section">
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
            <h2 className="site-heading">Walk through a real menu in two minutes</h2>
            <p className="muted mt-3 max-w-lg">The demo kitchen is the real app with a sample menu. When you're ready, start a trial with your own.</p>
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
  </div>;
}
