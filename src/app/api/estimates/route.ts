import { after, NextResponse } from 'next/server';
import { serverEnv } from '@/server/env';
import { runEstimate, startEstimate } from '@/server/estimates';
import { toJsonError } from '@/server/http';
import { clientIp } from '@/server/limits/clientIp';
import { sameOrigin } from '@/server/sameOrigin';
import { ensureSessionId } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * POST { title, details?, origin, sellingPriceMinor, shippingMinor?, quantity? } (strict) →
 * - 202 { id, cached: false }: the grounded classifier runs after the response; poll GET /api/estimates/<id>;
 * - 200 { id, cached: true }: an identical description and origin was classified in the last 24 h (no model call).
 * 403 cross-site; 400 invalid body; 422 origin not supported yet; 429 over the estimate rate limit; 503 the committed
 * estimate data is past its valid_until (needs a rebuild) — all before any model call.
 * Estimates are never charged and never become quotes.
 */
export async function POST(req: Request) {
  try {
    const env = serverEnv();
    if (!sameOrigin(req, env.publicBaseUrl)) return NextResponse.json({ error: 'cross-site request refused' }, { status: 403 });
    const body = (await req.json().catch(() => null)) as unknown;
    const sessionId = await ensureSessionId();
    const { id, cached } = await startEstimate(body, sessionId, clientIp((n) => req.headers.get(n), env.trustedProxyHops));
    if (cached) return NextResponse.json({ id, cached }, { status: 200 });
    after(() => runEstimate(id));
    return NextResponse.json({ id, cached }, { status: 202 });
  } catch (e) {
    return toJsonError(e);
  }
}
