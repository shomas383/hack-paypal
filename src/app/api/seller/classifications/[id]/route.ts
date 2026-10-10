import { NextResponse } from 'next/server';
import { toJsonError } from '@/server/http';
import { requireSeller } from '@/server/seller/access';
import { getClassificationView } from '@/server/seller/classify';

export const dynamic = 'force-dynamic';

/** GET → the classification's real progress and, when finished, its result (this seller session only). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const seller = await requireSeller();
    const { id } = await params;
    return NextResponse.json(await getClassificationView(id, seller), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return toJsonError(e);
  }
}
