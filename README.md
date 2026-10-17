# HEAT v0.1

First milestone: manager signs in → creates a restaurant → adds a dish and photo → employee joins and reads it on mobile.

## What each part does

- **Next.js** runs the web app in one project. The initial app uses browser-side Supabase authentication and data access; no custom backend server is needed.
- **TypeScript** catches mistakes in the data passed between screens.
- **Tailwind CSS** styles the responsive interface.
- **Supabase** stores accounts, restaurant records, and private photos. Database policies enforce permissions independently of what the screen displays.
- **GitHub** stores the source history. **Vercel** builds and hosts it.

No OpenAI key or AI features are used.

## 1. Create your Supabase project

1. Open https://supabase.com/dashboard and create a project named `heat-app` in your organization. Choose a region near your users. Save the database password in your password manager; the app does not need it.
2. In the project's SQL Editor, paste the complete contents of `supabase/migrations/001_heat.sql` and run it **once in a new project**. It creates the tables, permissions, invitation functions, and private `menu-photos` bucket in one transaction. Then run `supabase/migrations/002_edit_menu_items.sql` once to enable owner editing. Then run `supabase/migrations/003_content_categories.sql` once for content categories. Existing installations only need migrations they have not already applied. The optional `supabase/categorize_osaka.sql` assigns categories to the approved Osaka menu by exact dish name.
3. Open the project's Connect dialog and copy its **Project URL** and **publishable key**.
4. Copy `.env.example` to `.env.local` and fill in those two values. Never use a secret or service-role key here. `.env.local` is ignored by Git.
5. Under Authentication → URL Configuration, set Site URL to `http://localhost:3000` for local testing. Add `http://localhost:3000/**` as an allowed redirect URL. Keep email confirmation enabled.

The SQL does not create accounts or sample restaurant data. Use the app to do that.

## 2. Run the app locally

Install Node.js 22 or newer and pnpm, then open this folder in your editor:

```sh
pnpm install --frozen-lockfile
pnpm dev
```

Visit http://localhost:3000. Without Supabase settings it shows connection guidance and a sample employee preview at `/preview`. That preview cannot save anything and is separate from the real account flow. Restart the server after changing `.env.local`.

## 3. Test the real milestone

1. Create an account and choose **Manager — set up a restaurant**. Confirm its email, then sign in.
2. Create **HEAT Demo Kitchen**.
3. Add **Salmon Tiradito**, its description, ingredients and allergens (for example Fish and Sesame), and a JPG, PNG, or WebP photo under 5 MB. Review the actual recipe with the kitchen before using real dish data.
4. Save. Check that the card appears and the photo loads. Reload to verify persistence. Choose **Edit dish**, change its details, and save again. Replacing the photo is optional. An edit opened before another save is rejected to avoid overwriting newer changes. Previous photos remain private in storage so existing employee sessions can finish displaying them. CC in allergen notes displays as cross-contamination.
5. Open **Content library** from the sidebar. Search by dish name or ingredient, or select a category. Managers choose the category when adding or editing a dish. Choose **Invite employees** and copy the link. Links expire after 7 days; replacing a link invalidates the old link. Existing memberships stay active.
6. Open it in a separate browser session or on a phone after deployment. Create a second account, confirm email, sign in, and choose **Join restaurant**. If the invite is lost during email confirmation, reopen the invite in the employee browser or paste it into the **Join your restaurant** screen. New accounts default to employee onboarding; manager setup is selected during signup. This preference only changes onboarding; database ownership and membership policies still enforce access.
7. Verify the employee sees the saved dish/photo and has no dish creation controls for that restaurant. Employee accounts may create their own separate restaurants, which does not grant access to anyone else's.
8. With a third account that has not joined, verify the restaurant and dish are not visible.

Employee menus reload when opened; **Refresh** fetches changes during an existing session. Private photo links last one hour and refresh automatically while the menu remains open. The manager preview changes presentation only; use a separate employee account to test actual permissions.

## 4. Put the code on GitHub

Create an empty **private** repository named `heat-app` at https://github.com/new. Do not add a README or license during creation, since this project already has files. From this folder, connect it using the repository URL GitHub gives you:

```sh
git remote add origin YOUR_GITHUB_REPOSITORY_URL
git push -u origin codex/heat-v0.1
```

