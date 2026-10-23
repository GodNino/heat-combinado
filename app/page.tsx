// The public site. The app itself lives at /app; the demo kitchen at /demo; the free trial at /trial.
// Same colours, type and pieces as the app, so moving from here into it feels like one product.
// Every picture on this page is the app's own screens drawn in HTML, not a screenshot: they stay
// sharp, follow light and dark, and translate with the rest of the page.
import type { ReactNode } from "react";
import { ArrowRight, Bell, BookOpen, CalendarDays, Check, ChefHat, ClipboardCheck, Crown, FileText, Globe, Languages, MapPin, ShieldAlert, Store, Users, UtensilsCrossed, X } from "lucide-react";
import { HeatLogo } from "./heat-logo";
import { AuthForward } from "./auth-forward";
import { LanguageSwitch } from "./language";
import { Reveal } from "./landing-motion";

const FACTS = [
  ["One link", "to bring the team in"],
  ["FOH + BOH", "in one schedule"],
  ["English · Español", "every screen"],
  ["14 days free", "no card needed"],
];

// The same night, twice: how it runs today, and how it runs on HEAT.
const BEFORE_AFTER = [
  ["The schedule lives in a group chat", "The week is published to every phone, and changes wait for a manager"],
  ["Swaps by text; overtime found on payroll", "A released shift only reaches people who can cover it without overtime"],
  ["The menu binder nobody opens", "Every dish on a card, with a quiz that grades itself"],
  ["Allergy questions answered from memory", "Pick the allergies, see what to avoid and what to confirm with the kitchen"],
  ["86s shouted across the pass", "Tonight's 86 list on the phone of everyone working today"],
  ["The night's story leaves with the closing manager", "An end-of-shift report the owners can read, and a dashboard that remembers"],
];

const ROLES = [
  {icon: Crown, title: "Owners and GMs", text: "Labor and service for the week, every location side by side, and an alert the moment a report is urgent."},
  {icon: CalendarDays, title: "Floor managers", text: "Build the front of house, post pre-shift, hand out checklists and approve swaps with the hours in front of you."},
  {icon: ChefHat, title: "Head chefs and sous chefs", text: "Build the kitchen schedule, 86 what's out, and keep the line's time off in your own hands."},
  {icon: UtensilsCrossed, title: "Servers, bartenders and cooks", text: "Your shifts, tonight's board and what to study, on your phone. Release or swap a shift without a single text."},
];

const MORE = [
  {icon: ClipboardCheck, title: "Checklists", text: "Opening, running and closing jobs, handed out by service, with a record of who did what."},
  {icon: Languages, title: "Words to know", text: "How to say it and what it means, for every term a guest might ask about."},
  {icon: Store, title: "Standards and story", text: "Your service standards and the story of the house, written once and read by everyone."},
  {icon: FileText, title: "Printable sheets", text: "Dish cards, allergy sheets, the pre-shift and the week's schedule, as clean PDFs."},
  {icon: Users, title: "Access per person", text: "Decide who can change the menu, the pre-shift, the team, or each side of the schedule."},
  {icon: Bell, title: "Phone notifications", text: "Schedules, offered shifts, approvals, time off and urgent reports, as they happen."},
  {icon: Globe, title: "English and Spanish", text: "Every screen in either language, one tap away. What you write stays as you wrote it."},
  {icon: MapPin, title: "Every location", text: "Each location keeps its own menu, team and schedule; open a new one and bring over only the dishes it shares."},
];

const FAQ = [
  ["Does my team need to download an app?", "No. HEAT opens in the phone's browser from the invite link. They can add it to the home screen and turn on notifications, like any app."],
  ["Can the kitchen and the floor build their own schedules?", "Yes. Give the floor manager the front-of-house schedule and the head chef or sous chef the kitchen. Each builds, publishes and approves only their side; the GM sees both."],
  ["Does it work in Spanish?", "Every screen works in English and Spanish, and each person picks their own. Dish names and notes stay exactly as you wrote them."],
  ["Is the allergy check a guarantee?", "No, and it never pretends to be. It shows what to avoid and what to confirm, based on what your restaurant recorded. The kitchen always has the last word."],
  ["We have more than one location.", "Each location gets its own workspace, team and schedule under your brand. The owner moves between them and compares them side by side."],
  ["Can I see it before adding my own menu?", "Open the demo kitchen: the real app with a sample menu, team and week of shifts, no account needed. Then start a 14-day trial with your own, no card."],
];

