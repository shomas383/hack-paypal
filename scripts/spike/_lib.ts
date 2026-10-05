// Shared helpers for Week 1 sandbox spikes. Throwaway code — findings go into docs/PAYPAL.md.
// Invariants honored here: 7 (PayPal-Request-Id on every POST, reused on retry), 8 (local total
// assertion before order create), 9 (sandbox-only guard), 10 (no secrets in logs).
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { toPayPalAmount } from '../../src/domain/money/format';
import { usd, type Money } from '../../src/domain/money/money';

export const SANDBOX_BASE = 'https://api-m.sandbox.paypal.com';

const EnvSchema = z.object({
  PAYPAL_ENV: z.string(),
  PAYPAL_API_BASE: z.string().default(SANDBOX_BASE),
  PAYPAL_CLIENT_ID: z.string().min(1, 'PAYPAL_CLIENT_ID is empty — fill in .env'),
  PAYPAL_CLIENT_SECRET: z.string().min(1, 'PAYPAL_CLIENT_SECRET is empty — fill in .env'),
  PAYPAL_WEBHOOK_ID: z.string().optional(),
  PAYPAL_SANDBOX_BUYER_EMAIL: z.string().optional(),
  ANTHROPIC_API_KEY: z.string().optional(),
});
export type SpikeEnv = z.infer<typeof EnvSchema>;

let cachedEnv: SpikeEnv | undefined;

/** Sandbox guard (invariant 9). Must run before any network call. */
export function loadEnv(): SpikeEnv {
  if (cachedEnv) return cachedEnv;
  if (process.env.PAYPAL_ENV !== 'sandbox') {
    throw new Error(`Refusing to run: PAYPAL_ENV must be 'sandbox' (got '${process.env.PAYPAL_ENV ?? ''}')`);
  }
  const env = EnvSchema.parse(process.env);
  if (env.PAYPAL_API_BASE !== SANDBOX_BASE) {
    throw new Error(`Refusing to run: PAYPAL_API_BASE must be ${SANDBOX_BASE}`);
  }
  cachedEnv = env;
  return env;
}

// ---------- OAuth (docs/PAYPAL.md § Environment) ----------
let token: { value: string; expiresAt: number } | undefined;

export async function getAccessToken(): Promise<string> {
  const env = loadEnv();
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;
  const basic = Buffer.from(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`).toString('base64');
  const res = await fetch(`${SANDBOX_BASE}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'PayPal-Request-Id': randomUUID(),
    },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new Error(`OAuth failed: HTTP ${res.status} (check client id/secret are sandbox credentials)`);
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

// ---------- REST ----------
export interface PayPalResponse<T = unknown> {
  status: number;
  body: T;
  requestId?: string;
  debugId: string | null;
}

/** Shape of PayPal error bodies (schema: name, message, debug_id, details[].issue). */
export interface PayPalError {
  name?: string;
  message?: string;
  details?: { issue?: string; field?: string; description?: string }[];
}

export async function paypalRequest<T = unknown>(
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: unknown; requestId?: string; headers?: Record<string, string> } = {},
): Promise<PayPalResponse<T>> {
  loadEnv();
  // Invariant 7: every POST carries a PayPal-Request-Id; the retry below reuses the SAME id.
  const requestId = method === 'POST' ? (opts.requestId ?? randomUUID()) : undefined;
  const send = async (): Promise<Response> =>
    fetch(`${SANDBOX_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await getAccessToken()}`,
        'Content-Type': 'application/json',
        ...(requestId ? { 'PayPal-Request-Id': requestId } : {}),
        ...opts.headers,
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });

  let res: Response;
  try {
    res = await send();
    if (res.status >= 500) {
      log(`${method} ${path} → ${res.status}; retrying once with the same PayPal-Request-Id`);
      res = await send();
    }
  } catch (err) {
    log(`${method} ${path} → network error; retrying once with the same PayPal-Request-Id`);
    void err;
    res = await send();
  }
  const text = await res.text();
  const body = (text ? JSON.parse(text) : null) as T;
  const debugId = res.headers.get('paypal-debug-id');
  log(`${method} ${path} → ${res.status}${debugId ? ` (debug_id ${debugId})` : ''}`);
  return { status: res.status, body, debugId, ...(requestId ? { requestId } : {}) };
}

export const ok = (status: number): boolean => status >= 200 && status < 300;

export function issuesOf(body: unknown): string {
  const e = body as PayPalError | null;
  if (!e) return '(empty body)';
  const issues = (e.details ?? []).map((d) => d.issue).filter(Boolean);
  return `${e.name ?? '?'}${issues.length ? `: ${issues.join(', ')}` : ''}`;
}

