# Landed

Duty-aware checkout for cross-border commerce on PayPal. AI classifies the product (HTS code + confidence),
a verified rate table computes the landed cost, and the US buyer — or their AI agent — sees the full price,
duties included, before approving a PayPal payment.

> **Sandbox only.** The app refuses to run unless `PAYPAL_ENV=sandbox`. Duty figures are estimates, not customs rulings.

Status: Week 4 — walking skeleton of the demo path (listing → quote → checkout → PayPal sandbox → policy-gated capture; DDP invoice)
plus deploy readiness (Render Blueprint, health check, verified webhook receiver).

> **Demo data.** Seeded listings charge a **flat $25.00 demo shipping rate — not a carrier quote**. Shipping is excluded
> from customs value, so it never changes the duty estimate.

## Prerequisites
- Node 24 LTS, pnpm 10 (`corepack enable`)
- Docker (local Postgres)
- [cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/) for the webhook spike (`winget install Cloudflare.cloudflared`)
- PayPal developer sandbox app (client id/secret) and a sandbox personal (buyer) account

## Setup
```sh
cp .env.example .env        # fill in sandbox credentials
pnpm install
docker compose up -d
pnpm db:migrate
pnpm db:seed                # 5 demo listings
pnpm dev                    # http://localhost:3000 → /listings
```