export default function Landing() {
  return <div className="site">
    <AuthForward />
    <Reveal />
    <header className="site-nav">
      <div className="site-wrap site-nav-inner">
        <a href="/" className="site-logo" aria-label="HEAT home"><HeatLogo /></a>
        <nav className="site-links" aria-label="Sections">
          <a href="#product">Product</a>
          <a href="#schedule">Schedule</a>
          <a href="#roles">For your team</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="site-lang"><LanguageSwitch compact /></div>
        <div className="site-actions">
          <a href="/app" className="btn secondary">Sign in</a>
          <a href="/trial" className="btn">Start free trial</a>
        </div>
      </div>
    </header>

    <main>
      {/* ── Hero ── */}
      <section className="site-hero brand-aside lp-hero">
        <div className="lp-glow" aria-hidden="true" />
        <div className="site-wrap site-hero-grid">
          <div className="enter">
            <p className="lp-kicker"><span className="lp-dot" aria-hidden="true" />Built inside a working restaurant</p>
            <h1 className="site-title lp-title">Great service<br />starts with<br /><span className="lp-lime">knowing the menu.</span></h1>
            <p className="mt-6 max-w-lg text-lg text-white/75">One app for what your team needs to know and what your managers need to run: the menu, allergens, schedule, pre-shift, checklists and the end-of-shift report.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/trial" className="btn lp-btn-big">Start free trial<ArrowRight size={17} aria-hidden="true" /></a>
              <a href="/demo" className="btn secondary lp-btn-ghost">Try the demo kitchen</a>
            </div>
            <p className="mt-4 text-xs text-white/60">14 days free · No card needed · The demo needs no account</p>
          </div>
          <HeroPhone />
        </div>
      </section>

      <section className="lp-facts" aria-label="At a glance">
        <div className="site-wrap lp-facts-row">
          {FACTS.map(([big, small]) => <div key={big} className="lp-fact"><b>{big}</b><span>{small}</span></div>)}
        </div>
      </section>

      {/* ── Before and after ── */}
      <section className="site-section">
        <div className="site-wrap">
          <div className="reveal lp-center">
            <p className="eyebrow muted">Sound familiar?</p>
            <h2 className="site-heading lp-big">Most restaurants run on group chats, binders and memory.</h2>
            <p className="muted mt-4">HEAT puts the whole shift in one place, from the first quiz to the last report.</p>
          </div>
          <div className="lp-compare reveal" role="table" aria-label="Before and with HEAT">
            <div className="lp-compare-head" role="row"><span role="columnheader">Today</span><span role="columnheader">With HEAT</span></div>
            {BEFORE_AFTER.map(([before, after]) => <div key={before} className="lp-compare-row" role="row">
              <span role="cell" className="lp-before"><X size={16} aria-hidden="true" />{before}</span>
              <span role="cell" className="lp-after"><Check size={16} aria-hidden="true" />{after}</span>
            </div>)}
          </div>
        </div>
      </section>

      {/* ── Product scenes ── */}
      <section id="product" className="site-section site-sunken">
        <div className="site-wrap">
          <div className="reveal lp-center">
            <p className="eyebrow muted">The product</p>
            <h2 className="site-heading lp-big">From the first quiz to the last report</h2>
          </div>

          <Scene eyebrow="Know the menu" title="Your team learns the menu on their phones, not in the binder"
            points={["Every dish, cocktail and wine on a card, in your menu's own sections", "Quizzes write and grade themselves; 80% means they know it", "Assign what to study and see who's done it"]}
            visual={<MenuVisual />} />

          <Scene flip eyebrow="Allergy check" title="Answer the allergy question with the whole menu in front of you"
            points={["Pick a guest's allergies and see what to avoid and what to confirm", "Cross-contamination flagged dish by dish", "Print the sheet for the pass. It never calls a dish safe."]}
            visual={<AllergyVisual />} />

          <Scene id="schedule" eyebrow="Schedule" title="Build the week in minutes. Publish it to every phone."
            points={["Drag shifts between days and people; copy last week", "Overtime, double-booking and time off flagged before you publish", "Releases and swaps reach only people who can cover them, and a manager always approves", "The floor manager builds front of house; the head chef builds the kitchen"]}
            visual={<ScheduleVisual />} />

          <Scene flip eyebrow="Pre-shift" title="Tonight's board, on the phone of everyone working tonight"
            points={["The 86 list, the dishes to push and a note", "Send it to everyone, or only to who's on today's schedule", "Edit it after posting and the team sees what changed"]}
            visual={<PreshiftVisual />} />

          <Scene eyebrow="End of shift" title="Know how the night went, even when you weren't there"
            points={["Covers, sales, issues and what to order, with the 86 list and checklists filled in", "Urgent reports reach the owners' phones right away", "Labor and service next to the same days last week"]}
            visual={<DashboardVisual />} />
        </div>
      </section>

      {/* ── Roles ── */}
      <section id="roles" className="site-section">
        <div className="site-wrap">
          <div className="reveal lp-center">
            <p className="eyebrow muted">For your team</p>
            <h2 className="site-heading lp-big">Made for every role, front and back of house</h2>
          </div>
          <div className="lp-roles">
            {ROLES.map(({icon: Icon, title, text}) => <article key={title} className="panel lp-role reveal">
              <span className="lp-icon"><Icon size={20} aria-hidden="true" /></span>
              <h3 className="mt-4 text-lg font-semibold">{title}</h3>
              <p className="muted mt-2 text-sm">{text}</p>
            </article>)}
          </div>
        </div>
      </section>

      {/* ── Everything else ── */}
      <section className="site-section site-sunken">
        <div className="site-wrap">
          <div className="reveal">
            <p className="eyebrow muted">And everything around it</p>
            <h2 className="site-heading">Everything the floor needs before the first table</h2>
          </div>
          <div className="lp-more">
            {MORE.map(({icon: Icon, title, text}) => <article key={title} className="lp-more-item reveal">
              <Icon size={20} aria-hidden="true" />
              <div><h3 className="font-semibold">{title}</h3><p className="muted mt-1 text-sm">{text}</p></div>
            </article>)}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section className="site-section">
        <div className="site-wrap">
          <div className="reveal lp-center">
            <p className="eyebrow muted">How it works</p>
            <h2 className="site-heading lp-big">Ready for service this week</h2>
          </div>
          <ol className="site-steps lp-steps">
            {[
              ["Create your restaurant", "Start a free trial and name it. Each location gets a workspace of its own."],
              ["Add your menu", "Dishes, cocktails and wine, with photos, ingredients, allergens, prices and fire times."],
              ["Invite and publish", "Share one link, pick each person's position, publish the week. That's it."],
            ].map(([title, text], index) => <li key={title} className="panel p-6 reveal">
              <span className="step-number">{String(index + 1).padStart(2, "0")}</span>
              <h3 className="mt-3 text-lg font-semibold">{title}</h3>
              <p className="muted mt-2">{text}</p>
            </li>)}
          </ol>
        </div>
      </section>

      {/* ── FAQ ── */}
      <section id="faq" className="site-section site-sunken">
        <div className="site-wrap lp-faq-grid">
          <div className="reveal">
            <p className="eyebrow muted">Questions</p>
            <h2 className="site-heading">What restaurants ask us</h2>
            <p className="muted mt-4 max-w-sm">Anything else? Open the demo kitchen and look around: it's the real app.</p>
          </div>
          <div className="lp-faq">
            {FAQ.map(([q, a]) => <details key={q} className="lp-faq-item reveal">
              <summary>{q}</summary>
              <p className="muted">{a}</p>
            </details>)}
          </div>
        </div>
      </section>

      {/* ── Final call ── */}
      <section className="site-section">
        <div className="site-wrap">
          <div className="lp-final reveal">
            <div className="lp-glow lp-glow-final" aria-hidden="true" />
            <p className="lp-kicker"><span className="lp-dot" aria-hidden="true" />See it for yourself</p>
            <h2 className="lp-final-title">Your next service<br /><span className="lp-lime">can start here.</span></h2>
            <p className="mt-4 max-w-lg text-white/75">Walk through a real restaurant in two minutes: menu, team, schedule and reports. When you're ready, start a trial with your own.</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="/trial" className="btn lp-btn-big">Start free trial<ArrowRight size={17} aria-hidden="true" /></a>
              <a href="/demo" className="btn secondary lp-btn-ghost">Try the demo kitchen</a>
            </div>
            <p className="mt-4 text-xs text-white/60">14 days free · No card needed · The demo needs no account</p>
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

function Scene({id, eyebrow, title, points, visual, flip}: {id?: string; eyebrow: string; title: string; points: string[]; visual: ReactNode; flip?: boolean}) {
  return <div id={id} className={`lp-scene${flip ? " flip" : ""}`}>
    <div className="lp-scene-text reveal">
      <p className="lp-tag">{eyebrow}</p>
      <h3 className="lp-scene-title">{title}</h3>
      <ul className="lp-points">{points.map(point => <li key={point}><Check size={16} aria-hidden="true" />{point}</li>)}</ul>
    </div>
    <div className="lp-scene-visual reveal" aria-hidden="true">{visual}</div>
  </div>;
}

// ── The app's own screens, drawn small ──

function HeroPhone() {
  return <div className="lp-phone-wrap" aria-label="HEAT on a server's phone">
    <div className="lp-toast t1" aria-hidden="true"><Bell size={14} /><div><b>Schedule published</b><span>5 shifts this week</span></div></div>
    <div className="lp-toast t2" aria-hidden="true"><CalendarDays size={14} /><div><b>Ana offered you a shift</b><span>Fri · 5p–11p · Server</span></div></div>
    <div className="lp-toast t3" aria-hidden="true"><BookOpen size={14} /><div><b>Tonight's pre-shift</b><span>Toro 86'd · push the Omakase</span></div></div>
    <div className="lp-phone">
      <div className="lp-phone-notch" />
      <p className="lp-phone-eyebrow">Your next shift</p>
      <div className="lp-phone-shift"><div><b>Fri · 5p–11p</b><span>Server · Dinner</span></div><span className="lp-chip">Published</span></div>
      <p className="lp-phone-eyebrow">Tonight's pre-shift</p>
      <div className="lp-phone-card">
        <p className="text-sm">Two VIPs at 8pm on table 12, both shellfish allergies.</p>
        <div className="lp-pills"><span className="out">Toro · 86'd</span><span>Omakase · Focus</span><span className="low">Uni · Low</span></div>
      </div>
      <p className="lp-phone-eyebrow">Your progress</p>
      <div className="lp-phone-card">
        <div className="lp-bar-row"><span>Food</span><i style={{width: "82%"}} /><b>82%</b></div>
        <div className="lp-bar-row"><span>Cocktails</span><i style={{width: "64%"}} /><b>64%</b></div>
        <div className="lp-bar-row"><span>Wine & Sake</span><i style={{width: "45%"}} /><b>45%</b></div>
      </div>
    </div>
  </div>;
}

function MenuVisual() {
  return <div className="lp-stack">
    <div className="lp-card">
      <p className="lp-card-eyebrow">Raw bar · $24 · 8 min</p>
      <p className="lp-card-title">Yellowtail Tiradito</p>
      <p className="lp-card-text">Thin-sliced yellowtail, citrus soy, sliced chili, cilantro, toasted sesame.</p>
      <div className="lp-badges"><span>FISH</span><span>SOY</span><span>GLUTEN</span><span className="cc">SESAME · CC</span></div>
    </div>
    <div className="lp-card lp-card-offset">
      <p className="lp-card-eyebrow">Quiz me · 5 of 6</p>
      <p className="lp-card-title small">Which garnish finishes the tiradito?</p>
      <div className="lp-answers"><span>Shiso</span><span className="right">Cilantro<Check size={14} /></span><span>Scallion</span></div>
    </div>
  </div>;
}

function AllergyVisual() {
  return <div className="lp-stack">
    <div className="lp-card">
      <p className="lp-card-eyebrow">Guest allergies</p>
      <div className="lp-pills big"><span className="on">Shellfish</span><span className="on">Sesame</span><span>Gluten</span><span>Dairy</span><span>Nuts</span></div>
    </div>
    <div className="lp-card lp-card-offset">
      <div className="lp-row"><span>Do not offer</span><b className="lp-count bad">3</b></div>
      <div className="lp-row"><span>Confirm with the kitchen</span><b className="lp-count warn">2</b></div>
      <div className="lp-row"><span>No listed match</span><b className="lp-count">22</b></div>
      <p className="lp-card-text lp-gap">The kitchen always confirms.</p>
    </div>
  </div>;
}

function ScheduleVisual() {
  const rows: [string, string, (string | null)[]][] = [
    ["Ana", "Server", ["5p–11p", null, "5p–11p", "4p–10p", null]],
    ["Luis", "Bartender", [null, "4p–12a", "4p–12a", null, "4p–12a"]],
    ["Marco", "Sushi Chef", ["3p–11p", "3p–11p", null, "3p–11p", "3p–11p"]],
    ["Sofía", "Host", [null, "5p–10p", "5p–10p", "5p–10p", null]],
  ];
  const colors = ["blue", "red", "green", "purple"];
  return <div className="lp-card lp-sched">
    <div className="lp-sched-top"><b>Oct 19 – Oct 25</b><span className="lp-publish">Publish 12 changes</span></div>
    <div className="lp-sched-grid">
      <span />{["Mon", "Tue", "Wed", "Thu", "Fri"].map(day => <span key={day} className="lp-sched-day">{day}</span>)}
      {rows.map(([name, role, days], r) => <div key={name} className="lp-sched-line">
        <span className="lp-sched-name"><b>{name}</b><small>{role}</small></span>
        {days.map((time, d) => time ? <span key={d} className={`lp-shift pos-${colors[r]}${r === 1 && d === 4 ? " ot" : ""}${r === 3 && d === 1 ? " draft" : ""}`}>{time}</span> : <span key={d} />)}
      </div>)}
    </div>
    <div className="lp-sched-foot"><span className="lp-flag">Luis · 41h · Overtime</span><span className="muted">Floor and kitchen, each built by its own manager</span></div>
  </div>;
}

function PreshiftVisual() {
  return <div className="lp-stack">
    <div className="lp-toast static"><Bell size={14} /><div><b>Tonight's pre-shift is up</b><span>Sent to the 9 people working today</span></div></div>
    <div className="lp-card lp-card-offset">
      <p className="lp-card-eyebrow">Friday · Dinner</p>
      <p className="lp-card-text">Two VIPs at 8pm on table 12, both shellfish allergies. Push the Omakase.</p>
      <div className="lp-pills"><span className="out">Toro · 86'd</span><span className="low">Uni · Low count</span><span>Yuzu Spritz · New</span><span>Omakase · Focus</span></div>
      <div className="lp-audience"><span>Everyone</span><span className="on">Working today · 9</span><span>Pick who's on</span></div>
    </div>
  </div>;
}

function DashboardVisual() {
  const covers = [138, 172, 158, 226, 241];
  return <div className="lp-card lp-dash">
    <div className="lp-tiles">
      <div><b>694</b><span>Covers</span><small>+4% vs last week</small></div>
      <div><b>$55,800</b><span>Sales</span><small>+4% vs last week</small></div>
      <div className="alert"><b>1</b><span>Urgent report</span><small>Allergy incident</small></div>
    </div>
    <p className="lp-card-eyebrow lp-gap">Covers by day</p>
    <div className="lp-bars">{covers.map((n, i) => <div key={i}><b>{n}</b><i style={{height: `${(n / 241) * 100}%`}} /><span>{["Mon", "Tue", "Wed", "Thu", "Fri"][i]}</span></div>)}</div>
  </div>;
}
