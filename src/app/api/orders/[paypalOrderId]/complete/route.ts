import { NextResponse } from 'next/server';
import { completePayPalOrder } from '@/server/checkout';
import { toJsonError } from '@/server/http';
import { readSessionId } from '@/server/session';

/** POST — after buyer approval in PayPal: verify, authorize, run the policy gate, then capture or void. */
export async function POST(_req: Request, { params }: { params: Promise<{ paypalOrderId: string }> }) {
  try {
    const { paypalOrderId } = await params;
    return NextResponse.json(await completePayPalOrder(paypalOrderId, await readSessionId()));
  } catch (e) {
    return toJsonError(e);
  }
}
