import { NextResponse } from 'next/server';
import { z } from 'zod';
import { toJsonError } from '@/server/http';
import { requireSeller } from '@/server/seller/access';
import { answerQuestions } from '@/server/seller/review';

export const dynamic = 'force-dynamic';

const Body = z.object({ answers: z.record(z.string().max(40), z.string().max(40)), exclusionsApply: z.boolean().nullable() }).strict();

/** POST { answers: { questionId: optionId } (questions the seller is not sure about are left out), exclusionsApply } → the detail after routing reruns in code. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const seller = await requireSeller();
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'send { answers, exclusionsApply }' }, { status: 400 });
    return NextResponse.json(await answerQuestions((await params).id, seller, parsed.data));
  } catch (e) {
    return toJsonError(e);
  }
}