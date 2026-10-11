import { CURRENT_HTS_REV_SHORT } from '@/domain/rates/current';
import type { Tone } from './StatusBadge';

const SHORT: Record<string, string> = {
  LOW_CONFIDENCE: 'Low confidence',
  MISSING_ATTRIBUTES: 'Missing attributes',
  TOP2_DIFFER_6: 'Top two differ',
  ORIGIN_UNKNOWN: 'Origin unknown',
  MODEL_FLAGGED: 'Flagged for a check',
  NO_CANDIDATES: 'No matching lines',
  INVALID_CODE: 'Invalid code',
  TOO_BROAD: 'Too broad',
  UNVERIFIED_EVIDENCE: 'Unverified evidence',
  INVALID_OUTPUT: 'Malformed answer',
  ANSWER_CONTRADICTS: 'Answer contradicts',
};

/** Short label for the review-queue column. */
export function reasonShort(code: string): string {
  return SHORT[code] ?? code;
}

const STATUS: Record<string, { tone: Tone; text: string }> = {
  CLASSIFYING: { tone: 'progress', text: 'Classifying' },
  FAILED: { tone: 'danger', text: 'Failed' },
  PENDING_REVIEW: { tone: 'warning', text: 'Needs review' },
  AUTO_ACCEPTED: { tone: 'success', text: 'Auto-accepted' },
  ACCEPTED: { tone: 'success', text: 'Accepted' },
  OVERRIDDEN: { tone: 'info', text: 'Overridden' },
  PUBLISHED: { tone: 'success', text: 'Published' },
};

export function classificationStatus(status: string): { tone: Tone; text: string } {
  return STATUS[status] ?? { tone: 'neutral', text: status };
}

// Classification routing reasons (src/domain/classifier/review.ts) in plain words, with the run's own numbers.
export function reasonText(code: string, ctx: { confidence: number | null; threshold: number; missing: string[] }): string {
  switch (code) {
    case 'LOW_CONFIDENCE':
      return `Confidence ${ctx.confidence?.toFixed(2) ?? '—'} is below the ${ctx.threshold.toFixed(2)} threshold.`;
    case 'MISSING_ATTRIBUTES':
      return ctx.missing.length ? `The listing doesn't say: ${ctx.missing.join(', ')}.` : "The listing doesn't state an attribute that separates the candidates.";
    case 'TOP2_DIFFER_6':
      return 'The top two candidates are in different subheadings.';
    case 'ORIGIN_UNKNOWN':
      return 'The country of origin is unknown.';
    case 'MODEL_FLAGGED':
      return 'The classifier asked for a human check.';
    case 'NO_CANDIDATES':
      return `No official ${CURRENT_HTS_REV_SHORT} line matched the proposed headings.`;
    case 'INVALID_CODE':
      return `A proposed code isn't a ${CURRENT_HTS_REV_SHORT} line.`;
    case 'TOO_BROAD':
      return 'The proposed headings cover more than 100 official lines; add detail to the listing.';
    case 'UNVERIFIED_EVIDENCE':
      return "Some quoted evidence wasn't found in the listing text.";
    case 'INVALID_OUTPUT':
      return "The classifier's answer was malformed.";
    case 'ANSWER_CONTRADICTS':
      return 'Your answer rules out the proposed line.';
    default:
      return code;
  }
}
