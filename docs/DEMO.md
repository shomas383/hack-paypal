v1 — scene 4 may change if the research feature is approved (decision Oct 18).

# Demo script (target 2:50, hard max 2:55)
Judged on five equal criteria (Technological Implementation, Design, Potential Impact, Innovation/Idea, Presentation);
judges may score from the video alone, so every scene must explain itself.

Rules:
- **Real software only.** Every screen shown must be real, running software against PayPal sandbox. Record on production
  (`https://landed-hd19.onrender.com`) and rehearse every live step first.
- **Brands.** PayPal and AG Grid may appear and be named (both are hackathon sponsors). Nothing else:
  - generic product names;
  - no browser, OS, editor or GitHub chrome;
  - no AI model or vendor names on screen or in captions; say "the AI";
  - no marketplace names.

Timing: 25 + 33 + 38 + 34 + 20 + 20 = 170 s = 2:50. 331 spoken words ≈ 117 wpm (counted 2026-10-13; scene 3 gained a
sentence and scene 5 gained 5 s, taken from scenes 2–4).

## 1 · The problem — 0:00–0:25 (25 s, 55 words)
- **Screen:** `/listings`: nine listings on one screen (no scroll) — four automatic diver watches (Japan ×2, China,
  Germany), a chef's knife, an anime disc box set, men's denim jeans and two collectible figures — generic titles,
  Sandbox badge. Hold, and move the cursor slowly down the rows.
- **Say:** "The US ended duty-free entry for small parcels from every country. Every cross-border order now owes import duty,
  and most checkouts don't show it. One major marketplace now requires sellers in Japan to ship US orders duty-paid, but
  leaves them to work out the duty. Landed shows the delivered price, duty included, before anyone pays."
- **Must be true:** generic names only, no trademark in any title (L-P12 still says "Blu-ray" until it is renamed);
  Sandbox badge visible.

## 2 · Buyer checkout with duty — 0:25–0:58 (33 s, 57 words)
- **Screen:** `/listings` → *Get landed cost* on the Japanese watch (L-P03) → `/checkout/<quoteId>` → PayPal popup (3 s or
  less; cut the login) → back on checkout.
- **Inputs:** *Get landed cost* → *Approve $362.50 purchase* → PayPal button → approve.
- **Say:** "The duty comes from a human-verified rate row: the base rate plus a Chapter 99 heading, cited to the official
  schedule, and shown before the PayPal button. The buyer approves the exact amount. PayPal authorizes it, a code-only policy
  decides, then we capture or void. Sellers can also send it as a DDP invoice through PayPal Invoicing."
- **Must be true:**
  - Goods $300.00 · Shipping $25.00 · US import duty (est.) $37.50 (MFN $16.93 + 9903.05.49 $20.57) · Total **$362.50**.
  - Rate version `2026-rev21-v2`, HTS 2026 Rev. 21; the duty line sits above the PayPal button; per-order cap $400.00.
  - "Send DDP invoice instead" is visible.
  - After paying: "Payment CAPTURED · $362.50", "PayPal order <id> · Capture <id>", "Policy: all checks passed." Note the
    order id for scene 3.

## 3 · The agent: compare, then order status — 0:58–1:36 (38 s, 69 words)
- **Screen:** `/agent`, in the same browser session as scene 2.
- **Inputs** (budget `400.00`, confirmed, for both runs):
  1. Message `automatic diver watch under $400 delivered` → *Run comparison*.
  2. Message `What is the status of my order <id>?` → *Run comparison*.
  - Cut the waiting time. Measured on production (dry run 2026-10-13): the compare run took 5 steps in 10.7 s; the
    order-status run took 2 steps in 5.0 s.
- **Say:** "The AI decides what to search and explains; code computes every amount and enforces the budget. China has the
  lowest sticker price but not the lowest delivered price. Listings that try to give the AI instructions are withheld. The
  agent can only propose — it has no tool to approve or pay. It also reads an order's status through PayPal's Agent
  Toolkit, read-only: status and amounts, never the payer's details."
- **Must be true** (dry run 2026-10-13):
  - The quotes table has 5 rows:

    | Listing | Delivered |
    |---|---|
    | DE L-P14 | **$344.00** |
    | JP L-P03 | $362.50 |
    | JP L-C-bce3add4 (Japanese-language seller listing, "Matched on official HTS description (9102.21.70)") | $362.50 |
    | CN L-P13 | $377.09 |
    | JP L-P03-B | $452.50 ✗ over by $52.50 |
  - "1 listing contained seller instructions; withheld." is shown.
  - The banner reads "Lowest goods price: L-P13 (CN) $280.00 → delivered $377.09 · Lowest delivered: L-P14 (DE) $344.00".
    Hold on it for 1 s.
  - The proposal is DE L-P14 at $344.00, PENDING. The final message is at most 4 sentences.
  - Order status: COMPLETED, $362.50 = $300.00 + $25.00 + $37.50 in US import duty (est.). No payer details, no links.

## 4 · Estimate mode — 1:36–2:10 (34 s, 65 words)
- **Form:** *Product description (any language)* (one box) · *Where was it made?* · *Selling price to the US buyer (USD)*
  · *Shipping to the buyer (USD), optional* → submit.
