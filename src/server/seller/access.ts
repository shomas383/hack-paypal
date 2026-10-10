// Seller console access (server). Passcode from env only; constant-time compare; failed attempts per IP limited
// (5 per 15 min); an httpOnly session cookie holding a random id, checked against seller_sessions (8 h expiry).
// Without SELLER_CONSOLE_PASSCODE the console doesn't exist (404).
import { randomUUID } from 'node:crypto';
import { and, count, eq, gt, gte } from 'drizzle-orm';
import { cookies } from 'next/headers';
import { LOGIN_WINDOW_MS, SELLER_SESSION_TTL_MS, loginGate, passcodeMatches } from '@/domain/seller/access';
import { CheckoutError } from '../checkout';
import { db } from '../db/client';
import { auditLog, sellerLoginAttempts, sellerSessions } from '../db/schema';
import { serverEnv } from '../env';

const COOKIE = 'landed_seller';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export function sellerConsoleEnabled(): boolean {
  return Boolean(serverEnv().sellerConsolePasscode);
}

export type SignInResult = { ok: true } | { ok: false; status: 401; attemptsLeft: number } | { ok: false; status: 429 };

export async function signIn(passcode: string, ip: string, now = new Date()): Promise<SignInResult> {
  const expected = serverEnv().sellerConsolePasscode;
  if (!expected) throw new CheckoutError(404, 'not found');
  const since = new Date(now.getTime() - LOGIN_WINDOW_MS);
  const [row] = await db
    .select({ n: count() })
    .from(sellerLoginAttempts)
    .where(and(eq(sellerLoginAttempts.ip, ip), eq(sellerLoginAttempts.ok, false), gte(sellerLoginAttempts.at, since)));
  const gate = loginGate(row?.n ?? 0);
  if (!gate.allowed) return { ok: false, status: 429 };

  const ok = passcodeMatches(passcode, expected);
  await db.insert(sellerLoginAttempts).values({ ip, ok, at: now });
  if (!ok) return { ok: false, status: 401, attemptsLeft: gate.attemptsLeft - 1 };

  const id = randomUUID();
  const expiresAt = new Date(now.getTime() + SELLER_SESSION_TTL_MS);
  await db.insert(sellerSessions).values({ id, createdAt: now, expiresAt });
  await db.insert(auditLog).values({ event: 'seller.signed_in', entity: 'seller_session', entityId: id, sessionId: null, data: {} });
  (await cookies()).set(COOKIE, id, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production', expires: expiresAt });
  return { ok: true };
}

/** The current seller session id, or null (no cookie, unknown, expired, or console disabled). */
export async function readSellerSession(now = new Date()): Promise<string | null> {
  if (!sellerConsoleEnabled()) return null;
  const id = (await cookies()).get(COOKIE)?.value;
  if (!id || !UUID.test(id)) return null;
  const [row] = await db.select({ id: sellerSessions.id }).from(sellerSessions).where(and(eq(sellerSessions.id, id), gt(sellerSessions.expiresAt, now)));
  return row?.id ?? null;
}

/** Route guard: 404 when the console is disabled, 401 without a valid seller session. */
export async function requireSeller(): Promise<string> {
  if (!sellerConsoleEnabled()) throw new CheckoutError(404, 'not found');
  const id = await readSellerSession();
  if (!id) throw new CheckoutError(401, 'sign in to the seller console');
  return id;
}

export async function signOut(): Promise<void> {
  const jar = await cookies();
  const id = jar.get(COOKIE)?.value;
  if (id && UUID.test(id)) await db.update(sellerSessions).set({ expiresAt: new Date() }).where(eq(sellerSessions.id, id));
  jar.delete(COOKIE);
}
