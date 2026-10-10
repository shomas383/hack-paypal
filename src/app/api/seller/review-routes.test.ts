import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutError } from '@/server/checkout';

const access = vi.hoisted(() => ({ requireSeller: vi.fn(async () => 'seller-1') }));
const review = vi.hoisted(() => ({
  answerQuestions: vi.fn(async () => ({ ok: 'detail' })),
  acceptClassification: vi.fn(async () => ({ actionId: '7', detail: {} })),
  overrideClassification: vi.fn(async () => ({ actionId: '8', detail: {} })),
  undoAction: vi.fn(async () => ({})),
  publishReviewed: vi.fn(async () => ({})),
  reviewQueue: vi.fn(async () => []),
}));
const ledger = vi.hoisted(() => ({ ordersLedger: vi.fn(async () => []) }));
vi.mock('@/server/seller/access', () => access);
vi.mock('@/server/seller/review', () => review);
vi.mock('@/server/seller/ledger', () => ledger);
vi.mock('@/server/env', () => ({ serverEnv: () => ({ trustedProxyHops: 1 }) }));

const { POST: answers } = await import('./classifications/[id]/answers/route');
const { POST: accept } = await import('./classifications/[id]/accept/route');
const { POST: override } = await import('./classifications/[id]/override/route');
const { POST: undo } = await import('./classifications/[id]/undo/route');
const { POST: publish } = await import('./classifications/[id]/publish/route');
const { GET: orders } = await import('./orders/route');

const ID = '0b7a5e1c-1111-4222-8333-444455556666';
const params = { params: Promise.resolve({ id: ID }) };
const post = (body: unknown) => new Request('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('seller review routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('every route needs a seller session (401 → nothing runs)', async () => {
    for (const call of [() => accept(post({}), params), () => answers(post({ answers: {}, exclusionsApply: null }), params), () => orders()]) {
      access.requireSeller.mockRejectedValueOnce(new CheckoutError(401, 'sign in to the seller console'));
      expect((await call()).status).toBe(401);
    }
    expect(review.acceptClassification).not.toHaveBeenCalled();
    expect(review.answerQuestions).not.toHaveBeenCalled();
    expect(ledger.ordersLedger).not.toHaveBeenCalled();
  });

  it('bodies are validated strictly (no amounts, no extra fields)', async () => {
    expect((await override(post({ hts10: '6203.42.4511' }), params)).status).toBe(400);
    expect((await override(post({ hts10: '6203.42.4511', reason: 'r', priceMinor: 1 }), params)).status).toBe(400);
    expect((await publish(post({ valueSplit: { caseMinor: 1.5, bandMinor: 2 } }), params)).status).toBe(400);
    expect((await undo(post({}), params)).status).toBe(400);
    expect(review.overrideClassification).not.toHaveBeenCalled();
  });

  it('passes the seller session and the parsed body to the rules; 409 from the rules is passed through', async () => {
    await override(post({ hts10: '6203.42.4511', reason: 'Blue denim, per the seller' }), params);
    expect(review.overrideClassification).toHaveBeenCalledWith(ID, 'seller-1', { hts10: '6203.42.4511', reason: 'Blue denim, per the seller' });
    review.publishReviewed.mockRejectedValueOnce(new CheckoutError(409, 'Accept or override the code before publishing.'));
    const r = await publish(post({ valueSplit: null }), params);
    expect(r.status).toBe(409);
    expect(await r.json()).toEqual({ error: 'Accept or override the code before publishing.' });
  });
});
