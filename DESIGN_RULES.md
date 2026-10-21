# HEAT design rules

Read this file before you build, change or review ANY screen, component or style.
It applies to every person and every Claude working in this repo (Gaby, Diego and their Claudes).
Source: HEAT UI/UX Style Guide v2 plus the changes agreed since. If a rule here and the app disagree, the rule wins, and the app is fixed in its own commit.

## How to work

- Mockup first. For anything new or visibly different, show a mockup (HTML or image) and wait for a yes before touching the app. Gaby can waive this for a specific change.
- Decisions about how HEAT looks and behaves belong to Gaby. Propose, do not decide.
- One change = one commit, so any change can be reverted alone. Say in the commit message what it changes.
- Work on your own branch (`dev-gaby`, `dev-diego`). Never commit to `main` directly. Merge to `main` only through a Pull Request that the other person reviews.
- Never type colors, sizes or spacing that are not in this file. If you need something new, propose it as an addition here first.
- Be honest about what you could not check (a phone, dark mode, the employee view). Say so instead of assuming.
- Keep on-screen text plain, short and friendly. Say what the person can do next. No jargon, no blame.

## The rules

| Element | Rule |
| --- | --- |
| Buttons | 30 px tall, 12 px text, weight 600, fully rounded, thin dark outline. One size everywhere. Primary = lime. Only ONE lime button per screen. Importance is lime, never size. |
| Chips and filters | 30 px tall, 12 px text. The selected chip is dark with white letters. |
| Rows and options | Expandable rows, Words rows and quiz answers: 36 px tall, 13 px text. |
| Section names | Dark chip, white bold uppercase, 26 px tall, 11 px text (Standards, Our story). Our story chips carry a small lime dot. Inside cards use a bold dark label. |
| Inputs and search | 44 px tall, 16 px text, fully rounded. (Taller on purpose: thumbs, and phones do not zoom at 16 px.) |
| Spacing | Only 14 px between blocks, 16 px padding inside cards, 20 px for the biggest breaks. No fourth value. |
| Dividers | Solid, 1 px, line color. Never dotted or dashed. |
| Saved message | Green pill with a check, centered on screen, fades after about 3 seconds. |
| Error message | Red pill with an x, centered, stays until tapped. Says what happened and what to do. |
| Help text | Behind a round (i) next to the title. One sentence. Never hide a safety warning behind it. |
| Allergens | Always lime, always with codes (GLU, SHL, SES...) and the "confirm with the kitchen" line. |
| Back button | Top-left, same place every time. |
| Lime | Means "this is the main thing": primary action, selected state, allergens. Nothing else is colorful unless it signals pass or fail. |

Known, intentional exceptions: the round arrows that move between dishes are round icon buttons; text inputs are 44 px (see above).

## Type

- IBM Plex Sans for everything people read (400, 600, 700). IBM Plex Mono only for small labels such as codes and pronunciations.
- Screen title 24 bold. Card title 20 bold. Body 16. Buttons and chips 12 semi-bold. Section label 11 bold caps.

## Color

- Never write a color value in a screen. Use the tokens in `app/globals.css` (`--lime`, `--c-bg`, `--c-surface`, `--c-text`, `--c-muted`, `--c-line-5`, `--c-pass`, `--c-fail` and their dark values).
- Light: lime #C7F23A, page #F1F1EC, surface #FBFBF8, text #1B1C1A, muted #62645D, pass #17803F, fail #D42A1C.
- Lime has the same value in light and dark. Text on lime is always dark.
- Every screen must work in light AND dark, with the same layout. Only token values change.

## Cards

- The dish card is the model for any new card: photo, short context line, labeled facts, one lime allergen box.
- Card padding 16, 12 between facts, 14 between the card and the next block. Soft corners, thin line border.
- If a new card needs a new look, it probably needs a new place in the app, not a new style.

## Phone first

- Design at 375 px width. Desktop shows the same screens in a centered column or a wider grid, never a layout people have to relearn.
- Check every change at 375 px (and 390 px) and on desktop. Nothing may be wider than the screen: no sideways page scroll, no clipped buttons, no names that wrap letter by letter.
- Tap targets: keep the look, but make the tappable area about 44 px.

## Before anything ships (checklist)

1. All buttons 30 px / 12 px. Only one lime button on the screen.
2. Chips 30 px; the selected one is dark with white letters.
3. Rows, Words rows and quiz options 36 px / 13 px.
4. Spacing uses only 14 / 16 / 20 px.
5. Section names use the section chip (or the bold card label inside cards).
6. Dividers are solid and thin.
7. Saved and error use the centered pills.
8. Help text is behind an (i); safety warnings stay visible.
9. Colors come from tokens. Checked in light and dark.
10. Checked at phone width and on desktop. Nothing overflows.
11. Checked in Spanish too when the screen has text (no English left over, no cut-off labels).
12. The change is its own commit and can be reverted alone.

## How CSS changes are made in this repo

`app/globals.css` is large and already carries override blocks. Add a NEW block at the end instead of editing old ones. Use the same strong selector (`:root:root:root:root:root:root:root ...`) and put a comment above the block: what it does and "To undo, revert the commit that added this block". Keep each block to one purpose.

## Open design decisions (do not invent answers, ask Gaby)

From the October 2026 app audit, still undecided:
- Sub-navigation: proposed rule is up to three items = segmented control (one line, 36 px); four or more = 30/12 chips that scroll sideways.
- The Team accordion bars (Name & role, Can change, Assign study) are not in the guide yet.
- Role colors on the Schedule: every role needs its own hue (Bartender and Server look alike today).
- Whether Sign out moves from the top bar into the side menu.