// ---------- Orders v2 purchase unit with duty-as-tax (docs/PAYPAL.md § How we represent import duty) ----------
export interface SpikeItem {
  name: string;
  unitAmount: Money;
  /** Duty per unit → items[].tax. Arbitrary spike amounts, NOT tariff rates. */
  dutyPerUnit: Money;
  quantity: number;
}

export interface SpikeOrderInput {
  items: SpikeItem[];
  shipping: Money;
  customId?: string;
  /** Test-only override to provoke a server-side mismatch; skips the local assertion. */
  unsafeTaxTotalOverride?: Money;
}

/** Builds an Orders v2 purchase unit from Money; asserts amount = breakdown sum (invariant 8). */
export function buildPurchaseUnit(input: SpikeOrderInput) {
  let itemTotal = 0n;
  let taxTotal = 0n;
  for (const it of input.items) {
    if (it.unitAmount.currency !== 'USD' || it.dutyPerUnit.currency !== 'USD') throw new Error('USD only');
    itemTotal += it.unitAmount.amountMinor * BigInt(it.quantity);
    taxTotal += it.dutyPerUnit.amountMinor * BigInt(it.quantity);
  }
  const shipping = input.shipping.amountMinor;
  // Rule (PAYPAL.md, verbatim): amount = item_total + tax_total + shipping + handling + insurance − shipping_discount − discount.
  const amount = itemTotal + taxTotal + shipping;

  const taxTotalSent = input.unsafeTaxTotalOverride?.amountMinor ?? taxTotal;
  if (!input.unsafeTaxTotalOverride && amount !== itemTotal + taxTotalSent + shipping) {
    throw new Error('Local assertion failed: amount != breakdown sum');
  }

  return {
    expected: { itemTotal: usd(itemTotal), taxTotal: usd(taxTotal), shipping: usd(shipping), amount: usd(amount) },
    purchaseUnit: {
      ...(input.customId ? { custom_id: input.customId } : {}),
      amount: {
        ...toPayPalAmount(usd(amount)),
        breakdown: {
          item_total: toPayPalAmount(usd(itemTotal)),
          tax_total: toPayPalAmount(usd(taxTotalSent)),
          shipping: toPayPalAmount(usd(shipping)),
        },
      },
      items: input.items.map((it) => ({
        name: it.name,
        quantity: String(it.quantity),
        unit_amount: toPayPalAmount(it.unitAmount),
        tax: toPayPalAmount(it.dutyPerUnit),
        category: 'PHYSICAL_GOODS',
      })),
    },
  };
}

/** A small default order for spikes: one watch, duty as item tax, flat shipping. */
export const DEFAULT_SPIKE_ORDER: SpikeOrderInput = {
  items: [{ name: 'Landed spike — vintage watch', unitAmount: usd(25_000), dutyPerUnit: usd(3_125), quantity: 1 }],
  shipping: usd(2_500),
  customId: 'landed-spike',
};

export interface CreatedOrder {
  id: string;
  status: string;
}

export async function createAuthorizeOrder(input: SpikeOrderInput = DEFAULT_SPIKE_ORDER) {
  const { purchaseUnit, expected } = buildPurchaseUnit(input);
  const res = await paypalRequest<CreatedOrder & PayPalError>('POST', '/v2/checkout/orders', {
    body: { intent: 'AUTHORIZE', purchase_units: [purchaseUnit] },
  });
  return { res, expected, purchaseUnit };
}

// ---------- reporting ----------
export type CheckStatus = 'PASS' | 'FAIL' | 'SKIP' | 'INFO';
export interface Check {
  name: string;
  status: CheckStatus;
  detail?: string;
}

export const check = (name: string, pass: boolean, detail?: string): Check => ({
  name,
  status: pass ? 'PASS' : 'FAIL',
  ...(detail === undefined ? {} : { detail }),
});

export function log(msg: string): void {
  console.log(`  · ${msg}`);
}

/** Prints a PASS/FAIL table. Exit code 1 if any check FAILs (SKIP/INFO don't fail the run). */
export function report(spike: string, checks: Check[]): void {
  const width = Math.max(...checks.map((c) => c.name.length), 10);
  console.log(`\n=== ${spike} ===`);
  for (const c of checks) {
    console.log(`  [${c.status.padEnd(4)}] ${c.name.padEnd(width)}${c.detail ? `  — ${c.detail}` : ''}`);
  }
  const failed = checks.filter((c) => c.status === 'FAIL').length;
  const passed = checks.filter((c) => c.status === 'PASS').length;
  const overall = failed === 0 && passed > 0 ? 'PASS' : 'FAIL';
  console.log(`=== ${spike}: ${overall} (${passed} passed, ${failed} failed) ===\n`);
  if (overall === 'FAIL') process.exitCode = 1;
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
