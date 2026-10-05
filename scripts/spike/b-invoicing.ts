// Spike (b): Invoicing v2 draft → send, duty itemized as amount.breakdown.custom.
// Source: Invoicing v2 schema.json (developer.paypal.com/api/invoicing/v2/schema.json, fetched 2026-10-05):
//   invoice.detail.currency_code (required) · primary_recipients[].billing_info.email_address ·
//   items[] {name*, quantity* (string), unit_amount*} · amount.breakdown.shipping.amount ·
//   amount.breakdown.custom = single object {label*, amount} (NOT an array) ·
//   POST /invoices → 201 full invoice · POST /invoices/{id}/send {send_to_recipient, send_to_invoicer} → 200/202 link.
import { usd } from '../../src/domain/money/money';
import { toPayPalAmount, toPayPalValue } from '../../src/domain/money/format';
import { type Check, check, issuesOf, loadEnv, ok, paypalRequest, report } from './_lib';

type Amount = { currency_code: string; value: string };
interface Invoice {
  id: string;
  status: string;
  amount?: { value?: string; breakdown?: { custom?: { label?: string; amount?: Amount } } };
}

// Arbitrary spike amounts (minor units) — NOT tariff rates.
const GOODS = usd(25_000);
const SHIPPING = usd(2_500);
const DUTY = usd(3_125);
// HTS deliberately a placeholder: no real codes outside data/ (invariant 4).
const DUTY_LABEL = 'US import duty (est.) – HTS [spike placeholder]';

function invoiceBody(email: string, custom: unknown) {
  return {
    detail: { currency_code: 'USD', note: 'Landed spike (b) — sandbox test invoice' },
    primary_recipients: [{ billing_info: { email_address: email } }],
    items: [{ name: 'Landed spike — vintage watch', quantity: '1', unit_amount: toPayPalAmount(GOODS) }],
    amount: { breakdown: { shipping: { amount: toPayPalAmount(SHIPPING) }, custom } },
  };
}

export async function run(): Promise<void> {
  const env = loadEnv();
  const checks: Check[] = [];
  const email = env.PAYPAL_SANDBOX_BUYER_EMAIL;
  if (!email) throw new Error('PAYPAL_SANDBOX_BUYER_EMAIL is empty — set it to your sandbox personal account email');

  const customDuty = { label: DUTY_LABEL, amount: toPayPalAmount(DUTY) };
  const created = await paypalRequest<Invoice>('POST', '/v2/invoicing/invoices', { body: invoiceBody(email, customDuty) });
  checks.push(check('create draft invoice (201, DRAFT)', created.status === 201 && created.body.status === 'DRAFT',
    `HTTP ${created.status} status=${created.body?.status ?? issuesOf(created.body)}`));
  if (!ok(created.status)) return report('spike (b) invoicing', checks);
  const id = created.body.id;

  const sent = await paypalRequest('POST', `/v2/invoicing/invoices/${id}/send`, {
    body: { send_to_recipient: true, send_to_invoicer: false },
  });
  checks.push(check('send invoice (200/202)', sent.status === 200 || sent.status === 202, `HTTP ${sent.status} ${ok(sent.status) ? '' : issuesOf(sent.body)}`));

  const got = await paypalRequest<Invoice>('GET', `/v2/invoicing/invoices/${id}`);
  const total = toPayPalValue(usd(GOODS.amountMinor + SHIPPING.amountMinor + DUTY.amountMinor));
  checks.push(check('invoice status after send', got.body.status === 'SENT' || got.body.status === 'UNPAID',
    `status=${got.body.status}`));
  checks.push(check('invoice total = goods + shipping + duty', got.body.amount?.value === total,
    `want ${total} have ${got.body.amount?.value}`));
  const c = got.body.amount?.breakdown?.custom;
  checks.push(check('duty label + amount survive in breakdown.custom',
    c?.label === DUTY_LABEL && c.amount?.value === toPayPalValue(DUTY), `label="${c?.label}" amount=${c?.amount?.value}`));

  // Probe: only one custom entry? Schema says object; send an array and record the outcome.
  const two = await paypalRequest('POST', '/v2/invoicing/invoices', { body: invoiceBody(email, [customDuty, customDuty]) });
  checks.push({ name: 'probe: two custom entries (array)', status: 'INFO',
    detail: `HTTP ${two.status} ${ok(two.status) ? 'ACCEPTED — investigate' : issuesOf(two.body)}` });

  checks.push({ name: 'buyer-facing rendering', status: 'INFO',
    detail: `open the invoice email/link for ${email} and record how the custom line shows (invoice ${id})` });
  report('spike (b) invoicing', checks);
}
