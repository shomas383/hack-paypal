// What a user sees when an AI call fails: fixed copy chosen by a code, never the provider's message.
import { describe, expect, it } from 'vitest';
import { AI_UNAVAILABLE_TEXT, storedErrorCode } from './aiErrorText';

describe('AI error copy', () => {
  it('the unavailable copy is exactly the agreed text', () => {
    expect(AI_UNAVAILABLE_TEXT).toBe("The AI service isn't available right now. Nothing was charged or bought. Please try again later.");
  });

  it('storedErrorCode passes known codes and turns anything else (old raw messages) into FAILED', () => {
    expect(storedErrorCode(null)).toBeNull();
    expect(storedErrorCode('AI_UNAVAILABLE')).toBe('AI_UNAVAILABLE');
    expect(storedErrorCode('FAILED')).toBe('FAILED');
    expect(storedErrorCode('interrupted')).toBe('interrupted');
    expect(storedErrorCode('Your credit balance is too low to access the Anthropic API.')).toBe('FAILED');
    expect(storedErrorCode('invalid x-api-key')).toBe('FAILED');
  });
});
