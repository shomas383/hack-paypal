import { describe, expect, it } from 'vitest';
import { quoteUsable, quoteUnusableMessage } from './quoteUsable';

const q = { rateVersion: 'v1', expiresAt: new Date('2026-10-06T12:15:00Z') };
const FRESH = new Date('2026-10-06T12:00:00Z');
const EXPIRED = new Date('2026-10-06T12:15:00Z'); // expiry instant itself counts as expired (same as decideCapture)

describe('quoteUsable', () => {
  it('fresh quote on the current rate version → ok', () => {
    expect(quoteUsable(q, FRESH, 'v1')).toEqual({ ok: true });
  });

  it('expired → QUOTE_EXPIRED', () => {
    expect(quoteUsable(q, EXPIRED, 'v1')).toEqual({ ok: false, reasons: ['QUOTE_EXPIRED'] });
  });

  it('rate version no longer active → RATE_VERSION_STALE', () => {
    expect(quoteUsable(q, FRESH, 'v2')).toEqual({ ok: false, reasons: ['RATE_VERSION_STALE'] });
  });

  it('reports both reasons at once', () => {
    expect(quoteUsable(q, EXPIRED, 'v2')).toEqual({ ok: false, reasons: ['RATE_VERSION_STALE', 'QUOTE_EXPIRED'] });
  });

  it('staleness is the version only, never the age of the rates or the quote', () => {
    expect(quoteUsable({ rateVersion: 'v1', expiresAt: new Date('2026-12-15T00:15:00Z') }, new Date('2026-12-15T00:00:00Z'), 'v1')).toEqual({ ok: true });
  });
});

describe('quoteUnusableMessage', () => {
  it('names each reason and asks for a new quote', () => {
    expect(quoteUnusableMessage(['QUOTE_EXPIRED'])).toBe('quote expired — get a new quote');
    expect(quoteUnusableMessage(['RATE_VERSION_STALE'])).toBe('rates changed — get a new quote');
    expect(quoteUnusableMessage(['RATE_VERSION_STALE', 'QUOTE_EXPIRED'])).toBe('rates changed / quote expired — get a new quote');
  });
});
