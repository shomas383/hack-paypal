import { NextResponse } from 'next/server';
import { toJsonError } from '@/server/http';
import { publicQueue } from '@/server/seller/publicView';

export const dynamic = 'force-dynamic';

/** GET → the review queue, read-only and allowlisted (404 unless SELLER_PUBLIC_VIEW=1). No write route exists here. */
export async function GET() {
  try {
    return NextResponse.json(await publicQueue(), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return toJsonError(e);
  }
}
