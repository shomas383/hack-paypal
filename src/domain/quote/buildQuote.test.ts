// buildQuote on SYNTHETIC rate rows (see rates/__fixtures__/synthetic.ts) — no real tariff data here.
import { describe, expect, it } from 'vitest';
import { additiveRow, capRow, compoundRow, syntheticFile } from '../rates/__fixtures__/synthetic';
import { buildQuote, type ListingForQuote } from './buildQuote';

const NOW = new Date('2026-06-01T10:00:00Z');
const opts = { id: 'q-1', sessionId: 's-1', now: NOW, ttlSeconds: 900 };
const listing = (over: Partial<ListingForQuote> = {}): ListingForQuote => ({
  id: 'L-T01',
  title: 'synthetic capped article',
  origin: capRow.origin,
  hts10: capRow.hts10,
  priceMinor: 10_000n,
  shippingMinor: 2_500n,
  facts: {},
  ...over,
});

describe('buildQuote', () => {
  it('quotes goods + shipping + duty, with duty on goods only', () => {
    const r = buildQuote(syntheticFile, listing(), opts);
    if (r.kind !== 'OK') throw new Error(r.reason);
    const q = r.quote;
    expect(q).toMatchObject({
      id: 'q-1',
      listingId: 'L-T01',
      sessionId: 's-1',
      rateVersion: 'test-rev1-v1',
      rateRowId: capRow.id,
      goodsMinor: 10_000n,
      shippingMinor: 2_500n,
      dutyMinor: 1_000n, // cap 10% of $100 goods — shipping excluded from customs value
      totalMinor: 13_500n,
      currency: 'USD',
      effectiveRatePpm: 100_000,
    });
    expect(q.lines.map((l) => [l.kind, l.chapter99 ?? null, l.amountMinor])).toEqual([
      ['MFN', null, '400'],
      ['TEST_CAP', '9903.00.02', '600'],
    ]);
  });

  it('expires TTL seconds after creation and uses the creation date as entry date', () => {
    const r = buildQuote(syntheticFile, listing(), opts);
    if (r.kind !== 'OK') throw new Error(r.reason);
    expect(r.quote.createdAt).toEqual(NOW);
    expect(r.quote.expiresAt).toEqual(new Date('2026-06-01T10:15:00Z'));
    expect(r.quote.entryDate).toBe('2026-06-01');
  });

  it('passes the value split and facts through to the engine', () => {
    const watch = buildQuote(
      syntheticFile,
      listing({ hts10: compoundRow.hts10, priceMinor: 30_000n, valueSplit: { caseMinor: 25_000n, bandMinor: 5_000n } }),
      opts,
    );
    expect(watch.kind).toBe('OK');
    const fact = buildQuote(syntheticFile, listing({ origin: additiveRow.origin, hts10: additiveRow.hts10, facts: { test_fact: true } }), opts);
    expect(fact.kind).toBe('OK');
  });

  it('returns UNSUPPORTED (no quote) when the engine refuses', () => {
    expect(buildQuote(syntheticFile, listing({ hts10: compoundRow.hts10 }), opts)).toMatchObject({ kind: 'UNSUPPORTED' });
    expect(buildQuote(syntheticFile, listing({ hts10: '0000.00.9999' }), opts)).toMatchObject({ kind: 'UNSUPPORTED' });
    expect(buildQuote(syntheticFile, listing({ origin: additiveRow.origin, hts10: additiveRow.hts10 }), opts).kind).toBe('UNSUPPORTED');
  });

  it('rejects a negative shipping charge', () => {
    expect(buildQuote(syntheticFile, listing({ shippingMinor: -1n }), opts).kind).toBe('UNSUPPORTED');
  });
});
