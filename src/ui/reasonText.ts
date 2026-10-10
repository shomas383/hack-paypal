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
      return 'No official Rev 20 line matched the proposed headings.';
    case 'INVALID_CODE':
      return "A proposed code isn't a Rev 20 line.";
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
