import { NextResponse } from 'next/server';
import { approveQuote } from '@/server/checkout';
import { toJsonError } from '@/server/http';
import { readSessionId } from '@/server/session';

/** POST — records the human Approve click for this quote (this session only). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const sessionId = await readSessionId();
    if (!sessionId) return NextResponse.json({ error: 'no session' }, { status: 401 });
    return NextResponse.json(await approveQuote(id, sessionId));
  } catch (e) {
    return toJsonError(e);
  }
}
