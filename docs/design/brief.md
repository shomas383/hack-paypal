# Design brief: Landed

Approved 2026-10-10. Tokens live in `src/app/styles/tokens.css`; screen layouts in `docs/design/wireframes.md`.

## Audience
- **US buyers**, often arriving from an AI shopping agent. They want the true delivered price before paying.
- **A small cross-border seller**, for example a Japan-based sole trader. They need an HTS code they can stand behind and a
  publishable listing.
- **Judges (PayPal, AG Grid).** They scan for trust, correctness and a real data grid.

## Screens: the job, the one primary action, and the reading order

| Screen | Job | Primary action | Read 1st / 2nd / 3rd |
|---|---|---|---|
| /agent | Find the best item whose delivered total fits the budget | Run comparison (after confirming the budget) | proposal + delivered total / quotes table + insight / duty provenance |
| Checkout | Confirm the landed cost, then pay | Approve $X purchase (then PayPal's own button) | total + estimate sentence / ledger lines with codes / sources |
| /seller › Classify | Get an HTS line the seller can stand behind | Classify listing | proposed code + confidence / reasons + questions / evidence |
| /seller › Review queue | Clear items that need a decision | Accept classification | status + reasons / candidates with chains / evidence |
| /seller › Orders | See the duty collected per order | Export CSV | totals per order / HTS + Ch. 99 / status |
| /listings | Pick an item to quote | Get landed cost | title + price / origin + HTS / shipping note |

## Tone
Plain, exact and unhurried. Short declarative sentences, numerals and sentence case. Buttons are a verb plus an object
("Approve $344.00 purchase", "Accept classification", "Export CSV"). In-progress labels end in "…". Errors say what
happened and how to fix it. No exclamation marks, marketing words or emoji.

## References
- Stripe Dashboard: ledgers and tabular money.
- Mercury: calm neutrals and one accent.
- Ramp: dense tables and status as text.
- Linear: hierarchy from type, spacing and 1 px rules.

## Anti-references (banned)
- Colour and surface effects: purple, indigo or violet; any gradient, including gradient text; glassmorphism or blur;
  glow.
- Decoration: emoji icons; icons in tinted squares; identical card grids or cards inside cards; rounded-2xl.
- Layout: centred heroes, or a badge above the H1, on app screens.
- Motion: bounce or elastic easing; staggered entrance animations on data.
- Borrowed defaults: default Tailwind or shadcn palettes; placeholder names ("John Doe", "Acme").
- Copy and numbers: marketing words ("seamless", "unlock", "supercharge"); mixed decimal places; centred numbers.

## Duty wording (fixed)
- The label is always **"US import duty (est.)"**.
- Next to every delivered total, in one sentence: *"Includes US import duty, estimated from verified rates and paid here
  at checkout (delivered duty paid). It's an estimate, not a customs ruling."*
- The provenance is always one disclosure away: the official heading text, the sources, the rate version, the HTS
  revision and the verified date.
- Never "guaranteed".

## Visual rules (summary)
- **Layout:** left-aligned and task-first. Hierarchy comes from type, spacing and 1 px rules, not cards. The only bordered
  block on a screen is the one that holds its primary decision. Radius ≤ 8 px, and a nested radius ≤ its parent's. Max
  width ~1200 px for the app and ~720 px for checkout.
- **Colour:** neutral surfaces and one accent (#2457C5). Success, warning and danger are never shown by colour alone: they
  always come with text and an icon. Form controls use `--border-input` (#8A93A0, 3:1 contrast).
- **Type:** IBM Plex Sans for the UI and IBM Plex Mono for HTS codes, Chapter 99 codes and IDs. Text is 14 px by default
  and inputs are 16 px everywhere. Weights 400, 500 and 600 only.
- **Money:** one USD formatter, always 2 decimals, tabular figures. Numbers and their headers are right-aligned. The
  currency goes in the column header, not in each cell.
- **Motion:** only to make cause and effect clear. Transform and opacity only, 120–240 ms, ease-out, and none under reduced
  motion.
- **Accessibility:** WCAG 2.2 AA. Semantic tables with a caption and scoped header cells. A visible focus ring everywhere.
  Targets are at least 24 px, or 44 px on touch. The agent transcript is a `role="log"` with a single completion
  announcement.
