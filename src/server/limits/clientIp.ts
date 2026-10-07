// Client IP for rate limiting. The FIRST X-Forwarded-For entry is whatever the client sent (forgeable); the proxy in
// front of us appends the address it saw, so we take the RIGHTMOST entry.
// VERIFY on Render: no official docs; feedback.render.com/features/p/send-the-correct-xforwardedfor (2021) says Render
// "only appends" to a passed-in XFF. Confirm with DEBUG_CLIENT_IP=1 on /api/health after the first deploy.
import { isIP } from 'node:net';

export const UNKNOWN_IP = 'unknown';

export function clientIp(header: (name: string) => string | null): string {
  const xff = header('x-forwarded-for');
  if (!xff) return UNKNOWN_IP;
  const last = xff.split(',').pop()?.trim() ?? '';
  return isIP(last) ? last : UNKNOWN_IP;
}
