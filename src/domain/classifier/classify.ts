// LLM HTS classification (SPEC §4.1). The model PROPOSES candidate codes with confidence and quoted evidence; routing is
// decided by decideReview() in code, and amounts never come from here (invariant 5): the schema has no rate/price field.
// Structured output: AI SDK v7 `generateText` + `Output.object` (generateObject is deprecated in ai@7.0.127). With
// @ai-sdk/anthropic 4.0.71, claude-opus-5-5 uses native `output_config.format`, not a forced tool (it rejects tool_choice).
import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai';
import { ZodError } from 'zod';
import { decideReview, type ReviewDecision } from './review';
import { ClassifierOutput, type ClassifierOutputT } from './schema';

export const CLASSIFIER_MODEL = 'claude-opus-5-5';

export interface ListingText {
  title: string;
  description?: string;
  /** ISO 3166 alpha-2 country of origin, if known. Origin does not change the HTS code, but unknown origin forces review. */
  origin?: string | null;
}

export type Classification =
  | { kind: 'OK'; output: ClassifierOutputT; review: ReviewDecision }
  | { kind: 'INVALID_OUTPUT'; error: string; review: { needsReview: true; reasons: ['INVALID_OUTPUT'] } };

const SYSTEM = `You classify a product listing under the US Harmonized Tariff Schedule (HTSUS).
Return up to 3 candidate 10-digit HTSUS statistical codes, formatted dddd.dd.dddd, best first.
For each candidate give: a short description of the HTS line, a calibrated confidence between 0 and 1 (the probability this is
the correct 10-digit code), a one-sentence rationale, and evidence — exact quoted spans copied from the listing text.
List in missing_attributes every attribute that would decide between candidate codes but is not stated in the listing
(for example material, fiber content, movement type, jewel count, power source, age).
If the item may be 100 or more years old (antiques can fall under chapter 97), add "age" to missing_attributes.
Set needs_review to true if you are unsure.
Never output duty rates, tariff percentages, prices, or any amount of money. Classification only.`;

function userPrompt(l: ListingText): string {
  return [`Title: ${l.title}`, l.description ? `Description: ${l.description}` : null, `Country of origin: ${l.origin ?? 'unknown'}`]
    .filter(Boolean)
    .join('\n');
}

export async function classifyListing(listing: ListingText, model: LanguageModel, opts: { threshold: number }): Promise<Classification> {
  let output: ClassifierOutputT;
  try {
    const result = await generateText({
      model,
      system: SYSTEM,
      prompt: userPrompt(listing),
      output: Output.object({ schema: ClassifierOutput, name: 'hts_classification' }),
    });
    // Validate again ourselves: the provider may relax schema keywords (pattern, min/max) for native structured output.
    output = ClassifierOutput.parse(result.output);
  } catch (e) {
    // A malformed or schema-violating ANSWER is a review case, never a crash and never an auto-accept.
    // API failures (auth, rate limit, network) are not answers: rethrow so they surface instead of hiding as "review".
    if (NoObjectGeneratedError.isInstance(e) || e instanceof ZodError) {
      return { kind: 'INVALID_OUTPUT', error: e.message.slice(0, 300), review: { needsReview: true, reasons: ['INVALID_OUTPUT'] } };
    }
    throw e;
  }
  return { kind: 'OK', output, review: decideReview(output, { threshold: opts.threshold, originKnown: Boolean(listing.origin) }) };
}
