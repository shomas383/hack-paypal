import type { QuoteRecord } from '@/domain/quote/buildQuote';

/** A stored quote (synthetic numbers; shape as produced by buildQuote). */
export function buildQuoteFixture(over: Partial<QuoteRecord> = {}): QuoteRecord {
  return {
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
    ...over,
  };
}