This local project is initialized on `codex/heat-v0.1`. If no commit exists yet, first run `git add .` and `git commit -m "Build HEAT v0.1"`. GitHub may ask you to sign in. Keep `.env.local` out of source control. You can use this branch as the initial repository/default deployment branch or later merge it into `main`.

## 5. Deploy with Vercel

1. Open https://vercel.com/new and import the GitHub repository.
2. Select the branch with the HEAT code. Use the **Next.js** preset and the repository root as Root Directory.
3. Add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` as Vercel environment variables for the environments you will use. These values are included at build time, so redeploy after changing them.
4. Deploy. In Supabase Authentication → URL Configuration, change Site URL to the final HTTPS address and add that exact site followed by `/**` to the redirect allowlist. Keep localhost for local development if needed.
5. Repeat the two-account milestone on that URL, including a real phone and photo upload.

Vercel and Supabase account setup and a real cross-device test must be completed before calling the milestone live.

## Project map

- `app/page.tsx`: login, restaurant setup, manager workspace, and employee menu.
- `app/preview/page.tsx`: clearly labeled, read-only sample employee screen.
- `app/globals.css`: visual styling and mobile-friendly controls.
- `lib/supabase.ts`: public client configuration.
- `lib/menu.ts`: menu types and upload/input validation.
- `supabase/migrations/001_heat.sql`: database and storage authorization rules.
- `tests/permissions.test.ts`: executes the migration in local PostgreSQL (PGlite) and checks owner/employee/outsider access, invite expiry, and private storage policies using minimal Auth/Storage schemas.

## Checks

```sh
pnpm test
pnpm typecheck
pnpm build
```

The local database test checks SQL logic; it does not replace testing hosted Supabase Auth, email delivery, file uploads, and signed URLs. This first slice supports creation, owner editing, and viewing. Deleting dishes, employee removal, password recovery, quizzes, scoring, and AI remain future work.

## Official references

- Next.js setup: https://nextjs.org/docs/app/getting-started/installation
- Supabase Next.js quickstart: https://supabase.com/docs/guides/getting-started/quickstarts/nextjs
- Supabase database permissions: https://supabase.com/docs/guides/database/postgres/row-level-security
- Tailwind with Next.js: https://tailwindcss.com/docs/installation/framework-guides/nextjs

## Allergy check

The sidebar Allergy view is available to managers and employees using their existing restaurant access. It groups recorded labels, includes explicit recipe mentions, and separates Do not offer (including CC), Needs kitchen review (incomplete records), and No listed match—confirm with the kitchen. It never certifies a dish as safe. Generic Nuts notes block both Tree nuts and Peanuts. The conservative text matcher is not exhaustive, may overflag terms (for example plant-based milk), and cannot assess shared equipment or substitutions. The kitchen must verify all guest allergies and preparation before offering any dish. Custom allergen notes also appear as choices. No guest health records are stored. No migration required.

Allergy buttons support multiple simultaneous selections. Any selected match blocks the dish; no-match requires no recorded match for every selection. Tap again to deselect or use Clear selections. Reasons identify the triggering allergy.

## Food and Cocktails libraries

Apply migration 004 once after 003. It adds content_type (food by default) and the renamed food categories, including the Osaka source Bejitarian section. Bejitarian is a source category, not a dietary guarantee. Food and Cocktails are separate sidebar choices with scoped search and categories. Compact cards expand to reveal details and manager editing. Cocktail categories follow the manual: Pisco Experience, Kero Global, Native, Classic Kero Style, Alcohol-free. Managers choose the Library and Category when adding/editing content. Cocktail records with empty allergen fields always require manual review in Allergy results.

## Per-item quizzes and progress

Apply migration 005 after 004. Every current food item and cocktail gets six deterministic multiple-choice questions from its recorded data, without AI. Questions are generated on demand, so new items are included. Food topics: category, description, ingredients, allergen notes, first sauce/component, and name recognition. Cocktails replace the last two with preparation method and glassware. Missing source information is explicitly identified. These quizzes test the records, not independent recipe or allergy certification.

Only the database grades submissions. Answer keys are omitted when starting the quiz, and a content hash rejects submissions if the questions/options changed. Learners can read only their own attempts; direct client inserts/updates are forbidden. Current-item latest scores drive progress: sum(correct answers) / (6 × current item count), with unattempted/updated items as zero. A score of 5/6 meets the review target. Retakes replace the score used for progress, while history remains private. Changes to the item invalidate previous progress until retaken. Home, the library, and the quiz result show separate Food and Cocktails progress.

## Manager quiz editing and retakes
Apply migration `006_quiz_management.sql` after 005. Managers use **Edit quiz** on an expanded library item to edit questions, topics, choices, and the correct answer (1–30 questions, 2–6 distinct answers each). Saving invalidates current progress for that item; historical attempts remain.

Employees receive an initial attempt and two retakes per item. Starting reserves an attempt. Unfinished current sessions resume across devices. Each checked answer is immutable, with server-provided green/red feedback; completing the last answer saves exactly one result. Managers practice without a limit. Employees request additional attempts from the blocked quiz screen; the manager approves one at a time from Home. Menu or quiz updates do not reset the attempt allowance. Progress averages each item's latest score percentage, with unattempted/updated items counting as zero and an 80% review target.

The database serializes starts/approvals, hides unanswered answer keys, validates ownership and restaurant membership, and disables the old submission RPC. New tables have RLS and no direct client access. Tests in `tests/quiz-management.test.ts` cover editing, invalid choices, answer immutability, idempotency, attempts, approval, and stale content.

## Compact menu service details
Migration 007 adds optional USD `price`, `price_label` (market/variant price override), and `fire_minutes` (1–240). Managers edit these in the existing menu-item form; employee writes remain blocked by owner-only policies. Compact rows show source category, price/time when recorded, and up to three abbreviated allergen notes plus a remaining count. Amber means cross-contamination; full notes remain on the item page. The mobile bottom navigation was removed; sidebar navigation is retained.

## Quiz persistence correction
Apply migration 008 after 007. Quiz versions and progress now compare the actual question snapshot, not the menu item's general update timestamp. Price, fire-time, photo, and unchanged-content saves no longer hide results or strand unfinished attempts. Previously hidden matching results reappear automatically without rewriting scores, answers, or attempt counts. Actual question changes still invalidate current progress while retaining historical attempts. The persistence regression test reproduces the old service-update bug and verifies restoration, session resumption, a fresh sign-in, user isolation, and actual-content invalidation.

## Practical quiz refresh

Migration 009 adds answer explanations, hides them until each answer is submitted, and retains the latest saved score when questions change. Updated quizzes are marked for review without resetting employee attempt allowances. Managers can edit explanations alongside questions and choices.

`supabase/menu-quizzes.json` contains the AI-assisted, source-checked rewrite for 61 dishes and 24 cocktails (six questions each). `supabase/publish-menu-quizzes.sql` publishes this specific Osaka bank after exact source and item-count guards, preserving replaced custom questions in the protected `quiz_bank_revisions` table. Run 009 first. No live AI-generation service or API key is used. Missing cocktail allergens remain unknown; questions require manager/bar verification. When menu facts change, managers should update their custom quiz too.

The quiz screen uses segmented progress, lettered choices, immediate green/red feedback and explanations. Scores from older versions stay visible with an Updated quiz label. Tests cover explanation disclosure, manager editing, prior-score retention and question-bank structure.

## Dish detail reference layout

Apply migration 010 for manager-editable `table_setting` and `observations` fields (existing owner-only RLS applies). `import-service-notes.sql` imports visually checked food-manual notes by restaurant and exact item name, aborting on mismatched counts or conflicting existing notes. `osaka-service-notes.json` records source pages; 47 table settings and 29 observations are available across 61 dishes. Source labels Pico Buta and Beef Tartar map to the existing Pisco Buta and Niku Tartare records. Missing notes remain blank. Cocktail observations continue to be read from the existing description until edited in the new field.

Expanded cards use paragraph ingredients, compact service rows, orange observations, a red allergen panel with amber CC notes, and individually titled sauce/component recipes. The display keeps recipe text and full allergen notes; it does not infer missing allergies. Quiz content and attempt counts are unchanged.

## Typography

The shared type scale uses 12px metadata, 14px reading text, 18px section headings and 24px page titles. The shared monospace font stack is used throughout, including titles, reading text, labels, buttons, and fields. Form inputs remain 16px to avoid mobile focus zoom. Dish facts use stacked labels with paragraphs aligned to the same left edge; recipe text and allergen explanations use the same reading size.

## Editing without changing layout

The manager editor separates the description and Sauce breakdown into different fields, alongside Table setting and Observations. The app adds the section boundary when saving. Legacy sauce/source headings are read without regard to capitalization or surrounding spaces, so uppercasing existing content no longer hides sauce cards. Legacy observation lines are displayed with the observation styling and moved into the dedicated field when edited. Existing text is retained; unchanged descriptions without legacy observation lines are saved verbatim. Regression checks cover uppercase headings, Windows line endings, source notes and separate-field save/read behavior.

Food and cocktail cards display uppercase text using CSS. Saved text, manager edit fields, and quiz wording retain their original capitalization.

Card details have Previous/Next controls above and below the content, with an item position counter. Navigation follows the current library search/category and item order; review navigation stays within review items of the same content type. The first/last controls disable at list boundaries. Opening another card scrolls to the top and keeps its quiz/edit actions linked to that item.

## Public site, demo kitchen and free trial

HEAT now has a public front door. The app itself moved from `/` to `/app`.

| Route | What it is |
|---|---|
| `/` | Public landing page, in the app's own colours and type |
| `/app` | The app: sign-in, then the workspace (unchanged) |
| `/demo` | The demo kitchen: the real app with a sample menu, no account needed, read-only |
| `/trial` | Sign-up set up for a new restaurant: 14 days free, no access code |
| `/login` | Goes to `/app` |

Old email links that point at `/` (invites, password resets, confirmations) are passed on to `/app` automatically, so nothing already sent breaks.

Setup, once, in this order:

1. Apply `supabase/migrations/034_trial_and_demo.sql` **before** deploying this version. It only adds two columns to `restaurants` (`trial_ends_at`, `is_demo`) and two functions; existing restaurants are untouched and keep working as full accounts.
2. Demo kitchen: in Supabase, enable **Authentication → Sign In / Providers → Allow anonymous sign-ins**. Then open `supabase/demo-seed.sql`, replace `YOUR-ADMIN-EMAIL` with an existing HEAT account (it will own the demo menu) and run it once. Every dish in it is invented; it is not any real restaurant's menu.
3. Under Authentication → URL Configuration, add `https://YOUR-SITE/app/**` to the redirect allowlist next to the existing entry.

Creating a restaurant: with an access code it is a full account, exactly as before. Without a code it is a free trial: one per account, 14 days, never for a demo visitor. The owner sees the days left in a bar at the top. When a trial ends nothing is locked yet; the bar says it has ended. Enforcement and payments are later work.

## Brands and locations

Apply `supabase/migrations/035_organizations.sql` after 034. A brand (for example Osaka) groups several restaurants, its locations (Miami, Chicago…). Each location keeps its own menu, team, pre-shift and scores.

- **Start a brand:** the owner of a restaurant opens **Locations** in the sidebar and names the brand. Other restaurants they own can be added to it from the same screen.
- **The brand's owner runs every location** without being added to each one: `is_restaurant_owner()` now also answers yes for the brand's owner. Nothing changes for restaurants outside a brand.
- **Open a new location:** from Locations. It starts with an empty menu. Only a brand with at least one full (non-trial) location can open more.
- **Bring dishes over:** in Locations, a manager of the new location picks which dishes, drinks and wines it shares with another location of the same brand, by item or by whole category. Each import is a copy: the new location's own from then on, so a price or recipe change never touches the original. Items with a name already in that library are marked "Already here" and skipped. The category, the custom quiz and the photo come with each item; scores and progress do not. It can be used again any time a location adds something new.

`tests/organizations.test.ts` runs every migration in order and checks who can see and change what across a brand.

## Dashboards

Apply `supabase/migrations/036_dashboards.sql` after 035. It only adds read-only functions; nothing is written or changed.

- **Dashboard** (sidebar, for whoever holds Team access): team members, menu covered, quiz accuracy and who was active this week; completed quizzes per week for the last 8 weeks; coverage and accuracy by library; and every person, least covered first, linking to their page in Team.
- **All locations** (the brand's owner, a switch at the top of Dashboard): every location of the brand side by side, each measured against its own menu, with quizzes over the last four weeks.
- **My progress** (everyone): under the existing progress rings, the person's own quizzes per week and their sections from weakest to strongest. Nobody sees anyone else's numbers here.

All figures use the same rules as Home and Team (`026_learning_notes.md`): latest result per current item, accuracy weighted by answered questions, review below 80%. Learners are a location's members; the owner's own practice is not counted.

The database tests (`organizations`, `dashboards`) run every migration in order, so `pnpm test` runs test files one at a time to stay within memory. The test setup adds `menu_items.details`, which production has but no migration in this folder creates.
