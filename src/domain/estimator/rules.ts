// Estimator rules: how a Chapter 99 heading applies to an origin, drafted from official text (by Claude, or by hand for the
// reference fixture) and accepted only through the gate (gate.ts). Rules are DATA; this file is their shape. Strict zod.
// Kinds:
// - combined_cap: column 1 (or its AVE, note 52(k)) below the cap → total = cap; at or above → `cap_heading_at_or_above`,
//   no add-on (9903.05.49/.48 JP 12.5%, 9903.05.39/.38 EU 10%).
// - exempt: lines in `scope.list` (a note subdivision's code list) pay no Chapter 99 add-on (9903.05.86, .97).
// - conditional_exempt: exempt only when the fact holds; unanswered → both figures (.87 items, .88 civil aircraft,
//   .89 pharmaceutical use, .92 informational materials). Questions are built by code, never by the model.
// - not_for_sale: the heading covers only goods that are not sold (9903.05.91 donations); an estimate is for a sale.
// - via_coverage: the heading exempts goods of other Chapter 99 regimes (9903.05.90 → 232 etc.); a line named by those
//   regimes is refused by the coverage check, so the rule adds nothing by itself.
import { z } from 'zod';

const Ch99 = z.string().regex(/^99\d{2}\.\d{2}\.\d{2}$/);
/** "heading 9903.05.49" (its official text) or "note III 52(k)" (a note subdivision's text). */
const Source = z.string().regex(/^(heading 99\d{2}\.\d{2}\.\d{2}|note [IVXL]+ \d+(\([a-zA-Z0-9]+\))*)$/);
const NoteRef = z.string().regex(/^note [IVXL]+ \d+(\([a-zA-Z0-9]+\))+$/);
const Fact = z.string().regex(/^[a-z][a-z0-9_]*$/);

export const QuoteSchema = z.strictObject({ source: Source, text: z.string().min(12) });

export const RuleSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9-]+$/),
  origins: z.array(z.enum(['JP', 'EU'])).min(1),
  heading: Ch99,
  kind: z.enum(['combined_cap', 'exempt', 'conditional_exempt', 'not_for_sale', 'via_coverage']),
  /** combined_cap only. */
  rate_ppm: z.number().int().positive().optional(),
  /** combined_cap only. */
  cap_heading_at_or_above: Ch99.optional(),
  scope: z.union([
    z.strictObject({ all: z.literal(true) }),
    /** The code list of a note subdivision and its children. */
    z.strictObject({ list: NoteRef }),
    /** Lines whose official description chain contains one of the words the heading's own text lists. */
    z.strictObject({ heading_words: Ch99 }),
  ]),
  condition: z.strictObject({ fact: Fact }).optional(),
  quotes: z.array(QuoteSchema).min(1),
  /** Which quote states each number (index into quotes). */
  numbers: z.strictObject({ rate_ppm: z.number().int().nonnegative().optional() }),
  /** sha256 of each quoted source's text at drafting time: unchanged text → the rule is reused without a model call. */
  drafted_from_sha256: z.record(Source, z.string().regex(/^[0-9a-f]{64}$/)),
  drafted_by: z.string().min(1),
});

export const RulesFileSchema = z.strictObject({
  hts_revision: z.string().min(1),
  rules: z.array(RuleSchema).min(1),
});

export type Rule = z.infer<typeof RuleSchema>;
export type RulesFile = z.infer<typeof RulesFileSchema>;

/**
 * Where a drafted rule differs from the reference rule for the same heading: origins, kind, numbers, scope, and whether it
 * has a condition (a fact's name is reported apart by `factNameDiff`; G8 catches a wrong name for a fact verified rows use).
 */
export function compareToReference(drafted: Rule, reference: Rule | undefined): string[] {
  if (!reference) return [`no reference rule for ${drafted.heading}`];
  const diffs: string[] = [];
  const field = (name: string, a: unknown, b: unknown) => {
    if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${name}: drafted ${JSON.stringify(a)} ≠ reference ${JSON.stringify(b)}`);
  };
  field('origins', [...drafted.origins].sort(), [...reference.origins].sort());
  field('kind', drafted.kind, reference.kind);
  field('rate_ppm', drafted.rate_ppm, reference.rate_ppm);
  field('cap_heading_at_or_above', drafted.cap_heading_at_or_above, reference.cap_heading_at_or_above);
  field('scope', drafted.scope, reference.scope);
  field('condition', drafted.condition !== undefined, reference.condition !== undefined);
  return diffs;
}

export function factNameDiff(drafted: Rule, reference: Rule | undefined): string | null {
  const a = drafted.condition?.fact;
  const b = reference?.condition?.fact;
  return a && b && a !== b ? `${drafted.heading}: fact "${a}" (reference "${b}")` : null;
}
