import { describe, expect, it } from 'vitest';
import { ClassifierOutput } from './schema';

const candidate = {
  hts10: '9102.21.7000',
  description: 'Wrist watches, automatic, >17 jewels',
  confidence: 0.86,
  rationale: 'Automatic movement, 21 jewels, stainless case.',
  evidence: ['automatic diver watch', '21 jewels'],
};
const ok = { candidates: [candidate], missing_attributes: [], needs_review: false };

describe('ClassifierOutput (SPEC §4.1) — classification only, never rates or prices (invariant 5)', () => {
  it('accepts a well-formed result', () => {
    expect(ClassifierOutput.parse(ok)).toEqual(ok);
  });

  it('rejects any extra key: rates, duty, prices, or anything else', () => {
    for (const extra of [{ duty_rate: 0.15 }, { price: 300 }, { total_ppm: 125000 }, { notes: 'x' }]) {
      expect(() => ClassifierOutput.parse({ ...ok, ...extra })).toThrow();
      expect(() => ClassifierOutput.parse({ ...ok, candidates: [{ ...candidate, ...extra }] })).toThrow();
    }
  });

  it('requires a 10-digit HTS code in dddd.dd.dddd form', () => {
    for (const hts10 of ['9102.21.70', '910221.7000', '9102.21.700A', '9102217000']) {
      expect(() => ClassifierOutput.parse({ ...ok, candidates: [{ ...candidate, hts10 }] })).toThrow();
    }
  });

  it('requires confidence in [0, 1]', () => {
    for (const confidence of [-0.01, 1.01]) {
      expect(() => ClassifierOutput.parse({ ...ok, candidates: [{ ...candidate, confidence }] })).toThrow();
    }
  });
});
