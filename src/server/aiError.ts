// Model-call failures, classified by code. The provider's own message (e.g. "Your credit balance is too low…") goes to the
// server log only, cut to 200 characters, without headers, request body or response body; responses and stored rows
// carry the code (copy in src/domain/aiErrorText.ts).
import { APICallError, LoadAPIKeyError, RetryError } from 'ai';
import type { AiErrorCode } from '@/domain/aiErrorText';

const BILLING = /credit|billing|balance/i;

/** The provider error behind a retry wrapper (the SDK retries 429 / 5xx / network failures before giving up). */
const unwrap = (e: unknown): unknown => (RetryError.isInstance(e) ? e.lastError : e);

/**
 * AI_UNAVAILABLE: the AI service refused or couldn't be reached — billing (402, or a 400 about credit), auth (401 / 403,
 * a missing key), rate limit (429), overload or server error (5xx, 529), or no connection. Everything else is FAILED.
 */
export function aiErrorCode(e: unknown): AiErrorCode {
  const err = unwrap(e);
  if (LoadAPIKeyError.isInstance(err)) return 'AI_UNAVAILABLE';
  if (!APICallError.isInstance(err)) return 'FAILED';
  const s = err.statusCode;
  if (s === undefined) return err.isRetryable ? 'AI_UNAVAILABLE' : 'FAILED';
  if (s === 401 || s === 402 || s === 403 || s === 429 || s >= 500) return 'AI_UNAVAILABLE';
  if (s === 400 && (BILLING.test(err.message) || BILLING.test(err.responseBody ?? ''))) return 'AI_UNAVAILABLE';
  return 'FAILED';
}

/** One log line per failure: where, code, HTTP status, error name and the message cut to 200 characters. */
export function logAiError(where: string, e: unknown): AiErrorCode {
  const code = aiErrorCode(e);
  const err = unwrap(e);
  const status = APICallError.isInstance(err) ? (err.statusCode ?? '-') : '-';
  const name = err instanceof Error ? err.name : typeof err;
  const message = (err instanceof Error ? err.message : String(err)).replace(/\s+/g, ' ').slice(0, 200);
  console.error(`[ai] ${where}: ${code} status=${status} ${name}: ${message}`);
  return code;
}

/** The limits outcome for a failed reserved call: provider outages are recorded but not counted (src/server/limits/outcomes.ts). */
export const failureOutcome = (code: AiErrorCode) => (code === 'AI_UNAVAILABLE' ? 'ERROR_UNAVAILABLE' : 'ERROR') as 'ERROR_UNAVAILABLE' | 'ERROR';
