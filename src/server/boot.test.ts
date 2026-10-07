import { describe, expect, it } from 'vitest';
import { bootCheck } from './boot';

const SECRET = 'super-secret-value-123';
const valid = {
  PAYPAL_ENV: 'sandbox',
  PAYPAL_CLIENT_ID: 'client-id',
  PAYPAL_CLIENT_SECRET: SECRET,
  NEXT_PUBLIC_PAYPAL_CLIENT_ID: 'client-id',
  DATABASE_URL: 'postgres://landed:landed@localhost:5432/landed',
  SPEND_CAP_PER_ORDER_USD_MINOR: '40000',
  SPEND_CAP_PER_SESSION_USD_MINOR: '80000',
  QUOTE_TTL_SECONDS: '900',
};

describe('bootCheck (run at server startup by src/instrumentation.ts)', () => {
  it('passes a valid sandbox env', () => {
    expect(bootCheck(valid)).toEqual({ ok: true });
  });

  it('refuses to boot when PAYPAL_ENV is not sandbox', () => {
    const r = bootCheck({ ...valid, PAYPAL_ENV: 'live' });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/PAYPAL_ENV must be 'sandbox'/);
  });

  it('refuses to boot against the live API base', () => {
    const r = bootCheck({ ...valid, PAYPAL_API_BASE: 'https://api-m.paypal.com' });
    expect(!r.ok && r.message).toMatch(/sandbox base/);
  });

  it('never echoes a secret value in the message', () => {
    const r = bootCheck({ ...valid, PAYPAL_ENV: 'live', DATABASE_URL: '' });
    expect(!r.ok && r.message).not.toContain(SECRET);
  });
});
