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

describe('parseServerEnv — buyer-agent limits', () => {
  it('defaults to 5 runs per session per hour (IP: 2× that) and 30 per day', () => {
    expect(parseServerEnv(valid).agentLimits).toEqual({ perSessionPerHour: 5, perIpPerHour: 10, dailyCeiling: 30 });
  });

  it('reads AGENT_LIMIT_PER_SESSION_PER_HOUR and AGENT_DAILY_CEILING as positive integers', () => {
    expect(parseServerEnv({ ...valid, AGENT_LIMIT_PER_SESSION_PER_HOUR: '3', AGENT_DAILY_CEILING: '12' }).agentLimits).toEqual({ perSessionPerHour: 3, perIpPerHour: 6, dailyCeiling: 12 });
    expect(() => parseServerEnv({ ...valid, AGENT_DAILY_CEILING: '0' })).toThrow(/AGENT_DAILY_CEILING must be a positive integer/);
  });
});

describe('parseServerEnv — SELLER_CONSOLE_PASSCODE', () => {
  it('is optional (the seller console is a 404 without it)', () => {
    expect(parseServerEnv(valid).sellerConsolePasscode).toBeUndefined();
    expect(parseServerEnv({ ...valid, SELLER_CONSOLE_PASSCODE: '   ' }).sellerConsolePasscode).toBeUndefined();
  });

  it('needs at least 12 characters when set; the error never echoes the value', () => {
    expect(parseServerEnv({ ...valid, SELLER_CONSOLE_PASSCODE: 'long-enough-passcode' }).sellerConsolePasscode).toBe('long-enough-passcode');
    let message = '';
    try {
      parseServerEnv({ ...valid, SELLER_CONSOLE_PASSCODE: 'short123' });
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/SELLER_CONSOLE_PASSCODE must be at least 12 characters/);
    expect(message).not.toContain('short123');
  });
});

describe('parseServerEnv — CLASSIFIER_REVIEW_THRESHOLD', () => {
  it('defaults to 0.80 and reads a decimal in [0, 1]', () => {
    expect(parseServerEnv(valid).classifierReviewThreshold).toBe(0.8);
    expect(parseServerEnv({ ...valid, CLASSIFIER_REVIEW_THRESHOLD: '0.85' }).classifierReviewThreshold).toBe(0.85);
    expect(parseServerEnv({ ...valid, CLASSIFIER_REVIEW_THRESHOLD: '1' }).classifierReviewThreshold).toBe(1);
    expect(parseServerEnv({ ...valid, CLASSIFIER_REVIEW_THRESHOLD: '0' }).classifierReviewThreshold).toBe(0);
  });

  it('rejects values outside [0, 1] and non-numbers', () => {
    for (const bad of ['1.01', '-0.1', '80', 'high', '0.8.1']) {
      expect(() => parseServerEnv({ ...valid, CLASSIFIER_REVIEW_THRESHOLD: bad })).toThrow(/CLASSIFIER_REVIEW_THRESHOLD must be a decimal between 0 and 1/);
    }
  });
});

describe('parseServerEnv — PUBLIC_BASE_URL', () => {
  it('is optional, also in production (no code uses it yet), but validated whenever set', () => {
    expect(parseServerEnv(valid).publicBaseUrl).toBeUndefined();
    expect(parseServerEnv({ ...valid, NODE_ENV: 'production' }).publicBaseUrl).toBeUndefined();
    expect(() => parseServerEnv({ ...valid, NODE_ENV: 'production', PUBLIC_BASE_URL: 'http://x.test' })).toThrow(/https origin/);
  });

  it('accepts an https origin and normalises a trailing slash', () => {
    expect(parseServerEnv({ ...valid, NODE_ENV: 'production', PUBLIC_BASE_URL: 'https://landed-hd19.onrender.com/' }).publicBaseUrl).toBe(
      'https://landed-hd19.onrender.com',
    );
  });

  it('rejects http, a path, a query, credentials and non-URLs', () => {
    for (const bad of ['http://landed-hd19.onrender.com', 'https://x.onrender.com/app', 'https://x.onrender.com?a=1', 'https://u:p@x.onrender.com', 'landed-hd19.onrender.com']) {
      expect(() => parseServerEnv({ ...valid, PUBLIC_BASE_URL: bad })).toThrow(/PUBLIC_BASE_URL must be an https origin/);
    }
  });
});

describe('parseServerEnv — TRUSTED_PROXY_HOPS', () => {
  it('defaults to 1 (Render: one Cloudflare edge hop) and reads a positive integer', () => {
    expect(parseServerEnv(valid).trustedProxyHops).toBe(1);
    expect(parseServerEnv({ ...valid, TRUSTED_PROXY_HOPS: '2' }).trustedProxyHops).toBe(2);
    expect(() => parseServerEnv({ ...valid, TRUSTED_PROXY_HOPS: '0' })).toThrow(/TRUSTED_PROXY_HOPS must be a positive integer/);
  });
});

describe('parseServerEnv — estimate limits (public /estimate, its own budget)', () => {
  it('defaults when unset (5/session/hour, 10/IP/hour, 100/day)', () => {
    expect(parseServerEnv(valid).estimateLimits).toEqual({ perSessionPerHour: 5, perIpPerHour: 10, dailyCeiling: 100 });
  });
  it('reads ESTIMATE_LIMIT_PER_SESSION_PER_HOUR / _PER_IP_PER_HOUR / ESTIMATE_DAILY_CEILING', () => {
    const env = parseServerEnv({ ...valid, ESTIMATE_LIMIT_PER_SESSION_PER_HOUR: '2', ESTIMATE_LIMIT_PER_IP_PER_HOUR: '4', ESTIMATE_DAILY_CEILING: '20' });
    expect(env.estimateLimits).toEqual({ perSessionPerHour: 2, perIpPerHour: 4, dailyCeiling: 20 });
    expect(env.classifierLimits).toEqual({ perSessionPerHour: 10, perIpPerHour: 20, dailyCeiling: 200 }); // separate budgets
  });
});

describe('parseServerEnv — classifier limits', () => {
  it('defaults when unset (10/session/hour, 20/IP/hour, 200/day)', () => {
    expect(parseServerEnv(valid).classifierLimits).toEqual({ perSessionPerHour: 10, perIpPerHour: 20, dailyCeiling: 200 });
  });

  it('reads the three env vars as positive integers', () => {
    const env = parseServerEnv({ ...valid, CLASSIFIER_LIMIT_PER_SESSION_PER_HOUR: '3', CLASSIFIER_LIMIT_PER_IP_PER_HOUR: '5', CLASSIFIER_DAILY_CEILING: '50' });
    expect(env.classifierLimits).toEqual({ perSessionPerHour: 3, perIpPerHour: 5, dailyCeiling: 50 });
  });

  it('rejects zero, negatives and non-integers', () => {
    for (const bad of ['0', '-1', '2.5', 'ten']) {
      expect(() => parseServerEnv({ ...valid, CLASSIFIER_DAILY_CEILING: bad })).toThrow(/CLASSIFIER_DAILY_CEILING must be a positive integer/);
    }
  });
});

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
