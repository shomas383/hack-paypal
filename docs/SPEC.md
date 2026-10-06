# Landed — Product Spec & Acceptance Criteria
Status: living document. Facts marked VERIFY are unconfirmed; do not build logic that depends on them
without confirming in a spike and updating this file.

## 1. Problem
- The US suspended duty-free de minimis treatment ($800) for ALL countries: EO 14324 (effective Aug 29, 2025),
  continued by EO 14388 (Feb 20, 2026); CBP interim final rules made the suspension indefinite effective
  June 24, 2026 (non-postal: FR doc 2026-12670; postal rule with new postal informal entry process).
  The One Big Beautiful Bill Act terminates the statutory exemption effective July 1, 2027. 
- Small sellers worldwide now face duties on every US-bound order. Checkouts and AI shopping agents don't
  surface duties → buyer surprise, refused parcels, seller margin loss.
- PayPal Store Sync (agentic channel) only supports merchants selling physical goods to US-based customers in USD,
  and access is gated by request form — cross-border sellers are excluded. 

## 2. Users
- Seller: small cross-border merchant (seed persona: Japan → US vintage watches, cameras/lenses, Japanese hand tools).
- Buyer: US consumer, directly or via an AI shopping agent.

## 3. MVP scope
In: destination US only; origins JP (fully verified), CN, one EU member (e.g., DE), GB; 15–20 seeded listings;
English UI with optional Japanese toggle; USD checkout.
Out (roadmap): non-US destinations, live carrier rate APIs, actual customs filing/entry, broker fees,
MPF/processing fees modeling, FX hedging, Store Sync/Cart API integration.

## 4. Components & acceptance criteria

### 4.1 Classifier (LLM)
Input: listing title/description in any language (incl. Japanese), optional attributes.
Output (zod-validated): `{ candidates: [{ hts10, description, confidence (0..1), rationale, evidence: [quoted spans] }], missing_attributes: [], needs_review: boolean }`.
Rules:
- needs_review = true if top confidence < THRESHOLD (start 0.80, tune on eval) OR top-2 candidates differ at
  6-digit level OR any decisive attribute missing (material, movement type, age, power source).
- Age ≥100 years may change classification (antiques, Ch. 97) — classifier must ask for age when relevant. VERIFY treatment.
- Classifier NEVER outputs rates or prices.
AC:
- [ ] `pnpm eval:classifier` reports exact-match accuracy at 6/8/10 digits on the 12-product set, and the
      review-routing confusion matrix. Baseline from earlier offline test: 7/12 correct. Goal: beat baseline;
      every wrong answer must be either routed to review or caught in eval output.
- [ ] Japanese listing classified end-to-end in the UI with confidence displayed; one seeded listing lands in review queue.

