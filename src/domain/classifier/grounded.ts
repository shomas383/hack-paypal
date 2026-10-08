// Grounded choice (B2): call 2 picks among the real Rev 20 lines that code expanded from call 1's headings. Code checks
// that every quote the model gives actually appears in the listing, then decides the routing. The model's own flag can
// only ADD review. No rate / price fields exist anywhere in these schemas (invariant 5).
import { z } from 'zod';
import { validateHts10, type HtsLookup } from './hts';
import type { ReviewDecision, ReviewReason } from './review';

export function groundedChoiceSchema(codes: string[]) {
  if (codes.length === 0) throw new Error('groundedChoiceSchema needs at least one code');
  const Code = z.enum(codes as [string, ...string[]]);
  return z
    .object({
      candidates: z
        .array(
          z
            .object({
              hts10: Code,
              confidence: z.number().min(0).max(1),
              rationale: z.string(),
              /** Exact spans copied from the listing text. */
              evidence: z.array(z.string()),
            })
            .strict(),
        )
        .max(3),
      /** Only the attributes that separate the remaining candidates, with the listing's value or null if not stated. */
      separating_attributes: z.array(z.object({ name: z.string(), value_from_listing: z.string().nullable() }).strict()),
      needs_review: z.boolean(),
    })
    .strict();
}

export type GroundedChoice = z.infer<ReturnType<typeof groundedChoiceSchema>>;

/** Comparison-only folding: NFKC (full-width ↔ half-width), case, whitespace. Stored / displayed text is never changed. */
const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();

export interface VerifiedChoice {
  choice: GroundedChoice;
  droppedQuotes: number;
  /** Candidates left with no evidence that appears in the listing. */
  unverifiedCodes: string[];
}

export function verifyQuotes(listingText: string, choice: GroundedChoice): VerifiedChoice {
  const haystack = fold(listingText);
  const appears = (q: string) => {
    const f = fold(q);
    return f.length > 0 && haystack.includes(f);
  };
  let droppedQuotes = 0;
  const unverifiedCodes: string[] = [];
  const candidates = choice.candidates.map((c) => {
    const evidence = c.evidence.filter((q) => {
      const ok = appears(q);
      if (!ok) droppedQuotes++;
      return ok;
    });
    if (evidence.length === 0) unverifiedCodes.push(c.hts10);
    return { ...c, evidence };
  });
  const separating_attributes = choice.separating_attributes.map((a) => ({
    name: a.name,
    value_from_listing: a.value_from_listing !== null && appears(a.value_from_listing) ? a.value_from_listing : null,
  }));
  return { choice: { ...choice, candidates, separating_attributes }, droppedQuotes, unverifiedCodes };
}

const digits6 = (code: string) => code.replace(/\D/g, '').slice(0, 6);

export function decideGroundedReview(v: VerifiedChoice, ctx: { threshold: number; originKnown: boolean; idx: HtsLookup }): ReviewDecision {
  const { choice } = v;
  if (choice.candidates.length === 0) return { needsReview: true, reasons: ['NO_CANDIDATES'] };
  const [top, second] = [...choice.candidates].sort((a, b) => b.confidence - a.confidence);
  const reasons: ReviewReason[] = [];
  if (choice.candidates.some((c) => !validateHts10(c.hts10, ctx.idx).ok)) reasons.push('INVALID_CODE');
  if (top!.confidence < ctx.threshold) reasons.push('LOW_CONFIDENCE');
  if (second && digits6(second.hts10) !== digits6(top!.hts10)) reasons.push('TOP2_DIFFER_6');
  if (choice.separating_attributes.some((a) => a.value_from_listing === null)) reasons.push('MISSING_ATTRIBUTES');
  if (v.unverifiedCodes.length > 0) reasons.push('UNVERIFIED_EVIDENCE');
  if (!ctx.originKnown) reasons.push('ORIGIN_UNKNOWN');
  if (choice.needs_review) reasons.push('MODEL_FLAGGED');
  return { needsReview: reasons.length > 0, reasons };
}
