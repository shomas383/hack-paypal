import { describe, expect, it } from 'vitest';
import { LOGIN_MAX_FAILURES, loginGate, passcodeMatches } from './access';

describe('passcodeMatches (constant-time over fixed-length digests)', () => {
  it('true only for the exact passcode', () => {
    expect(passcodeMatches('correct horse battery', 'correct horse battery')).toBe(true);
    expect(passcodeMatches('correct horse batterY', 'correct horse battery')).toBe(false);
    expect(passcodeMatches('', 'correct horse battery')).toBe(false);
    // Different lengths still compare digests of equal length (no early exit on length).
    expect(passcodeMatches('x', 'correct horse battery')).toBe(false);
    expect(passcodeMatches('correct horse battery and more', 'correct horse battery')).toBe(false);
  });

  it('never matches when no passcode is configured', () => {
    expect(passcodeMatches('', '')).toBe(false);
  });
});

describe('loginGate (failed attempts per IP in the window)', () => {
  it('allows until the limit, counting down', () => {
    expect(loginGate(0)).toEqual({ allowed: true, attemptsLeft: LOGIN_MAX_FAILURES });
    expect(loginGate(4)).toEqual({ allowed: true, attemptsLeft: 1 });
  });

  it('locks at the limit', () => {
    expect(loginGate(LOGIN_MAX_FAILURES)).toEqual({ allowed: false, attemptsLeft: 0 });
    expect(loginGate(LOGIN_MAX_FAILURES + 3)).toEqual({ allowed: false, attemptsLeft: 0 });
  });
});
