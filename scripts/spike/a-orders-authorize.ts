// Spike (a): Orders v2 AUTHORIZE with itemized items + tax_total duty, buyer approval via JS SDK v6,
// authorize → capture (order 1) and authorize → void (order 2).
// Sources: docs/PAYPAL.md; Orders/Payments v2 schema.json (developer.paypal.com/api/{orders,payments}/v2/schema.json,
// fetched 2026-10-05); v6 SDK quick start (developer.paypal.com/docsai/payments/methods/paypal/sdk/js/v6/paypal-checkout).
import { createServer } from 'node:http';
import { usd } from '../../src/domain/money/money';
import { toPayPalValue } from '../../src/domain/money/format';
import {
  type Check,
  check,
  createAuthorizeOrder,
  DEFAULT_SPIKE_ORDER,
  issuesOf,
  loadEnv,
  log,
  ok,
  paypalRequest,
  report,
  sleep,
} from './_lib';

const PORT = 5173;
const APPROVAL_TIMEOUT_MS = 10 * 60_000;

type Amount = { currency_code: string; value: string };
interface OrderDetails {
  id: string;
  status: string; // schema enum: CREATED|SAVED|APPROVED|VOIDED|COMPLETED|PAYER_ACTION_REQUIRED
  purchase_units: {
    amount: Amount & { breakdown?: { item_total?: Amount; tax_total?: Amount; shipping?: Amount } };
    items?: { tax?: Amount }[];
    payments?: { authorizations?: { id: string; status: string }[] };
  }[];
}

export async function run(): Promise<void> {
  const env = loadEnv();
  const checks: Check[] = [];

  // 1. Negative: tax_total ≠ Σ items[].tax (local assertion bypassed for this one call).
  //    Settles the PAYPAL.md VERIFY item "exact rule tax_total = Σ(items[].tax × quantity)".
  log('Negative test: tax_total off by one cent');
  const bad = await createAuthorizeOrder({ ...DEFAULT_SPIKE_ORDER, unsafeTaxTotalOverride: usd(3_126) });
  checks.push(check('tax_total mismatch rejected by PayPal', bad.res.status === 422 || bad.res.status === 400,
    `HTTP ${bad.res.status} ${issuesOf(bad.res.body)}`));

  // 2. Two real orders (local assertion on).
  const orders: { id: string; expected: Awaited<ReturnType<typeof createAuthorizeOrder>>['expected'] }[] = [];
  for (const label of ['capture-path', 'void-path']) {
    const { res, expected } = await createAuthorizeOrder({ ...DEFAULT_SPIKE_ORDER, customId: `landed-spike-${label}` });
    checks.push(check(`create AUTHORIZE order (${label})`, ok(res.status) && res.body.status === 'CREATED',
      `HTTP ${res.status} status=${res.body.status ?? issuesOf(res.body)}`));
    if (!ok(res.status)) return report('spike (a) orders authorize', checks);
    orders.push({ id: res.body.id, expected });
  }

  // 3. Buyer approval via local v6 page.
  const approved = new Set<string>();
  const server = createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/approved') {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        const { orderId } = JSON.parse(raw || '{}') as { orderId?: string };
        if (orderId) approved.add(orderId);
        log(`onApprove received for ${orderId}`);
        res.writeHead(204).end();
      });
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(approvalPage(env.PAYPAL_CLIENT_ID, orders.map((o) => o.id)));
  });
  await new Promise<void>((r) => server.listen(PORT, r));
  console.log(`\n>>> Open http://localhost:${PORT} and approve BOTH orders with your sandbox BUYER account.`);
  console.log('>>> While on the PayPal approval screen, note how the duty (tax_total) is labelled — record it in PAYPAL.md.\n');

  const deadline = Date.now() + APPROVAL_TIMEOUT_MS;
  while (approved.size < orders.length && Date.now() < deadline) await sleep(1000);
  server.close();

  for (const [i, o] of orders.entries()) {
    const path = i === 0 ? 'capture' : 'void';
    const got = await paypalRequest<OrderDetails>('GET', `/v2/checkout/orders/${o.id}`);
    checks.push(check(`order ${path}: buyer approved (GET status)`, got.body.status === 'APPROVED',
      `status=${got.body.status} onApprove=${approved.has(o.id)}`));
    if (got.body.status !== 'APPROVED') continue;

    // Totals echoed by PayPal match ours to the cent.
    const pu = got.body.purchase_units[0];
    const want = {
      amount: toPayPalValue(o.expected.amount),
      tax_total: toPayPalValue(o.expected.taxTotal),
      item_total: toPayPalValue(o.expected.itemTotal),
      shipping: toPayPalValue(o.expected.shipping),
    };
    const have = {
      amount: pu?.amount.value,
      tax_total: pu?.amount.breakdown?.tax_total?.value,
      item_total: pu?.amount.breakdown?.item_total?.value,
      shipping: pu?.amount.breakdown?.shipping?.value,
    };
    checks.push(check(`order ${path}: totals echo to the cent`, JSON.stringify(want) === JSON.stringify(have),
      `want ${JSON.stringify(want)} have ${JSON.stringify(have)}`));

    // 4. Authorize; read authorization id at the documented path.
    const auth = await paypalRequest<OrderDetails>('POST', `/v2/checkout/orders/${o.id}/authorize`);
    const authId = auth.body.purchase_units?.[0]?.payments?.authorizations?.[0]?.id;
    checks.push(check(`order ${path}: authorize → purchase_units[0].payments.authorizations[0].id`,
      ok(auth.status) && !!authId, `HTTP ${auth.status} authId=${authId ?? issuesOf(auth.body)}`));
    if (!authId) continue;

    if (path === 'capture') {
      const body = { final_capture: true };
      const cap = await paypalRequest<{ id: string; status: string }>('POST',
        `/v2/payments/authorizations/${authId}/capture`, { body });
      checks.push(check('capture authorization → COMPLETED', ok(cap.status) && cap.body.status === 'COMPLETED',
        `HTTP ${cap.status} status=${cap.body.status ?? issuesOf(cap.body)}`));
      // Idempotency (invariant 7): replay with the SAME PayPal-Request-Id must not create a second capture.
      const replay = await paypalRequest<{ id: string; status: string }>('POST',
        `/v2/payments/authorizations/${authId}/capture`, { body, ...(cap.requestId ? { requestId: cap.requestId } : {}) });
      checks.push(check('capture replay with same PayPal-Request-Id → same capture id',
        ok(replay.status) && replay.body.id === cap.body.id,
        `HTTP ${replay.status} first=${cap.body.id} replay=${replay.body.id ?? issuesOf(replay.body)}`));
    } else {
      const v = await paypalRequest('POST', `/v2/payments/authorizations/${authId}/void`);
      const after = await paypalRequest<{ status: string }>('GET', `/v2/payments/authorizations/${authId}`);
      checks.push(check('void authorization → VOIDED', (v.status === 200 || v.status === 204) && after.body.status === 'VOIDED',
        `void HTTP ${v.status}; GET status=${after.body.status}`));
    }
  }

  checks.push({ name: 'approval UI label for tax_total', status: 'INFO', detail: 'record manually in PAYPAL.md' });
  report('spike (a) orders authorize', checks);
}

