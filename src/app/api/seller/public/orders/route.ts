import { NextResponse } from 'next/server';
import { toJsonError } from '@/server/http';
import { publicLedger } from '@/server/seller/publicView';

export const dynamic = 'force-dynamic';

/** GET → the orders and duty ledger, read-only and allowlisted (404 unless SELLER_PUBLIC_VIEW=1). No buyer data. */
export async function GET() {
  try {
    return NextResponse.json(await publicLedger(), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return toJsonError(e);
  }
}
