// PayPal request bodies built ONLY from a stored quote (SPEC §4.3, §4.6) — never from client or LLM amounts.
// Fields per docs/PAYPAL.md (Orders v2 items/breakdown; Invoicing v2 detail/items/breakdown.custom).
import { toPayPalAmount } from '@/domain/money/format';
import { usd } from '@/domain/money/money';
import type { QuoteRecord } from '@/domain/quote/buildQuote';

const MAX_TEXT = 127; // PayPal truncates item name / description beyond this (docs/PAYPAL.md)
const clip = (s: string): string => (s.length <= MAX_TEXT ? s : `${s.slice(0, MAX_TEXT - 1)}…`);

/** Invariant 8 + quote integrity: amount = goods + shipping + duty, and duty = Σ quote lines. */
function assertQuoteTotals(q: QuoteRecord): void {
  const lineSum = q.lines.reduce((s, l) => s + BigInt(l.amountMinor), 0n);
  if (lineSum !== q.dutyMinor) throw new Error(`quote ${q.id}: duty ${q.dutyMinor} ≠ sum of duty lines ${lineSum}`);
  if (q.goodsMinor + q.shippingMinor + q.dutyMinor !== q.totalMinor) {
    throw new Error(`quote ${q.id}: amount ${q.totalMinor} ≠ breakdown sum (item_total + shipping + tax_total)`);
  }
}

export function buildOrderRequest(q: QuoteRecord) {
  assertQuoteTotals(q);
  return {
    intent: 'AUTHORIZE' as const,
    purchase_units: [
      {
        custom_id: q.id,
        description: clip(`HTS ${q.hts10} · rates ${q.rateVersion} · US import duty (est.) shown as tax`),
        amount: {
          ...toPayPalAmount(usd(q.totalMinor)),
          breakdown: {
            item_total: toPayPalAmount(usd(q.goodsMinor)),
            shipping: toPayPalAmount(usd(q.shippingMinor)),
            tax_total: toPayPalAmount(usd(q.dutyMinor)),
          },
        },
        items: [
          {
            name: clip(q.title),
            quantity: '1',
            unit_amount: toPayPalAmount(usd(q.goodsMinor)),
            tax: toPayPalAmount(usd(q.dutyMinor)),
            category: 'PHYSICAL_GOODS' as const,
            sku: q.listingId,
          },
        ],
      },
    ],
  };
}

/** "US import duty (est.) – HTS 9102.21.70" — the 8-digit line that carries the rate. */
export function dutyLabel(q: Pick<QuoteRecord, 'hts10'>): string {
  return `US import duty (est.) – HTS ${q.hts10.slice(0, 10)}`;
}

export function buildInvoiceRequest(q: QuoteRecord, recipientEmail: string) {
  assertQuoteTotals(q);
  if (!recipientEmail.trim()) throw new Error('invoice recipient email is required');
  const hasDuty = q.dutyMinor > 0n;
  // VERIFY: whether Invoicing accepts a $0.00 custom amount — until confirmed, omit it and say so in the note.
  const note = `Landed DDP invoice · quote ${q.id} · rates ${q.rateVersion}${hasDuty ? '' : ' · No US import duty (exempt)'}`;
  return {
    detail: { currency_code: 'USD' as const, note },
    primary_recipients: [{ billing_info: { email_address: recipientEmail.trim() } }],
    items: [{ name: clip(q.title), quantity: '1', unit_amount: toPayPalAmount(usd(q.goodsMinor)) }],
    amount: {
      breakdown: {
        shipping: { amount: toPayPalAmount(usd(q.shippingMinor)) },
        ...(hasDuty ? { custom: { label: dutyLabel(q), amount: toPayPalAmount(usd(q.dutyMinor)) } } : {}),
      },
    },
  };
}
