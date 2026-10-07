import { NextResponse, type NextRequest } from 'next/server';
import { createQuote } from '@/server/checkout';
import { toJsonError } from '@/server/http';
import { ensureSessionId } from '@/server/session';

/** POST /api/quotes — form (listingId) → 303 to the checkout page; JSON → { quoteId }. Amounts never come from the client. */
export async function POST(req: NextRequest) {
  try {
    const isForm = (req.headers.get('content-type') ?? '').includes('form');
    const listingId = isForm ? String((await req.formData()).get('listingId') ?? '') : String(((await req.json()) as { listingId?: unknown }).listingId ?? '');
    const sessionId = await ensureSessionId();
    const quote = await createQuote(listingId, sessionId);
    if (isForm) return NextResponse.redirect(new URL(`/checkout/${quote.id}`, req.url), 303);
    return NextResponse.json({ quoteId: quote.id });
  } catch (e) {
    return toJsonError(e);
  }
}
