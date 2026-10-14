import { NextResponse } from 'next/server';
import { toJsonError } from '@/server/http';
import { publicDetail } from '@/server/seller/publicView';

export const dynamic = 'force-dynamic';

/**
 * GET → one classification's review detail, read-only and allowlisted (no "by"; 404 unless SELLER_PUBLIC_VIEW=1). Reads
 * only: an interrupted run is reported, not closed out.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    return NextResponse.json(await publicDetail(id), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return toJsonError(e);
  }
}
