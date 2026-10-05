# Landed

Duty-aware checkout for cross-border commerce on PayPal. AI classifies the product (HTS code + confidence),
a verified rate table computes the landed cost, and the US buyer — or their AI agent — sees the full price,
duties included, before approving a PayPal payment.

> **Sandbox only.** The app refuses to run unless `PAYPAL_ENV=sandbox`. Duty figures are estimates, not customs rulings.

Status: Week 1 — project scaffold + PayPal sandbox spikes. No product features yet.

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
pnpm dev                    # http://localhost:3000
```

## Commands
| Command | What it does |
|---|---|
| `pnpm dev` | Run the app locally |
| `pnpm test` | Vitest unit tests |
| `pnpm typecheck` · `pnpm lint` | TypeScript (strict) · ESLint |
| `pnpm db:migrate` | Apply Drizzle migrations |
| `pnpm spike:a` … `pnpm spike:d` | PayPal sandbox spikes (see below); `pnpm spike:paypal <a\|b\|c\|d>` also works |
| `pnpm test:e2e` · `pnpm db:seed` · `pnpm rates:validate` · `pnpm eval:classifier` | Not implemented yet (exit 1) |

## Sandbox spikes (`scripts/spike/`)
Each prints a PASS/FAIL table and exits non-zero on failure.
- **a** — Orders v2 `AUTHORIZE` with duty as item tax; open `http://localhost:5173` to approve two orders with the sandbox buyer; then capture one and void the other.
- **b** — Invoicing v2 draft → send with duty as a labelled custom amount. Needs `PAYPAL_SANDBOX_BUYER_EMAIL`.
- **c** — Webhooks. Run `cloudflared tunnel --url http://localhost:8787`, register the tunnel URL as a webhook in the sandbox app, set `PAYPAL_WEBHOOK_ID`, start `pnpm spike:c`, then run `pnpm spike:a` in another terminal.
- **d** — PayPal Agent Toolkit (read-only `get_order`) with the Vercel AI SDK. Optional order id argument; needs `ANTHROPIC_API_KEY` for the LLM checks.

## License
MIT — see [LICENSE](LICENSE).
