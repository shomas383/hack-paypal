// Anonymous human session (httpOnly cookie). Its id is the "approvedBy" of approvals and scopes the session spend cap.
import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';

const NAME = 'landed_session';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export async function readSessionId(): Promise<string | undefined> {
  const v = (await cookies()).get(NAME)?.value;
  return v && UUID.test(v) ? v : undefined;
}

/** Route handlers / server actions only (setting a cookie). */
export async function ensureSessionId(): Promise<string> {
  const existing = await readSessionId();
  if (existing) return existing;
  const id = randomUUID();
  // Render serves HTTPS; locally `next dev` is plain http, so `secure` only in production.
  (await cookies()).set(NAME, id, { httpOnly: true, sameSite: 'lax', path: '/', secure: process.env.NODE_ENV === 'production' });
  return id;
}
