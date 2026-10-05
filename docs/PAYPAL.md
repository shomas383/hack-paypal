# PayPal integration notes (verified items cite source; VERIFY items must be confirmed in Week 1 spike)

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
  VERIFY: retention window of the id on PayPal's side (not testable quickly; don't rely on retries days later).

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
- Decision (pending spike): duty as `amount.breakdown.custom` labeled "US import duty (est.) – HTS xxxx.xx.xxxx", so the exact
  computed amount and label show to the buyer (percent-based item tax could round differently). VERIFY IN WEEK 1: exact
  `custom` schema, whether only one custom field is allowed, and buyer-facing rendering.

## Webhooks
- Verify via postback `POST /v1/notifications/verify-webhook-signature` (headers PAYPAL-AUTH-ALGO, PAYPAL-CERT-URL,
  PAYPAL-TRANSMISSION-ID, PAYPAL-TRANSMISSION-SIG, PAYPAL-TRANSMISSION-TIME + `webhook_id` + event body),
  or self-verify via cert. Postback does NOT work for simulator/mock events. 
- Simulator: `POST /v1/notifications/simulate-event` or dashboard simulator. 
- Events to subscribe (VERIFY IN WEEK 1 against the event-names page): `CHECKOUT.ORDER.APPROVED`,
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
  `ai@7`/`zod@4`). AI SDK v7 tools use `inputSchema`, so raw toolkit tools may not work in v7 `generateText` — spike (d) probes this
  and tests a v7 `tool()` wrapper around the toolkit's `execute`. `get_order` ← `actions.orders.get`, input `{ id }`;
  `pay_order` ← `actions.orders.capture` (never enable).
- Do NOT depend on: Store Sync / Cart API (`/merchant-cart`) — access-gated, US customers/USD/physical goods only; 
  remote MCP commerce tools (`search_product`, `create_cart`, `checkout_cart`) — announced for gift cards, behind
  `x-feature-flags: commerce:true`.  Ask PayPal Discord about Cart API access in Week 1 (nice-to-have, not a dependency).
## Week 1 findings — from primary sources (2026-10-05)
Sources: OpenAPI specs at `https://developer.paypal.com/api/{orders,payments,invoicing}/v2/schema.json` and
`https://developer.paypal.com/api/webhooks/v1/schema.json`; v6 quick start at
`https://developer.paypal.com/docsai/payments/methods/paypal/sdk/js/v6/paypal-checkout`. Runtime behavior still needs the
spike run — items below are schema/doc facts only.
- Orders: `order_status` enum = `CREATED|SAVED|APPROVED|VOIDED|COMPLETED|PAYER_ACTION_REQUIRED`. `items[].tax` is a money
  object. The schema does **not** list issue codes like `ITEM_TOTAL_MISMATCH` or a tax-total mismatch code — spike (a) records the
  real error for a 1-cent `tax_total` mismatch.
- Payments: capture authorization body `{ amount?, invoice_id?, final_capture?, note_to_payer?, soft_descriptor? }` → 200/201,
  `status` ∈ `COMPLETED|DECLINED|PARTIALLY_REFUNDED|PENDING|REFUNDED|FAILED`. Void → **200 (body) or 204 (no body)**.
  `GET /v2/payments/authorizations/{id}` `status` ∈ `CREATED|CAPTURED|DENIED|PARTIALLY_CAPTURED|VOIDED|PENDING`.
  `PayPal-Request-Id` and `Prefer` headers are documented on capture and void.
- Invoicing: `detail.currency_code` is required; recipient = `primary_recipients[].billing_info.email_address`;
  items require `name`, `quantity` (string), `unit_amount`; invoice item `tax` is `{ name, percent, amount? }` (percent-based).
  `amount.breakdown.custom` is a **single object** `{ label (required), amount }` — not an array, so only one custom amount.
  Create → 201 with the full invoice; send body `{ subject?, note?, send_to_invoicer?, send_to_recipient?, additional_recipients? }`
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
- 2026-10-05 spike (b): `POST /v2/invoicing/invoices` → 403 `NOT_AUTHORIZED` — sandbox app did not have Invoicing enabled. Rerun pending.
- 2026-10-05 spike (a) PASS (12/12) — two AUTHORIZE orders ($250.00 item + $31.25 duty as `items[].tax`/`tax_total` + $25.00
  shipping = $306.25) approved via v6; PayPal echoed all totals to the cent; authorization id at
  `purchase_units[0].payments.authorizations[0].id`; capture → 201 `COMPLETED`; void → **204** then `GET` authorization → `VOIDED`;
  1-cent `tax_total` mismatch → 422 `TAX_TOTAL_MISMATCH`; capture replay with same `PayPal-Request-Id` → same capture id.