/** Minimal v6 approval page. Orders are created server-side; createOrder just resolves the existing id. */
function approvalPage(clientId: string, orderIds: string[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"><title>Landed spike (a)</title></head>
<body style="font-family:system-ui;max-width:640px;margin:2rem auto">
<h1>Landed spike (a) — approve orders</h1>
<p id="status">Loading PayPal SDK v6…</p>
${orderIds.map((id, i) => `<div style="margin:1rem 0"><strong>Order ${i + 1}</strong> <code>${id}</code><div id="btn-${i}"></div></div>`).join('')}
<script>
const ORDER_IDS = ${JSON.stringify(orderIds)};
const setStatus = (t) => { document.getElementById('status').textContent = t; };
async function onLoad() {
  try {
    const sdk = await window.paypal.createInstance({ clientId: ${JSON.stringify(clientId)}, components: ['paypal-payments'] });
    const eligibility = await sdk.findEligibleMethods();
    if (!eligibility.isEligible('paypal')) { setStatus('PayPal not eligible'); return; }
    ORDER_IDS.forEach((orderId, i) => {
      const session = sdk.createPayPalOneTimePaymentSession({
        onApprove: async (data) => {
          await fetch('/approved', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orderId: data.orderId }) });
          document.getElementById('btn-' + i).textContent = 'Approved ✔';
        },
        onCancel: () => setStatus('Cancelled order ' + (i + 1)),
        onError: (e) => setStatus('Error: ' + (e && e.message)),
      });
      const button = document.createElement('paypal-button');
      document.getElementById('btn-' + i).append(button);
      button.addEventListener('click', async () => {
        try { await session.start({ presentationMode: 'auto' }, Promise.resolve({ orderId })); }
        catch (e) { setStatus('start failed: ' + (e && e.message)); }
      });
    });
    setStatus('Ready — approve each order.');
  } catch (e) { setStatus('SDK init failed: ' + (e && e.message)); }
}
</script>
<script async src="https://www.sandbox.paypal.com/web-sdk/v6/core" onload="onLoad()"></script>
</body></html>`;
}
