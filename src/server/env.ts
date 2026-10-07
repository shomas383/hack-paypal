// Server environment. Boot fails unless the app is pointed at the PayPal SANDBOX (invariant 9).
// Error messages name the variable but never echo its value (invariant 10).
export const SANDBOX_API_BASE = 'https://api-m.sandbox.paypal.com';

export interface ServerEnv {
  paypalApiBase: string;
  paypalClientId: string;
  paypalClientSecret: string;
  publicPaypalClientId: string;
  databaseUrl: string;
  spendCapPerOrderMinor: bigint;
  spendCapPerSessionMinor: bigint;
  quoteTtlSeconds: number;
  /** Default invoice recipient (sandbox Personal account). Optional. */
  sandboxBuyerEmail?: string;
  /** Id of the registered sandbox webhook; without it the webhook route answers 503. Optional. */
  paypalWebhookId?: string;
  /** X-Forwarded-For entries appended by trusted proxies, skipped from the right to find the client IP (Render: 1). */
  trustedProxyHops: number;
  /** Classifier call budget (checked before any LLM call). */
  classifierLimits: { perSessionPerHour: number; perIpPerHour: number; dailyCeiling: number };
}

type RawEnv = Record<string, string | undefined>;

function required(raw: RawEnv, name: string): string {
  const v = raw[name];
  if (v === undefined || v.trim() === '') throw new Error(`${name} is not set (see .env.example)`);
  return v;
}

function positiveInt(raw: RawEnv, name: string): bigint {
  const v = required(raw, name);
  if (!/^\d+$/.test(v) || BigInt(v) <= 0n) throw new Error(`${name} must be a positive integer`);
  return BigInt(v);
}

/** Optional positive integer with a default (limits, not money). */
function positiveIntOr(raw: RawEnv, name: string, fallback: number): number {
  const v = raw[name]?.trim();
  if (!v) return fallback;
  if (!/^\d+$/.test(v) || Number(v) <= 0) throw new Error(`${name} must be a positive integer`);
  return Number(v);
}

export function parseServerEnv(raw: RawEnv): ServerEnv {
  if (raw.PAYPAL_ENV !== 'sandbox') throw new Error("Refusing to start: PAYPAL_ENV must be 'sandbox'");
  const base = raw.PAYPAL_API_BASE?.trim() || SANDBOX_API_BASE;
  if (base !== SANDBOX_API_BASE) throw new Error(`Refusing to start: PAYPAL_API_BASE must be the sandbox base ${SANDBOX_API_BASE}`);
  const email = raw.PAYPAL_SANDBOX_BUYER_EMAIL?.trim();
  const webhookId = raw.PAYPAL_WEBHOOK_ID?.trim();
  return {
    paypalApiBase: base,
    paypalClientId: required(raw, 'PAYPAL_CLIENT_ID'),
    paypalClientSecret: required(raw, 'PAYPAL_CLIENT_SECRET'),
    publicPaypalClientId: required(raw, 'NEXT_PUBLIC_PAYPAL_CLIENT_ID'),
    databaseUrl: required(raw, 'DATABASE_URL'),
    spendCapPerOrderMinor: positiveInt(raw, 'SPEND_CAP_PER_ORDER_USD_MINOR'),
    spendCapPerSessionMinor: positiveInt(raw, 'SPEND_CAP_PER_SESSION_USD_MINOR'),
    quoteTtlSeconds: Number(positiveInt(raw, 'QUOTE_TTL_SECONDS')),
    trustedProxyHops: positiveIntOr(raw, 'TRUSTED_PROXY_HOPS', 1),
    classifierLimits: {
      perSessionPerHour: positiveIntOr(raw, 'CLASSIFIER_LIMIT_PER_SESSION_PER_HOUR', 10),
      perIpPerHour: positiveIntOr(raw, 'CLASSIFIER_LIMIT_PER_IP_PER_HOUR', 20),
      dailyCeiling: positiveIntOr(raw, 'CLASSIFIER_DAILY_CEILING', 200),
    },
    ...(email ? { sandboxBuyerEmail: email } : {}),
    ...(webhookId ? { paypalWebhookId: webhookId } : {}),
  };
}

let cached: ServerEnv | undefined;

/** Process env, parsed once. Server-only. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
