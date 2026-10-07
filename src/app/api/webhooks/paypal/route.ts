import { NextResponse } from 'next/server';
import { handleWebhook } from '@/server/webhooks/handle';
import { webhookDeps } from '@/server/webhooks/deps';

/** POST /api/webhooks/paypal — verified, idempotent by event id, reconciliation only (never moves money). */
export async function POST(req: Request) {
  try {
    const raw = await req.text(); // the event exactly as delivered; parsed once inside handleWebhook
    const r = await handleWebhook(raw, (name) => req.headers.get(name), webhookDeps());
    return NextResponse.json(r.body, { status: r.status });
  } catch (e) {
    // Non-2xx makes PayPal redeliver later; the event id dedupe makes that safe.
    console.error('webhook error:', e instanceof Error ? e.message : e);
    return NextResponse.json({ error: 'webhook processing failed' }, { status: 500 });
  }
}
