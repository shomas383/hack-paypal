// Grounded HTS classification (B2, SPEC §4.1). Two calls; code in between:
//   1. the model proposes up to 3 HEADINGS (6 or 8 digits) — no 10-digit codes;
//   2. code expands them to the real lines of the current HTS revision (official HTS index) with description chains;
//      nothing expands → NO_CANDIDATES, more than MAX_EXPANDED_LINES → TOO_BROAD (no second call);
//   3. the model chooses only from that list (z.enum), with evidence and the attributes that separate the candidates;
//   4. code verifies every quote against the listing, then decides the routing.
// The model never sets amounts (invariant 5). Malformed answers → INVALID_OUTPUT (review); API errors are rethrown.
// Structured output via generateText + Output.object (native output_config.format for claude-opus-5-5; spike h).
import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai';
import { z, ZodError } from 'zod';
import type { ListingText } from './classify';
import { decideGroundedReview, groundedChoiceSchema, verifyQuotes, type GroundedChoice } from './grounded';
import { expandHeading, type HtsLine, type HtsLookup } from './hts';
import type { ReviewDecision } from './review';
import { CURRENT_HTS_REVISION } from '@/domain/rates/current';

export const MAX_EXPANDED_LINES = 100;

const Headings = z
  .object({
    headings: z
      .array(
        z
          .object({
            heading: z.string().regex(/^\d{4}\.\d{2}(\.\d{2})?$/, 'a 6-digit (dddd.dd) or 8-digit (dddd.dd.dd) heading'),
            reason: z.string(),
            evidence: z.array(z.string()),
          })
          .strict(),
      )
      .max(3),
    needs_review: z.boolean(),
  })
  .strict();

const SYSTEM_1 = `You classify a product listing under the US Harmonized Tariff Schedule (HTSUS).
Return up to 3 candidate HEADINGS, best first, each at the 6-digit level (dddd.dd) or, only when you are sure of the split,
the 8-digit level (dddd.dd.dd). Never return a 10-digit statistical code: the exact line is chosen in a later step from the
official schedule. Give a short reason and evidence — exact spans copied from the listing text.
Set needs_review to true if you are unsure.
Never output duty rates, tariff percentages, prices, or any amount of money. Classification only.`;

const SYSTEM_2 = `You classify a product listing under the US Harmonized Tariff Schedule (HTSUS), 2026 Revision 20.
You are given the ONLY valid candidate lines, each with its full official description chain from the schedule.
Choose up to 3 of these codes, best first; you may not use any code that is not in the list.
For each: a calibrated confidence between 0 and 1 (the probability it is the correct line), a one-sentence rationale, and
evidence — exact spans copied from the listing text (not from the schedule).
In separating_attributes list ONLY the attributes that decide between the plausible lines in the list (for example fiber,
gender, jewel count, strap material), each with its value copied exactly from the listing, or null if the listing does not
state it. Do not list attributes that do not separate the candidates.
Some Chapter 91 lines are 8-digit codes because watches and clocks are reported by component (Statistical Note 1); choose
them as given.
Set needs_review to true if you are unsure.
Never output duty rates, tariff percentages, prices, or any amount of money. Classification only.`;

export interface GroundedMeta {
  headings: string[];
  invalidHeadings: string[];
  expanded: number;
  droppedQuotes: number;
  calls: number;
  usage: { input: number; output: number };
  ms: number;
}

export type GroundedClassification =
  | { kind: 'OK'; choice: GroundedChoice; candidates: HtsLine[]; review: ReviewDecision; meta: GroundedMeta }
  | { kind: 'STOPPED'; review: ReviewDecision; meta: GroundedMeta }
  | { kind: 'INVALID_OUTPUT'; stage: 1 | 2; error: string; review: ReviewDecision; meta: GroundedMeta };

const listingText = (l: ListingText) => [l.title, l.description].filter(Boolean).join('\n');
const userPrompt = (l: ListingText) =>
  [`Title: ${l.title}`, l.description ? `Description: ${l.description}` : null, `Country of origin: ${l.origin ?? 'unknown'}`].filter(Boolean).join('\n');