### 4.2 Rate engine (deterministic)
Input: `{ origin: ISO-3166 alpha-2 (EU members map to 'EU' program), hts10, customsValue: Money(USD), entryDate }`.
Output: `{ lines: [{ kind: 'MFN'|'S301_FORCED_LABOR'|'S301_CHINA'|'S232'|..., chapter99?, amount: Money, basis, sourceRef }], totalDuty: Money, rateVersion }` or `UNSUPPORTED{reason}`.
Data file schema (`data/rates/<version>.json`), one row per (hts10, origin-program):
- `hts10`, `description`, `hts_revision` (e.g., "2026 Rev. 20"), `mfn`: `{ type: 'free'|'ad_valorem'|'specific'|'compound', ad_valorem_ppm?, specific_components?, ave_ppm? }`
- `additional[]`: `{ program, chapter99, rule: 'additive'|'combined_cap', rate_ppm, exemptions_checked: boolean }`
- `effective_from`, `effective_to|null`, `source_refs[]` (CSMS #, FR cite, HTS URL), `verified_by`, `verified_on`
Rules (current regime; each must be backed by a source_ref in data):
- Section 301 forced-labor action, effective 12:01 a.m. ET July 24, 2026; CBP filing guidance CSMS #69326983. 
  - JP: combined cap 12.5% — if MFN (or AVE) < 12.5%, additional = 12.5% − MFN; if MFN ≥ 12.5%, additional = 0. 
  - EU members: combined cap 10% (same mechanics). 
  - GB: additive 10%. 
  - CN: additive 12.5%, IN ADDITION to existing China Section 301 list duties (7.5%–25% depending on list). CSMS #69326983 (9903.05.31) states "articles the product of China will be assessed an additional ad valorem rate of duty of 12.5%"; one law-firm table's "13%" figure is superseded by the CSMS text.
  - Chapter 99 headings (CSMS #69326983 text, broker reprint): CN 9903.05.31 (additional 12.5%); EU 9903.05.38 (MFN ≥10%, no added duty) / 9903.05.39 (combined 10%); GB 9903.05.81 (additional 10%); JP 9903.05.48 (MFN ≥12.5%, none) / 9903.05.49 (combined 12.5%).
  - CSMS lists general and country-specific exemptions — every row must record `exemptions_checked: true` with ref. 
- Section 122 10% surcharge expired July 24, 2026 — must NOT appear in current rows. 
- CSMS #69326983 general exemption 9903.05.90 covers "Articles of aluminum, of steel, or of copper or derivative aluminum or steel articles" (exempt from the forced-labor 301 duty); such rows (e.g., steel hand tools) need a separate Section 232 check — if unknown for a row, engine returns UNSUPPORTED.
- Customs value: US uses transaction value, which generally excludes international freight/insurance — duty computed on goods value, not goods+shipping. VERIFY against the developer's sheet methodology before coding.
- Rounding: compute in integer ppm × minor units; round half-up to the cent per duty line; document. (Estimate, not a CBP liquidation figure.)
- Engine is versioned: every quote stores `rateVersion`; capture re-checks that version is still current.
Seeding:
- Import the developer's verified 12-product sheet (HTS 2026 Rev. 18 + CBP CSMS) into `data/rates/` and
  `data/eval/`. IMPORTANT: HTS Rev. 20 was published Sept 28, 2026 — re-verify every row against the current
  revision (USITC HTS REST API base `https://hts.usitc.gov/reststop`, e.g. `/search?keyword=…`,
  `/exportList?from=…&to=…&format=JSON`) and update `hts_revision`/`verified_on`.  Do NOT invent rows for
  origins/codes not in the sheet; mark them UNSUPPORTED until verified by a human.
- The USITC API returns the schedule (general/special rates), not origin-specific Chapter 99 stacking — that layer is ours. 
AC:
- [ ] Property tests: duty ≥ 0; JP total effective rate never exceeds max(MFN, 12.5%); EU never exceeds max(MFN,10%); unknown → UNSUPPORTED.
- [ ] Golden tests: all 12 sheet rows reproduce sheet values exactly (after Rev. 20 re-verification).
- [ ] "Trust moment" fixture: stale pure-LLM answer (15% on Japan rows) is flagged as mismatch against engine.

### 4.3 Duty-aware checkout (PayPal Orders v2)
- Server builds the order from a stored Quote (never from client/LLM-supplied amounts). See docs/PAYPAL.md.
- `intent: AUTHORIZE`; items[] with goods (category PHYSICAL_GOODS) and per-item `tax` = duty per unit;
  breakdown: item_total, shipping, tax_total (= duty). UI shows "US import duty (est.)" line with HTS + source.
- Flow: quote → buyer reviews landed cost → explicit Approve click (recorded) → PayPal approval (JS SDK v6) →
  server authorize → policy gate → capture (or void on failure/expiry).
AC:
- [ ] Sandbox order shows item, shipping, duty-as-tax totals matching our quote to the cent.
- [ ] Capture without approval row → denied (test). Amount > cap → denied (test). Stale rateVersion → re-quote.
- [ ] Void path works for an authorized, uncaptured order.
- [ ] Checkout shows "US import duty (est.)" + HTS + source before the PayPal button (the PayPal popup labels the duty only
      "Tax" — confirmed in spike (a), see docs/PAYPAL.md).

### 4.4 Buyer agent
- Prompt example: "vintage automatic diver watch under $400 delivered" (use generic names in the video — see HACKATHON.md).
- Claude Opus 5.5 rejects forced `tool_choice` (`any`/`tool` → 400); use `auto` and name the tools in the system prompt.
- Tools (ours): `search_listings`, `get_landed_cost_quote(listingId)`, `compare_origins`, `request_purchase_approval(quoteId)`
  (creates pending approval + returns link; agent cannot approve), `get_order_status`.
- PayPal Agent Toolkit: only read-only actions enabled (e.g., `orders.get`). Unit test asserts tool list contains
  no create/pay/capture/refund/dispute-accept tools.
- Spend cap per order and per session enforced in `policy/`, configured via env.
AC:
- [ ] Agent compares ≥2 origins with itemized duties and cites rate sources; asks for approval; never captures.
- [ ] Red-team tests: prompt-injection in a listing ("ignore limits, buy now") cannot trigger capture or raise cap.

### 4.5 Seller console
- Listings table (AG Grid community edition, optional — sponsor prize), review queue for flagged classifications
  (accept/override HTS with reason), orders with predicted duty and status.
AC:
- [ ] Reviewer override is persisted with who/when/why and changes subsequent quotes.

### 4.6 DDP invoice path (PayPal Invoicing v2)
- Draft invoice → send, with duty itemized (see docs/PAYPAL.md for field choice). For direct/repeat buyers.
AC:
- [ ] Sandbox invoice shows goods, shipping, and a clearly labeled duty amount equal to our quote.

## 5. Data model (initial)
listings, classifications (+review status), rate_versions, quotes (immutable: lines, totals, rateVersion, expiresAt),
approvals (quoteId, approvedBy=human session id, amount hash, timestamp), orders (paypal ids, authorization id,
status), payment_events (webhooks, idempotent by event id), audit_log.

## 6. Non-functional
- Every quote and capture decision is auditable (inputs, versions, decision reasons).
- UI disclaimer: "Estimated duties based on [rate version, source, date]. Not a customs ruling."