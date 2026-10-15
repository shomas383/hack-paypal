// Provider failures (billing, auth, rate limit, overload, network) are "AI_UNAVAILABLE"; anything else is "FAILED". The raw
// provider message reaches the server log only: truncated, without headers, request body or response body.
import { APICallError, LoadAPIKeyError, RetryError } from 'ai';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { aiErrorCode, logAiError } from './aiError';

// A recognisable stand-in planted in the response headers and body; it must never reach the log line.
const PLANTED = 'not-a-real-key-header-value';
const apiError = (statusCode: number | undefined, message = 'provider said no', responseBody = '', isRetryable = false) =>
  new APICallError({
    message,
    url: 'https://api.anthropic.com/v1/messages',
    requestBodyValues: { prompt: 'secret listing text' },
    ...(statusCode === undefined ? {} : { statusCode }),
    responseHeaders: { 'x-api-key': PLANTED, 'request-id': 'req_1' },
    responseBody,
    isRetryable,
  });

describe('aiErrorCode', () => {
  it('billing, auth, permission, rate limit, overload and server errors are AI_UNAVAILABLE', () => {
    for (const s of [401, 402, 403, 429, 500, 503, 529]) expect(aiErrorCode(apiError(s)), String(s)).toBe('AI_UNAVAILABLE');
  });

  it('a 400 about credit or billing is AI_UNAVAILABLE; any other 400 is FAILED', () => {
    expect(aiErrorCode(apiError(400, 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits.'))).toBe('AI_UNAVAILABLE');
    expect(aiErrorCode(apiError(400, 'invalid request', '{"error":{"message":"Your credit balance is too low"}}'))).toBe('AI_UNAVAILABLE');
    expect(aiErrorCode(apiError(400, 'messages: text content blocks must be non-empty'))).toBe('FAILED');
  });

  it('a network failure (no status, retryable), a retry wrapper around a provider failure and a missing API key are AI_UNAVAILABLE', () => {
    expect(aiErrorCode(apiError(undefined, 'Cannot connect to API: fetch failed', '', true))).toBe('AI_UNAVAILABLE');
    expect(aiErrorCode(new RetryError({ message: 'Failed after 3 attempts', reason: 'maxRetriesExceeded', errors: [apiError(529), apiError(529)] }))).toBe('AI_UNAVAILABLE');
    expect(aiErrorCode(new LoadAPIKeyError({ message: 'Anthropic API key is missing.' }))).toBe('AI_UNAVAILABLE');
  });

  it('anything else is FAILED', () => {
    expect(aiErrorCode(new Error('database is down'))).toBe('FAILED');
    expect(aiErrorCode('a string')).toBe('FAILED');
    expect(aiErrorCode(undefined)).toBe('FAILED');
  });
});

describe('logAiError', () => {
  afterEach(() => vi.restoreAllMocks());

  it('logs where, code, status and the message cut to 200 characters; never headers, request or response body', () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    logAiError('estimate', apiError(400, `Your credit balance is too low ${'x'.repeat(400)}`, `{"body":"${PLANTED}"}`));
    expect(log).toHaveBeenCalledTimes(1);
    const line = log.mock.calls[0]!.map(String).join(' ');
    expect(line).toContain('estimate');
    expect(line).toContain('AI_UNAVAILABLE');
    expect(line).toContain('400');
    expect(line).toContain('Your credit balance is too low');
    expect(line).not.toContain(PLANTED);
    expect(line).not.toContain('secret listing text');
    expect(line).not.toContain('req_1');
    expect(line.length).toBeLessThan(320);
  });
});
