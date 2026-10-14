// With the public read-only view ON, every seller write route still needs the owner's seller session: without one each
// answers 401 and no rule, model call or reservation runs (SPEC §4.5).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutError } from '@/server/checkout';

const access = vi.hoisted(() => ({ requireSeller: vi.fn() }));
const review = vi.hoisted(() => ({
  answerQuestions: vi.fn(),
  acceptClassification: vi.fn(),
  overrideClassification: vi.fn(),
  undoAction: vi.fn(),
  publishReviewed: vi.fn(),
  reviewQueue: vi.fn(),
  reviewDetail: vi.fn(),
}));
const classify = vi.hoisted(() => ({ startGroundedClassification: vi.fn(), runGroundedClassification: vi.fn(), getClassificationView: vi.fn() }));
const afterFn = vi.hoisted(() => vi.fn());
vi.mock('@/server/seller/access', () => access);
vi.mock('@/server/seller/review', () => review);
vi.mock('@/server/seller/classify', () => classify);
vi.mock('@/server/env', () => ({ serverEnv: () => ({ trustedProxyHops: 1, sellerPublicView: true }) }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: afterFn }));

const { POST: classifyRoute } = await import('./classifications/route');
const { POST: answers } = await import('./classifications/[id]/answers/route');
const { POST: accept } = await import('./classifications/[id]/accept/route');
const { POST: override } = await import('./classifications/[id]/override/route');
const { POST: undo } = await import('./classifications/[id]/undo/route');
const { POST: publish } = await import('./classifications/[id]/publish/route');

const ID = '0b7a5e1c-1111-4222-8333-444455556666';
const params = { params: Promise.resolve({ id: ID }) };
const post = (body: unknown) => new Request('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('seller write routes with SELLER_PUBLIC_VIEW=1', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    access.requireSeller.mockRejectedValue(new CheckoutError(401, 'sign in to the seller console'));
  });

  it('every write route answers 401 without the owner session, and nothing runs', async () => {
    const writes = [
      () => classifyRoute(post({ title: 'Automatic diver watch', origin: 'JP', priceMinor: 30000, shippingMinor: 2500 })),
      () => answers(post({ answers: {}, exclusionsApply: null }), params),
      () => accept(post({}), params),
      () => override(post({ hts10: '9102.21.70', reason: 'r' }), params),
      () => undo(post({ actionId: '1' }), params),
      () => publish(post({ valueSplit: null }), params),
    ];
    for (const w of writes) expect((await w()).status).toBe(401);
    expect(access.requireSeller).toHaveBeenCalledTimes(writes.length);
    for (const fn of [...Object.values(review), classify.startGroundedClassification, classify.runGroundedClassification, afterFn]) expect(fn).not.toHaveBeenCalled();
  });
});
