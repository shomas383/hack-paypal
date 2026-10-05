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
- `pnpm test:e2e` — Playwright demo-path test against sandbox
- `pnpm typecheck` · `pnpm lint`
- `pnpm db:migrate` · `pnpm db:seed` — seeds listings + imports `data/rates/*.json`
- `pnpm rates:validate` — schema + source/effective-date checks on rate data
- `pnpm eval:classifier` — runs classifier on `data/eval/products.json`, prints accuracy table
- `pnpm spike:paypal` — Week 1 sandbox spike scripts in `scripts/spike/`

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

## Workflow
- Non-trivial change (multi-file, unclear approach, PayPal/rates/policy code): use plan mode first; show me the plan.
- Tests first for `money`, `rates`, `policy`. Write the failing test, then the code.
- Small commits, conventional messages (`feat:`, `fix:`, `test:`, `docs:`, `chore:`). One concern per commit.
- After changes: run `pnpm typecheck && pnpm test`; show me the output, don't just say it passes.
- Use a subagent for wide searches/reviews (e.g., "review this diff against invariants 1–11").
- When you learn a PayPal/tariff fact from a primary source, record it in `docs/PAYPAL.md` or `docs/SPEC.md` with the URL and date.
- IMPORTANT: Scope discipline. If a task isn't on the demo path in `docs/DEMO.md`, ask before building it.

## Definition of done (per feature)
- Acceptance criteria in `docs/SPEC.md` met; unit tests + (if on demo path) Playwright step green
- Typecheck + lint clean; no new unpinned deps; no `VERIFY` introduced silently (list them in the PR/commit body)
- Works against PayPal sandbox end-to-end, not just mocks
- README updated if setup/commands changed

## Current milestone — update weekly
Week 1 (Oct 5–11): sandbox spike. Prove with scripts in `scripts/spike/`: (a) Orders v2 AUTHORIZE with itemized
items + tax_total duty, buyer approval via JS SDK v6, authorize → capture → void; (b) Invoicing draft → send with
duty itemized; (c) webhook receipt + verification; (d) Agent Toolkit read-only tools in AI SDK. Write results
into `docs/PAYPAL.md` and clear the matching VERIFY items.
Feature freeze: **Wed Nov 4, 2026, end of day.**