## Demo path (sandbox)
`/listings` → **Get landed cost** → the checkout shows goods, shipping, and the **US import duty (est.)** line with HTS code,
Chapter 99 heading(s), sources and rate version — before any PayPal button → **Approve purchase** (recorded; spend cap shown)
→ PayPal button → log in as the sandbox Personal buyer → the server re-checks the order against the stored quote, authorizes,
runs the capture policy, and captures (or voids). **Send DDP invoice instead** creates and sends a PayPal invoice with the duty
itemized. End-to-end test: `PW_HEADED=1 pnpm test:e2e` (set `PAYPAL_SANDBOX_BUYER_PASSWORD` in `.env` to automate the
PayPal login; if PayPal's popup changes, the test pauses so you can finish the login and press Resume).

## How classification stays safe
The AI proposes a code; the code decides what happens with it.
- **Only real codes.** The model first names up to 3 HTS headings. The app expands them into the actual lines of the official
  HTS 2026 Rev. 20, and the model must choose from that list. Codes that no longer exist, such as pre-renumbering ones, can't
  get through.
- **Checked quotes.** Every piece of evidence and every attribute the model says the listing states must actually appear in
  the listing text.
- **Review when unsure.** Low confidence, close alternatives, or an unknown attribute that decides between lines all send the
  item to human review.
- **No amounts from the AI.** Duty comes only from the verified rate table, and nothing is quotable until the seller publishes
  the listing.

Eval on 11 verified products (+1 excluded), 3 runs, claude-opus-5-5, 2026-10-08 (`pnpm eval:classifier --runs 3`):

| | Ungrounded | Grounded |
|---|---|---|
| Wrong code auto-accepted | 0 / 0 / 0 | **0 / 0 / 0** |
| Correct and auto-accepted | 0/11 | **3/11** every run |
| 10-digit accuracy (baseline 8/11) | 7 / 5 / 7 of 11 | **9/11** every run |
| 8-digit accuracy (baseline 8/11) | 8 / 6 / 7 of 11 | **10/11** every run |

The baseline is beaten by one product at 10 digits, consistently across 3 runs. With n = 11, that's a small sample. The one
wrong answer went to review. A classification takes about 12–14 s (max 34 s).

## Deploy (Render, sandbox only)
`render.yaml` is a Render Blueprint: a web service plus Render Postgres 17, on the smallest paid plans.
1. **Apply the Blueprint.** In Render, choose New → Blueprint and select this repo. Confirm the plan names and prices first.
2. **Enter the `sync: false` values when prompted.** These are the PayPal sandbox credentials,
   `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_SANDBOX_BUYER_EMAIL`, `ANTHROPIC_API_KEY`, the spend caps, the quote TTL, the classifier
   threshold and the classifier limits.
   - `NEXT_PUBLIC_PAYPAL_CLIENT_ID` is baked into the build, so it must be set before the first build.
   - `DATABASE_URL` comes from the database automatically.
   - `render.yaml` fixes three values that aren't secrets: `PAYPAL_ENV`, `PAYPAL_API_BASE`, `TRUSTED_PROXY_HOPS=1`.
   - It also sets `PUBLIC_BASE_URL=https://landed-hd19.onrender.com`. That's the public https origin, required in production.
     Redirects are relative, and no URL is ever built from the request's host.
3. **What each deploy runs.** Each step runs through `npx --yes pnpm@10.32.1`, so it uses the pinned pnpm. Render's image doesn't
   allow `corepack enable`.
   - **Build:** `install --frozen-lockfile`, then `build`.
   - **Pre-deploy:** `db:migrate` plus `db:seed`. Both are idempotent, and the seed aborts if any listing can't be quoted.
   - **Start:** `start`.
   - **Health check:** `/api/health`.
4. **The server refuses to boot unless `PAYPAL_ENV=sandbox`** with the sandbox API base.
5. **Register the webhook.** In the PayPal developer dashboard, point the sandbox app's webhook at
   `https://<render-url>/api/webhooks/paypal`. Put its id in `PAYPAL_WEBHOOK_ID` and redeploy. Deliveries are verified with
   PayPal and stored once per event id, for reconciliation only.
6. **Production differences:**
   - The DDP invoice always goes to `PAYPAL_SANDBOX_BUYER_EMAIL`.
   - The session cookie is `Secure`.
   - Classifier calls are rate-limited per session, per IP and per day.

## Commands
| Command | What it does |
|---|---|
| `pnpm dev` | Run the app locally |
| `pnpm test` | Vitest unit tests |
| `pnpm typecheck` · `pnpm lint` | TypeScript (strict) · ESLint |
| `pnpm db:migrate` · `pnpm db:seed` | Apply Drizzle migrations · seed the 5 demo listings |
| `pnpm test:e2e` | Playwright demo-path test against the PayPal sandbox (`PW_HEADED=1` to watch) |
| `pnpm spike:a` … `pnpm spike:d` | PayPal sandbox spikes (see below); `pnpm spike:paypal <a\|b\|c\|d\|e\|f\|g>` also works |
| `pnpm rates:import` | Regenerate rate data + eval fixtures from the human-verified sheet (kept locally in `data/source/`, not committed) |
| `pnpm hts:import` | Build the Rev 20 HTS index (codes + description chains, no rates) from the official export kept locally in `data/source/hts/` |
| `pnpm rates:validate` | Schema + verification-metadata checks on `data/rates/*.json` |
| `pnpm eval:classifier [--runs N]` | Classifier eval on `data/eval/products.json` (needs `ANTHROPIC_API_KEY`; ~11 Claude calls per run). Exits 1 if a wrong code would have been auto-accepted |

## Sandbox spikes (`scripts/spike/`)
Each prints a PASS/FAIL table and exits non-zero on failure.
- **a** — Orders v2 `AUTHORIZE` with duty as item tax; open `http://localhost:5173` to approve two orders with the sandbox buyer; then capture one and void the other.
- **b** — Invoicing v2 draft → send with duty as a labelled custom amount. Needs `PAYPAL_SANDBOX_BUYER_EMAIL`.
- **c** — Webhooks. Run `cloudflared tunnel --url http://localhost:8787`, register the tunnel URL as a webhook in the sandbox app, set `PAYPAL_WEBHOOK_ID`, start `pnpm spike:c`, then run `pnpm spike:a` in another terminal.
- **d** — PayPal Agent Toolkit (read-only `get_order`) with the Vercel AI SDK. Optional order id argument; needs `ANTHROPIC_API_KEY` for the LLM checks.
- **e** — Invoicing v2: does a $0.00 duty line work (exempt items)? Creates a draft only (never sent). `pnpm spike:paypal e`.
- **f** — Invoicing v2: is create idempotent by `PayPal-Request-Id`? (No.) Drafts only, deleted afterwards.
- **g** — Invoicing v2: is `invoice_number` unique and searchable? (Yes.) Drafts only, deleted afterwards.

## License
MIT — see [LICENSE](LICENSE).
