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
  /**
   * Public https origin (e.g. https://landed-hd19.onrender.com) for any absolute URL we must hand out. Optional and unused for
   * now (validated if set); never derived from the request, Host or X-Forwarded-Host. Redirects use relative paths instead.
   */
  publicBaseUrl?: string;
  /** X-Forwarded-For entries appended by trusted proxies, skipped from the right to find the client IP (Render: 1). */
  trustedProxyHops: number;
  /** Top-candidate confidence below this → human review (SPEC §4.1). A probability, not money. */
  classifierReviewThreshold: number;
  /** Buyer-agent run budget (checked before the first model call). IP limit = 2 × the session limit. */
  agentLimits: { perSessionPerHour: number; perIpPerHour: number; dailyCeiling: number };
  /** Classifier call budget (checked before any LLM call). */
  classifierLimits: { perSessionPerHour: number; perIpPerHour: number; dailyCeiling: number };
  /** Public /estimate budget (one row per estimate = 2 classifier calls; checked before any model call; own limits). */
  estimateLimits: { perSessionPerHour: number; perIpPerHour: number; dailyCeiling: number };
  /** Shared seller-console passcode (≥ 12 chars). Optional: without it /seller and /api/seller/* are 404. */
  sellerConsolePasscode?: string;
  /** SELLER_PUBLIC_VIEW=1: the public read-only seller view (/seller/demo, GET /api/seller/public/*). Off by default. */
  sellerPublicView: boolean;
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

function unitInterval(raw: RawEnv, name: string, fallback: number): number {
  const v = raw[name]?.trim();
  if (!v) return fallback;
  if (!/^(0(\.\d+)?|1(\.0+)?)$/.test(v)) throw new Error(`${name} must be a decimal between 0 and 1`);
  return Number(v);
}

/** Optional on/off switch: unset, empty or "0" → off; "1" → on; anything else refuses to boot. */
function flag(raw: RawEnv, name: string): boolean {
  const v = raw[name]?.trim();
  if (!v || v === '0') return false;
  if (v === '1') return true;
  throw new Error(`${name} must be 0 or 1`);
}

function publicBaseUrl(raw: RawEnv): string | undefined {
  const v = raw.PUBLIC_BASE_URL?.trim();
  // Optional until code hands out an absolute URL; then make it required for a production server (not during
  // `next build`, which also runs with NODE_ENV=production — skip when NEXT_PHASE === 'phase-production-build').
  if (!v) return undefined;
  const bad = new Error('PUBLIC_BASE_URL must be an https origin like https://example.onrender.com (no path, query or credentials)');
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    throw bad;
  }
  if (u.protocol !== 'https:' || u.username || u.password || u.search || u.hash || (u.pathname !== '/' && u.pathname !== '')) throw bad;
  return u.origin;
}

export function parseServerEnv(raw: RawEnv): ServerEnv {
  if (raw.PAYPAL_ENV !== 'sandbox') throw new Error("Refusing to start: PAYPAL_ENV must be 'sandbox'");
  const base = raw.PAYPAL_API_BASE?.trim() || SANDBOX_API_BASE;
  if (base !== SANDBOX_API_BASE) throw new Error(`Refusing to start: PAYPAL_API_BASE must be the sandbox base ${SANDBOX_API_BASE}`);
  const email = raw.PAYPAL_SANDBOX_BUYER_EMAIL?.trim();
  const webhookId = raw.PAYPAL_WEBHOOK_ID?.trim();
  const baseUrl = publicBaseUrl(raw);
  const passcode = raw.SELLER_CONSOLE_PASSCODE?.trim();
  if (passcode && passcode.length < 12) throw new Error('SELLER_CONSOLE_PASSCODE must be at least 12 characters');
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
    classifierReviewThreshold: unitInterval(raw, 'CLASSIFIER_REVIEW_THRESHOLD', 0.8),
    agentLimits: (() => {
      const perSession = positiveIntOr(raw, 'AGENT_LIMIT_PER_SESSION_PER_HOUR', 5);
      return { perSessionPerHour: perSession, perIpPerHour: perSession * 2, dailyCeiling: positiveIntOr(raw, 'AGENT_DAILY_CEILING', 30) };
    })(),
    classifierLimits: {
      perSessionPerHour: positiveIntOr(raw, 'CLASSIFIER_LIMIT_PER_SESSION_PER_HOUR', 10),
      perIpPerHour: positiveIntOr(raw, 'CLASSIFIER_LIMIT_PER_IP_PER_HOUR', 20),
      dailyCeiling: positiveIntOr(raw, 'CLASSIFIER_DAILY_CEILING', 200),
    },
    estimateLimits: {
      perSessionPerHour: positiveIntOr(raw, 'ESTIMATE_LIMIT_PER_SESSION_PER_HOUR', 5),
      perIpPerHour: positiveIntOr(raw, 'ESTIMATE_LIMIT_PER_IP_PER_HOUR', 10),
      dailyCeiling: positiveIntOr(raw, 'ESTIMATE_DAILY_CEILING', 100),
    },
    sellerPublicView: flag(raw, 'SELLER_PUBLIC_VIEW'),
    ...(email ? { sandboxBuyerEmail: email } : {}),
    ...(webhookId ? { paypalWebhookId: webhookId } : {}),
    ...(baseUrl ? { publicBaseUrl: baseUrl } : {}),
    ...(passcode ? { sellerConsolePasscode: passcode } : {}),
  };
}

let cached: ServerEnv | undefined;

/** Process env, parsed once. Server-only. */
export function serverEnv(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
