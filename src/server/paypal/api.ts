// Orders v2 / Payments v2 / Invoicing v2 calls used by the checkout (endpoints and fields per docs/PAYPAL.md).
import { fromPayPalValue, toPayPalAmount } from '@/domain/money/format';
import { usd } from '@/domain/money/money';
import type { CaptureGrant } from '@/domain/policy/decideCapture';
import type { QuoteRecord } from '@/domain/quote/buildQuote';
import { paypalRequest } from './client';
import { buildInvoiceRequest, buildOrderRequest } from './payloads';

type Amount = { currency_code: string; value: string };

export interface PayPalOrder {
  id: string;
  status: string;
  purchase_units: {
    custom_id?: string;
    amount: Amount & { breakdown?: { item_total?: Amount; shipping?: Amount; tax_total?: Amount } };
    payments?: { authorizations?: { id: string; status: string; amount: Amount }[] };
  }[];
}

export async function createOrder(quote: QuoteRecord, requestId: string): Promise<{ id: string; status: string }> {
  const res = await paypalRequest<{ id: string; status: string }>('POST', '/v2/checkout/orders', { body: buildOrderRequest(quote), requestId });
  return res.body;
}

export async function getOrder(orderId: string): Promise<PayPalOrder> {
  return (await paypalRequest<PayPalOrder>('GET', `/v2/checkout/orders/${encodeURIComponent(orderId)}`)).body;
}

/** Authorize an approved order; authorization id at purchase_units[0].payments.authorizations[0].id (spike a). */
export async function authorizeOrder(orderId: string, requestId: string) {
  const res = await paypalRequest<PayPalOrder>('POST', `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, { requestId });
  const auth = res.body.purchase_units?.[0]?.payments?.authorizations?.[0];
  if (!auth) throw new Error(`authorize ${orderId}: no authorization in response`);
  const currency = auth.amount.currency_code === 'USD' ? 'USD' : null;
  if (!currency) throw new Error(`authorize ${orderId}: unexpected currency ${auth.amount.currency_code}`);
  return { id: auth.id, status: auth.status, amountMinor: fromPayPalValue(auth.amount.value, currency).amountMinor, currency };
}

/** Capture is only possible with a CaptureGrant, which only decideCapture() can produce (invariant 6). */
export async function captureAuthorization(authorizationId: string, grant: CaptureGrant, requestId: string) {
  const res = await paypalRequest<{ id: string; status: string }>(
    'POST',
    `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/capture`,
    { body: { amount: toPayPalAmount(usd(grant.amountMinor)), final_capture: true }, requestId },
  );
  return res.body;
}

export async function voidAuthorization(authorizationId: string, requestId: string): Promise<void> {
  await paypalRequest('POST', `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, { requestId });
}

/**
 * Create returns only a link {rel, href, method} (spike b) — the id is the last path segment.
 * NOT idempotent: PayPal ignores PayPal-Request-Id here (spike f), so it is sent once and never retried.
 */
export async function createInvoice(quote: QuoteRecord, recipientEmail: string, requestId: string): Promise<string> {
  const res = await paypalRequest<{ id?: string; href?: string }>('POST', '/v2/invoicing/invoices', {
    body: buildInvoiceRequest(quote, recipientEmail),
    requestId,
    retry: false,
  });
  const id = res.body?.id ?? res.body?.href?.split('/').pop();
  if (!id) throw new Error('invoice create returned no id or link');
  return id;
}

export async function sendInvoice(invoiceId: string, requestId: string): Promise<void> {
  await paypalRequest('POST', `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}/send`, {
    body: { send_to_recipient: true, send_to_invoicer: false },
    requestId,
  });
}

export async function getInvoice(invoiceId: string) {
  const res = await paypalRequest<{
    id: string;
    status: string;
    amount?: { value?: string; breakdown?: { custom?: { label?: string; amount?: Amount } } };
    detail?: { metadata?: { recipient_view_url?: string } };
  }>('GET', `/v2/invoicing/invoices/${encodeURIComponent(invoiceId)}`);
  return res.body;
}
