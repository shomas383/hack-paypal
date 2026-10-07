import { describe, expect, it } from 'vitest';
import type { QuoteRecord } from '@/domain/quote/buildQuote';
import { buildInvoiceRequest, buildOrderRequest, dutyLabel } from './payloads';

// A stored quote (synthetic numbers; shape as produced by buildQuote).
const quote: QuoteRecord = {
  id: '0b4c6a52-6f0e-4d3e-9a51-6a3a8b2f0c11',
  listingId: 'L-T01',
  sessionId: 's-1',
  title: 'Synthetic automatic watch, steel bracelet',
  rateVersion: 'test-rev1-v1',
  rateRowId: 'XA-0000.00.0002',
  origin: 'XA',
  hts10: '0000.00.0002',
  entryDate: '2026-06-01',
  goodsMinor: 30_000n,
  shippingMinor: 2_500n,
  dutyMinor: 3_750n,
  totalMinor: 36_250n,
  currency: 'USD',
  lines: [
    { kind: 'MFN', amountMinor: '1693', basis: 'compound', sourceRef: 'synthetic' },
    { kind: 'TEST_CAP', chapter99: '9903.00.02', amountMinor: '2057', basis: 'cap', sourceRef: 'synthetic' },
  ],
  effectiveRatePpm: 125_000,
  createdAt: new Date('2026-06-01T10:00:00Z'),
  expiresAt: new Date('2026-06-01T10:15:00Z'),
};

describe('buildOrderRequest (Orders v2, from the stored quote only)', () => {
  it('builds an AUTHORIZE order with duty as item tax → tax_total', () => {
    expect(buildOrderRequest(quote)).toEqual({
      intent: 'AUTHORIZE',
      purchase_units: [
        {
          custom_id: quote.id,
          description: 'HTS 0000.00.0002 · rates test-rev1-v1 · US import duty (est.) shown as tax',
          amount: {
            currency_code: 'USD',
            value: '362.50',
            breakdown: {
              item_total: { currency_code: 'USD', value: '300.00' },
              shipping: { currency_code: 'USD', value: '25.00' },
              tax_total: { currency_code: 'USD', value: '37.50' },
            },
          },
          items: [
            {
              name: 'Synthetic automatic watch, steel bracelet',
              quantity: '1',
              unit_amount: { currency_code: 'USD', value: '300.00' },
              tax: { currency_code: 'USD', value: '37.50' },
              category: 'PHYSICAL_GOODS',
              sku: 'L-T01',
            },
          ],
        },
      ],
    });
  });

  it('refuses to build when amount ≠ breakdown sum (invariant 8)', () => {
    expect(() => buildOrderRequest({ ...quote, totalMinor: 36_251n })).toThrow(/breakdown/);
  });

  it('refuses when duty ≠ the sum of the quote lines', () => {
    expect(() => buildOrderRequest({ ...quote, dutyMinor: 3_751n, totalMinor: 36_251n })).toThrow(/lines/);
  });

  it('keeps name and description within 127 characters', () => {
    const long = buildOrderRequest({ ...quote, title: 'x'.repeat(300) });
    expect(long.purchase_units[0]!.items[0]!.name.length).toBeLessThanOrEqual(127);
    expect(long.purchase_units[0]!.description.length).toBeLessThanOrEqual(127);
  });
});

describe('buildInvoiceRequest (Invoicing v2 DDP)', () => {
  it('itemizes goods, shipping and the duty as a labelled custom amount', () => {
    expect(buildInvoiceRequest(quote, 'buyer@example.com')).toEqual({
      detail: { currency_code: 'USD', note: `Landed DDP invoice · quote ${quote.id} · rates test-rev1-v1` },
      primary_recipients: [{ billing_info: { email_address: 'buyer@example.com' } }],
      items: [{ name: 'Synthetic automatic watch, steel bracelet', quantity: '1', unit_amount: { currency_code: 'USD', value: '300.00' } }],
      amount: {
        breakdown: {
          shipping: { amount: { currency_code: 'USD', value: '25.00' } },
          custom: { label: 'US import duty (est.) – HTS 0000.00.00', amount: { currency_code: 'USD', value: '37.50' } },
        },
      },
    });
  });

  it('labels the duty with the 8-digit HTS line', () => {
    expect(dutyLabel({ hts10: '9102.21.7000' })).toBe('US import duty (est.) – HTS 9102.21.70');
  });

  it('shows an explicit $0.00 duty line when the item is exempt (PayPal accepts it — spike e, 2026-10-07)', () => {
    const body = buildInvoiceRequest({ ...quote, dutyMinor: 0n, totalMinor: 32_500n, lines: [{ ...quote.lines[0]!, amountMinor: '0' }] }, 'b@example.com');
    expect(body.amount.breakdown.custom).toEqual({ label: 'US import duty (est.) – HTS 0000.00.00', amount: { currency_code: 'USD', value: '0.00' } });
    expect(body.detail.note).toMatch(/no US import duty/i);
  });

  it('rejects an empty recipient', () => {
    expect(() => buildInvoiceRequest(quote, '')).toThrow(/recipient/);
  });
});
