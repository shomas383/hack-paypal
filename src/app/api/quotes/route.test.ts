import { describe, expect, it, vi } from 'vitest';

vi.mock('@/server/checkout', () => ({
  CheckoutError: class extends Error {},
  createQuote: vi.fn(async () => ({ id: '3c0847ef-6a25-42de-9918-9499fd2ef865' })),
}));
vi.mock('@/server/session', () => ({ ensureSessionId: vi.fn(async () => 's-1') }));

const { POST } = await import('./route');

// Behind Render's proxy the request URL is the INTERNAL address (http://localhost:10000/…), never the public one.
const internal = (body: BodyInit, type: string) =>
  new Request('http://localhost:10000/api/quotes', { method: 'POST', headers: { 'content-type': type, host: 'localhost:10000', 'x-forwarded-host': 'evil.example' }, body });

describe('POST /api/quotes redirect', () => {
  it('form post → 303 with a RELATIVE Location (no host from the request, no X-Forwarded-Host)', async () => {
    const res = await POST(internal('listingId=L-P03', 'application/x-www-form-urlencoded') as never);
    expect(res.status).toBe(303);
    const location = res.headers.get('location');
    expect(location).toBe('/checkout/3c0847ef-6a25-42de-9918-9499fd2ef865');
    expect(location).not.toMatch(/localhost|evil\.example|^https?:/);
  });

  it('JSON post → { quoteId }, no redirect', async () => {
    const res = await POST(internal(JSON.stringify({ listingId: 'L-P03' }), 'application/json') as never);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ quoteId: '3c0847ef-6a25-42de-9918-9499fd2ef865' });
  });
});
