// Spike (g): can a quote-derived invoice number make a stuck CREATING invoice recoverable?
// Source: Invoicing v2 OpenAPI (fetched 2026-10-07): `detail.invoice_number` (string, ≤25 chars; "If omitted, an
// auto-incremented number … is used"); POST /v2/invoicing/search-invoices with `search_data.invoice_number` filter.
// The spec documents NO duplicate-number error. Creates DRAFTS only and deletes them.
import { randomUUID } from 'node:crypto';
import { toPayPalAmount } from '../../src/domain/money/format';
import { usd } from '../../src/domain/money/money';
import { type Check, check, issuesOf, loadEnv, ok, paypalRequest, report } from './_lib';

type Created = { id?: string; href?: string };

export async function run(): Promise<void> {
  const env = loadEnv();
  const email = env.PAYPAL_SANDBOX_BUYER_EMAIL;
  if (!email) throw new Error('PAYPAL_SANDBOX_BUYER_EMAIL is empty');
  const checks: Check[] = [];
  const number = `LQ-G-${randomUUID().replace(/-/g, '').slice(0, 20)}`; // 25 chars, like a quote-derived number
  const body = {
    detail: { currency_code: 'USD', invoice_number: number, note: 'Landed spike (g) draft — not sent' },
    primary_recipients: [{ billing_info: { email_address: email } }],
    items: [{ name: 'Landed spike (g) — invoice number probe', quantity: '1', unit_amount: toPayPalAmount(usd(30_000)) }],
  };
  const idOf = (b: Created | null) => b?.id ?? b?.href?.split('/').pop();
  const created = new Set<string>();

  const a = await paypalRequest<Created>('POST', '/v2/invoicing/invoices', { body, requestId: randomUUID() });
  const idA = idOf(a.body);
  if (idA) created.add(idA);
  checks.push({ name: `create with invoice_number ${number}`, status: 'INFO', detail: `HTTP ${a.status} ${ok(a.status) ? `id=${idA}` : issuesOf(a.body)}` });

  const b = await paypalRequest<Created & { name?: string }>('POST', '/v2/invoicing/invoices', { body, requestId: randomUUID() });
  const idB = ok(b.status) ? idOf(b.body) : undefined;
  if (idB) created.add(idB);
  checks.push(check('duplicate invoice_number is rejected', !ok(b.status), `HTTP ${b.status} ${ok(b.status) ? `id=${idB} (ACCEPTED)` : `name=${b.body?.name ?? '?'} issues=${issuesOf(b.body)}`}`));

  const s = await paypalRequest<{ total_items?: number; items?: { id: string; detail?: { invoice_number?: string } }[] }>(
    'POST',
    '/v2/invoicing/search-invoices?page=1&page_size=10&total_required=true',
    { body: { invoice_number: number }, requestId: randomUUID() },
  );
  const found = (s.body?.items ?? []).map((i) => `${i.id}(${i.detail?.invoice_number ?? '?'})`);
  checks.push(check('search-invoices finds it by number', ok(s.status) && !!idA && found.some((f) => f.startsWith(idA)), `HTTP ${s.status} total=${s.body?.total_items ?? '?'} items=${found.join(', ') || 'none'}`));

  for (const id of created) {
    const del = await paypalRequest('DELETE', `/v2/invoicing/invoices/${id}`);
    checks.push({ name: `delete draft ${id}`, status: ok(del.status) ? 'INFO' : 'FAIL', detail: `HTTP ${del.status}` });
  }
  report('spike (g) invoice_number dedupe + search', checks);
}
