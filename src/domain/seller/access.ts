// Seller console access (docs/design/wireframes.md §3). A single shared passcode from env (SELLER_CONSOLE_PASSCODE),
// compared in constant time; failed attempts per IP are limited. No user accounts: "who" in the audit is the seller session.
import { createHash, timingSafeEqual } from 'node:crypto';

export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const SELLER_SESSION_TTL_MS = 8 * 60 * 60_000;

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Constant time: both sides are hashed to 32 bytes first, so the comparison never exits early on length. */
export function passcodeMatches(input: string, expected: string): boolean {
  if (!expected) return false;
  return timingSafeEqual(digest(input), digest(expected));
}

export function loginGate(failedInWindow: number): { allowed: boolean; attemptsLeft: number } {
  const left = Math.max(0, LOGIN_MAX_FAILURES - failedInWindow);
  return { allowed: left > 0, attemptsLeft: left };
}
