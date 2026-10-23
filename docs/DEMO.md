# Demo script: final cut 2:56, recorded 2026-10-18
Hard max: **< 3:00 (official rule)**; judges aren't required to watch past 3:00. Target for any re-record: 2:50.
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
- **Music:** the background music is an original track composed and produced by the owner (credited in the YouTube
  description).

Spoken words in the final cut: 63 + 72 + 71 + 117 + 52 = 375, about 128 wpm over 2:56 (the end card is silent text,
about 4 s).

## The problem
- **Screen:** `/listings`: nine listings on one screen (no scroll) — five automatic diver watches (three from Japan,
  including the Japanese-language seller listing; one from China; one from Germany), one articulated PVC figure, men's
  denim jeans, a chef's knife and the anime disc box set — generic titles, Sandbox badge. Hold, and move the cursor
  slowly down the rows.
- **Say:** "So, you buy a watch from Japan for $300, and a week later a customs bill arrives. Since the US ended duty-free
  entry for small parcels, almost every cross-border order owes import duty, and most checkouts don't show it. That's why
  I built Landed. It shows the delivered price, duty included, before anyone pays, to the buyer and to the AI shopping
  agent."
- **Must be true:** generic names only, no trademark in any title; Sandbox badge visible.

## 1 · Shopper
- **Screen:** `/listings` → *Get landed cost* on the Japanese watch (L-P03) → `/checkout/<quoteId>` → PayPal popup (3 s or
  less; cut the login) → back on checkout.
- **Inputs:** *Get landed cost* → *Approve $362.50 purchase* → PayPal button → approve.
- **Say:** "First, let's look at what the shopper experiences with Landed. Here you see a US import duty estimate of
  $37.50, and every dollar is linked to the official US tariff schedule. Here you approve the exact total. PayPal
  authorizes the payment first; our code checks the amount and the limits, and only then captures it. If anything is off,
  the hold is released. Sellers can also send this as a PayPal invoice."
- **Must be true:**
  - Goods $300.00 · Shipping $25.00 · US import duty (est.) $37.50 (MFN $16.93 + 9903.05.49 $20.57) · Total **$362.50**.
  - Rate version `2026-rev21-v2`, HTS 2026 Rev. 21; the duty line sits above the PayPal button; per-order cap $400.00.
  - "Send DDP invoice instead" is visible.
  - After paying: "Payment CAPTURED · $362.50", "PayPal order <id> · Capture <id>", "Policy: all checks passed." Note the
    order id for the agent's order-status run.

## 2 · AI agent
- **Screen:** `/agent`, in the same browser session as the shopper scene.
- **Inputs** (budget `400.00`, confirmed, for both runs):
  1. Message `automatic diver watch under $400 delivered` → *Run comparison*.
  2. Message `What is the status of my order <id>?` → *Run comparison*.
  - Cut the waiting time. Measured on production (dry run 2026-10-13): the compare run took 5 steps in 10.7 s; the
    order-status run took 2 steps in 5.0 s.
- **Say:** "Next, the AI shopping agent. It compares every option by the final price, duty included. Here, China has the
  lowest sticker price, but Germany is cheapest delivered. Our code does the math and enforces my budget, and listings
  that try to trick the AI are blocked. The agent can only suggest; I approve and pay. It can even check my orders
  through PayPal's Agent Toolkit without ever seeing my personal details."
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

