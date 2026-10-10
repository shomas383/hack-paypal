import { NextResponse } from 'next/server';
import { toJsonError } from '@/server/http';
import { requireSeller } from '@/server/seller/access';
import { acceptClassification } from '@/server/seller/review';

export const dynamic = 'force-dynamic';

/** POST → { actionId, detail }: the recorded "Accept classification" (undoable). */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const seller = await requireSeller();
    return NextResponse.json(await acceptClassification((await params).id, seller));
  } catch (e) {
    return toJsonError(e);
  }
}