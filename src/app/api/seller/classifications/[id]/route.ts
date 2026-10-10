import { NextResponse } from 'next/server';
import { toJsonError } from '@/server/http';
import { requireSeller } from '@/server/seller/access';
import { reviewDetail } from '@/server/seller/review';

export const dynamic = 'force-dynamic';

/**
 * GET → the classification's real progress and, when finished, its result plus the review detail (questions built by
 * code, statements, audit trail, publish requirements). Any signed-in seller session.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSeller();
    const { id } = await params;
    return NextResponse.json(await reviewDetail(id), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return toJsonError(e);
  }
}
