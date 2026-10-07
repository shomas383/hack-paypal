import { NextResponse } from 'next/server';
import { bootCheck } from '@/server/boot';

export const dynamic = 'force-dynamic';

/** GET /api/health — Render health check: env is sandbox, DB answers, rate table loads. Never returns secrets. */
export async function GET() {
  const boot = bootCheck(process.env);
  if (!boot.ok) return NextResponse.json({ ok: false, error: boot.message }, { status: 503 });
  try {
    const { sql } = await import('@/server/db/client');
    const { currentRateTable } = await import('@/server/rates');
    await sql`select 1`;
    return NextResponse.json({ ok: true, paypalEnv: 'sandbox', rateVersion: currentRateTable().version });
  } catch (e) {
    console.error('health check failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: 'database or rate table unavailable' }, { status: 503 });
  }
}
