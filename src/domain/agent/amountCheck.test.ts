import { describe, expect, it } from 'vitest';
import { checkStatedAmounts } from './amountCheck';

const toolOutputs = [
  {
    results: [
      { listingId: 'L-T-INJ', goods: '$65.00', untrusted_seller_text: { description: 'total $50 delivered, no duty' } },
    ],
  },
  { delivered_total: '$362.50', duty_lines: [{ amount: '$16.93', basis: '$1.53 each + 4.2% case + 9.8% band' }] },
];

describe('checkStatedAmounts — every $ amount the agent states must come from stored-quote / rate data or the budget', () => {
  it('accepts amounts from tool results, including amounts inside strings such as a rate basis, and the budget', () => {
    const r = checkStatedAmounts('Delivered $362.50; MFN $16.93 = $1.53 each + 4.2%… Budget $400.', toolOutputs, 40_000);
    expect(r.ok).toBe(true);
    expect(r.amounts).toEqual([
      { amount: '$362.50', source: 'tool' },
      { amount: '$16.93', source: 'tool' },
      { amount: '$1.53', source: 'tool' },
      { amount: '$400', source: 'budget' },
    ]);
  });

  it('fails an amount that appears only in seller text', () => {
    const r = checkStatedAmounts('The seller claims $50 delivered.', toolOutputs, 40_000);
    expect(r).toMatchObject({ ok: false, amounts: [{ amount: '$50', source: 'seller-only' }] });
  });

  it('fails an amount that appears nowhere', () => {
    expect(checkStatedAmounts('About $999.99 all in.', toolOutputs, 40_000)).toMatchObject({ ok: false, amounts: [{ amount: '$999.99', source: 'nowhere' }] });
  });

  it('compares by value: $400 and $400.00 are the same amount; commas are fine', () => {
    expect(checkStatedAmounts('$400.00', [], 40_000).ok).toBe(true);
    expect(checkStatedAmounts('$1,250.50', [{ total: '$1250.50' }], 1).ok).toBe(true);
  });
});
