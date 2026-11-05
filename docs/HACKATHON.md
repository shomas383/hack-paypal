# PayPal AI Hackathon — rules digest, checklist, timeline
Source of truth: https://paypalaihackathon.devpost.com/rules (re-check weekly; rules may be amended).

## Dates
- Submission period: Oct 1, 2026 9:00 AM PT – **Nov 12, 2026 12:00 PM PT** (PST after DST ends Nov 1; = 20:00 UTC; = Nov 13 05:00 JST).
- Judging: Dec 1, 2026 (2:00 pm PT) – Dec 15, 2026 (8:00 am PT). Winners announced on or around Dec 21, 2026 (2:00 pm PT), per the official rules.
- Project must remain available free for testing until judging ends → keep the hosted app, the sandbox app and the judge
  sandbox buyers working until winners are announced (**Dec 21, 2026**); then rotate or delete the judge sandbox buyers.
- Early eligibility review: the organizers review submissions made by **Thu Nov 5**; edits are allowed until the Nov 12
  12:00 PM PT deadline. We submit on **Nov 4**.

## Requirements
- Build/update an app integrating the PayPal developer platform (free sandbox) + any AI tool. PayPal must be central.
- New projects, or existing ones significantly updated after Oct 1, 2026. Our code is new; the 12-product sheet and earlier LLM test are prior research data — say so in README.
- Text description of features. Functional demo: hosted URL OR complete setup/run instructions (we provide both). Mockups don't count.
- Public GitHub repo with all source/assets/instructions and an OSS license detectable in the repo About section (AGPL-3.0 `LICENSE`; the rule requires any open source
  license file, not a specific one — confirmed against the Devpost rules 2026-10-13).
- Include test credentials/sandbox login details judges need (sandbox buyer account only — never API secrets).
- Video: < 3 minutes (judges need not watch beyond 3:00), shows project running, public on YouTube, no third-party trademarks or
  copyrighted music without permission → use generic product names on screen; royalty-free/no music, or the owner's own
  original track (used in the final cut).
- English (or translations provided).
- Third-party APIs/data must be used per their terms.

## Judging
- Stage 1 pass/fail: fits theme, reasonably applies required APIs/SDKs.
- Stage 2, equally weighted, tie-break in this order: Technological Implementation → Design → Potential Impact → Innovation/Idea → Presentation.
- Judges may judge solely on description, images, and video; judging may include automated AI-driven analysis → README and video must be self-explanatory.

