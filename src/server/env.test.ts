import { describe, expect, it } from 'vitest';
import { parseServerEnv } from './env';

const SECRET = 'super-secret-value-123';
const valid = {
  PAYPAL_ENV: 'sandbox',
  PAYPAL_API_BASE: 'https://api-m.sandbox.paypal.com',
  PAYPAL_CLIENT_ID: 'client-id',
  PAYPAL_CLIENT_SECRET: SECRET,
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: 'client-id',
  DATABASE_URL: 'postgres://landed:landed@localhost:5432/landed',
  SPEND_CAP_PER_ORDER_USD_MINOR: '40000',
  SPEND_CAP_PER_SESSION_USD_MINOR: '80000',
  QUOTE_TTL_SECONDS: '900',
};

describe('parseServerEnv', () => {
  it('reads the optional webhook id', () => {
    expect(parseServerEnv(valid).paypalWebhookId).toBeUndefined();
    expect(parseServerEnv({ ...valid, PAYPAL_WEBHOOK_ID: ' WH-ID ' }).paypalWebhookId).toBe('WH-ID');
  });

  it('parses a valid sandbox env; caps are integer minor units', () => {
    const env = parseServerEnv(valid);
    expect(env.spendCapPerOrderMinor).toBe(40_000n);
    expect(env.spendCapPerSessionMinor).toBe(80_000n);
    expect(env.quoteTtlSeconds).toBe(900);
    expect(env.paypalApiBase).toBe('https://api-m.sandbox.paypal.com');
    expect(env.sandboxBuyerEmail).toBeUndefined();
  });

  it('defaults the API base to sandbox', () => {
    const { PAYPAL_API_BASE: _drop, ...rest } = valid;
    void _drop;
    expect(parseServerEnv(rest).paypalApiBase).toBe('https://api-m.sandbox.paypal.com');
  });

  it('refuses to boot unless PAYPAL_ENV is sandbox (invariant 9)', () => {
    expect(() => parseServerEnv({ ...valid, PAYPAL_ENV: 'live' })).toThrow(/sandbox/);
    expect(() => parseServerEnv({ ...valid, PAYPAL_ENV: undefined })).toThrow(/sandbox/);
  });

  it('refuses a non-sandbox API base', () => {
    expect(() => parseServerEnv({ ...valid, PAYPAL_API_BASE: 'https://api-m.paypal.com' })).toThrow(/sandbox/);
  });

  it('rejects non-integer or non-positive caps and TTL', () => {
    expect(() => parseServerEnv({ ...valid, SPEND_CAP_PER_ORDER_USD_MINOR: '400.00' })).toThrow(/SPEND_CAP_PER_ORDER_USD_MINOR/);
    expect(() => parseServerEnv({ ...valid, SPEND_CAP_PER_SESSION_USD_MINOR: '0' })).toThrow(/SPEND_CAP_PER_SESSION_USD_MINOR/);
    expect(() => parseServerEnv({ ...valid, QUOTE_TTL_SECONDS: 'abc' })).toThrow(/QUOTE_TTL_SECONDS/);
  });

  it('names a missing variable without echoing any secret value (invariant 10)', () => {
    let message = '';
    try {
      parseServerEnv({ ...valid, PAYPAL_CLIENT_ID: '' });
    } catch (e) {
      message = e instanceof Error ? e.message : String(e);
    }
    expect(message).toMatch(/PAYPAL_CLIENT_ID/);
    expect(message).not.toContain(SECRET);
  });
});