## 3 · Seller
- **Screen:** `/estimate` (the seller's estimate tab), then `/seller`, signed in before the take (never show the passcode)
  → *Orders and duty* → *Review queue*.
- **Estimate form:** *Product description (any language)* (one box) · *Where was it made?* · *Selling price to the US
  buyer (USD)* · *Shipping to the buyer (USD), optional* → submit.
  - (a) Description `Men's jeans, straight leg, 14 oz cotton denim.`, origin Japan, price `200.00`, shipping left empty.
    While saying "Other possible matches…", click *Other likely lines (same duty)* so the "Automated estimate
    (2026-rev21-e4)" labels appear.
  - (b) Refusal: `Stainless steel stovetop kettle, 1.5 L`, Japan, `90.00`.
- **Ledger and queue:**
  1. Filter the *Listing* column with `L-P14` (4 rows) → hover a row (tooltip) → *Export CSV* (the export follows the
     filter).
  2. *Review queue* → click "Men’s leather oxford shoes".
  - **Never click *Accept* or *Publish* on camera.**
- **Say:** "Next is the seller's tab. Before stocking a product, a seller can estimate the duty on almost anything made in
  Japan, Germany or China, just by describing it. For these jeans, the duty comes from a rate I verified by hand, and it
  says so. Other possible matches are labeled as automated estimates. When Landed can't be sure, like for this steel
  kettle, it says so and shows why instead of guessing. Every sale lands in the seller's dashboard, built with AG Grid:
  the duty, the tariff code and the rates used. You can filter it, total it and export it for the accountant. Anything the
  AI isn't sure about waits here for a person to review."
- **Must be true:**
  - (a) 6203.42.4511 "Verified rate row (2026-rev21-v2)" **$33.20**; after the click, the other lines are labelled
    "Automated estimate (2026-rev21-e4)".
  - (b) "Can't estimate this product yet", citing heading 9903.82.03 and U.S. note 16(c)(vii).
  - The L-P14 filter leaves 4 rows, each with its duty, HTS line and rate version; the pinned captured-duty total shows.
  - The shoes item shows "Needs review", confidence 0.50, its review reasons and its questions.
- **Fallbacks:**
  - Verified row: `Automatic diver watch, stainless steel case and bracelet, 21 jewels`, Germany, `290.00`. The 9102.21.70
    result card then asks for *Value of the watch case (USD)*: enter `190.00` → *Estimate with this split* → "Verified rate
    row", $29.00.
  - Refusal: `Men's leather oxford shoes, leather soles`, Japan, `220.00` → cites heading 9903.41.10.

## Why trust it
- **Say:** "You might be asking: why should we trust the numbers? Every verified duty is tested to the cent. In our
  testing, the AI never auto-approved a wrong code, and a safety check caught an AI-written rule that would have
  undercharged. The AI suggests, the code decides, and a person approves every payment."
- **Behind each claim:**
  - Tested to the cent: the golden cases (below).
  - Never auto-approved a wrong code: SPEC §4.1, wrong ∧ auto 0 across 33 verified answers.
  - The safety check: the estimator build gate (GR) blocked the AI-drafted rule for 9903.05.87 (SPEC §4.7).

## End card (about 4 s)
- **Screen:** Landed · "Duty included, before you pay." · 15 golden test cases · 0 of 33 wrong codes auto-accepted ·
  1,000+ tests · landed-hd19.onrender.com
- **Numbers:**
  - 15 = cases in `data/eval/golden-2026-rev21-v2.json` (P01–P14, P07 twice).
  - 0 of 33 = SPEC §4.1: wrong ∧ auto 0 across 33 verified answers (11 products × 3 runs).
  - 1,000+ = `pnpm test` unit tests (1,034 in 104 files on 2026-10-14).
  - Re-check all three before any re-record.

## Before recording (for any re-record)
1. **Review queue on production:** has rows since the 2026-10-13 dry run, including "Men’s leather oxford shoes" (Needs
   review, 0.50). Check it is still there and unaccepted.
2. **Ledger on production:** it holds old test orders (voids, older rate versions); the `L-P14` filter in the seller scene
   shows 4 rows. Check they and the pinned total read cleanly.
3. **Catalog for the agent scene:** keep it as in the dry run: 5 quoted rows (incl. the Japanese-language seller listing
   L-C-bce3add4) and 1 withheld listing. Publish no other matching listing before recording; the compare cap is 6.
4. **Rehearse the estimate takes** (a) and (b) on production; switch to the fallbacks if a result differs.
5. **Limits:**
   - Agent: 5 runs per session per hour and 60 per day (judging-window value in `render.yaml`). A take uses 2, so rehearse
     in another session.
   - Use a fresh browser session per take, because of the session spend cap.
   - Re-quote if a take spans the quote expiry.
6. **PayPal popup:** it labels the duty "Tax" (known). Keep it short; log in to the sandbox beforehand or cut the login.
7. **Agent wording:** rehearse until the final message is at most 4 sentences and the order reply says "US import duty
   (est.)".
8. **Setup:**
   - Kiosk or full-screen browser, OS taskbar hidden, zoom 110%, 1080p.
   - Captions on, with no model or vendor names.
   - Music: the owner's original track only.

## Verification
- Rehearse each scene on production against its "Must be true" list.
- Final runtime under 3:00 (official rule). The final cut is 2:56.
