import { NextResponse } from 'next/server';
import { z } from 'zod';
import { toJsonError } from '@/server/http';
import { requireSeller } from '@/server/seller/access';
import { undoAction } from '@/server/seller/review';

export const dynamic = 'force-dynamic';

const Body = z.object({ actionId: z.string().max(20) }).strict();

/** POST { actionId } → the detail after the recorded accept / override is undone (never a publish). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const seller = await requireSeller();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'send { actionId }' }, { status: 400 });
    return NextResponse.json(await undoAction((await params).id, seller, parsed.data.actionId));
  } catch (e) {
    return toJsonError(e);
  }
}