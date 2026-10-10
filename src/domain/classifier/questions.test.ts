// Synthetic chains (test fixtures, not HTS text): the questions are built only from whatever official chain the index holds.
import { describe, expect, it } from 'vitest';
import { applySellerAnswers, buildQuestions } from './questions';
import type { HtsLine } from './hts';

const line = (code: string, ...chain: string[]): HtsLine => ({ code, componentReporting: false, chain });
const H = 'Watches:';
const LINES: HtsLine[] = [
  line('9102.21.10', H, 'Automatic:', 'No jewels or only one jewel'),
  line('9102.21.30', H, 'Automatic:', 'Over 1 but not over 17 jewels'),
  line('9102.21.70', H, 'Automatic:', 'Over 17 jewels:', 'Strap of base metal'),
  line('9102.21.90', H, 'Automatic:', 'Over 17 jewels:', 'Other'),
  line('9102.29.02', H, 'Other:', 'Other'),
];

describe('buildQuestions (from the official chains of the chosen candidates; never from the model)', () => {
  it('asks at the first level where the chosen candidates differ; options are the official texts + "None of these"', () => {
    const qs = buildQuestions(LINES, ['9102.21.70', '9102.21.30']);
    expect(qs.choices).toEqual([
      {
        id: 'level-2',
        text: 'Which description matches the item?',
        options: [
          { id: 'o-0', text: 'Over 17 jewels', codes: ['9102.21.70'] },
          { id: 'o-1', text: 'Over 1 but not over 17 jewels', codes: ['9102.21.30'] },
        ],
      },
    ]);
  });

  it('goes one level deeper inside the top candidate’s branch (at most 3 questions)', () => {
    const qs = buildQuestions(LINES, ['9102.21.70', '9102.21.90', '9102.21.30']);
    expect(qs.choices.map((q) => [q.id, q.options.map((o) => o.text)])).toEqual([
      ['level-2', ['Over 17 jewels', 'Over 1 but not over 17 jewels']],
      ['level-3', ['Strap of base metal', 'Other']],
    ]);
  });

  it('no choice question with a single chosen candidate', () => {
    expect(buildQuestions(LINES, ['9102.21.70']).choices).toEqual([]);
  });

  it('exclusions: the other official lines under the top candidate’s subheading, by their last level', () => {
    expect(buildQuestions(LINES, ['9102.21.70', '9102.21.30']).exclusions).toEqual([
      { code: '9102.21.10', text: 'No jewels or only one jewel' },
      { code: '9102.21.90', text: 'Other' },
    ]);
    expect(buildQuestions(LINES, []).exclusions).toEqual([]);
  });
});

describe('applySellerAnswers (routing reruns in code)', () => {
  const qs = buildQuestions(LINES, ['9102.21.70', '9102.21.90', '9102.21.30']);
  const base = ['MISSING_ATTRIBUTES', 'TOP2_DIFFER_6'] as const;

  it('answers confirming the top line at every level clear MISSING_ATTRIBUTES / TOP2_DIFFER_6', () => {
    const r = applySellerAnswers(qs, { 'level-2': 'o-0', 'level-3': 'o-0' }, true, ['9102.21.70', '9102.21.90', '9102.21.30'], [...base, 'LOW_CONFIDENCE']);
    expect(r).toEqual({ reasons: ['LOW_CONFIDENCE'], needsReview: true, remaining: ['9102.21.70'], suggested: null });
  });

  it('all reasons cleared → no review', () => {
    expect(applySellerAnswers(qs, { 'level-2': 'o-0', 'level-3': 'o-0' }, true, ['9102.21.70', '9102.21.90', '9102.21.30'], [...base]).needsReview).toBe(false);
  });

  it('an answer that rules out the top line → ANSWER_CONTRADICTS, with the remaining line suggested', () => {
    const r = applySellerAnswers(qs, { 'level-2': 'o-1' }, null, ['9102.21.70', '9102.21.90', '9102.21.30'], [...base]);
    expect(r.reasons).toContain('ANSWER_CONTRADICTS');
    expect(r.remaining).toEqual(['9102.21.30']);
    expect(r.suggested).toBe('9102.21.30');
  });

  it('"None of these" or "one of the excluded lines applies" → ANSWER_CONTRADICTS', () => {
    expect(applySellerAnswers(qs, { 'level-2': 'none' }, null, ['9102.21.70', '9102.21.90', '9102.21.30'], []).reasons).toEqual(['ANSWER_CONTRADICTS']);
    expect(applySellerAnswers(qs, { 'level-2': 'o-0', 'level-3': 'o-0' }, false, ['9102.21.70', '9102.21.90', '9102.21.30'], []).reasons).toEqual(['ANSWER_CONTRADICTS']);
  });

  it('partial answers never clear a reason', () => {
    expect(applySellerAnswers(qs, { 'level-2': 'o-0' }, null, ['9102.21.70', '9102.21.90', '9102.21.30'], [...base]).reasons).toEqual([...base]);
  });

  it('unknown question or option ids are rejected', () => {
    expect(() => applySellerAnswers(qs, { 'level-9': 'o-0' }, null, ['9102.21.70'], [])).toThrow(/unknown question/);
    expect(() => applySellerAnswers(qs, { 'level-2': 'o-7' }, null, ['9102.21.70'], [])).toThrow(/unknown option/);
  });
});
