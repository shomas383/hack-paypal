import { NextResponse } from 'next/server';
import { getEstimate } from '@/server/estimates';
import { toJsonError } from '@/server/http';
import { readSessionId } from '@/server/session';

export const dynamic = 'force-dynamic';

/**
 * GET → the estimate: real progress while classifying; when ready, each candidate line with its estimate (verified rate row
 * first, else the automated estimator) or why it can't be estimated. Only the session that created it; anyone else gets 404.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await getEstimate(id, await readSessionId()), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return toJsonError(e);
  }
}
