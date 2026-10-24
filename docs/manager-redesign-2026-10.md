# Manager redesign, October 2026

What changed on the manager side of the app (Today, Labor, Training), PR by PR, so anyone picking this up knows where things stand. Written for Diego by Gaby and Claude. All of it is live on www.heatplatform.io unless it says otherwise.

## Rules every change followed

- Buttons are 30px tall with 12px text. Only one lime button per screen.
- A selected chip is dark with white letters.
- Spacing is 14, 16 or 20 only.
- Design tokens only, no raw colors. Light and dark mode both work.
- Every new word has a Spanish translation in `lib/i18n-es.ts`.
- One change, one commit. CSS goes in a new block at the end of `app/globals.css` (selector `:root:root:root:root:root:root:root`) with a comment saying how to undo it, so reverting the commit removes it.

## What changed

| PR | Area | What changed |
| --- | --- | --- |
| #16 | Dashboard | The figures sit in one slim row instead of big tiles. |
| #17 | Service | "Shift reports" opens the Past reports list. |
| #18 | Side work | "Checklists" is renamed "Side work" in the app. |
| #19 | Today | A Today view replaces Manager Home, with chips Today, Labor, Service and Training. |
| #20 | Training | Per-dish Assign list. Chips: Needs practice (default), Not quizzed yet, All dishes. Search. "Assign all N" is the only lime button and asks to confirm at 8 or more. Note and due date are folded away. |
| #21 | Today | Three figures (People today, Scheduled, Requests) and one status card with rows for Pre-shift, Side work and Last shift report. Red "Not posted", amber "In progress", green dot when done. "Who is working today" is folded. |
| #22 | Labor | Date buttons Today, Yesterday, This week, Date range. One-person view with hours, shifts, overtime and a pass or fail line against the weekly limit. Hours by position table, a comparison with the period before, and a "Keep an eye on" list. |
| #23 | Today | A posted pre-shift shows as a card (note plus Focus, 86 and Low chips) with the print and download button. Nothing posted means no card. |
| #24 | Labor | Print icon (PDF of what is on screen, or one person's shifts). "Find a person" is a small round search icon that opens a slim box. From and To are small date pills that open the phone's calendar. |
| #25 | Labor | Opens on Today instead of This week. |
| #26 | Training, Today | A perfect score on a quiz that was updated since says "Quiz updated · 4/4" instead of "Needs practice 4/4". The pencil on the Pre-shift row opens Pre-shift already in edit mode. "Edited" shows after 5 seconds instead of a full minute. The "Full schedule" button is gone from "Who is working today". |
| #27 | Pre-shift | While editing, the "On the board today" card steps aside, so its Delete and Edit buttons do not sit above the form. |

## Where the code lives

- `app/today.tsx`: the Today figures row and status card.
- `app/assign-dishes.tsx`: the Training Assign list.
- `app/labor-view.tsx`: the whole Labor screen (dates, search, one-person view, print icon).
- `lib/labor-sheet.ts` and `lib/sheets.ts`: the printable Labor PDF. Tested in `tests/labor-sheet.test.ts`.
- `lib/ops-stats.ts`: `laborRange` and `overtimeHours`, tested in `tests/ops-stats.test.ts`.
- `app/workspace.tsx`: `renderToday()` puts the Today pieces together. `PostedPreShiftCard` and `PreShiftManager` live here too.
- `lib/i18n-es.ts`: Spanish. Exact English phrases go in `PHRASES` (a duplicate key is a TypeScript error, so search before adding). Text with numbers or names goes in `PATTERNS` as a regex, and must be a single text node. Restaurant slang stays in English.
- `app/globals.css`: new blocks at the end. Amber has no design token, so `--c-amber` (#f5b02e) was added in the Today block.

## Known limits and open items

- Overtime on a short Labor range (one day) only sees shifts inside that range, so it can miss hours earlier in the same week. A fix would judge overtime over the whole week.
- The Service chip still shows only the current week.
- The print icon is the app's existing download arrow, not a printer.
- The "Last shift report" row is hidden when there is no report in the last 3 days.
- Dates are not localized to Spanish formats, and the PDFs are English only.
- While editing a pre-shift, Delete is not on screen. It comes back after posting. If it should be reachable while editing, that is a small change.
- The Training back button still says "Team", and the public landing page (`app/page.tsx`) still says "Checklists" where the app now says "Side work".
- "Active this week" (Training, for example "3 of 5") counts team members active in the last 7 days. Check that the label fits the small box on a phone.
- Two tests in `tests/sheets.test.ts` (allergy sheets, "NO RECORDED MATCH") fail with or without these changes. Worth a look.

## How the changes were made

The cloud workspace could not push to GitHub, so each change came as a patch file. Gaby attached it to a task that created the branch and opened the PR, then merged it with "Create a merge commit". None of these changes were type-checked or built where they were written (the package registry was blocked there). They were syntax-checked and run through the node tests, and checked on the live site and Vercel previews.
