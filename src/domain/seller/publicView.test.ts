// The public read-only seller view (SPEC §4.5): allowlist projections only. Whatever extra fields the server rows carry
// (seller session, IP, emails, payer, call ids), none survives; the audit trail loses its "by".
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { FORBIDDEN_KEYS, forbiddenPaths, toPublicDetail, toPublicLedgerRow, toPublicQueueRow, type PublicDetailInput, type PublicLedgerRow, type PublicQueueRow } from './publicView';

const EXTRA = { by: 'a1b2', sellerSession: '0b7a5e1c-1111-4222-8333-444455556666', sessionId: 's-1', ip: '203.0.113.7', email: 'buyer@example.com', payer: { email_address: 'buyer@example.com' }, callId: '7' };

const queueRow: PublicQueueRow = {
  id: 'c-1',
  title: 'Automatic diver watch',
  origin: 'JP',
  topCode: '9102.21.70',
  hts10: null,
  confidence: 0.55,
  reasons: ['LOW_CONFIDENCE'],
  status: 'PENDING_REVIEW',
  answered: 0,
  questions: 1,
  updatedAt: '2026-10-13T00:00:00.000Z',
};
const ledgerRow: PublicLedgerRow = {
  orderId: 'o-1',
  date: '2026-10-07T00:00:00.000Z',
  listingId: 'L-P03',
  title: 'Automatic diver watch',
  goodsMinor: '30000',
  shippingMinor: '2500',
  dutyMinor: '3750',
  totalMinor: '36250',
  hts10: '9102.21.70',
  ch99: [],
  rateVersion: '2026-rev21-v2',
  status: 'CAPTURED',
  paypalOrderId: '5O190127TN364715T',
};
const detail: PublicDetailInput = {
  id: 'c-1',
  status: 'PENDING_REVIEW',
  progress: { state: 'done', steps: [] },
  input: { title: 'Automatic diver watch', description: '21 jewels', origin: 'JP' },
  error: null,
  reasons: ['LOW_CONFIDENCE'],
  threshold: 0.8,
  top: { hts10: '9102.21.70', confidence: 0.55, rationale: 'r', evidence: ['automatic'], chain: ['Wrist watches'], componentReporting: true },
  others: [],
  separatingAttributes: [{ name: 'jewels', value_from_listing: '21' }],
  hts10: null,
  priceMinor: '30000',
  shippingMinor: '2500',
  listingId: null,
  questions: { choices: [], exclusions: [] },
  answers: {},
  exclusionsApply: null,
  statements: [{ question: 'Jewels?', answer: 'Over 17 jewels', at: '2026-10-13T00:00:00.000Z' }],
  actions: [{ id: '1', action: 'accept', fromStatus: 'PENDING_REVIEW', toStatus: 'ACCEPTED', fromHts10: null, toHts10: '9102.21.70', reason: null, at: '2026-10-13T00:00:00.000Z', undone: true }],
  expanded: [{ code: '9102.21.70', chain: ['Wrist watches'] }],
  suggested: null,
  publish: { code: '9102.21.70', needsSplit: false, verifiedRate: true },
  quote: null,
};

const EMAIL = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const keys = (o: object) => Object.keys(o).sort();
/** The public detail: the input minus its stored error code (a failed run's error never leaves the server). */
const publicKeys = keys(detail).filter((k) => k !== 'error');
const publicDetail = Object.fromEntries(Object.entries(detail).filter(([k]) => k !== 'error'));

describe('public seller projections', () => {
  it('copy exactly the allowlisted keys; every extra field is dropped', () => {
    expect(keys(toPublicQueueRow({ ...queueRow, ...EXTRA }))).toEqual(keys(queueRow));
    expect(keys(toPublicLedgerRow({ ...ledgerRow, ...EXTRA }))).toEqual(keys(ledgerRow));
    const d = toPublicDetail({ ...detail, ...EXTRA, input: { ...detail.input, ...EXTRA }, actions: detail.actions.map((a) => ({ ...a, ...EXTRA })) });
    expect(keys(d)).toEqual(publicKeys);
    expect(keys(d.input)).toEqual(['description', 'origin', 'title']);
    expect(keys(d.actions[0]!)).toEqual(['action', 'at', 'fromHts10', 'fromStatus', 'id', 'reason', 'toHts10', 'toStatus', 'undone']);
  });

  it('values are kept as they are (no reformatting)', () => {
    expect(toPublicQueueRow({ ...queueRow, ...EXTRA })).toEqual(queueRow);
    expect(toPublicLedgerRow({ ...ledgerRow, ...EXTRA })).toEqual(ledgerRow);
    expect(toPublicDetail({ ...detail, ...EXTRA })).toEqual(publicDetail);
  });

  it('no forbidden key and no email-shaped string anywhere in the public payloads', () => {
    const payload = [toPublicQueueRow({ ...queueRow, ...EXTRA }), toPublicLedgerRow({ ...ledgerRow, ...EXTRA }), toPublicDetail({ ...detail, ...EXTRA, actions: detail.actions.map((a) => ({ ...a, by: 'a1b2' })) })];
    expect(forbiddenPaths(payload)).toEqual([]);
    expect(JSON.stringify(payload)).not.toMatch(EMAIL);
  });

  it('a failed run’s error (a code, or raw text in an older row) is never in the public detail', () => {
    for (const error of ['AI_UNAVAILABLE', 'Your credit balance is too low to access the Anthropic API.']) {
      const d = toPublicDetail({ ...detail, status: 'FAILED', error });
      expect('error' in d).toBe(false);
      expect(JSON.stringify(d)).not.toContain(error);
    }
  });

  it('forbiddenPaths finds forbidden keys at any depth', () => {
    expect(forbiddenPaths({ a: [{ b: { by: 'x' } }], sellerSession: 'y' })).toEqual(['a.0.b.by', 'sellerSession']);
    for (const k of FORBIDDEN_KEYS) expect(forbiddenPaths({ [k]: 1 })).toEqual([k]);
  });

  it('property: arbitrary extra keys never survive a projection', () => {
    const extra = fc.dictionary(
      fc.string({ minLength: 1, maxLength: 12 }).filter((k) => !(k in detail) && k !== '__proto__'),
      fc.jsonValue(),
    );
    fc.assert(
      fc.property(extra, (x) => {
        expect(keys(toPublicQueueRow({ ...queueRow, ...x } as PublicQueueRow))).toEqual(keys(queueRow));
        expect(keys(toPublicLedgerRow({ ...ledgerRow, ...x } as PublicLedgerRow))).toEqual(keys(ledgerRow));
        const d = toPublicDetail({ ...detail, ...x, actions: detail.actions.map((a) => ({ ...a, ...x })) } as PublicDetailInput);
        expect(keys(d)).toEqual(publicKeys);
        expect(keys(d.actions[0]!)).toEqual(keys(detail.actions[0]!));
      }),
    );
  });
});
