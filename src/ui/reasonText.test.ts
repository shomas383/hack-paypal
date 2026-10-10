import { describe, expect, it } from 'vitest';
import { reasonText } from './reasonText';

const ctx = { confidence: 0.62, threshold: 0.8, missing: ['jewel count', 'strap material'] };

describe('reasonText: routing reasons in plain words', () => {
  it('uses the run’s own numbers and attributes', () => {
    expect(reasonText('LOW_CONFIDENCE', ctx)).toBe('Confidence 0.62 is below the 0.80 threshold.');
    expect(reasonText('MISSING_ATTRIBUTES', ctx)).toBe("The listing doesn't say: jewel count, strap material.");
    expect(reasonText('MISSING_ATTRIBUTES', { ...ctx, missing: [] })).toBe("The listing doesn't state an attribute that separates the candidates.");
  });

  it('covers every routing reason; unknown codes pass through', () => {
    for (const code of ['TOP2_DIFFER_6', 'ORIGIN_UNKNOWN', 'MODEL_FLAGGED', 'NO_CANDIDATES', 'INVALID_CODE', 'TOO_BROAD', 'UNVERIFIED_EVIDENCE', 'INVALID_OUTPUT', 'ANSWER_CONTRADICTS']) {
      expect(reasonText(code, ctx)).not.toBe(code);
      expect(reasonText(code, ctx)).toMatch(/\.$/);
    }
    expect(reasonText('SOMETHING_NEW', ctx)).toBe('SOMETHING_NEW');
  });
});
