import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutError } from '@/server/checkout';

const svc = vi.hoisted(() => ({ startEstimate: vi.fn(), runEstimate: vi.fn(), getEstimate: vi.fn(), answerEstimate: vi.fn() }));
const session = vi.hoisted(() => ({ ensureSessionId: vi.fn(async () => 'sess-1'), readSessionId: vi.fn(async () => 'sess-1') }));
const afterFn = vi.hoisted(() => vi.fn());
vi.mock('@/server/estimates', () => svc);
vi.mock('@/server/session', () => session);
vi.mock('@/server/env', () => ({ serverEnv: () => ({ trustedProxyHops: 1 }) }));
vi.mock('next/server', async (orig) => ({ ...(await orig<typeof import('next/server')>()), after: afterFn }));

const { POST: create } = await import('./route');
const { GET: read } = await import('./[id]/route');
const { POST: answer } = await import('./[id]/answers/route');

const post = (url: string, body: unknown, origin: string | null = 'http://localhost') =>
  new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7, 10.0.0.1', ...(origin ? { origin } : {}) }, body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });
const body = { title: 'Seiko automatic diver watch', origin: 'JP', sellingPriceMinor: 30000 };

describe('POST /api/estimates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('403 without an Origin header or from another site — nothing is reserved', async () => {
    expect((await create(post('http://localhost/api/estimates', body, null))).status).toBe(403);
    expect((await create(post('http://localhost/api/estimates', body, 'https://evil.example'))).status).toBe(403);
    expect(svc.startEstimate).not.toHaveBeenCalled();
  });

  it('202 { id, cached: false }: the classifier runs after the response; client IP from the trusted hop', async () => {
    svc.startEstimate.mockResolvedValueOnce({ id: 'e-1', cached: false });
    const r = await create(post('http://localhost/api/estimates', body));
    expect(r.status).toBe(202);
    expect(await r.json()).toEqual({ id: 'e-1', cached: false });
    expect(svc.startEstimate).toHaveBeenCalledWith(body, 'sess-1', '203.0.113.7');
    expect(afterFn).toHaveBeenCalledTimes(1);
  });

  it('200 { id, cached: true } for an identical description within 24 h — no run is scheduled', async () => {
    svc.startEstimate.mockResolvedValueOnce({ id: 'e-2', cached: true });
    const r = await create(post('http://localhost/api/estimates', body));
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ id: 'e-2', cached: true });
    expect(afterFn).not.toHaveBeenCalled();
  });

  it('400 / 422 / 429 from the service pass through with their message; nothing is scheduled', async () => {
    for (const [status, msg] of [[400, 'invalid estimate request: title'], [422, 'Estimates are available for goods made in JP or DE for now.'], [429, 'too many estimate requests — try again later']] as const) {
      svc.startEstimate.mockRejectedValueOnce(new CheckoutError(status, msg));
      const r = await create(post('http://localhost/api/estimates', body));
      expect(r.status).toBe(status);
      expect(await r.json()).toEqual({ error: msg });
    }
    expect(afterFn).not.toHaveBeenCalled();
  });
});

describe('GET /api/estimates/<id>', () => {
  beforeEach(() => vi.clearAllMocks());

  it("the owner's estimate, never cached by the browser", async () => {
    svc.getEstimate.mockResolvedValueOnce({ id: 'e-1', status: 'READY', candidates: [] });
    const r = await read(new Request('http://localhost/api/estimates/e-1'), params('e-1'));
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(svc.getEstimate).toHaveBeenCalledWith('e-1', 'sess-1');
  });

  it('another session gets 404 (the service decides; the route passes it through)', async () => {
    session.readSessionId.mockResolvedValueOnce('someone-else');
    svc.getEstimate.mockRejectedValueOnce(new CheckoutError(404, 'estimate not found'));
    const r = await read(new Request('http://localhost/api/estimates/e-1'), params('e-1'));
    expect(r.status).toBe(404);
    expect(svc.getEstimate).toHaveBeenCalledWith('e-1', 'someone-else');
  });
});

describe('POST /api/estimates/<id>/answers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('403 cross-site; 200 with the recomputed view; 409 while classifying', async () => {
    expect((await answer(post('http://localhost/api/estimates/e-1/answers', { facts: { civil_aircraft: true } }, 'https://evil.example'), params('e-1'))).status).toBe(403);
    svc.answerEstimate.mockResolvedValueOnce({ id: 'e-1', status: 'READY' });
    const ok = await answer(post('http://localhost/api/estimates/e-1/answers', { facts: { civil_aircraft: true } }), params('e-1'));
    expect(ok.status).toBe(200);
    expect(svc.answerEstimate).toHaveBeenCalledWith('e-1', 'sess-1', { facts: { civil_aircraft: true } });
    svc.answerEstimate.mockRejectedValueOnce(new CheckoutError(409, 'the estimate is not ready yet'));
    expect((await answer(post('http://localhost/api/estimates/e-1/answers', {}), params('e-1'))).status).toBe(409);
  });
});
