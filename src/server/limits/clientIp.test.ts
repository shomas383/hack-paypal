import { describe, expect, it } from 'vitest';
import { clientIp, UNKNOWN_IP } from './clientIp';

const h = (xff?: string) => (name: string) => (name.toLowerCase() === 'x-forwarded-for' ? (xff ?? null) : null);

describe('clientIp — the rightmost X-Forwarded-For hop (appended by the proxy in front of us), never the first', () => {
  it('a forged leading XFF entry does not change the counted IP', () => {
    expect(clientIp(h('6.6.6.6, 203.0.113.7'))).toBe('203.0.113.7');
    expect(clientIp(h('203.0.113.7'))).toBe('203.0.113.7');
    expect(clientIp(h('1.1.1.1, 6.6.6.6,203.0.113.7'))).toBe('203.0.113.7');
  });

  it('accepts IPv6', () => {
    expect(clientIp(h('6.6.6.6, 2001:db8::1'))).toBe('2001:db8::1');
  });

  it('missing, empty or malformed header → the shared unknown bucket', () => {
    expect(clientIp(h())).toBe(UNKNOWN_IP);
    expect(clientIp(h('  '))).toBe(UNKNOWN_IP);
    expect(clientIp(h('1.2.3.4, not-an-ip'))).toBe(UNKNOWN_IP);
    expect(clientIp(h('1.2.3.4, '))).toBe(UNKNOWN_IP);
  });
});
