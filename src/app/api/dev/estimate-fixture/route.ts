import { NextResponse } from 'next/server';
import { EstimateAnswers } from '@/domain/estimator/request';
import { devToolsEnabled } from '@/server/devOnly';
import { fixtureView } from '@/server/estimateFixtures';

export const dynamic = 'force-dynamic';

const notFound = () => NextResponse.json({ error: 'not found' }, { status: 404 });

/** Dev only (404 in production): GET ?name=<fixture> → the fixture's estimate view, computed from the committed data. */
export async function GET(req: Request) {
  if (!devToolsEnabled()) return notFound();
  const v = fixtureView(new URL(req.url).searchParams.get('name') ?? '');
  return v ? NextResponse.json(v, { headers: { 'cache-control': 'no-store' } }) : notFound();
}

/** Dev only: POST ?name=<fixture> with the answers body of /api/estimates/<id>/answers → the recomputed view. */
export async function POST(req: Request) {
  if (!devToolsEnabled()) return notFound();
  const parsed = EstimateAnswers.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: 'invalid answers' }, { status: 400 });
  try {
    const v = fixtureView(new URL(req.url).searchParams.get('name') ?? '', parsed.data);
    return v ? NextResponse.json(v, { headers: { 'cache-control': 'no-store' } }) : notFound();
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'invalid answers' }, { status: 400 });
  }
}
