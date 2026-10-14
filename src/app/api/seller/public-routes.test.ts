// The public read-only seller API (SPEC §4.5): GET only, 404 unless SELLER_PUBLIC_VIEW=1, allowlisted payloads, and the
// detail is read without the interrupted-run close-out (no write on a public read).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { forbiddenPaths } from '@/domain/seller/publicView';

const env = vi.hoisted(() => ({ on: false }));
const access = vi.hoisted(() => ({ requireSeller: vi.fn() }));
const EXTRA = { by: 'a1b2', sellerSession: 'sess', sessionId: 's-1', ip: '203.0.113.7', email: 'buyer@example.com', callId: '7' };
const review = vi.hoisted(() => ({ reviewQueue: vi.fn(), reviewDetail: vi.fn() }));
const ledger = vi.hoisted(() => ({ ordersLedger: vi.fn() }));
vi.mock('@/server/env', () => ({ serverEnv: () => ({ sellerPublicView: env.on }) }));
vi.mock('@/server/seller/access', () => access);
vi.mock('@/server/seller/review', () => review);
vi.mock('@/server/seller/ledger', () => ledger);

const queueMod = await import('./public/queue/route');
const ordersMod = await import('./public/orders/route');
const detailMod = await import('./public/classifications/[id]/route');

const ID = '0b7a5e1c-1111-4222-8333-444455556666';
const get = () => new Request('http://localhost/api/seller/public/x');
const params = { params: Promise.resolve({ id: ID }) };
const calls = [() => queueMod.GET(), () => ordersMod.GET(), () => detailMod.GET(get(), params)];

const queueRow = { id: ID, title: 'Automatic diver watch', origin: 'JP', topCode: '9102.21.70', hts10: null, confidence: 0.55, reasons: [], status: 'PENDING_REVIEW', answered: 0, questions: 1, updatedAt: '2026-10-13T00:00:00.000Z' };
const ledgerRow = { orderId: 'o-1', date: '2026-10-07T00:00:00.000Z', listingId: 'L-P03', title: 'Automatic diver watch', goodsMinor: '30000', shippingMinor: '2500', dutyMinor: '3750', totalMinor: '36250', hts10: '9102.21.70', ch99: [], rateVersion: '2026-rev21-v2', status: 'CAPTURED', paypalOrderId: 'PAYPALORDER1' };
const detailRow = {
  id: ID, status: 'PENDING_REVIEW', progress: { state: 'done', steps: [] }, input: { title: 'Automatic diver watch', origin: 'JP' }, error: null, reasons: [], threshold: 0.8, top: null, others: [], separatingAttributes: [],
  hts10: null, priceMinor: '30000', shippingMinor: '2500', listingId: null, questions: { choices: [], exclusions: [] }, answers: {}, exclusionsApply: null, statements: [],
  actions: [{ id: '1', action: 'accept', fromStatus: 'PENDING_REVIEW', toStatus: 'ACCEPTED', fromHts10: null, toHts10: '9102.21.70', reason: null, at: '2026-10-13T00:00:00.000Z', undone: false, by: 'a1b2' }],
  expanded: [], suggested: null, publish: { code: null, needsSplit: false, verifiedRate: false }, quote: null,
};

describe('public seller API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    review.reviewQueue.mockResolvedValue([{ ...queueRow, ...EXTRA }]);
    ledger.ordersLedger.mockResolvedValue([{ ...ledgerRow, ...EXTRA }]);
    review.reviewDetail.mockResolvedValue({ ...detailRow, ...EXTRA });
  });

  it('404 for every route while SELLER_PUBLIC_VIEW is off; nothing is read', async () => {
    env.on = false;
    for (const call of calls) expect((await call()).status).toBe(404);
    expect(review.reviewQueue).not.toHaveBeenCalled();
    expect(review.reviewDetail).not.toHaveBeenCalled();
    expect(ledger.ordersLedger).not.toHaveBeenCalled();
  });

  it('200 with no-store when on; no seller session is needed or created', async () => {
    env.on = true;
    for (const call of calls) {
      const r = await call();
      expect(r.status).toBe(200);
      expect(r.headers.get('cache-control')).toBe('no-store');
    }
    expect(access.requireSeller).not.toHaveBeenCalled();
  });

  it('payloads are allowlisted: no forbidden key, no email, no "by" in the audit trail', async () => {
    env.on = true;
    const bodies = await Promise.all(calls.map(async (c) => (await c()).json()));
    expect(forbiddenPaths(bodies)).toEqual([]);
    expect(JSON.stringify(bodies)).not.toMatch(/@/);
    expect(bodies[0]).toEqual([queueRow]);
    expect(bodies[1]).toEqual([ledgerRow]);
    const action = Object.fromEntries(Object.entries(detailRow.actions[0]!).filter(([k]) => k !== 'by'));
    expect(bodies[2]).toEqual({ ...detailRow, actions: [action] });
  });

  it('the detail is read with readOnly (no interrupted-run close-out write)', async () => {
    env.on = true;
    await detailMod.GET(get(), params);
    expect(review.reviewDetail).toHaveBeenCalledWith(ID, { readOnly: true });
  });

  it('the modules export GET only (no write method exists)', () => {
    for (const mod of [queueMod, ordersMod, detailMod] as Record<string, unknown>[]) {
      for (const m of ['POST', 'PUT', 'PATCH', 'DELETE']) expect(mod[m]).toBeUndefined();
      expect(typeof mod.GET).toBe('function');
    }
  });
});
