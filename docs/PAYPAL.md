# PayPal integration notes (verified items cite source; remaining VERIFY items are carried over — Week 1 spikes done 2026-10-05, all PASS)

## Environment
- Sandbox REST base: `https://api-m.sandbox.paypal.com` (live is `https://api-m.paypal.com` — never used).
- OAuth: `POST /v1/oauth2/token`, HTTP Basic (client_id:secret), body `grant_type=client_credentials`.
  Response has `access_token`, `expires_in` (seconds). Cache token; refresh before expiry. 
- Source: developer.paypal.com REST docs; paypal/agent-toolkit README.

## Orders v2 (developer.paypal.com/api/orders/v2)
Endpoints: `POST /v2/checkout/orders` · `GET /v2/checkout/orders/{id}` · `PATCH /v2/checkout/orders/{id}` (CREATED/APPROVED only) ·
`POST /v2/checkout/orders/{id}/authorize` · `POST /v2/checkout/orders/{id}/capture`. 
- `intent`: `CAPTURE` | `AUTHORIZE`. We use AUTHORIZE. 
- `purchase_units[].amount.breakdown` has exactly 7 fields: `item_total, shipping, handling, tax_total, insurance, shipping_discount, discount`.
  **There is no duty field.** 
- Rule (verbatim): "the amount equals item_total plus tax_total plus shipping plus handling plus insurance minus
  shipping_discount minus discount." Mismatch → 422. Validate locally first. 
- `item_total` must equal Σ(unit_amount × quantity) (error ITEM_TOTAL_MISMATCH). 
- If `items[].tax` is specified, `tax_total` is required. **Confirmed 2026-10-05 (spike a, sandbox):** `tax_total` ≠ Σ(items[].tax × quantity)
  (off by $0.01) → HTTP 422 `UNPROCESSABLE_ENTITY`, issue `TAX_TOTAL_MISMATCH`.
- `items[]` fields: `name` (required; >127 chars truncated), `quantity` (string, whole number), `unit_amount` (required), `tax`,
  `description` (>2048 chars truncated), `sku` (≤127), `category`, `url`, `image_url`, `upc`. 
- `category` enum: `PHYSICAL_GOODS`, `DIGITAL_GOODS`, `DONATION` (DONATION needs account permission). We use PHYSICAL_GOODS. 
- `purchase_units` 1–10. 

### How we represent import duty (decision)
- Duty → `items[i].tax` (duty per unit for that item) → `breakdown.tax_total`. Rationale: a customs duty is a tax;
  keeps `item_total` = goods only; avoids mislabeling as `handling` (a merchant fee) or as a fake item.
- Put HTS + rate version in `purchase_units[].custom_id` / `description` (≤127 effective chars) for traceability.
- Our own UI is the source of truth for the "US import duty (est.)" label.
- **Confirmed 2026-10-05 (spike a, sandbox approval popup → Order details):** lines shown are item name + qty, `Subtotal`, `Shipping`,
  **`Tax`** (= our duty), `Total`. Accurate (duty is a tax) but generic — a US buyer may read it as sales tax.
  Decision: keep duty-as-tax; our checkout shows "US import duty (est.)" + HTS + source BEFORE the PayPal button, so the buyer
  has seen the itemized duty when PayPal shows "Tax". Rejected alternative: separate items[] line "US import duty (est.)" — it
  would inflate `item_total` (goods) with a tax and misstate the breakdown.

### Money formatting
- `value` is a string: integer for JPY (zero-decimal currency; decimals cause an error), 2 decimals for USD. 
- MVP charges USD only. JPY appears only for display/seller pricing. Any FX rate must come from a dated, sourced table. VERIFY source.

## Payments v2 — authorize/capture/void
- After approval: `POST /v2/checkout/orders/{id}/authorize`. Authorization id at
  `purchase_units[0].payments.authorizations[0].id` — store immediately. 
- Capture: `POST /v2/payments/authorizations/{authorization_id}/capture` (partial allowed; `final_capture` flag). 
- Void: `POST /v2/payments/authorizations/{authorization_id}/void` (cannot void a fully captured authorization). 
- Reauthorize: `POST /v2/payments/authorizations/{authorization_id}/reauthorize`. 
- Authorization holds funds up to 29 days; 3-day honor period has the highest capture success.  Demo captures immediately after gate.