/** Real progress, reported as each step starts (the seller console shows it; nothing is simulated). */
export type GroundedStage =
  | { stage: 'proposing' }
  | { stage: 'matching'; headings: string[] }
  | { stage: 'choosing'; headings: string[]; expanded: number };

export async function classifyListingGrounded(
  listing: ListingText,
  model: LanguageModel,
  opts: { threshold: number; idx: HtsLookup; onStage?: (s: GroundedStage) => void | Promise<void> },
): Promise<GroundedClassification> {
  const stage = async (s: GroundedStage) => {
    await opts.onStage?.(s);
  };
  const started = Date.now();
  const meta: GroundedMeta = { headings: [], invalidHeadings: [], expanded: 0, droppedQuotes: 0, calls: 0, usage: { input: 0, output: 0 }, ms: 0 };
  const originReasons = listing.origin ? [] : (['ORIGIN_UNKNOWN'] as const);
  const done = <T extends GroundedClassification>(r: T): T => ({ ...r, meta: { ...r.meta, ms: Date.now() - started } });
  const invalid = (stage: 1 | 2, e: Error): GroundedClassification =>
    done({ kind: 'INVALID_OUTPUT', stage, error: e.message.slice(0, 300), review: { needsReview: true, reasons: ['INVALID_OUTPUT', ...originReasons] }, meta });

  async function call<T>(system: string, prompt: string, schema: z.ZodType<T>, name: string): Promise<T> {
    meta.calls++;
    const result = await generateText({ model, system, prompt, output: Output.object({ schema, name }) });
    meta.usage.input += result.usage.inputTokens ?? 0;
    meta.usage.output += result.usage.outputTokens ?? 0;
    return schema.parse(result.output); // validate again: the provider may relax schema keywords for native structured output
  }
  const isAnswerError = (e: unknown): e is Error => NoObjectGeneratedError.isInstance(e) || e instanceof ZodError;

  // 1. Headings.
  await stage({ stage: 'proposing' });
  let h: z.infer<typeof Headings>;
  try {
    h = await call(SYSTEM_1, userPrompt(listing), Headings, 'hts_headings');
  } catch (e) {
    if (isAnswerError(e)) return invalid(1, e);
    throw e;
  }
  meta.headings = h.headings.map((x) => x.heading);

  // 2. Expand to real lines of the current revision.
  await stage({ stage: 'matching', headings: meta.headings });
  const lines = new Map<string, HtsLine>();
  for (const heading of meta.headings) {
    const expanded = expandHeading(heading, opts.idx);
    if (expanded.length === 0) meta.invalidHeadings.push(heading);
    for (const line of expanded) lines.set(line.code, line);
  }
  meta.expanded = lines.size;
  if (lines.size === 0) return done({ kind: 'STOPPED', review: { needsReview: true, reasons: ['NO_CANDIDATES', ...originReasons] }, meta });
  if (lines.size > MAX_EXPANDED_LINES) return done({ kind: 'STOPPED', review: { needsReview: true, reasons: ['TOO_BROAD', ...originReasons] }, meta });

  // 3. Choose from the list only.
  await stage({ stage: 'choosing', headings: meta.headings, expanded: lines.size });
  const candidates = [...lines.values()];
  const list = candidates.map((c, i) => `${i + 1}. ${c.code} — ${c.chain.join(' > ')}`).join('\n');
  let choice: GroundedChoice;
  try {
    choice = await call(SYSTEM_2, `${userPrompt(listing)}\n\nValid candidate lines (HTSUS ${CURRENT_HTS_REVISION}):\n${list}`, groundedChoiceSchema(candidates.map((c) => c.code)), 'hts_choice');
  } catch (e) {
    if (isAnswerError(e)) return invalid(2, e);
    throw e;
  }

  // 4. Verify quotes, then route.
  const verified = verifyQuotes(listingText(listing), choice);
  meta.droppedQuotes = verified.droppedQuotes;
  const review = decideGroundedReview(verified, { threshold: opts.threshold, originKnown: Boolean(listing.origin), idx: opts.idx });
  return done({ kind: 'OK', choice: verified.choice, candidates, review, meta });
}
