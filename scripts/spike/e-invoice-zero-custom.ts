// Spike (e): does Invoicing v2 accept amount.breakdown.custom with a $0.00 amount (exempt duty, e.g. 9903.05.92)?
// Creates a DRAFT only (never sent). Settles the VERIFY in src/server/paypal/payloads.ts.
import { toPayPalAmount } from '../../src/domain/money/format';
import { usd } from '../../src/domain/money/money';
import { type Check, check, issuesOf, loadEnv, ok, paypalRequest, report } from './_lib';

type Amount = { currency_code: string; value: string };

export async function run(): Promise<void> {
  const env = loadEnv();
  const email = env.PAYPAL_SANDBOX_BUYER_EMAIL;
  if (!email) throw new Error('PAYPAL_SANDBOX_BUYER_EMAIL is empty');
  const checks: Check[] = [];
  const label = 'US import duty (est.) – HTS 8523.49.40';

  const created = await paypalRequest<{ id?: string; href?: string }>('POST', '/v2/invoicing/invoices', {
    body: {
      detail: { currency_code: 'USD', note: 'Landed spike (e) — $0.00 custom amount probe (draft, not sent)' },
      primary_recipients: [{ billing_info: { email_address: email } }],
      items: [{ name: 'Landed spike — recorded Blu-ray (exempt)', quantity: '1', unit_amount: toPayPalAmount(usd(18_000)) }],
      amount: { breakdown: { shipping: { amount: toPayPalAmount(usd(2_500)) }, custom: { label, amount: toPayPalAmount(usd(0)) } } },
    },
  });
  const id = created.body?.id ?? created.body?.href?.split('/').pop();
  checks.push({ name: 'create draft with custom $0.00', status: 'INFO', detail: `HTTP ${created.status} ${ok(created.status) ? `id=${id}` : issuesOf(created.body)}` });
  if (!ok(created.status) || !id) return report('spike (e) $0.00 custom amount', checks);

  const got = await paypalRequest<{ status: string; amount?: { value?: string; breakdown?: { custom?: { label?: string; amount?: Amount } } } }>(
    'GET',
    `/v2/invoicing/invoices/${id}`,
  );
  const c = got.body.amount?.breakdown?.custom;
  checks.push(check('draft total = goods + shipping', got.body.amount?.value === '205.00', `total=${got.body.amount?.value}`));
  checks.push({ name: 'custom line as stored by PayPal', status: 'INFO', detail: c ? `label="${c.label}" amount=${c.amount?.value ?? '(none)'}` : '(custom omitted by PayPal)' });
  report('spike (e) $0.00 custom amount', checks);
}
