import { describe, expect, it } from 'vitest';
import { clientIp, UNKNOWN_IP } from './clientIp';

const h = (xff?: string) => (name: string) => (name.toLowerCase() === 'x-forwarded-for' ? (xff ?? null) : null);

// Render 2026-10-07 (DEBUG_CLIENT_IP=1, forged leading 6.6.6.6): "6.6.6.6,73.55.190.127, 172.71.146.201" — the rightmost
// entry is a Cloudflare edge (172.64.0.0/13); the real client is one hop further left → TRUSTED_PROXY_HOPS=1.
describe('clientIp — skip N trusted proxy hops from the right; never trust the leading (client-supplied) entries', () => {
  it('Render header with hops=1 → the real client', () => {
    expect(clientIp(h('6.6.6.6,73.55.190.127, 172.71.146.201'), 1)).toBe('73.55.190.127');
  });

  it('the same header without the forged entry → the same result', () => {
    expect(clientIp(h('73.55.190.127, 172.71.146.201'), 1)).toBe('73.55.190.127');
    expect(clientIp(h('1.1.1.1 , 6.6.6.6,73.55.190.127 ,172.71.146.201'), 1)).toBe('73.55.190.127');
  });

  it('hops=2 skips two trusted hops', () => {
    expect(clientIp(h('6.6.6.6, 203.0.113.7, 10.0.0.1, 172.71.146.201'), 2)).toBe('203.0.113.7');
  });

  it('accepts IPv6', () => {
    expect(clientIp(h('6.6.6.6, 2001:db8::1, 172.71.146.201'), 1)).toBe('2001:db8::1');
  });

  it('fewer entries than hops + 1 → the unknown bucket', () => {
    expect(clientIp(h('172.71.146.201'), 1)).toBe(UNKNOWN_IP);
    expect(clientIp(h('73.55.190.127, 172.71.146.201'), 2)).toBe(UNKNOWN_IP);
  });

  it('missing, empty or malformed → the unknown bucket', () => {
    expect(clientIp(h(), 1)).toBe(UNKNOWN_IP);
    expect(clientIp(h('  '), 1)).toBe(UNKNOWN_IP);
    expect(clientIp(h('not-an-ip, 172.71.146.201'), 1)).toBe(UNKNOWN_IP);
    expect(clientIp(h(', 172.71.146.201'), 1)).toBe(UNKNOWN_IP);
  });
});
