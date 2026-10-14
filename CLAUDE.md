# Landed — duty-aware checkout for cross-border commerce on PayPal

Pitch: AI classifies the product (HTS code + confidence), a verified rate table computes the true
landed cost, and the US buyer — or their AI agent — sees the full price, duties included, before
approving a PayPal payment. Hackathon entry: PayPal AI Hackathon (Devpost). Solo developer.
Deadline: **Nov 12, 2026 12:00 PM PT (PST) = Nov 13 05:00 JST. We submit by Nov 10.**

## Read these on demand (not auto-imported, to save context)
- `docs/SPEC.md` — requirements, data model, rate-engine rules, acceptance criteria. Read before any feature work.
- `docs/PAYPAL.md` — verified PayPal API notes + gotchas. Read before touching `src/server/paypal/**`.
- `docs/HACKATHON.md` — rules, judging, submission checklist, timeline. Read before README/video/deploy work.
- `docs/DEMO.md` — the <3-minute demo script. The demo path is the product; build toward it.
- `docs/HTS_VERIFICATION_SPEC.md` — how a duty row is verified (HTS + Chapter 99, Rev. 20 regime facts). Read before
  touching `data/rates/` or `src/domain/rates/`.

## Stack (decided — do not change without asking)
- TypeScript (strict) · Next.js App Router · pnpm · Node 24 LTS (Active LTS until 2026-10-20 per the nodejs/release schedule; Node 26 enters Active LTS 2026-10-28; Agent Toolkit needs ≥18)
- PayPal REST via `fetch` in `src/server/paypal/` (our own thin client) · PayPal JS SDK v6 via `@paypal/paypal-js/sdk-v6`
- LLM: Claude via Vercel AI SDK (`ai` + `@ai-sdk/anthropic`), structured output with `zod`
- PayPal Agent Toolkit `@paypal/agent-toolkit/ai-sdk` — READ-ONLY tools only (see Invariants)
- Postgres + Drizzle ORM (local: docker compose; prod: Render Postgres)
- Tests: Vitest (+ fast-check for money/rate properties) · Playwright for the demo path E2E
- Deploy: Render (web service + Postgres). Optional AG Grid in seller console (sponsor prize).

