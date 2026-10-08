// Review routing (SPEC §4.1). Deterministic: code decides; the model's own needs_review flag can only ADD review.
// Anything routed to review is never auto-quoted.
import type { ClassifierOutputT } from './schema';

export type ReviewReason =
  | 'LOW_CONFIDENCE'
  | 'TOP2_DIFFER_6'
  | 'MISSING_ATTRIBUTES'
  | 'ORIGIN_UNKNOWN'
  | 'MODEL_FLAGGED'
  | 'NO_CANDIDATES'
  // grounded (B2) only:
  | 'INVALID_CODE'
  | 'TOO_BROAD'
  | 'UNVERIFIED_EVIDENCE'
  | 'INVALID_OUTPUT';

export interface ReviewDecision {
  needsReview: boolean;
  reasons: ReviewReason[];
}

const digits6 = (hts10: string) => hts10.replace(/\D/g, '').slice(0, 6);

export function decideReview(result: ClassifierOutputT, opts: { threshold: number; originKnown: boolean }): ReviewDecision {
  if (result.candidates.length === 0) return { needsReview: true, reasons: ['NO_CANDIDATES'] };
  const [top, second] = [...result.candidates].sort((a, b) => b.confidence - a.confidence);
  const reasons: ReviewReason[] = [];
  if (top!.confidence < opts.threshold) reasons.push('LOW_CONFIDENCE');
  if (second && digits6(second.hts10) !== digits6(top!.hts10)) reasons.push('TOP2_DIFFER_6');
  if (result.missing_attributes.length > 0) reasons.push('MISSING_ATTRIBUTES');
  if (!opts.originKnown) reasons.push('ORIGIN_UNKNOWN');
  if (result.needs_review) reasons.push('MODEL_FLAGGED');
  return { needsReview: reasons.length > 0, reasons };
}

/** The candidate a reviewer (or auto-accept) starts from: highest confidence. */
export function topCandidate(result: ClassifierOutputT) {
  return [...result.candidates].sort((a, b) => b.confidence - a.confidence)[0];
}
