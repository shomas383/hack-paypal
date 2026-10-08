import { describe, expect, it } from 'vitest';
import { digitMatch, scoreRun, type EvalProduct, type Prediction } from './evalScore';

const v = (id: string, hts10: string): EvalProduct => ({ id, title: id, origin: 'JP', expected: { status: 'VERIFIED', hts10 } });
const excluded: EvalProduct = { id: 'P07', title: 'P07', origin: null, expected: { status: 'EXCLUDED', hts10: null } };
const p = (id: string, top: string | null, review: boolean): Prediction => ({ id, top, confidence: 0.9, review, reasons: review ? ['LOW_CONFIDENCE'] : [] });

describe('digitMatch', () => {
  it('compares 6 / 8 / 10 digits ignoring dots', () => {
    expect(digitMatch('9006.53.0205', '9006.53.0000')).toEqual({ d6: true, d8: false, d10: false }); // 90065302 vs 90065300
    expect(digitMatch('9006.53.0205', '9006.53.0299')).toEqual({ d6: true, d8: true, d10: false });
    expect(digitMatch('8211.92.9030', '8211.92.4060')).toEqual({ d6: true, d8: false, d10: false });
    expect(digitMatch('9102.21.7000', null)).toEqual({ d6: false, d8: false, d10: false });
  });
});

describe('scoreRun', () => {
  const products = [v('P01', '9504.40.0000'), v('P03', '9102.21.7000'), v('P04', '9006.53.0205'), excluded];

  it('counts wrong ∧ auto (the safety number) and the auto rate over verified products only', () => {
    const s = scoreRun(products, [p('P01', '9504.40.0000', false), p('P03', '9102.21.5000', false), p('P04', '9006.53.0205', true), p('P07', '6203.42.4511', true)]);
    expect(s.n).toBe(3);
    expect(s.wrongAuto).toEqual(['P03']);
    expect(s.autoCorrect).toBe(1);
    expect(s.acc).toEqual({ d6: 3, d8: 2, d10: 2 }); // P03 9102.21.50 ≠ .70 at 8 digits
    expect(s.matrix).toEqual({ correctAuto: 1, correctReview: 1, wrongAuto: 1, wrongReview: 0 });
  });

  it('P07 is scored on routing only: passes when routed to review, fails (safety) when auto', () => {
    expect(scoreRun(products, [p('P07', '6203.42.4511', true)]).excludedRouting).toEqual([{ id: 'P07', pass: true }]);
    const bad = scoreRun(products, [p('P07', '6203.42.4511', false)]);
    expect(bad.excludedRouting).toEqual([{ id: 'P07', pass: false }]);
    expect(bad.safe).toBe(false);
  });

  it('an invalid answer (no top code) counts as wrong, and is safe only because it is routed to review', () => {
    const s = scoreRun([v('P01', '9504.40.0000')], [p('P01', null, true)]);
    expect(s.acc.d10).toBe(0);
    expect(s.matrix.wrongReview).toBe(1);
    expect(s.safe).toBe(true);
  });

  it('a missing prediction for a verified product counts as wrong ∧ review', () => {
    expect(scoreRun([v('P01', '9504.40.0000')], []).matrix).toEqual({ correctAuto: 0, correctReview: 0, wrongAuto: 0, wrongReview: 1 });
  });
});
