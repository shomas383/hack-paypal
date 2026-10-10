import { describe, expect, it } from 'vitest';
import { overBudgetBy, priceInsight, runSummary, type QuoteView } from './insight';

// The four stored quotes from the 2026-10-10 live run (rates-v4), as the tool returns them.
const q = (listingId: string, origin: string, goods: string, delivered: string, within: boolean): QuoteView => ({
  listingId,
  origin,
  goods,
  delivered_total: delivered,
  budget: '$400.00',
  within_budget: within,
});
const RUN: QuoteView[] = [
  q('L-P03', 'JP', '$300.00', '$362.50', true),
  q('L-P13', 'CN', '$280.00', '$377.09', true),
  q('L-P03-B', 'JP', '$380.00', '$452.50', false),
  q('L-P14', 'DE', '$290.00', '$344.00', true),
];

describe('priceInsight (code-computed; shown only when the cheapest goods are not the cheapest delivered)', () => {
  it('CN has the lowest goods price, DE the lowest delivered total', () => {
    expect(priceInsight(RUN)).toEqual({
      lowestGoods: { listingId: 'L-P13', origin: 'CN', goodsMinor: 28_000n, deliveredMinor: 37_709n },
      lowestDelivered: { listingId: 'L-P14', origin: 'DE', goodsMinor: 29_000n, deliveredMinor: 34_400n },
    });
  });

  it('null when the same listing is cheapest on both', () => {
    expect(priceInsight([RUN[0]!, RUN[3]!])).toBeNull(); // JP 300 → 362.50, DE 290 → 344.00: DE wins both
  });

  it('considers only within-budget quotes, and ignores unsupported ones', () => {
    const cheapButOver = q('L-X', 'JP', '$100.00', '$999.00', false);
    expect(priceInsight([...RUN, cheapButOver])?.lowestGoods.listingId).toBe('L-P13');
    expect(priceInsight([{ listingId: 'L-U', unsupported: 'no verified rate' }, RUN[3]!])).toBeNull();
  });

  it('refuses amounts that are not exact dollar strings (never parses floats)', () => {
    expect(priceInsight([q('L-A', 'JP', '280', '$377.09', true), RUN[3]!])).toBeNull();
  });
});

describe('overBudgetBy', () => {
  it('delivered − budget in minor units, or null when within', () => {
    expect(overBudgetBy(RUN[2]!)).toBe(5_250n);
    expect(overBudgetBy(RUN[3]!)).toBeNull();
  });
});

describe('runSummary (the one completion announcement)', () => {
  it('counts quotes and names the proposal', () => {
    expect(runSummary(RUN, { listingId: 'L-P14', delivered_total: '$344.00' })).toBe('Found 4 quotes, 3 within budget. Prepared a purchase for L-P14 at $344.00.');
    expect(runSummary(RUN, null)).toBe('Found 4 quotes, 3 within budget. No purchase was prepared.');
    expect(runSummary([RUN[0]!], null)).toBe('Found 1 quote, 1 within budget. No purchase was prepared.');
  });
});