## Prizes & stacking
- Grand: $12,000 / $8,000 / $5,000.
- Honorable Mentions ($5,000 each): Most Creative, Most Impactful, Best Demo Delivery, Best Use of PayPal + AI, Best Use of Agentic Commerce.
- AG Grid prize rules (checked by the user on https://paypalaihackathon.devpost.com/rules, 2026-10-08): "Best Use of AG Grid"
  ($5,000 / $2,000 / 3 × $1,000) is open to submissions "that use any AG Grid tools". No edition, licence or AG Studio
  requirement; general judging criteria; stacks with one Grand Prize or Honorable Mention. (Devpost returns 403 to automated
  fetches, so this was checked by hand.)
- Plan (seller UI, later): AG Grid **Community** only (no row grouping, pivot or Excel export) for the review queue and an
  orders/duty ledger (goods, duty, HTS, rate version, capture/void status, CSV export). Dependency pins to be proposed after
  checking current ag-grid-community / ag-grid-react versions and React 19 support on npm.

## Submission checklist
- [x] Flip https://github.com/shomas383/hack-paypal from private to PUBLIC before submitting (it is private during development); AGPL-3.0 LICENSE visible in About (any open source license meets the rule); README: pitch, architecture diagram, setup (≤5 commands), hosted URL, sandbox test buyer login, tools used list, what was built after Oct 1. Done 2026-11-04: public, About set (description, website, topics); GitHub detects the AGPL-3.0 license.
- [x] `.env.example` complete; no secrets in git history (run a secret scan BEFORE making the repo public).
  2026-11-04: full-history secret scan, 285/285 commits (6 branch tips, no tags). 14 findings, all reviewed: fake test
  fixtures (6985716 env.test.ts, 2bb94a1 boot.test.ts, c58d51d env.test.ts) and the local docker DATABASE_URL in
  .env.example (2cdd913). No real secrets. No .env, data/source, key files or sandbox emails in history. Decision: no history
  rewrite, no scanner change. Findings (commit:file:line:rule):
  - 2cdd913:.env.example:9:2, 2cdd913:.env.example:9:3
  - 6985716:src/server/env.test.ts:4:2, 6985716:src/server/env.test.ts:8:2, 6985716:src/server/env.test.ts:10:2,
    6985716:src/server/env.test.ts:11:2, 6985716:src/server/env.test.ts:11:3
  - 2bb94a1:src/server/boot.test.ts:4:2, 2bb94a1:src/server/boot.test.ts:7:2, 2bb94a1:src/server/boot.test.ts:9:2,
    2bb94a1:src/server/boot.test.ts:10:2, 2bb94a1:src/server/boot.test.ts:10:3
  - c58d51d:src/server/env.test.ts:35:2, c58d51d:src/server/env.test.ts:38:2
- [x] Sandbox webhook URL points at the live Render URL (not a dead quick tunnel) — live deliveries verified 2026-10-07
- [ ] Hosted demo works from a fresh browser; seeded data present; stays up until winners are announced, Dec 21, 2026 (not on a
  free tier that sleeps/expires)
- [x] `SELLER_PUBLIC_VIEW=1` on Render after the deploy that contains `/seller/demo`; open it from a fresh browser.
  Verified on production 2026-11-01 (/seller/demo returned 200) and again 2026-11-04 in the final live check.
- [x] Owner: create a judge sandbox **personal** buyer and a spare (not the `.env` buyer, which stays the invoice recipient
  and e2e login); fund them; one production checkout with each. Credentials go only in the Devpost testing field, never in
  the repo. Done 2026-11-01: judge buyer PASS (Test A), spare created and one production checkout PASS.
- [x] Judge-login check on production (Test A, 2026-11-01, owner by hand): PASS. Clean private browser, logged out of the
  PayPal developer site, signed in as the judge buyer. Checkout showed the duty before payment; authorize → check → capture
  succeeded; the success page showed the order and capture IDs; the agent answered for its own order and refused another
  session's; /estimate gave the knife figure and refused the kettle; the /seller/demo ledger worked; the payment arrived in
  the sandbox business account. (No credentials or order IDs recorded here.)
- [ ] VERIFY (owner, by hand): a sandbox personal account created under a *different* developer account can pay our
  sandbox merchant. Nothing relies on it now: the README's own-account fallback was removed on 2026-11-01. Record the
  result in docs/PAYPAL.md (date + PASS/FAIL only). Test B, 2026-11-01: **skipped**; the Devpost testing instructions direct judges to the
  provided judge login, so this stays unverified.
- [ ] VERIFY (owner, by hand): who can see Devpost's testing-instructions field (judges/managers only, or public)
- [ ] After Dec 21, 2026: rotate or delete the judge sandbox buyers
- [x] YouTube video public, < 3:00 (official rule; final cut 2:56), captions on (2026-11-04)
- [x] Demo video recorded and edited (2:56, under the 3:00 limit), uploaded to YouTube as Unlisted
- [x] YouTube title, description, chapters, custom thumbnail and corrected English captions done
- [x] Background music: original track by me (credited in the YouTube description)
- [x] Switch video to Public on Nov 4
- [x] Add the GitHub link to the YouTube description on Nov 4
- [x] Devpost form: description, tools list (PayPal Orders v2, Payments v2, Invoicing v2, Webhooks, JS SDK v6, Agent Toolkit, Claude, AG Grid, Render), repo + video links
- [x] Submit on **Nov 4** (early eligibility review for submissions by Nov 5; edits allowed until the Nov 12 deadline);
  never submit on deadline day. Submitted 2026-11-04 with the repo and video links.

## Devpost testing instructions (draft — fill the placeholders on the form only, never here)
> Live app: https://landed-hd19.onrender.com (PayPal **sandbox** only; no real money moves).
> 1. Buyer checkout: /listings → pick a watch → **Get landed cost** (the US import duty is shown before any PayPal button)
>    → **Approve purchase** → PayPal popup → log in with the sandbox buyer below. The server captures only if its policy
>    check passes; the order then appears in the seller ledger (step 4).
>    Sandbox buyer (test account, sandbox only): `<judge buyer email>` / `<judge buyer password>`.
> 2. Shopping agent: /agent → "automatic diver watch under $400 delivered" → confirm the budget → it compares delivered
>    prices and prepares the checkout; you approve and pay there.
> 3. Estimate: /estimate → any product description, made in Japan, Germany or China (live AI, rate-limited).
> 4. Seller console (AG Grid): https://landed-hd19.onrender.com/seller/demo, read-only, no passcode: Review queue
>    (open a row for the code-built questions and audit trail) and Orders and duty (CSV export).
> The first request after a quiet period may take a few seconds.

## Timeline
- Wk1 Oct 5–11: PayPal sandbox spike — DONE early (Oct 5). Still to do: ask PayPal Discord re Cart API access (nice-to-have).
- Webinars: Oct 6 9am PT "Start building with PayPal"; Oct 12 7am PT "Build a payments dashboard without building a dashboard".
- Wk2 Oct 12–18 (can start now): rate engine (tests first) + HTS Rev. 20 re-verification + 12-product import.
- Wk3 Oct 19–25: classifier + eval; checkout + invoice end-to-end in sandbox. **Walking skeleton of full demo path by Oct 25; record rough-cut video.**
- Wk4 Oct 26–Nov 1: buyer agent + approval gate + seller console (AG Grid).
- Nov 2: README audit and fixes (done, 998ca9d); Devpost fields complete.
- Nov 3: full-history secret scan (all commits); `pnpm estimator:build` if still needed; final production check.
- Nov 4: **feature freeze**; make the repo public (check AGPL-3.0 shows in About); tag `v1.0-submission`; video Public; fill
  the Devpost links and testing instructions; **submit**.
- Nov 5–12: respond to any eligibility flags (edits allowed until Nov 12 12:00 PM PT).
- Nov 10–11: estimator:build on Rev. 21 (removes the China exclusion disclosures that end Nov 9); run tests, deploy, check
  /estimate.
- Weekly until Dec 21: site, judge login and credit checks; check reststop/currentRelease for a new HTS revision.
