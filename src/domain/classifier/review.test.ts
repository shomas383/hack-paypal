import { describe, expect, it } from 'vitest';
import { decideReview } from './review';
import type { ClassifierOutputT } from './schema';

const c = (hts10: string, confidence: number) => ({ hts10, description: 'd', confidence, rationale: 'r', evidence: ['e'] });
const result = (over: Partial<ClassifierOutputT> = {}): ClassifierOutputT => ({
  candidates: [c('9102.21.7000', 0.9)],
  missing_attributes: [],
  needs_review: false,
  ...over,
});
const opts = { threshold: 0.8, originKnown: true };

describe('decideReview — code decides routing; the model can only ADD review', () => {
  it('confident, single 6-digit heading, nothing missing, origin known → auto', () => {
    expect(decideReview(result(), opts)).toEqual({ needsReview: false, reasons: [] });
  });

  it('threshold edges: exactly at the threshold → auto; just below → LOW_CONFIDENCE', () => {
    expect(decideReview(result({ candidates: [c('9102.21.7000', 0.8)] }), opts).needsReview).toBe(false);
    expect(decideReview(result({ candidates: [c('9102.21.7000', 0.7999)] }), opts)).toEqual({ needsReview: true, reasons: ['LOW_CONFIDENCE'] });
  });

  it('uses the highest-confidence candidate as top, whatever the order', () => {
    expect(decideReview(result({ candidates: [c('9102.21.5000', 0.3), c('9102.21.7000', 0.9)] }), opts).needsReview).toBe(false);
  });

  it('top two differ at 6 digits → TOP2_DIFFER_6; same 6-digit heading is fine', () => {
    expect(decideReview(result({ candidates: [c('9102.21.7000', 0.9), c('9101.21.1000', 0.85)] }), opts).reasons).toEqual(['TOP2_DIFFER_6']);
    expect(decideReview(result({ candidates: [c('9102.21.7000', 0.9), c('9102.21.5000', 0.85)] }), opts).reasons).toEqual([]);
  });

  it('missing attributes, unknown origin, the model flag and no candidates each force review', () => {
    expect(decideReview(result({ missing_attributes: ['age'] }), opts).reasons).toEqual(['MISSING_ATTRIBUTES']);
    expect(decideReview(result(), { ...opts, originKnown: false }).reasons).toEqual(['ORIGIN_UNKNOWN']);
    expect(decideReview(result({ needs_review: true }), opts).reasons).toEqual(['MODEL_FLAGGED']);
    expect(decideReview(result({ candidates: [] }), opts)).toEqual({ needsReview: true, reasons: ['NO_CANDIDATES'] });
  });

  it('the model saying needs_review=false never overrides a code rule', () => {
    const r = decideReview(result({ candidates: [c('9102.21.7000', 0.5)], needs_review: false }), opts);
    expect(r).toEqual({ needsReview: true, reasons: ['LOW_CONFIDENCE'] });
  });

  it('reports every reason, not just the first', () => {
    const r = decideReview(result({ candidates: [c('9102.21.7000', 0.5), c('9101.21.1000', 0.4)], missing_attributes: ['movement type'], needs_review: true }), {
      ...opts,
      originKnown: false,
    });
    expect(r.reasons).toEqual(['LOW_CONFIDENCE', 'TOP2_DIFFER_6', 'MISSING_ATTRIBUTES', 'ORIGIN_UNKNOWN', 'MODEL_FLAGGED']);
  });
});
