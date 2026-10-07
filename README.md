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

## Deploy (Render, sandbox only)
`render.yaml` is a Render Blueprint: a web service plus Render Postgres 17, on the smallest paid plans.
1. **Apply the Blueprint.** In Render, choose New → Blueprint and select this repo. Confirm the plan names and prices first.
2. **Enter the `sync: false` values when prompted.** These are the PayPal sandbox credentials,
   `NEXT_PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_SANDBOX_BUYER_EMAIL`, `ANTHROPIC_API_KEY`, the spend caps, the quote TTL, the classifier
   threshold and the classifier limits.
   - `NEXT_PUBLIC_PAYPAL_CLIENT_ID` is baked into the build, so it must be set before the first build.
   - `DATABASE_URL` comes from the database automatically.
3. **What each deploy runs:**
   - **Build:** `pnpm install --frozen-lockfile && pnpm build`.
   - **Pre-deploy:** `drizzle-kit migrate` plus the seed. Both are idempotent, and the seed aborts if any listing can't be quoted.
   - **Start:** `next start`.
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
| `pnpm rates:validate` | Schema + verification-metadata checks on `data/rates/*.json` |
| `pnpm eval:classifier` | Not implemented yet (exit 1) |

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
