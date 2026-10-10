import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutError } from '@/server/checkout';

const access = vi.hoisted(() => ({ sellerConsoleEnabled: vi.fn(() => true), signIn: vi.fn(), signOut: vi.fn(), requireSeller: vi.fn() }));
const classify = vi.hoisted(() => ({ startGroundedClassification: vi.fn(), runGroundedClassification: vi.fn(), getClassificationView: vi.fn() }));
const afterFn = vi.hoisted(() => vi.fn());
vi.mock('@/server/seller/access', () => access);
vi.mock('@/server/seller/classify', () => classify);
vi.mock('@/server/env', () => ({ serverEnv: () => ({ trustedProxyHops: 1 }) }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: afterFn }));

const { POST: signInRoute } = await import('./session/route');
const { POST: classifyRoute } = await import('./classifications/route');

const json = (body: unknown) => new Request('http://localhost/api/seller/x', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7, 10.0.0.1' }, body: JSON.stringify(body) });

describe('POST /api/seller/session', () => {
  beforeEach(() => vi.clearAllMocks());

  it('404 when the console is disabled (no passcode configured)', async () => {
    access.sellerConsoleEnabled.mockReturnValueOnce(false);
    expect((await signInRoute(json({ passcode: 'x' }))).status).toBe(404);
    expect(access.signIn).not.toHaveBeenCalled();
  });

  it('401 says how many attempts are left; 429 when locked', async () => {
    access.signIn.mockResolvedValueOnce({ ok: false, status: 401, attemptsLeft: 4 });
    const r401 = await signInRoute(json({ passcode: 'wrong' }));
    expect(r401.status).toBe(401);
    expect(await r401.json()).toEqual({ error: "That passcode isn't correct. 4 attempts left.", attemptsLeft: 4 });

    access.signIn.mockResolvedValueOnce({ ok: false, status: 429 });
    const r429 = await signInRoute(json({ passcode: 'wrong' }));
    expect(r429.status).toBe(429);
    expect(await r429.json()).toEqual({ error: 'Too many attempts. Try again in 15 minutes.' });
  });

  it('200 on success; the passcode never appears in the response', async () => {
    access.signIn.mockResolvedValueOnce({ ok: true });
    const r = await signInRoute(json({ passcode: 'correct horse battery staple' }));
    expect(r.status).toBe(200);
    expect(await r.text()).not.toContain('correct horse');
  });
});

describe('POST /api/seller/classifications', () => {
  beforeEach(() => vi.clearAllMocks());

  it('401 without a seller session — nothing is reserved or run', async () => {
    access.requireSeller.mockRejectedValueOnce(new CheckoutError(401, 'sign in to the seller console'));
    const r = await classifyRoute(json({ title: 'x' }));
    expect(r.status).toBe(401);
    expect(classify.startGroundedClassification).not.toHaveBeenCalled();
    expect(afterFn).not.toHaveBeenCalled();
  });

  it('202 { id } and the run is scheduled after the response', async () => {
    access.requireSeller.mockResolvedValueOnce('seller-1');
    classify.startGroundedClassification.mockResolvedValueOnce({ id: 'c-1' });
    const r = await classifyRoute(json({ title: 'Automatic diver watch', origin: 'JP', priceMinor: 30000, shippingMinor: 2500 }));
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ id: 'c-1' });
    expect(afterFn).toHaveBeenCalledTimes(1);
  });

  it('429 from the classifier rate limit is passed through', async () => {
    access.requireSeller.mockResolvedValueOnce('seller-1');
    classify.startGroundedClassification.mockRejectedValueOnce(new CheckoutError(429, 'too many classifier requests — try again later'));
    expect((await classifyRoute(json({ title: 'x' }))).status).toBe(429);
  });
});
