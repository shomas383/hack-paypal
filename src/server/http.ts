// Route-handler error mapping. PayPalError messages carry status + debug_id only (no tokens or bodies with secrets).
import { NextResponse } from 'next/server';
import { CheckoutError } from './checkout';
import { PayPalError } from './paypal/client';

export function toJsonError(e: unknown): NextResponse {
  if (e instanceof CheckoutError) return NextResponse.json({ error: e.message }, { status: e.status });
  if (e instanceof PayPalError) return NextResponse.json({ error: e.message }, { status: 502 });
  console.error('unhandled checkout error:', e instanceof Error ? e.message : e);
  return NextResponse.json({ error: 'internal error' }, { status: 500 });
}
