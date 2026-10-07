// Spike (f): does Invoicing v2 honour PayPal-Request-Id on create? (Decides how sendDdpInvoice may retry a CREATING row.)
// Source: Invoicing v2 OpenAPI (developer.paypal.com/api/invoicing/v2/schema.json, fetched 2026-10-07): the
// `paypal_request_id` header parameter is defined, but POST /v2/invoicing/invoices and …/send do NOT reference it
// (only …/conditional-rules does). DELETE /v2/invoicing/invoices/{id} deletes draft/scheduled invoices (204).
// Creates DRAFTS only (never sent) and deletes every draft it created.
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
  const body = (note: string) => ({
    detail: { currency_code: 'USD', note },
    primary_recipients: [{ billing_info: { email_address: email } }],
    items: [{ name: 'Landed spike (f) — idempotency probe', quantity: '1', unit_amount: toPayPalAmount(usd(30_000)) }],
    amount: { breakdown: { shipping: { amount: toPayPalAmount(usd(2_500)) }, custom: { label: 'US import duty (est.) – HTS 9102.21.70', amount: toPayPalAmount(usd(3_750)) } } },
  });
  const idOf = (b: Created | null) => b?.id ?? b?.href?.split('/').pop();
  const created = new Set<string>();

  const rid = randomUUID();
  const first = await paypalRequest<Created>('POST', '/v2/invoicing/invoices', { body: body('Landed spike (f) draft — not sent'), requestId: rid });
  const id1 = idOf(first.body);
  if (id1) created.add(id1);
  checks.push({ name: '1st create (request id R)', status: 'INFO', detail: `HTTP ${first.status} ${ok(first.status) ? `id=${id1}` : issuesOf(first.body)}` });

  const second = await paypalRequest<Created>('POST', '/v2/invoicing/invoices', { body: body('Landed spike (f) draft — not sent'), requestId: rid });
  const id2 = idOf(second.body);
  if (id2) created.add(id2);
  checks.push({ name: '2nd create, same R + same body', status: 'INFO', detail: `HTTP ${second.status} ${ok(second.status) ? `id=${id2}` : issuesOf(second.body)}` });
  checks.push(check('same request id → same invoice (idempotent create)', !!id1 && id1 === id2, `${id1} vs ${id2 ?? 'none'}`));

  const third = await paypalRequest<Created>('POST', '/v2/invoicing/invoices', { body: body('Landed spike (f) draft — DIFFERENT body'), requestId: rid });
  const id3 = idOf(third.body);
  if (id3) created.add(id3);
  checks.push({ name: '3rd create, same R + different body', status: 'INFO', detail: `HTTP ${third.status} ${ok(third.status) ? `id=${id3}${id3 === id1 ? ' (= 1st)' : ' (new)'}` : issuesOf(third.body)}` });

  // Cleanup: delete every draft this spike created.
  for (const id of created) {
    const del = await paypalRequest('DELETE', `/v2/invoicing/invoices/${id}`);
    checks.push({ name: `delete draft ${id}`, status: ok(del.status) ? 'INFO' : 'FAIL', detail: `HTTP ${del.status}` });
  }
  checks.push({ name: 'distinct drafts created', status: 'INFO', detail: String(created.size) });
  report('spike (f) invoicing PayPal-Request-Id', checks);
}