- **Main take:**
  - (a) Description `Men's jeans, straight leg, 14 oz cotton denim.`, origin Japan, price `200.00`, shipping left
    empty. Proven on production 2026-10-12.
  - (b) Refusal: `Stainless steel stovetop kettle, 1.5 L`, Japan, `90.00`.
- **Action during (a):** while saying "Other likely lines are automated estimates…", click *Other likely lines (same duty)*
  so the "Automated estimate (2026-rev21-e4)" labels appear.
- **Say:** "For sellers deciding what to source: describe any product made in Japan, Germany or China. Where a
  human-verified rate row exists, it's used first and labelled. Other likely lines are automated estimates from the official
  schedule, labelled with their data version. And when an official note names a duty we don't model, it refuses and cites
  the note instead of guessing. Estimates are never charged."
- **Must be true:**
  - (a) 6203.42.4511 "Verified rate row (2026-rev21-v2)" **$33.20**; after the click, the other lines are labelled
    "Automated estimate (2026-rev21-e4)".
  - (b) "Can't estimate this product yet", citing heading 9903.82.03 and U.S. note 16(c)(vii).
- **Optional extra, only if a rehearsal shows it:** `Men's jeans, straight leg, 14 oz denim. Fabric content not stated by
  the maker.` → range "$33.20 to $55.80 on a $200.00 sale", "What decides it: Fiber content." Production stopped this input
  as "too broad" on 2026-10-12.
- **Fallbacks:**
  - Verified row: `Automatic diver watch, stainless steel case and bracelet, 21 jewels`, Germany, `290.00`. The 9102.21.70
    result card then asks for *Value of the watch case (USD)*: enter `190.00` → *Estimate with this split* → "Verified rate
    row", $29.00.
  - Refusal: `Men's leather oxford shoes, leather soles`, Japan, `220.00` → cites heading 9903.41.10.

## 5 · Seller ledger in AG Grid — 2:10–2:30 (20 s, 35 words)
- **Screen:** `/seller`, signed in before the take (never show the passcode) → *Orders and duty* → *Review queue*.
- **Inputs:**
  1. Filter the *Listing* column with `L-P14` (4 rows) → hover a row (tooltip) → *Export CSV* (the export follows the
     filter).
  2. *Review queue* → click "Men’s leather oxford shoes".
  - **Never click *Accept* or *Publish* on camera.**
- **Say:** "Sellers get every order in AG Grid, with filters, a duty total and CSV export. Every order keeps the rate version
  it was quoted under. Uncertain classifications wait in a review queue for a human."
- **Must be true** (dry run 2026-10-13):
  - The L-P14 filter leaves 4 rows, each with its duty, HTS line and rate version.
  - The pinned captured-duty total shows.
  - The shoes item shows "Needs review", confidence 0.50, its review reasons and its questions.

## 6 · Trust — end card — 2:30–2:50 (20 s, 50 words ≈ 150 wpm, the fastest scene; rehearse the pace)
- **Screen:** our own end-card slide: **"15 golden cases to the cent · 0 of 33 wrong codes auto-accepted · 989 tests
  passing"**, then "Landed — duty included, before you pay. Sandbox only."
- **Say:** "Every verified duty is reproduced to the cent by golden tests. The classifier auto-accepted zero wrong
  codes in thirty-three answers. The AI proposes, code decides, and a human approves every payment.
  A build gate checks every AI-drafted rule against the official text, and it caught one that would have undercharged."
- **Numbers (checked 2026-10-13):**
  - 15 = cases in `data/eval/golden-2026-rev21-v2.json` (P01–P14, P07 twice).
  - 0 of 33 = SPEC §4.1: wrong ∧ auto 0 across 33 verified answers (11 products × 3 runs).
  - 989 = `pnpm test` unit tests, in 93 files.
  - Re-check all three before the final take.

## Before recording
1. **Review queue on production:** has rows since the 2026-10-13 dry run, including "Men’s leather oxford shoes" (Needs
   review, 0.50). Check it is still there and unaccepted.
2. **Ledger on production:** it holds old test orders (voids, older rate versions); the `L-P14` filter in scene 5 shows 4
   rows. Check they and the pinned total read cleanly.
3. **Catalog for scene 3:** keep it as in the dry run: 5 quoted rows (incl. the Japanese-language seller listing
   L-C-bce3add4) and 1 withheld listing. Publish no other matching listing before recording; the compare cap is 6.
4. **Rehearse scene 4** (a) and (b) on production; switch to the fallbacks if a result differs.
5. **Limits:**
   - Agent: 5 runs per session per hour and 30 per day. A take uses 2, so rehearse in another session.
   - Use a fresh browser session per take, because of the session spend cap.
   - Re-quote if a take spans the quote expiry.
6. **PayPal popup:** it labels the duty "Tax" (known). Keep it short; log in to the sandbox beforehand or cut the login.
7. **Agent wording:** rehearse until the final message is at most 4 sentences and the order reply says "US import duty
   (est.)".
8. **Setup:**
   - Kiosk or full-screen browser, OS taskbar hidden, zoom 110%, 1080p.
   - Captions on, with no model or vendor names.
   - No music, or royalty-free only.

## Verification
- Rehearse each scene on production against its "Must be true" list.
- Final runtime 2:55 or less (Devpost checklist).
