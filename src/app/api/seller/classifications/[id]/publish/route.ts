import { NextResponse } from 'next/server';
import { z } from 'zod';
import { toJsonError } from '@/server/http';
import { requireSeller } from '@/server/seller/access';
import { publishReviewed } from '@/server/seller/review';

export const dynamic = 'force-dynamic';

const Body = z.object({ valueSplit: z.object({ caseMinor: z.number().int(), bandMinor: z.number().int() }).strict().nullable() }).strict();

/** POST { valueSplit } → the detail after the recorded Publish (case/band split required for component-reported lines). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const seller = await requireSeller();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'send { valueSplit }' }, { status: 400 });
    return NextResponse.json(await publishReviewed((await params).id, seller, parsed.data));
  } catch (e) {
    return toJsonError(e);
  }
}