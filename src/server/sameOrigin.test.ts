import { describe, expect, it } from 'vitest';
import { sameOrigin } from './sameOrigin';

const r = (url: string, origin?: string) => new Request(url, { method: 'POST', headers: origin ? { origin } : {} });

describe('sameOrigin', () => {
  it("true only when Origin's host is the request's own (or PUBLIC_BASE_URL's when set)", () => {
    expect(sameOrigin(r('https://landed-hd19.onrender.com/api/estimates', 'https://landed-hd19.onrender.com'))).toBe(true);
    expect(sameOrigin(r('http://localhost:3000/api/estimates', 'http://localhost:3000'))).toBe(true);
    expect(sameOrigin(r('http://internal:10000/api/estimates', 'https://landed-hd19.onrender.com'), 'https://landed-hd19.onrender.com')).toBe(true);
  });
  it('false without an Origin, from another site or port, or with garbage', () => {
    expect(sameOrigin(r('https://landed-hd19.onrender.com/api/estimates'))).toBe(false);
    expect(sameOrigin(r('https://landed-hd19.onrender.com/api/estimates', 'https://evil.example'))).toBe(false);
    expect(sameOrigin(r('http://localhost:3000/api/estimates', 'http://localhost:4000'))).toBe(false);
    expect(sameOrigin(r('http://localhost:3000/api/estimates', 'null'))).toBe(false);
  });
});