## Idempotency
- Send `PayPal-Request-Id: <uuid>` on every POST (shown in PayPal docs for create order and capture authorization). 
  Persist the id with the operation; reuse it on retry. **Confirmed 2026-10-05 (spike a):** replaying a capture with the same
  `PayPal-Request-Id` seconds later → HTTP 200 (first call was 201) with the **same capture id** — no second capture.
  Carried over — VERIFY: retention window of the id on PayPal's side (not testable quickly; don't rely on retries days later).

## JS SDK v6 (buyer approval)
- Package `@paypal/paypal-js`, import `loadCoreSdkScript` from `@paypal/paypal-js/sdk-v6`; `environment: 'sandbox'` selects env (clientId does not). 
- `window.paypal.createInstance({ clientId, components: ['paypal-payments'] })` — client ID auth is recommended (client token only required for Fastlane). 
- Use `findEligibleMethods`, `<paypal-button>` web component, and `createPayPalOneTimePaymentSession` with onApprove → our server authorize. 
- Sandbox core script: `https://www.sandbox.paypal.com/web-sdk/v6/core`. 
- **Confirmed 2026-10-05 (spike a):** v6 works with an order created server-side with `intent: AUTHORIZE` — no intent option on the
  SDK; `createInstance({ clientId, components: ['paypal-payments'] })` + `session.start(..., Promise.resolve({ orderId }))`;
  `onApprove` gave `data.orderId`; `GET order` → `APPROVED`; then server `authorize`. Popup ran from `http://localhost:5173`.
  Gotcha: logging in with the sandbox **Business** account (the app's own merchant) is refused ("This PayPal account is
  associated with the merchant you're trying to pay") — approve with the sandbox **Personal** account.

## Invoicing v2 (DDP path)
- `POST /v2/invoicing/invoices` creates a DRAFT; `POST /v2/invoicing/invoices/{id}/send` delivers it. 
- Items need name, quantity, unit_amount; `items[].tax` is per-line tax (name + rate); `amount.breakdown.shipping.amount`
  (+ optional `shipping.tax`); a `custom` amount (label + amount) exists in the breakdown. 
- Decision (confirmed by spike (b), 2026-10-05): duty as `amount.breakdown.custom` labeled "US import duty (est.) – HTS xxxx.xx.xxxx",
  so the exact computed amount and label show to the buyer (percent-based item tax could round differently). Evidence: custom is a
  single `{label, amount}` object (schema; array → 400 in sandbox); the buyer view shows the label verbatim. Was VERIFY: exact
  `custom` schema, whether only one custom field is allowed, and buyer-facing rendering — all resolved.
- **$0.00 custom amount accepted (spike (e), 2026-10-07):** draft with `custom { label, amount: 0.00 }` → 201; GET returns the
  label verbatim and `amount 0.00` (INV2-ARRX-PH8V-8VSV-MKRA, draft, not sent). Decision: exempt items (e.g. 9903.05.92) show an
  explicit "US import duty (est.) – HTS … $0.00" line. **Buyer view confirmed 2026-10-07** (sent invoice INV2-73MU-SSEW-267C-TLEK,
  Blu-ray from the app): lines Subtotal $180.00 · Shipping $25.00 · "US import duty (est.) – HTS 8523.49.40" $0.00 · Total
  $205.00, and the note "No US import duty (exempt)" under "Notes to customer".
- **Invoice create is NOT idempotent by `PayPal-Request-Id` (spike (f), 2026-10-07).** The Invoicing v2 OpenAPI
  (`developer.paypal.com/api/invoicing/v2/schema.json`, fetched 2026-10-07) defines the `PayPal-Request-Id` header but does not
  reference it on `POST /v2/invoicing/invoices` or `…/send` (only on `…/conditional-rules`). In the sandbox, the same request id +
  same body twice → two different drafts (both 201: INV2-4TU5-XA3C-ZJV4-UDMM, INV2-Q8JA-42YS-DRSB-NRXU); same id + different body →
  a third (201). All three deleted (`DELETE /v2/invoicing/invoices/{id}` → 204; drafts/scheduled only). **Consequence:** never retry
  an invoice create — not even our client's automatic same-id retry on 5xx/network error — and dedupe per quote in our DB.
- **`detail.invoice_number` is unique per merchant and searchable (spike (g), 2026-10-07).** Spec: `detail.invoice_number` string
  ≤25 chars (omitted → auto-incremented); `POST /v2/invoicing/search-invoices` body `{ invoice_number }` filter; no duplicate
  error documented. Sandbox: a second create with the same number → **422 `UNPROCESSABLE_ENTITY`, issue
  `DUPLICATE_INVOICE_NUMBER`**; `search-invoices` with that number → 200, `total_items` 1, the first draft
  (INV2-PGCR-REVH-BGXB-69NW, deleted → 204). Not yet used: a quote-derived number would let a stuck CREATING row recover.

## Webhooks
- Verify via postback `POST /v1/notifications/verify-webhook-signature` (headers PAYPAL-AUTH-ALGO, PAYPAL-CERT-URL,
  PAYPAL-TRANSMISSION-ID, PAYPAL-TRANSMISSION-SIG, PAYPAL-TRANSMISSION-TIME + `webhook_id` + event body),
  or self-verify via cert. Postback does NOT work for simulator/mock events (docs claim) — **but 2026-10-05 spike (c): a `simulate-event` delivery to our registered webhook verified `SUCCESS`.** Don't rely on either; treat simulator results as non-evidence.
- Simulator: `POST /v1/notifications/simulate-event` or dashboard simulator. 
- Events to subscribe (2026-10-05: `CHECKOUT.ORDER.APPROVED` received for real + verified; `PAYMENT.AUTHORIZATION.CREATED` accepted by
  simulate-event; carried over — VERIFY the rest as real deliveries once the real checkout has a webhook endpoint): `CHECKOUT.ORDER.APPROVED`,
  `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.COMPLETED`, `PAYMENT.CAPTURE.DENIED`, `INVOICING.INVOICE.PAID`.
- Webhooks are for reconciliation; the demo path must not depend on webhook delivery timing (poll `GET order` as fallback).
- Store events idempotently by event id.

## Agent Toolkit / MCP
- npm `@paypal/agent-toolkit` — pinned 1.11.0 (latest on npm 2026-10-04). Python: `paypal-agent-toolkit`. 
- Frameworks: OpenAI Agents SDK, Vercel AI SDK, LangChain, CrewAI, MCP, Amazon Bedrock. 
- TS usage: `import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk'`; `new PayPalAgentToolkit({ clientId, clientSecret,
  configuration: { actions: { orders: { get: true } }, context: { sandbox: true } } })`; `toolkit.getTools()`. 
- MCP server: npm `@paypal/mcp` (npm shows 1.8.1); env `PAYPAL_ACCESS_TOKEN`, `PAYPAL_ENVIRONMENT=SANDBOX`. 
- Known issues (github.com/paypal/agent-toolkit): #82 `pay_order` captures directly, no confirmation; #95 no human gate/spend bound
  on capture; #96 `@paypal/mcp` depends on `"@paypal/agent-toolkit": "latest"`; #98 PayPal-Request-Id not set per call (no idempotency). 
  → Policy: toolkit tools are read-only allowlist; all money movement goes through `src/server/paypal` + `policy/`. Pin exact versions;
  if using `@paypal/mcp`, pin via lockfile/overrides.
- Pinned `@paypal/agent-toolkit@1.11.0` (published 2026-09-01). Read from the installed package 2026-10-05: tools are built with
  AI SDK **v4** `tool({ description, parameters, execute })` and the package depends on `ai@^4` + `zod@^3` (installed alongside our
  `ai@7`/`zod@4`). AI SDK v7 tools use `inputSchema`; spike (d) confirmed raw toolkit tools do NOT work in v7 `generateText`.
  **Decision: wrap the toolkit's `execute` in our own v7 `tool()`** (see spike results). `get_order` ← `actions.orders.get`, input `{ id }`;
  `pay_order` ← `actions.orders.capture` (never enable).
- Do NOT depend on: Store Sync / Cart API (`/merchant-cart`) — access-gated, US customers/USD/physical goods only; 
  remote MCP commerce tools (`search_product`, `create_cart`, `checkout_cart`) — announced for gift cards, behind
  `x-feature-flags: commerce:true`. Carried over: ask PayPal Discord about Cart API access (nice-to-have, not a dependency; not done in Week 1).

## Week 1 findings — from primary sources (2026-10-05)
Sources: OpenAPI specs at `https://developer.paypal.com/api/{orders,payments,invoicing}/v2/schema.json` and
`https://developer.paypal.com/api/webhooks/v1/schema.json`; v6 quick start at
`https://developer.paypal.com/docsai/payments/methods/paypal/sdk/js/v6/paypal-checkout`. Items below are schema/doc facts;
where sandbox behavior differed, "Week 1 spike results" below wins and the item is marked SUPERSEDED.
- Orders: `order_status` enum = `CREATED|SAVED|APPROVED|VOIDED|COMPLETED|PAYER_ACTION_REQUIRED`. `items[].tax` is a money
  object. The schema does **not** list issue codes like `ITEM_TOTAL_MISMATCH` or a tax-total mismatch code — spike (a) observed
  422 `TAX_TOTAL_MISMATCH` for a 1-cent `tax_total` mismatch.
- Payments: capture authorization body `{ amount?, invoice_id?, final_capture?, note_to_payer?, soft_descriptor? }` → 200/201,
  `status` ∈ `COMPLETED|DECLINED|PARTIALLY_REFUNDED|PENDING|REFUNDED|FAILED`. Void → **200 (body) or 204 (no body)**.
  `GET /v2/payments/authorizations/{id}` `status` ∈ `CREATED|CAPTURED|DENIED|PARTIALLY_CAPTURED|VOIDED|PENDING`.
  `PayPal-Request-Id` and `Prefer` headers are documented on capture and void.
- Invoicing: `detail.currency_code` is required; recipient = `primary_recipients[].billing_info.email_address`;
  items require `name`, `quantity` (string), `unit_amount`; invoice item `tax` is `{ name, percent, amount? }` (percent-based).
  `amount.breakdown.custom` is a **single object** `{ label (required), amount }` — not an array, so only one custom amount.
  ~~Create → 201 with the full invoice~~ **SUPERSEDED by spike (b): sandbox returns 201 with only a link `{rel, href, method}`;**
  send body `{ subject?, note?, send_to_invoicer?, send_to_recipient?, additional_recipients? }`
  → 200/202 with a link.
- Webhooks: verify request `{ auth_algo, cert_url, transmission_id, transmission_sig, transmission_time, webhook_id, webhook_event }`
  (all required) → `{ verification_status: SUCCESS|FAILURE }`. Simulate request `{ webhook_id?, url?, event_type (required), resource_version? }` → 202.
- JS SDK v6: `createInstance({ clientId, components: ['paypal-payments'] })`; `findEligibleMethods()` → `isEligible('paypal')`;
  `createPayPalOneTimePaymentSession({ onApprove, onCancel, onError })`, `onApprove(data)` gives `data.orderId`;
  `session.start({ presentationMode: 'auto' }, createOrderPromise)` where the promise resolves to `{ orderId }` (do not await it
  before `start` — transient activation). AUTHORIZE with a server-created order confirmed in spike (a) — see JS SDK v6 section.

## Week 1 spike results (sandbox runs)
- 2026-10-05 spike (d) PASS — `@paypal/agent-toolkit@1.11.0` with `actions: { orders: { get: true } }` → `getTools()` = `["get_order"]` only;
  `get_order.execute({ id })` returns the order JSON. **Toolkit tools passed raw into AI SDK v7 `generateText` do NOT work** (Claude
  could not complete the call — v4 `parameters` vs v7 `inputSchema`). **Decision: wrap toolkit `execute` in our own v7 `tool()`**
  (`inputSchema: z.object({ id })`); verified with `claude-opus-5-5` (tool called, order returned). Opus 5.5 rejects forced
  `tool_choice` → use auto + name the tool in the prompt.
- 2026-10-05 Orders: `POST /v2/checkout/orders` with `intent: AUTHORIZE`, one PHYSICAL_GOODS item with `items[].tax`, and
  breakdown `item_total + tax_total + shipping` → 201 `CREATED`.
- 2026-10-05 spike (b): first run → 403 `NOT_AUTHORIZED` until **Invoicing** was ticked in the sandbox app's Features and saved (took effect immediately).
- 2026-10-05 spike (a) PASS (12/12) — two AUTHORIZE orders ($250.00 item + $31.25 duty as `items[].tax`/`tax_total` + $25.00
  shipping = $306.25) approved via v6; PayPal echoed all totals to the cent; authorization id at
  `purchase_units[0].payments.authorizations[0].id`; capture → 201 `COMPLETED`; void → **204** then `GET` authorization → `VOIDED`;
  1-cent `tax_total` mismatch → 422 `TAX_TOTAL_MISMATCH`; capture replay with same `PayPal-Request-Id` → same capture id.
- 2026-10-05 spike (b) PASS (5/5) — **Create invoice returns 201 with ONLY a link** `{ rel: 'self', href: 'https://api.sandbox.paypal.com/v2/invoicing/invoices/<id>', method: 'GET' }`
  (contradicts schema.json, which shows the full invoice). Take the id from the href's last segment and GET via our own client; never
  follow the href host (`api.sandbox`, not `api-m.sandbox`). Draft → `DRAFT`; send `{ send_to_recipient: true }` → 200; status → `SENT`;
  total $306.25 = goods + shipping + `breakdown.custom` duty; custom label and amount ($31.25) preserved exactly.
  Two custom entries (array) → 400 `INVALID_REQUEST` — only ONE custom amount per invoice. Buyer view link at
  `detail.metadata.recipient_view_url`. **Buyer view confirmed 2026-10-05:** lines = item (qty × price), `Subtotal`, `Shipping`,
  **our custom label verbatim** ("US import duty (est.) – HTS …", not truncated) + amount, `Total`. Unlike Orders (shown as generic
  "Tax"), the invoice path displays our duty wording to the buyer.
- 2026-10-05 spike (c) PASS (3/3) — cloudflared quick tunnel → `localhost:8787`, webhook registered in the sandbox app (all events).
  Real `CHECKOUT.ORDER.APPROVED` delivered within seconds of buyer approval; `verify-webhook-signature` with the **re-serialized parsed
  JSON** body as `webhook_event` → `SUCCESS` (headers read lowercase: `paypal-auth-algo`, `paypal-cert-url`, `paypal-transmission-id`,
  `paypal-transmission-sig`, `paypal-transmission-time`). Simulated `PAYMENT.AUTHORIZATION.CREATED` also → `SUCCESS` (see above).
  In-process replay of a delivery was ignored by event-id dedupe. Not observed yet as real deliveries: authorization created/voided,
  capture completed, invoice paid (spike stopped at first verified event). Quick-tunnel URLs change on restart → re-register the webhook.

## Week 3 checkout findings (app + headed Playwright runs, 2026-10-07)
- **End to end in the app:** listing → quote (engine) → recorded Approve → `POST /v2/checkout/orders` (AUTHORIZE, built from the
  stored quote) → v6 popup approval → `GET order` (status `APPROVED`, `custom_id` = quote id, amount = quote) → authorize →
  `decideCapture()` → capture. Watch $362.50 captured in four runs (e.g. 5HB497297B0298612, 09J03450KN706650Y); a $0-duty
  Blu-ray order ($205.00) captured the same way (9HR91302BB8179944). DDP invoice SENT with the duty label (INV2-FBEK-T3W8-KQSP-GXGX).
- **v6 SDK (`@paypal/paypal-js@11.2.1`):** `loadCoreSdkScript({ environment: 'sandbox' })` → `createInstance({ clientId,
  components: ['paypal-payments'] })` → `session.start({ presentationMode: 'auto' }, Promise<{ orderId }>)`; `onApprove` gets
  `{ orderId }`. Works from `http://localhost:3000`.
- **Sandbox login popup has two variants** (field logs, ids only): (a) `#email` → Next (`#btnNext`) → `#password` → `#btnLogin`;
  (b) `input#email[name=login_email]` + `input#password[name=login_password]` on one page with an id-less `button[type=submit]`.
  Review page main CTA: `button#one-time-cta[type=submit]`. All undocumented — the e2e keeps a manual fallback (VERIFY).
- **Flakes seen:** (1) an overlay "Don't see the secure PayPal browser? … Click to Continue" inside our page; (2) one run where the
  popup never opened after the order was created (cause unknown). Unapproved orders are left `CREATED` and expire on PayPal's side.
  Decision (2026-10-07): stop automating; record the demo with a human assisting the PayPal login when asked.
- **App void branch, end to end** (manual sandbox runs, watch $362.50; times from the DB, 2026-10-07 UTC):
  - Test A — `QUOTE_TTL_SECONDS=60`, buyer waited in the popup past expiry: order 7TX25118NJ956015E, authorization
    3V9043177K645411H → policy `VOID [QUOTE_EXPIRED]` → voided (03:23). UI: "Payment VOIDED, Policy: QUOTE_EXPIRED".
  - Test B — order cap lowered to 30000 while the popup was open (server restarted): order 7AU08241A9982080A, authorization
    58X98432TK234561S → policy `VOID [OVER_ORDER_CAP]` → voided (03:30).
  - Both: `orders.status = VOIDED`, no `capture_id`; audit log `paypal.authorized` → `policy.decided` → `paypal.voided` with the
    reason. PayPal dashboard: Authorization $362.50 "Voided", Void "Completed", no capture. Env restored to TTL 900 / cap 40000.

## Week 4 deploy notes (Render; local production checks 2026-10-07)
- **Webhook receiver** `POST /api/webhooks/paypal`: postback verification (as spike c) → `payment_events` (unique `event_id`) →
  audit row with match/mismatch vs `orders.status`. Never moves money. Local `next start`: forged signature headers → 400
  "signature verification failed", missing headers → 400; nothing stored.
- **Live deliveries to Render verified (2026-10-07)**, from one app checkout: watch order 06R32448RY9333933, authorization
  69H53833MG326201D, capture 9ST328317X200011U, $362.50. PayPal's webhook dashboard shows three events delivered with **Success**:
  `CHECKOUT.ORDER.APPROVED`, `PAYMENT.AUTHORIZATION.CREATED`, `PAYMENT.CAPTURE.COMPLETED` (these spellings are now confirmed as real
  deliveries). Success means our route answered 2xx, which it does only after verification SUCCESS and the insert into
  `payment_events` (a failure in either answers 400/500).
  - **Sandbox delivery delay:** the two non-capture events sat at PENDING (no response code) for a few minutes, then turned
    Success with no change on our side. That's PayPal's queue, not an error: the demo path must not wait on webhooks.
  - **`resource.id` per event type, confirmed in PayPal's webhook dashboard (2026-10-07):** `CHECKOUT.ORDER.APPROVED` payload
    `resource.id` = 06R32448RY9333933 (the **order** id); the event list's Resource ID column shows `PAYMENT.AUTHORIZATION.CREATED`
    → 69H53833MG326201D (the **authorization** id) and `PAYMENT.CAPTURE.COMPLETED` → 9ST328317X200011U (the **capture** id).
    These are exactly the three columns reconciliation matches on (`orders.paypal_order_id` / `authorization_id` / `capture_id`).
    The stored `reconcile` values were not inspected (no Render Shell; the DB is closed to external access).
  - `PAYMENT.AUTHORIZATION.VOIDED`, `PAYMENT.CAPTURE.DENIED` and `INVOICING.INVOICE.PAID` remain VERIFY as real deliveries.
- **One invoice per quote** (after spikes f/g): concurrent double request for one quote → one 409 + one SENT invoice
  (INV2-CYV7-9T9K-UT94-F42U), a third call returns the same invoice; one DB row.
- **Production invoice recipient**: with `NODE_ENV=production`, a browser-supplied `attacker@example.com` was ignored; the invoice
  (INV2-LQZ2-DHLK-6NS3-BCKG, Blu-ray $205.00, duty $0.00) went to `PAYPAL_SANDBOX_BUYER_EMAIL`.
- **Render facts** (render.com/docs/blueprint-spec, read 2026-10-07): `preDeployCommand` runs after build, before start, any plan;
  default plans `0.5c-512mb` (web) / `0.1c-256mb` (Postgres); `postgresMajorVersion` as a string. Render's default for new
  Postgres is 18 (changelog 2025-11-13); we pin 17.
- **Client IP on Render (verified 2026-10-07, `DEBUG_CLIENT_IP=1`, request with a forged `X-Forwarded-For: 6.6.6.6`):** the app
  received `X-Forwarded-For: "6.6.6.6,73.55.190.127, 172.71.146.201"`. The client-supplied entry is kept at the left, the real
  client IP (73.55.190.127) follows, and the rightmost entry is a Cloudflare edge (172.71.146.201, in 172.64.0.0/13). So the
  rightmost hop is NOT the client: `clientIp` skips `TRUSTED_PROXY_HOPS` (=1 on Render) entries from the right. Entries are
  separated by both "," and ", ".
  **Re-checked after 5c8e561 (2026-10-07):** XFF `"6.6.6.6,73.55.190.127, 172.71.146.245"` → `countedIp` 73.55.190.127, equal to
  `cf-connecting-ip` and `true-client-ip`. The Cloudflare edge IP varies per request (.201, then .245), so it must never be used
  as a rate-limit key. `DEBUG_CLIENT_IP` removed from Render afterwards.
- **Plans confirmed at Apply (2026-10-07, Hobby workspace):** web `0.5c-512mb` (Starter, about $7/mo), Postgres `0.1c-256mb`
  (about $6/mo).
- **Database network access:** the inbound IP rule `0.0.0.0/0` was removed in the dashboard (2026-10-07), so there is no external
  DB access. The web service uses the internal connection string, and `/api/health` still returns ok. `render.yaml` sets
  `ipAllowList: []` so a recreated database is closed too (blueprint-spec: an omitted list allows all IPs on a NEW database
  and keeps the current rules on an existing one).
- **Request URL is internal behind Render's proxy (2026-10-07):** `req.url` is `http://localhost:10000/…`, so a redirect built
  from it sent buyers to `https://localhost:10000/checkout/<id>`. Fix: relative `Location` headers. Any absolute URL we must hand
  out uses `PUBLIC_BASE_URL` (https origin, validated if set; optional until code uses it), never Host or X-Forwarded-Host. No PayPal
  `return_url`/`cancel_url` is sent today; the v6 popup does not need them. **Verified on Render after ff9d307 (2026-10-07):**
  "Get landed cost" landed on `https://landed-hd19.onrender.com/checkout/36ebc1e0-6369-41ab-9e04-08d98bc41187` with no address
  editing.
- **Render build image: `corepack enable` fails** (first build, 2026-10-07: `Internal Error: EROFS: read-only file system, unlink
  '/usr/bin/pnpm'`, Node 24.21.0). Build, pre-deploy and start all run `npx --yes pnpm@10.32.1 …`, so every step uses our
  pinned pnpm rather than the preinstalled one. Same commands verified locally (install --frozen-lockfile, build, db:migrate, db:seed).

## Judges' sandbox buyers (decided 2026-10-14)
- Judges pay with a dedicated sandbox **personal** account (plus a spare) that the owner creates in our developer
  dashboard. It is not the `.env` buyer (`PAYPAL_SANDBOX_BUYER_EMAIL` stays the invoice recipient and the e2e login).
  Credentials go only in Devpost's testing field. Capture doesn't check who the payer is (`decideCapture` checks the
  stored quote, the approval, the authorization and the caps), so any sandbox personal account that can log in can pay.
- VERIFY (owner, by hand): a sandbox personal account created under a *different* developer account can approve and pay
  an order from our sandbox app (the README's "use your own sandbox account" fallback relies on it). Record the date and
  the PayPal order id here.
- Keep both judge accounts working until winners are announced (Dec 21, 2026), then rotate or delete them.

## Agent Toolkit `get_order` — live run on production (2026-10-13)
- **PASS**, Render deploy `d2d8117` (`get_order_status` returns an allow-list only: id, intent, status, custom_id, amount,
  breakdown, authorization/capture statuses). One /agent run per message, same browser session as a normal checkout.
- Order `1VC48838C5454262A` (L-P03, JP watch, captured by the app's checkout in that session): the agent reported status
  `COMPLETED`, authorized then captured, $362.50 = $300.00 item + $25.00 shipping + $37.50 — matching the ledger row and the
  stored quote. No payer details and no links in the agent's text. The raw tool output was not inspected, so
  `capture_statuses` on an AUTHORIZE order (VERIFY in the plan) is known only from the agent's wording ("the capture is complete").
- Order `06R32448RY9333933` (2026-10-07, another session): refused by code (`not an order of this session`); the agent said it
  couldn't see any details and showed none.
- **Mistake caught:** the checkout success page showed only "Capture <id>", so the first two tries asked about capture ids
  (correctly refused: not order ids of this session). The order id came from /seller. Fix: the outcome now shows
  "PayPal order <id> · Capture <id>" (`src/ui/orderIds.ts`).
- The reply called the $37.50 "tax"; the system prompt now says to call `tax_total` "US import duty (est.)" (not yet deployed).
