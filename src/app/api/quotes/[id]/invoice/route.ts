import { NextResponse } from 'next/server';
import { sendDdpInvoice } from '@/server/checkout';
import { toJsonError } from '@/server/http';
import { readSessionId } from '@/server/session';

/** POST { email? } — DDP invoice from the stored quote (duty as a labelled custom amount), then sends it. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sessionId = await readSessionId();
    if (!sessionId) return NextResponse.json({ error: 'no session' }, { status: 401 });
    const body = (await req.json().catch(() => ({}))) as { email?: unknown };
    return NextResponse.json(await sendDdpInvoice(id, sessionId, typeof body.email === 'string' ? body.email : undefined));
  } catch (e) {
    return toJsonError(e);
  }
}
