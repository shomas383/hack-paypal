import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { approvalHash, decideCapture, type PolicyInput } from './decideCapture';

const NOW = new Date('2026-10-06T12:00:00Z');
const quote = {
  id: 'q-1',
  totalMinor: 36_250n,
  currency: 'USD' as const,
  rateVersion: 'v1',
  expiresAt: new Date('2026-10-06T12:15:00Z'),
};
const base = (): PolicyInput => ({
  quote,
  approval: { quoteId: quote.id, amountMinor: quote.totalMinor, currency: 'USD', amountHash: approvalHash(quote) },
  authorization: { status: 'CREATED', amountMinor: quote.totalMinor, currency: 'USD' },
  now: NOW,
  currentRateVersion: 'v1',
  caps: { perOrderMinor: 40_000n, perSessionMinor: 80_000n },
  sessionCapturedMinor: 0n,
});

describe('decideCapture', () => {
  it('captures when every check passes, and grants exactly the quoted amount', () => {
    const d = decideCapture(base());
    expect(d.decision).toBe('CAPTURE');
    expect(d.reasons).toEqual([]);
    if (d.decision !== 'CAPTURE') throw new Error('unreachable');
    expect(d.grant).toMatchObject({ quoteId: 'q-1', amountMinor: 36_250n, currency: 'USD' });
  });

  const cases: [string, (i: PolicyInput) => PolicyInput, string][] = [
    ['no approval row', (i) => ({ ...i, approval: null }), 'NO_APPROVAL'],
    ['approval for another quote', (i) => ({ ...i, approval: { ...i.approval!, quoteId: 'q-2' } }), 'APPROVAL_MISMATCH'],
    ['approval for another amount', (i) => ({ ...i, approval: { ...i.approval!, amountMinor: 36_249n } }), 'APPROVAL_MISMATCH'],
    ['approval hash tampered', (i) => ({ ...i, approval: { ...i.approval!, amountHash: 'x' } }), 'APPROVAL_MISMATCH'],
    ['authorization not CREATED', (i) => ({ ...i, authorization: { ...i.authorization, status: 'VOIDED' } }), 'AUTH_NOT_CREATED'],
    ['authorized amount ≠ quote', (i) => ({ ...i, authorization: { ...i.authorization, amountMinor: 36_251n } }), 'AUTH_AMOUNT_MISMATCH'],
    ['authorized currency ≠ quote', (i) => ({ ...i, authorization: { ...i.authorization, currency: 'JPY' } }), 'AUTH_AMOUNT_MISMATCH'],
    ['over the per-order cap', (i) => ({ ...i, caps: { ...i.caps, perOrderMinor: 36_249n } }), 'OVER_ORDER_CAP'],
    ['over the per-session cap', (i) => ({ ...i, sessionCapturedMinor: 43_751n }), 'OVER_SESSION_CAP'],
    ['rate version changed since the quote', (i) => ({ ...i, currentRateVersion: 'v2' }), 'RATE_VERSION_STALE'],
    ['quote expired', (i) => ({ ...i, now: new Date('2026-10-06T12:15:00Z') }), 'QUOTE_EXPIRED'],
  ];

  it.each(cases)('voids: %s', (_name, mutate, reason) => {
    const d = decideCapture(mutate(base()));
    expect(d.decision).toBe('VOID');
    expect(d.reasons).toContain(reason);
    expect('grant' in d).toBe(false);
  });

  it('allows amounts exactly at the caps', () => {
    expect(decideCapture({ ...base(), caps: { perOrderMinor: 36_250n, perSessionMinor: 80_000n } }).decision).toBe('CAPTURE');
    expect(decideCapture({ ...base(), sessionCapturedMinor: 43_750n }).decision).toBe('CAPTURE');
  });

  it('reports every failing check, not just the first', () => {
    const d = decideCapture({ ...base(), approval: null, currentRateVersion: 'v2', now: new Date('2027-01-01T00:00:00Z') });
    expect(d.reasons).toEqual(expect.arrayContaining(['NO_APPROVAL', 'RATE_VERSION_STALE', 'QUOTE_EXPIRED']));
  });

  it('binds the approval hash to quote id, total, currency and rate version', () => {
    const h = approvalHash(quote);
    expect(approvalHash({ ...quote, id: 'q-2' })).not.toBe(h);
    expect(approvalHash({ ...quote, totalMinor: 1n })).not.toBe(h);
    expect(approvalHash({ ...quote, rateVersion: 'v2' })).not.toBe(h);
    expect(approvalHash({ ...quote })).toBe(h);
  });

  it('property: any single violation → VOID with no grant', () => {
    fc.assert(
      fc.property(fc.constantFrom(...cases), ([, mutate]) => {
        const d = decideCapture(mutate(base()));
        expect(d.decision).toBe('VOID');
        expect('grant' in d).toBe(false);
      }),
    );
  });
});
