// Classifier output (SPEC §4.1), validated with zod. Classification ONLY: there is no field for a rate, duty or price
// (invariant 5) and unknown keys are rejected, so the model cannot smuggle amounts through.
import { z } from 'zod';

export const HTS10 = z.string().regex(/^\d{4}\.\d{2}\.\d{4}$/, 'expected an HTS code like 9102.21.7000');

export const Candidate = z
  .object({
    hts10: HTS10,
    description: z.string(),
    confidence: z.number().min(0).max(1),
    rationale: z.string(),
    /** Quoted spans from the listing text that support this code. */
    evidence: z.array(z.string()),
  })
  .strict();

export const ClassifierOutput = z
  .object({
    candidates: z.array(Candidate),
    /** Decisive attributes the listing does not state (e.g. material, movement type, age, power source). */
    missing_attributes: z.array(z.string()),
    needs_review: z.boolean(),
  })
  .strict();

export type ClassifierOutputT = z.infer<typeof ClassifierOutput>;
