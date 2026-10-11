// A reviewed list of Chapter 99 headings that a primary source ends although the HTS still prints them (see headings.ts
// VerifiedOverride). Data, not code: data/reviews/<name>.json, written once from an approved review document and changed
// only by a new review. Strict zod. Pure.
import { z } from 'zod';
import type { VerifiedOverride } from './headings';

const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const Heading = z.string().regex(/^99\d{2}\.\d{2}\.\d{2}$/);

export const ReviewedListSchema = z.strictObject({
  name: z.string().min(1),
  hts_revision: z.string().min(1),
  review_document: z.string().min(1),
  reviewed_on: IsoDate,
  reviewers: z.array(z.string().min(1)).min(1),
  sources: z
    .array(z.strictObject({ title: z.string().min(1), citation: z.string().min(1), urls: z.array(z.url()).min(1), read_on: IsoDate, says: z.string().min(1) }))
    .min(1),
  /** The docs sentence G0 checks is still there. */
  docs_quote: z.strictObject({ file: z.string().min(1), quote: z.string().min(1) }),
  prefixes: z.array(z.string().regex(/^99\d{2}\.\d{2}\.$/)).min(1),
  /** sha256 of "<heading text with parent rows>\n<General column>" (headingTextSha), as reviewed. */
  headings: z.array(z.strictObject({ heading: Heading, group: z.string().min(1), order: z.string().min(1), text_sha256: z.string().regex(/^[0-9a-f]{64}$/) })).min(1),
  /** Reviewed and deliberately left out (still in force), with why. */
  excluded: z.array(z.strictObject({ heading: Heading, why: z.string().min(1) })),
});
export type ReviewedList = z.infer<typeof ReviewedListSchema>;

export function overrideFromList(list: ReviewedList, listFile: string): VerifiedOverride {
  const dup = list.headings.map((h) => h.heading).find((h, i, a) => a.indexOf(h) !== i);
  if (dup) throw new Error(`${listFile}: ${dup} is listed twice`);
  return { prefixes: list.prefixes, file: list.docs_quote.file, quote: list.docs_quote.quote, listFile, reviewedOn: list.reviewed_on, headings: list.headings };
}
