// Thin PayPal REST client (sandbox only). Every POST carries a PayPal-Request-Id supplied by the caller, who persists
// it before the call so a retry reuses the same id (invariant 7). Tokens and secrets are never logged (invariant 10).
import { randomUUID } from 'node:crypto';
import { serverEnv } from '../env';

export interface PayPalResponse<T = unknown> {
  status: number;
  body: T;
  debugId: string | null;
}

export interface PayPalErrorBody {
  name?: string;
  message?: string;
  details?: { issue?: string; description?: string }[];
}

export class PayPalError extends Error {
  constructor(
    readonly status: number,
    readonly body: PayPalErrorBody | null,
    readonly debugId: string | null,
  ) {
    const issues = (body?.details ?? []).map((d) => d.issue).filter(Boolean).join(', ');
    super(`PayPal ${status} ${body?.name ?? ''}${issues ? `: ${issues}` : ''}${debugId ? ` (debug_id ${debugId})` : ''}`);
  }
}

let token: { value: string; expiresAt: number } | undefined;

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt - 60_000) return token.value;
  const env = serverEnv();
  const basic = Buffer.from(`${env.paypalClientId}:${env.paypalClientSecret}`).toString('base64');
  const res = await fetch(`${env.paypalApiBase}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', 'PayPal-Request-Id': randomUUID() },
    body: 'grant_type=client_credentials',
  });
  if (!res.ok) throw new PayPalError(res.status, null, res.headers.get('paypal-debug-id'));
  const json = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: json.access_token, expiresAt: Date.now() + json.expires_in * 1000 };
  return token.value;
}

/** POST requires a requestId; one retry on network error / 5xx with the SAME id. Non-2xx throws PayPalError. */
export async function paypalRequest<T>(
  method: 'GET' | 'POST',
  path: string,
  opts: { body?: unknown; requestId?: string } = {},
): Promise<PayPalResponse<T>> {
  if (method === 'POST' && !opts.requestId) throw new Error(`POST ${path} needs a persisted PayPal-Request-Id`);
  const base = serverEnv().paypalApiBase;
  const send = async (): Promise<Response> =>
    fetch(`${base}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${await accessToken()}`,
        'Content-Type': 'application/json',
        ...(method === 'POST' ? { 'PayPal-Request-Id': opts.requestId! } : {}),
      },
      ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
    });

  let res: Response;
  try {
    res = await send();
    if (res.status >= 500) res = await send();
  } catch {
    res = await send();
  }
  const text = await res.text();
  const body = (text ? JSON.parse(text) : null) as T;
  const debugId = res.headers.get('paypal-debug-id');
  if (res.status < 200 || res.status >= 300) throw new PayPalError(res.status, body as PayPalErrorBody, debugId);
  return { status: res.status, body, debugId };
}
