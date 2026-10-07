import { NextResponse } from 'next/server';
import { bootCheck } from '@/server/boot';
import { clientIp } from '@/server/limits/clientIp';

export const dynamic = 'force-dynamic';

/** GET /api/health — Render health check: env is sandbox, DB answers, rate table loads. Never returns secrets. */
export async function GET(req: Request) {
  const boot = bootCheck(process.env);
  if (!boot.ok) return NextResponse.json({ ok: false, error: boot.message }, { status: 503 });
  // Temporary (DEBUG_CLIENT_IP=1): echo the caller's own X-Forwarded-For and the IP we would count, to verify on Render
  // that the rightmost hop is the real client IP. Unset after the check.
  const debug =
    process.env.DEBUG_CLIENT_IP === '1'
      ? { xForwardedFor: req.headers.get('x-forwarded-for'), countedIp: clientIp((n) => req.headers.get(n)) }
      : {};
  try {
    const { sql } = await import('@/server/db/client');
    const { currentRateTable } = await import('@/server/rates');
    await sql`select 1`;
    return NextResponse.json({ ok: true, paypalEnv: 'sandbox', rateVersion: currentRateTable().version, ...debug });
  } catch (e) {
    console.error('health check failed:', e instanceof Error ? e.message : e);
    return NextResponse.json({ ok: false, error: 'database or rate table unavailable' }, { status: 503 });
  }
}
