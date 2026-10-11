import { NextResponse } from 'next/server';
import { serverEnv } from '@/server/env';
import { answerEstimate } from '@/server/estimates';
import { toJsonError } from '@/server/http';
import { sameOrigin } from '@/server/sameOrigin';
import { readSessionId } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * POST { facts?: { <fact>: boolean }, valueSplit?: { caseMinor, bandMinor }, quantity? } (strict) → the recomputed estimate.
 * Code only — no model call. Owner session only (404 otherwise); 409 while still classifying; 403 cross-site.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (!sameOrigin(req, serverEnv().publicBaseUrl)) return NextResponse.json({ error: 'cross-site request refused' }, { status: 403 });
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as unknown;
    return NextResponse.json(await answerEstimate(id, await readSessionId(), body), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return toJsonError(e);
  }
}
