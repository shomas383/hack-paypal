import { after, NextResponse } from 'next/server';
import { toJsonError } from '@/server/http';
import { clientIp } from '@/server/limits/clientIp';
import { serverEnv } from '@/server/env';
import { requireSeller } from '@/server/seller/access';
import { runGroundedClassification, startGroundedClassification } from '@/server/seller/classify';
import { reviewQueue } from '@/server/seller/review';

export const dynamic = 'force-dynamic';

/** GET → the review queue: every grounded classification, most recently changed first. */
export async function GET() {
  try {
    await requireSeller();
    return NextResponse.json(await reviewQueue(), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return toJsonError(e);
  }
}

/**
 * POST { title, description?, origin, priceMinor, shippingMinor } → 202 { id }. The grounded classifier runs after the
 * response; poll GET /api/seller/classifications/<id> for its real progress. 401 without a seller session; 429 over the
 * classifier rate limit (checked before any model call).
 */
export async function POST(req: Request) {
  try {
    const seller = await requireSeller();
    const body = (await req.json().catch(() => null)) as unknown;
    const { id } = await startGroundedClassification(body, seller, clientIp((n) => req.headers.get(n), serverEnv().trustedProxyHops));
    after(() => runGroundedClassification(id));
    return NextResponse.json({ id }, { status: 202 });
  } catch (e) {
    return toJsonError(e);
  }
}
