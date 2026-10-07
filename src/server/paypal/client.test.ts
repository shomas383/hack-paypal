import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const ENV = {
  PAYPAL_ENV: 'sandbox',
  PAYPAL_CLIENT_ID: 'id',
  PAYPAL_CLIENT_SECRET: 'secret',
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: 'id',
  DATABASE_URL: 'postgres://x',
  SPEND_CAP_PER_ORDER_USD_MINOR: '40000',
  SPEND_CAP_PER_SESSION_USD_MINOR: '80000',
  QUOTE_TTL_SECONDS: '900',
};

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** fetch mock: OAuth always succeeds; API calls answer from `api` in order. Returns the API calls made (not the token call). */
function mockFetch(api: (() => Response | Promise<Response>)[]) {
  const calls: { url: string; requestId: string | null }[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      if (url.endsWith('/v1/oauth2/token')) return json(200, { access_token: 't', expires_in: 3600 });
      calls.push({ url, requestId: new Headers(init.headers).get('PayPal-Request-Id') });
      const next = api.shift();
      if (!next) throw new Error('unexpected extra API call');
      return next();
    }),
  );
  return calls;
}

describe('paypalRequest retries', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('default: one retry after a 5xx, with the SAME PayPal-Request-Id', async () => {
    const calls = mockFetch([() => json(503, {}), () => json(201, { id: 'X' })]);
    const { paypalRequest } = await import('./client');
    await paypalRequest('POST', '/v2/checkout/orders', { body: {}, requestId: 'R-1' });
    expect(calls.map((c) => c.requestId)).toEqual(['R-1', 'R-1']);
  });

  it('retry: false — a 5xx is NOT resent (invoice create is not idempotent, spike f)', async () => {
    const calls = mockFetch([() => json(503, { name: 'INTERNAL_SERVER_ERROR' })]);
    const { paypalRequest, PayPalError } = await import('./client');
    await expect(paypalRequest('POST', '/v2/invoicing/invoices', { body: {}, requestId: 'R-2', retry: false })).rejects.toBeInstanceOf(PayPalError);
    expect(calls).toHaveLength(1);
  });

  it('retry: false — a network error is NOT resent', async () => {
    const calls = mockFetch([
      () => {
        throw new TypeError('fetch failed');
      },
    ]);
    const { paypalRequest } = await import('./client');
    await expect(paypalRequest('POST', '/v2/invoicing/invoices', { body: {}, requestId: 'R-3', retry: false })).rejects.toThrow(/fetch failed/);
    expect(calls).toHaveLength(1);
  });
});

describe('createInvoice', () => {
  beforeEach(() => {
    vi.resetModules();
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it('is never resent after a 5xx or a network error', async () => {
    const { buildQuoteFixture } = await import('./__fixtures__/quote');
    for (const fail of [() => json(500, {}), () => Promise.reject(new TypeError('fetch failed'))]) {
      vi.resetModules();
      const calls = mockFetch([fail]);
      const { createInvoice } = await import('./api');
      await expect(createInvoice(buildQuoteFixture(), 'b@example.com', 'R-4')).rejects.toBeTruthy();
      expect(calls.filter((c) => c.url.endsWith('/v2/invoicing/invoices'))).toHaveLength(1);
    }
  });
});
