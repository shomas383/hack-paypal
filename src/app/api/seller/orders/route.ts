import { NextResponse } from 'next/server';
import { toJsonError } from '@/server/http';
import { requireSeller } from '@/server/seller/access';
import { ordersLedger } from '@/server/seller/ledger';

export const dynamic = 'force-dynamic';

/** GET → the orders and duty ledger (amounts from stored quotes; no buyer data). */
export async function GET() {
  try {
    await requireSeller();
    return NextResponse.json(await ordersLedger(), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return toJsonError(e);
  }
}