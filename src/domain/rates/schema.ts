// Rate data file schema (data/rates/<version>.json). Rates are DATA (invariant 2): this file defines the shape only.
// Integers only: ad valorem rates in ppm (12.5% = 125000), specific amounts in USD micros ($1.53 = 1530000).
// Method for producing a row: docs/HTS_VERIFICATION_SPEC.md. Objects are strict so a typo'd key fails validation.
import { z } from 'zod';

const Ppm = z.number().int().nonnegative();
const UsdMicros = z.number().int().positive();
const Text = z.string().min(1);
const IsoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'expected YYYY-MM-DD');
const Hts10 = z.string().regex(/^\d{4}\.\d{2}\.\d{4}$/, 'expected NNNN.NN.NNNN');
const Chapter99 = z.string().regex(/^99\d{2}\.\d{2}\.\d{2}$/, 'expected 99NN.NN.NN');

export const ComponentSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('specific'), amount_usd_micros: UsdMicros, per: z.literal('each') }),
  z.strictObject({ kind: z.literal('ad_valorem'), rate_ppm: Ppm, applies_to: z.enum(['full_value', 'case', 'band']) }),
]);

export const MfnSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('free') }),
  z.strictObject({ type: z.literal('ad_valorem'), rate_ppm: Ppm }),
  z.strictObject({ type: z.literal('specific'), text: Text, components: z.array(ComponentSchema).min(1) }),
  z.strictObject({ type: z.literal('compound'), text: Text, components: z.array(ComponentSchema).min(1) }),
]);

export const ConditionSchema = z.strictObject({ fact: Text, required_value: z.boolean(), ref: Text });

export const AdditionalSchema = z.strictObject({
  program: Text,
  chapter99: Chapter99,
  /** combined_cap only: heading used when the base rate (or AVE) is at or above the cap. */
  chapter99_at_or_above_cap: Chapter99.optional(),
  rule: z.enum(['combined_cap', 'additive', 'exempt']),
  rate_ppm: Ppm,
  basis: z.literal('full_value'),
  compare: z.literal('ave').optional(),
  conditions: z.array(ConditionSchema),
  ref: Text,
});

export const RateRowSchema = z.strictObject({
  id: Text,
  hts10: Hts10,
  origin: z.string().regex(/^[A-Z]{2}$/, 'expected ISO 3166 alpha-2'),
  listings: z.array(Text).min(1),
  description: Text,
  mfn: MfnSchema,
  special_note: Text.optional(),
  additional: z.array(AdditionalSchema),
  not_applied: z.array(z.strictObject({ program: Text, chapter99: Chapter99, reason: Text, ref: Text })),
  exemptions_checked: z.strictObject({ done: z.literal(true), refs: z.array(Text).min(1) }),
  source_refs: z
    .array(
      z.strictObject({
        kind: z.enum(['hts_line', 'ch99_heading', 'us_note', 'csms']),
        ref: Text,
        url: z.url().optional(),
      }),
    )
    .min(1),
  ruling: z.strictObject({
    number: Text.nullable(),
    status: z.enum(['supports', 'analogy', 'none']),
    note: Text.optional(),
  }),
  evidence: Text,
  verified_by: Text,
  verified_on: IsoDate,
  hts_revision: Text,
  effective_from: IsoDate,
  effective_to: IsoDate.nullable(),
});

export const RateFileSchema = z.strictObject({
  version: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'expected e.g. 2026-rev20-v1'),
  hts_revision: Text,
  generated_from: z.strictObject({ file: Text, tab: Text, sha256: z.string().regex(/^[0-9a-f]{64}$/) }),
  regime_notes: z.array(Text),
  rows: z.array(RateRowSchema).min(1),
});

export type Component = z.infer<typeof ComponentSchema>;
export type Mfn = z.infer<typeof MfnSchema>;
export type Additional = z.infer<typeof AdditionalSchema>;
export type RateRow = z.infer<typeof RateRowSchema>;
export type RateFile = z.infer<typeof RateFileSchema>;
