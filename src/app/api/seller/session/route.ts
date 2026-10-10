import { NextResponse } from 'next/server';
import { z } from 'zod';
import { toJsonError } from '@/server/http';
import { clientIp } from '@/server/limits/clientIp';
import { serverEnv } from '@/server/env';
import { sellerConsoleEnabled, signIn, signOut } from '@/server/seller/access';

export const dynamic = 'force-dynamic';

const Body = z.object({ passcode: z.string().max(200) }).strict();

/** POST { passcode } → 200 (session cookie set) | 401 { error, attemptsLeft } | 429 | 404 when the console is disabled. */
export async function POST(req: Request) {
  try {
    if (!sellerConsoleEnabled()) return NextResponse.json({ error: 'not found' }, { status: 404 });
    const parsed = Body.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: 'send { passcode }' }, { status: 400 });
    const r = await signIn(parsed.data.passcode, clientIp((n) => req.headers.get(n), serverEnv().trustedProxyHops));
    if (r.ok) return NextResponse.json({ ok: true });
    if (r.status === 429) return NextResponse.json({ error: 'Too many attempts. Try again in 15 minutes.' }, { status: 429 });
    return NextResponse.json(
      { error: `That passcode isn't correct. ${r.attemptsLeft} ${r.attemptsLeft === 1 ? 'attempt' : 'attempts'} left.`, attemptsLeft: r.attemptsLeft },
      { status: 401 },
    );
  } catch (e) {
    return toJsonError(e);
  }
}

export async function DELETE() {
  try {
    if (!sellerConsoleEnabled()) return NextResponse.json({ error: 'not found' }, { status: 404 });
    await signOut();
    return NextResponse.json({ ok: true });
  } catch (e) {
    return toJsonError(e);
  }
}
