// A failed AI call reaches the browser and the database as a code only; the copy below is what the user reads. The
// provider's own message stays in the server log (src/server/aiError.ts).
export type AiErrorCode = 'AI_UNAVAILABLE' | 'FAILED';

export const AI_UNAVAILABLE_TEXT = "The AI service isn't available right now. Nothing was charged or bought. Please try again later.";

const STORED = new Set(['AI_UNAVAILABLE', 'FAILED', 'interrupted']);

/** A stored error as it may leave the server: a known code, or FAILED for anything else (older rows kept raw text). */
export function storedErrorCode(raw: string | null): AiErrorCode | 'interrupted' | null {
  if (raw === null) return null;
  return STORED.has(raw) ? (raw as AiErrorCode | 'interrupted') : 'FAILED';
}
