// Client IP for rate limiting. Leading X-Forwarded-For entries are whatever the client sent (forgeable); each proxy in
// front of us appends the address it saw. So we skip `trustedHops` entries from the right and take the next one.
// Render, verified 2026-10-07 (DEBUG_CLIENT_IP=1, forged leading 6.6.6.6): "6.6.6.6,73.55.190.127, 172.71.146.201" —
// the rightmost entry is a Cloudflare edge (172.64.0.0/13), the real client is one further left → TRUSTED_PROXY_HOPS=1.
import { isIP } from 'node:net';

export const UNKNOWN_IP = 'unknown';

export function clientIp(header: (name: string) => string | null, trustedHops: number): string {
  const xff = header('x-forwarded-for');
  if (!xff) return UNKNOWN_IP;
  const entries = xff.split(',').map((e) => e.trim()); // the header mixes "," and ", "
  const candidate = entries[entries.length - 1 - trustedHops];
  return candidate && isIP(candidate) ? candidate : UNKNOWN_IP;
}
