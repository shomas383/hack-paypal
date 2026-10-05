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
- If `items[].tax` is specified, `tax_total` is required.  VERIFY IN WEEK 1: exact rule tax_total = Σ(items[].tax × quantity) (likely; error TAX_TOTAL_MISMATCH unconfirmed).
- `items[]` fields: `name` (required; >127 chars truncated), `quantity` (string, whole number), `unit_amount` (required), `tax`,
  `description` (>2048 chars truncated), `sku` (≤127), `category`, `url`, `image_url`, `upc`. 
- `category` enum: `PHYSICAL_GOODS`, `DIGITAL_GOODS`, `DONATION` (DONATION needs account permission). We use PHYSICAL_GOODS. 
- `purchase_units` 1–10. 

### How we represent import duty (decision)
- Duty → `items[i].tax` (duty per unit for that item) → `breakdown.tax_total`. Rationale: a customs duty is a tax;
  keeps `item_total` = goods only; avoids mislabeling as `handling` (a merchant fee) or as a fake item.
- Put HTS + rate version in `purchase_units[].custom_id` / `description` (≤127 effective chars) for traceability.
- Our own UI is the source of truth for the "US import duty (est.)" label.
- VERIFY IN WEEK 1: how the PayPal approval UI labels tax_total (likely "Tax"/"Sales tax"); if misleading, evaluate
  alternative = separate items[] line "US import duty (est.)" with category PHYSICAL_GOODS — document trade-off before switching.

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
  Persist the id with the operation; reuse it on retry. VERIFY IN WEEK 1: retention window of the id on PayPal's side.

## JS SDK v6 (buyer approval)
- Package `@paypal/paypal-js`, import `loadCoreSdkScript` from `@paypal/paypal-js/sdk-v6`; `environment: 'sandbox'` selects env (clientId does not). 
- `window.paypal.createInstance({ clientId, components: ['paypal-payments'] })` — client ID auth is recommended (client token only required for Fastlane). 
- Use `findEligibleMethods`, `<paypal-button>` web component, and `createPayPalOneTimePaymentSession` with onApprove → our server authorize. 
- Sandbox core script: `https://www.sandbox.paypal.com/web-sdk/v6/core`. 
- VERIFY IN WEEK 1: v6 flow with an order created server-side with intent AUTHORIZE (v5 needed `intent=authorize` in script URL).

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
- npm `@paypal/agent-toolkit` (jsDelivr lists 1.10.0; VERIFY exact latest at install and pin). Python: `paypal-agent-toolkit`. 
- Frameworks: OpenAI Agents SDK, Vercel AI SDK, LangChain, CrewAI, MCP, Amazon Bedrock. 
- TS usage: `import { PayPalAgentToolkit } from '@paypal/agent-toolkit/ai-sdk'`; `new PayPalAgentToolkit({ clientId, clientSecret,
  configuration: { actions: { orders: { get: true } }, context: { sandbox: true } } })`; `toolkit.getTools()`. 
- MCP server: npm `@paypal/mcp` (npm shows 1.8.1); env `PAYPAL_ACCESS_TOKEN`, `PAYPAL_ENVIRONMENT=SANDBOX`. 
- Known issues (github.com/paypal/agent-toolkit): #82 `pay_order` captures directly, no confirmation; #95 no human gate/spend bound
  on capture; #96 `@paypal/mcp` depends on `"@paypal/agent-toolkit": "latest"`; #98 PayPal-Request-Id not set per call (no idempotency). 
  → Policy: toolkit tools are read-only allowlist; all money movement goes through `src/server/paypal` + `policy/`. Pin exact versions;
  if using `@paypal/mcp`, pin via lockfile/overrides.
- Do NOT depend on: Store Sync / Cart API (`/merchant-cart`) — access-gated, US customers/USD/physical goods only; 
  remote MCP commerce tools (`search_product`, `create_cart`, `checkout_cart`) — announced for gift cards, behind
  `x-feature-flags: commerce:true`.  Ask PayPal Discord about Cart API access in Week 1 (nice-to-have, not a dependency).