import { NextResponse } from 'next/server';
import { toJsonError } from '@/server/http';
import { requireSeller } from '@/server/seller/access';
import { getClassificationView } from '@/server/seller/classify';

export const dynamic = 'force-dynamic';

/** GET → the classification's real progress and, when finished, its result (any signed-in seller session). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await requireSeller();
    const { id } = await params;
    return NextResponse.json(await getClassificationView(id), { headers: { 'cache-control': 'no-store' } });
  } catch (e) {
    return toJsonError(e);
  }
}
