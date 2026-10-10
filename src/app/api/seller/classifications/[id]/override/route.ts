import { NextResponse } from 'next/server';
import { z } from 'zod';
import { toJsonError } from '@/server/http';
import { requireSeller } from '@/server/seller/access';
import { overrideClassification } from '@/server/seller/review';

export const dynamic = 'force-dynamic';

const Body = z.object({ hts10: z.string().max(20), reason: z.string().max(500) }).strict();

/** POST { hts10, reason } → { actionId, detail }: only a code from this run's expanded Rev 20 lines, with a reason. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const seller = await requireSeller();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'send { hts10, reason }' }, { status: 400 });
    return NextResponse.json(await overrideClassification((await params).id, seller, parsed.data));
  } catch (e) {
    return toJsonError(e);
  }
}