## Commands (create these scripts in Week 1; keep this list in sync with package.json)
- `pnpm dev` — run app locally
- `pnpm test` — Vitest unit tests (fast; run after every change)
- `pnpm test:e2e` — Playwright demo-path test against sandbox (`PW_HEADED=1` to watch; pauses for a human if PayPal's login needs it)
- `pnpm typecheck` · `pnpm lint`
- `pnpm db:migrate` · `pnpm db:seed` — applies Drizzle migrations · upserts the demo listings from `data/seed/listings.json`
  (prices checked against the verified golden cases; every listing must quote OK)
- `pnpm rates:import` — regenerates `data/rates/` + `data/eval/` from the gitignored verified sheet (`data/source/`); stages the output
- `pnpm rates:validate` — schema + source/effective-date checks on rate data
- `pnpm secrets:scan <range>` — secret scan of every file touched and line added by each commit in the range
  (src/guards/secretScan.ts): 1 sensitive paths, 2 secret patterns, 3 known local values (.env secrets, git user.email,
  SECRET_SCAN_EXTRA — read at runtime, never committed), 4 high-entropy tokens (not path/slug-like; no SRI hashes; the
  generated HTS index is exempt from rule 4 only). Prints file:line only, never the matched text; exit 1 on any finding
- `pnpm hts:download` — downloads the full HTS export into the gitignored `data/source/hts/` and writes
  `current-export.meta.json` (the release read from `reststop/currentRelease` before and after; `exportList` ignores any release
  parameter, so the export can't be pinned to a revision)
- `pnpm hts:import` — builds the committed HTS index (codes + description chains, no rates) from the export named in that
  sidecar; the revision label and file names come from the recorded release; stages the output
- `pnpm eval:classifier [--runs N]` — runs the classifier on `data/eval/products.json` (live Claude calls, ~11 per run); prints
  wrong ∧ auto (exit 1 if > 0), auto rate, 6/8/10-digit accuracy vs the 8/11 baseline, confusion matrix, per-product reasons
- `pnpm estimator:build` (exactly; write mode) — next data version `data/estimator/<release>-eN/` (previous version's rules +
  recorded drafting runs `__fixtures__/rules-drafted-*.json` for reference rules it lacks), records valid_until, stages it.
- `pnpm estimator:build --out <dir> [--draft [--max-calls N] [--draft-headings 9903.05.87,…|--draft-ids cn-exempt-…,…]]` — builds the estimate-mode data
  from the official sources (export of current-export.meta.json; the release's Ch. 99 PDF, downloaded if missing; pdftotext
  must be xpdf 4.06) and runs the gate (G0–G9) with the reference rules; writes manifest/report/rules to `--out` (refused
  inside data/). `--draft` is LIVE: Claude drafts the rules (≤ 15 calls, retries included) and GR compares them to the reference
- `pnpm agent:live [--out f.ndjson] ["message"] [--budget 400.00] [--exclude-listing <id>]…` — ONE live buyer-agent run
  against the local DB (live Claude calls); prints the transcript and fails if any $ amount in the agent's text isn't from
  stored-quote/rate data or the budget, a non-allowlisted tool was called, L-T-INJ was proposed, an HTS-description match
  within the compare cap wasn't quoted, the agent text has a checkout path / URL / quoted official text, or the final
  message has more than 4 sentences or more than one paragraph (a 1-sentence final message, untraceable quotes and
  unexplained HTS-description mentions only warn). `--exclude-listing` hides a
  listing from that run's catalog (no DB write; script only — no route can reach it)
- `pnpm seller:seed [--force]` — LIVE (2 Claude calls per sample): classifies the two seller demo samples
  (`src/domain/seller/samples.ts`) so the review queue isn't empty; accepts/publishes nothing; skips samples already
  classified. Never run by a deploy.
- `pnpm spike:paypal <a|b|c|d|e|f|g>` (aliases `pnpm spike:a` … `spike:d`) — sandbox spike scripts in `scripts/spike/`
- `pnpm build` · `pnpm start` — production build/start (Render runs these via `render.yaml`; `/api/health` is the health check)
- `data/rates/` is guarded by `.claude/hooks/protect-rates.mjs`: Edit/Write and Bash/PowerShell commands that mention it are
  denied, except exactly `pnpm rates:import` / `pnpm rates:validate`. Read it with the Read tool.
- `data/hts/` (the Rev 20 HTS index) has the same guard: written only by `pnpm hts:import`, which also stages its output;
  any other command mentioning it is denied. Read it with the Read tool. (Hook tests: `src/guards/protectHook.test.ts`.)

## Architecture map
- `src/app/` — Next.js routes: `(buyer)/`, `(seller)/`, `api/`
- `src/domain/money/` — Money type, minor-unit math, formatting. Pure, 100% tested.
- `src/domain/rates/` — rate engine (pure functions). Input: origin + HTS10 + customs value. Output: itemized duty + citations, or `UNSUPPORTED`.
- `src/domain/classifier/` — LLM HTS classification + confidence + review routing
- `src/domain/policy/` — capture policy gate (deterministic). The ONLY path to capture.
- `src/server/paypal/` — OAuth token cache, orders, payments, invoicing, webhooks
- `src/agent/` — buyer agent: tools, system prompt, toolkit allowlist
- `data/rates/` — versioned rate tables (JSON). `data/eval/` — 12-product eval set. `data/seed/` — listings.
- `scripts/spike/` — throwaway sandbox experiments (Week 1); findings go into docs/PAYPAL.md

## Non-negotiable invariants
1. Money = `{ amountMinor: bigint | integer, currency: 'USD' | 'JPY' }`. NEVER floats. JPY exponent 0 (no decimals); USD exponent 2. Convert to PayPal strings only in `src/domain/money/format.ts`.
2. Rates are DATA, never code. Every rate row carries `source`, `hts_revision`, `effective_from`, `verified_on`. No rate literals in `src/`.
3. Rate engine refuses (`UNSUPPORTED`) for any origin/HTS/date not covered. It never guesses, interpolates, or asks the LLM.
4. NEVER invent tariff rates, HTS codes, PayPal fields, or endpoints. If not in `docs/` or `data/`, write `// VERIFY:` and ask me.
5. LLM never decides amounts, never sets prices/duty, never authorizes or captures. LLM proposes; code decides.
6. Every capture requires a recorded human approval row + a passing `policy.decideCapture()`; spend caps enforced in code.
7. Every PayPal POST sends a unique `PayPal-Request-Id`; retries reuse the same id. Never rely on Agent Toolkit for money-moving calls.
8. PayPal order `amount.value` MUST equal the breakdown sum; assert locally before calling the API. 
9. Sandbox only: base URL `https://api-m.sandbox.paypal.com`. Boot fails if `PAYPAL_ENV !== 'sandbox'`.
10. Secrets only via env. `.env` is gitignored; `.env.example` is the contract. Never print secrets in logs/tests.
11. Exact pinned dependency versions (no `^`, `~`, `latest`). Commit the lockfile. ASK before adding any dependency.
12. Never circumvent a hook or permission rule (no path splitting, encoding, alternate tools or indirection). If a guard
    blocks something you need, stop and ask me. No path obfuscation (splitting, encoding, globbing tricks) to avoid a hook;
    use the Read/Glob/Grep tools or stop and ask.
    This includes false positives: e.g. a commit message naming a protected folder is blocked → stop and tell me; never reword it.
13. `.env` is never read, with ONE approved exception: the secret scan's rule 3 (`pnpm secrets:scan`) reads it at runtime
    to compare added lines against local secret values. Conditions:
    - `src/guards/secretScan.ts` and `scripts/secret-scan.ts` never print, log or return secret values or matched text
      (file:line + rule only); the no-leak test in `src/guards/secretScan.test.ts` stays.
    - Any change to those two files needs my explicit approval before commit; show me the diff first.
    - Never run the scanner with its output redirected to a file that gets committed.
14. Do not accept or merge outside code contributions into this repo; all code must come from the owner or the owner's own
    AI-assisted sessions.

## Workflow
- Non-trivial change (multi-file, unclear approach, PayPal/rates/policy code): use plan mode first; show me the plan.
- Tests first for `money`, `rates`, `policy`. Write the failing test, then the code.
- Small commits, conventional messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). One concern per commit.
- After changes: run `pnpm typecheck && pnpm test`; show me the output, don't just say it passes.
- Every push runs `pnpm secrets:scan origin/main..main` (the exact range being pushed) first; any finding → don't push,
  report the file:line list.
- Use a subagent for wide searches/reviews (e.g., "review this diff against invariants 1–11").
- When you learn a PayPal/tariff fact from a primary source, record it in `docs/PAYPAL.md` or `docs/SPEC.md` with the URL and date.
- IMPORTANT: Scope discipline. If a task isn't on the demo path in `docs/DEMO.md`, ask before building it.

## Definition of done (per feature)
- Acceptance criteria in `docs/SPEC.md` met; unit tests + (if on demo path) Playwright step green
- Typecheck + lint clean; no new unpinned deps; no `VERIFY` introduced silently (list them in the PR/commit body)
- Works against PayPal sandbox end-to-end, not just mocks
- README updated if setup/commands changed

## Current milestone — update weekly
Week 4 part A (deploy) DONE (2026-10-07): live on Render (https://landed-hd19.onrender.com) — health check + boot-time sandbox
lock, verified idempotent webhook receiver (live deliveries Success), one invoice per quote, production invoice recipient pinned,
classifier rate limit (client IP verified), DB closed to external access. Watch $362.50 captured on Render.
Part B1 (classifier + eval) DONE (2026-10-08): safe but baseline not beaten; the model answers from stale memory.
Part B2 (grounded classifier on the Rev 20 HTS index) DONE (2026-10-08): wrong ∧ auto 0/33, auto 3/11, 10-digit 9/10 every run
(baseline 8/10; beaten by one product, n = 11). See SPEC §4.1.
rates-v2 DONE (2026-10-08): the watch is keyed by its component-reporting line 9102.21.70 (Ch. 91 Stat. Note 1); every rate key
is checked against the HTS index; duty unchanged ($37.50 on $300).
Buyer agent + /agent page DONE and live (verified on Render 2026-10-09): read/prepare-only tools, confirmed budget, injection
withheld by code (the seller-instruction notice comes from code), official Ch. 99 wording, cap refusals with numbers; the page
compares JP $362.50 ✓ · CN $377.09 ✓ · JP-B $452.50 ✗ (over budget), proposes JP, and the checkout shows the "proposed by your
agent" banner. SPEC §4.4 ACs met.
rates-v3 DONE (2026-10-09): CN watch P13 (9903.05.31 + 9903.88.15, cumulative per note 52(a)); programs CH99_NOTE52 /
CH99_NOTE20_LIST4A / CH99_NOTE20_LIST4B.
rates-v4 DONE (2026-10-10): EU watch P14 (DE, 9903.05.39 combined 10%, note 52(k); the importer checks the sheet's cap
against the official .39/.38 heading text); refs and regime notes cite heading and note numbers only (no "List 4A/4B", no
"301", no FR citation). Seed L-P14. Demo query is now "automatic diver watch under $400 delivered": the agent quotes JP
$362.50 · CN $377.09 · DE $344.00 · JP-B $452.50 ✗ and proposes DE (live run 2026-10-10). With "vintage" it picks JP L-P03
(the only listing claiming an era) — DEMO optional second beat.
UI refresh + seller UI DONE on branch `ui-refresh` (2026-10-10, not merged/pushed yet): design system (docs/design/,
tokens.css, IBM Plex, exact USD formatter, raw-value guard), buyer pages refreshed (axe clean, production-build screenshots);
seller console `/seller` behind SELLER_CONSOLE_PASSCODE (≥ 12 chars; unset → 404): grounded classifier in the service with real
progress, code-built seller questions from the official chains ("Other (not: …)", "none of these apply"), accept / override /
undo / publish (case/band split; quotable only with a verified rate row), AG Grid Community review queue and orders/duty ledger
with CSV. Migrations 0008–0010. `pnpm seller:seed` (live) exists, not run on Render. SPEC §4.1/§4.4/§4.5 ACs ticked.
Next: go-live (merge ui-refresh, push, Render deploy runs migrations 0008–0010; set SELLER_CONSOLE_PASSCODE in Render; then
`pnpm seller:seed` once), then polish and the demo video.
Estimate mode (branch `estimate-mode`, not pushed): **Oct 20 checkpoint MET on 2026-10-11** — JP/EU data layer green incl.
G8: Ch. 99 note extraction + mentions index, rules (reference + first live drafting run; 9903.05.87 blocked by GR), gate
G0–G9 + GR, coverage (G7), reviewed IEEPA list (data/reviews/, 120 headings, EO 14389 §1 / CSMS # 67834313, sha-checked by
G0), first committed data version `2026-rev21-e1` (pnpm estimator:build; JP 5,512 / DE 5,007 of 19,926 lines refused).
Loader, verified-first, no-charge guards, estimates API (migration 0011) and /estimate page DONE (2026-10-11).
CN DONE (2026-10-12, data `2026-rev21-e4`, valid_until: none — scoped to modeled rules' boundaries): 9903.05.31 + note 20 lists 20(b)/(d)/(f)/(s)(i) additive,
9903.88.16 not applied (suspended), CN note 52 exemptions; note 20 exclusions are disclosures (5 in effect / 58 expired /
8 unclear → refuse); numbering fixes for the 9 official oddities; ended entry periods out of force; civil-aircraft headings
name their origin. G8 green JP/DE/CN (P13 $72.09). Refused of 19,926: JP 4,532 / DE 5,004 / CN 3,739. Drafting: CN lists
7 calls, exemptions 7 calls; 9903.05.87 blocked by GR for JP/EU and CN. e1–e3 kept as history. SPEC §4.7.
Pushed to main 2026-10-12. After 2026-11-09 the 20(vvv)/(www) exclusion notices are stale (they state their end date): rebuild.
Rate coverage decision (2026-10-09): add the EU row now; auto-importing base rates is deferred (README roadmap: base rates from
the official HTS export, add-on rules encoded per Chapter 99 program).

Week 3 walking skeleton: DONE early (2026-10-07) — listing → quote → checkout (duty line before the button) → recorded Approve →
PayPal v6 → authorize → `decideCapture()` → capture | void; DDP invoice. Headed e2e green; results in docs/PAYPAL.md.
Week 2 rate engine + data: DONE (2026-10-06) — 10 verified Rev. 20 rows, golden 11/11, trust 10/11 flagged, property tests.
Week 1 sandbox spikes: DONE (2026-10-05).

Carried over:
- PayPal popup automation is flaky (two login variants, "Click to Continue" overlay, one run with no popup) — e2e keeps a manual fallback.
- Webhooks: `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.DENIED`, `INVOICING.INVOICE.PAID` not yet seen as real deliveries.
- PayPal-Request-Id retention window unknown — never rely on retries days later. Invoicing create IGNORES it (spike f): never retry
  an invoice create. A stuck CREATING invoice row → 409; recovery via a quote-derived `invoice_number` is possible (spike g), not built.
- `PUBLIC_BASE_URL` is optional and unused (validated if set; `render.yaml` sets it). When code first hands out an absolute URL,
  make it required for a production server (not during `next build`: skip when `NEXT_PHASE === 'phase-production-build'`).
- Render: `corepack enable` fails (EROFS on /usr/bin/pnpm, 2026-10-07) → every `render.yaml` step runs
  `npx --yes pnpm@10.32.1 …`.
- Rev. 20 effective date RESOLVED (releaseList: Rev 20 was in force 09/28–10/09/2026). VERIFY: P12 ruling H236026 not yet read.
- HTS 2026 Rev. 21 (current from 10/09/2026): DONE 2026-10-11. A full-text comparison (HTS_VERIFICATION_SPEC §8) found no change
  to any rate, heading or note text our rows use; the user updated sheet Y/Z/V/W; index `2026-rev21`, rates `2026-rev21-v1`
  (numbers identical to v5, test). `exportList` can't be pinned to a release, so `pnpm hts:download` records currentRelease.
  On each new revision: hts:download → compare (§8 method) → sheet Y/Z/V → hts:import → bump current.ts → rates:import.
- rates-v2 DONE (2026-10-08): sheet M14 = 9102.21.70, V14 = 2026-10-08; the import (now 2026-rev20-v2) aborts unless every rate
  key is a real line in data/hts/2026-rev20.json (8-digit keys only with componentReporting). The current version is named in
  `src/domain/rates/current.ts`; v1 files stay as history (stored v1 quotes reference them and are refused as stale).
  rates-v4 (2026-10-10) supersedes it; rates-v5 (polish-1, 2026-10-10) = v4 minus the CSMS citation (rates unchanged; a
  published version's content never changes, so any change to generated data is a new version). After the Render deploy,
  `/api/health` should show `rateVersion: 2026-rev21-v2` after the next deploy (was 2026-rev20-v5). The pre-deploy step re-seeds
  the listings, incl. L-P14; open older-version quotes become stale and are re-quoted. 2026-rev21-v2 (2026-10-11) = v1 with
  the importer's own text in house style (note/heading numbers only; src/domain/rates/houseStyle.test.ts); figures identical.

Polish backlog (Wk5, before the Nov 4 freeze):
- Duty line labels: DONE — checkout and agent show the official Ch. 99 heading text, quoted, with no program label; rates-v3
  renamed the programs after their HTS notes (CH99_NOTE52, CH99_NOTE20_LIST4A/4B).
- Base HTS line text: DONE (ui-refresh) — checkout and agent show the full official chain, every level verbatim, " › ".
- Quote expiry: DONE (ui-refresh) — shown in the buyer's local time.
- Ledger: DONE (polish-1, 2026-10-10) — Rate version shown at all widths; Listing is the only flex column (title on hover);
  goods/shipping/PayPal order in tooltips + CSV (grid max 1152 px).
- Action rows: DONE (polish-1) — primary first (Accept / Publish, then Override); publish dialog and checkout already were.
- Agent final message: prompt asks for ONE paragraph of 2–4 sentences, duty "made up of the base rate plus heading …";
  agent:live FAILs > 4 sentences / > 1 paragraph (polish-1). Live 2026-10-10: demo query 4 sentences PASS; "vintage …"
  5 sentences FAIL (5th = "nothing is bought until you … Approve") — next: tell the prompt not to restate the checkout steps.
- Seller questions: DONE (polish-1) — options citing statistical reporting numbers show "If you don't know, choose Not sure".
- Agent search/quote mismatch: DONE (2026-10-10, local) — search_listings returns only matches (+ whole-catalog withheld
  count), get_landed_cost_quote refuses ids no search in the run returned, compare_landed_costs quotes all matches (max 6,
  score then id) sorted by delivered total; agent:live checks quoted ⊆ searched, DE proposed, JP-B over-budget row.
- HTS-description search: DONE on branch `hts-description-search` (2026-10-11, local, not pushed) — seller-published
  listings match on their official Rev 20 chain when their own words don't (title matches always first; then score,
  created_at, id); /agent shows "Matched on official HTS description"; seller-text filter normalised + Japanese/Chinese
  patterns + fail closed on unchecked scripts; replay fixture `?fixture=ja`. SPEC §4.4. Keep production at ≤ 2 Japanese
  watches for the video (a 3rd is shown but not quoted: compare cap 6).
- HTS match line: DONE (polish-1) — deepestLevels(): one level per matched term (9102.21.70 → 2 bullets).
- /agent layout: DONE (polish-1) — quote table fits 721–1280 px (id ellipsis + title; two-line rows ≤ 720 px); search
  table right gutter at ≤ 640 px; notices singular/plural.
- CSMS citation: REMOVED in rates-v5 (polish-1) — no verified sheet row backed it; note 52 / heading citations kept.
- Sheet (next sheet edit): Products!S for P11 says a covered knife is "charged on steel CONTENT" — contradicts Rev 21 note
  16(c) ("Headings 9903.82.02–9903.82.26 apply to the full customs value …"); only feeds data/eval (products.json). Also
  Verify!W for P05, P09, P13, P14 still name programs ("301", "List 4A/4B", "Section 232", "IEEPA"; pinned in
  houseStyle.test.ts) and Products!S for P05 — reword to note/heading numbers; then importer EU_EVIDENCE ('IEEPA
  (terminated)') changes with P14's W, and rates:import makes a new version. Same batch: P12's title and evidence still
  say "Blu-ray" (trademark) in the importer's GENERIC map, data/rates and data/eval — rename to "optical disc" as the seed
  listing L-P12 already is (2026-10-13); not shown in the UI (no rate-row description or evidence is displayed).
- Guitar case-value question: when the price per item is over $100, ask ‘Is the guitar alone, without its case, worth $100
  or less?’ instead of leaving both lines open (wording only; duty unchanged for JP).
- Ledger (/seller Orders and duty): a filter on the Rate version column (README screenshot shows old-version orders on
  purpose: every order keeps the rate version it was quoted under).
- CURRENT_HTS_REV_SHORT (src/domain/rates/current.ts): the regex is /^d{4} Rev. / (missing backslash) — labels read
  "2026 Rev. 21" instead of "Rev 21". One-character fix; on main since d0dba74.
- Estimator: split note 21 out of 20(www). The official text prints the 9903.89 note as "(21) (a) …" right after
  20(www)(14), so it segments as 20(www)(21); today exclusionOf() keeps it out of the 20(www) exclusion (items naming other
  Ch. 99 headings), and a second "21." (infant formula, 9903.19.23) follows — a proper fix needs a duplicate-note-number
  scheme. Also: 9903.05.87 (52(c)) drafted as unconditional twice → blocked; CN refuses its 16 items.
- Review queue (production dry run 2026-10-13): (a) questions the evidence already answers are still asked — the watch
  asks "automatic winding?" though the listing says automatic; (b) every question carries the same heading "Which
  description matches the item?"; (c) the oldest ledger row shows a 10-digit HTS (9102.21.7000) where the others show
  the 8-digit 9102.21.70.
- Estimator: rebuild after 2026-11-09 (exclusion notices end; note 31 headings 9903.91.12–.16 start Nov 10, lines already
  refused); EU members beyond DE; note 31 and 20(s)(ii) not modeled.

Feature freeze: **Wed Nov 4, 2026, end of day.**