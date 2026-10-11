// Rule drafting by Claude (structured output), then code fills what the model must not: the id, the sha256 of every quoted
// source, and who drafted it. The model sees only official text — never the reference rules, amounts or expected answers —
// and its rules are accepted only through the gate (gate.ts), including agreement with the reference rules (GR).
// Calls are budgeted by the caller (`budget`, retries included).
import { generateText, NoObjectGeneratedError, Output, type LanguageModel } from 'ai';
import { ZodError } from 'zod';
import { sourceSha, sourceText, type GateInput } from './gate';
import { RuleSchema, type Rule } from './rules';

export const DRAFT_MODEL = 'claude-opus-5-5';

/** Fact names already used by verified rows; a condition that is one of these must use the same name. */
export const KNOWN_FACTS = ['informational_material', 'steel_weight_share_ge_15pct', 'steel_us_melted_poured_ge_85pct'];

const DraftSchema = RuleSchema.omit({ id: true, drafted_from_sha256: true, drafted_by: true });

const SYSTEM = `You turn official U.S. tariff text (HTSUS Chapter 99, headings and U.S. note 52 to subchapter III) into one machine-readable rule for one heading.
Rules:
- Use only the texts given. Every quote must be copied verbatim (exact words and punctuation) from the cited source.
- Never compute amounts. A number in the rule must appear in one of your quotes; numbers.rate_ppm is the index of the quote that states the rate.
- rate_ppm is parts per million of value (12.5 percent = 125000).
- origins: "JP" for goods of Japan, "EU" for goods of a member state of the European Union; list the ones the heading can apply to among these two.
- kind:
  combined_cap — the heading tops column 1 duty (or its ad valorem equivalent) up to a combined rate; give rate_ppm and cap_heading_at_or_above (the heading used when column 1 is at or above that rate); scope {"all": true}.
  exempt — goods in a list of a note subdivision pay none of the additional duties; scope {"list": "note III 52(x)"}.
  conditional_exempt — exempt only when a fact about the goods holds; give condition.fact and the scope: the subdivision list, or {"heading_words": "<this heading>"} when the heading itself describes the goods by a list of words.
  not_for_sale — the heading covers only goods that are not sold (e.g. donations); scope {"all": true}.
  via_coverage — the heading exempts goods that other Chapter 99 regimes cover (it lists those regimes, not goods); scope {"all": true}.
- condition.fact: snake_case. If the condition is one of these existing facts, use its name: ${KNOWN_FACTS.join(', ')}.
- Sources are written "heading 9903.05.49" or "note III 52(k)" exactly as given.`;

/** Long runs of codes in a list subdivision are elided for the prompt; the gate checks lists by code, not the model. */
const elide = (t: string) => t.replace(/(?:\b\d{4}\.\d{2}(?:\.\d{2,4})?;?\s*){6,}/g, (m) => `[${(m.match(/\d{4}\.\d{2}/g) ?? []).length} HTSUS provisions listed] `);

export interface DraftContext {
  heading: string;
  sources: string[];
}

/**
 * The texts a heading's rule is drafted from: the heading and its neighbours, the note 52 subdivision that defines it with
 * its items, 52(a) and 52(k).
 */
export function draftContext(heading: string, data: GateInput['data']): DraftContext {
  const all = Object.keys(data.headings).sort();
  const i = all.indexOf(heading);
  const near = [all[i - 1], heading, all[i + 1]].filter((h): h is string => !!h && h.startsWith(heading.slice(0, 7)));
  const defining = data.notes.subdivisions
    .filter((s) => s.section === 'III' && s.note === 52 && s.asProvidedIn.headings.includes(heading) && s.shallNotApply)
    .flatMap((s) => [
      `note III ${s.path}`,
      // its items ("(1) Etrogs (classifiable in subheading 0805.90.01);" …)
      ...data.notes.subdivisions.filter((c) => c.section === 'III' && c.path.startsWith(`${s.path}(`)).map((c) => `note III ${c.path}`),
    ]);
  const sources = [...near.map((h) => `heading ${h}`), ...defining, 'note III 52(a)', 'note III 52(k)'];
  return { heading, sources: [...new Set(sources)] };
}

export function draftPrompt(ctx: DraftContext, data: GateInput['data']): string {
  const blocks = ctx.sources.map((s) => {
    const general = s.startsWith('heading ') ? `\n[General column: ${data.headings[s.slice(8)]?.general || '—'}]` : '';
    return `### ${s}${general}\n${elide(sourceText(s, data) ?? '')}`;
  });
  return `Draft the rule for heading ${ctx.heading}.\n\n${blocks.join('\n\n')}`;
}

export interface DraftResult {
  rules: Rule[];
  failed: { heading: string; error: string }[];
  calls: number;
  usage: { input: number; output: number };
}

export async function draftRules(
  tasks: { id: string; heading: string }[],
  data: GateInput['data'],
  model: LanguageModel,
  opts: { budget: number; draftedBy: string },
): Promise<DraftResult> {
  const out: DraftResult = { rules: [], failed: [], calls: 0, usage: { input: 0, output: 0 } };
  for (const t of tasks) {
    const ctx = draftContext(t.heading, data);
    let last = '';
    for (let attempt = 0; attempt < 2 && out.calls < opts.budget; attempt++) {
      out.calls++;
      try {
        const r = await generateText({ model, system: SYSTEM, prompt: draftPrompt(ctx, data), output: Output.object({ schema: DraftSchema, name: 'estimator_rule' }) });
        out.usage.input += r.usage.inputTokens ?? 0;
        out.usage.output += r.usage.outputTokens ?? 0;
        const d = DraftSchema.parse(r.output);
        const sources = [...new Set(d.quotes.map((q) => q.source))].sort();
        out.rules.push({
          ...d,
          id: t.id,
          drafted_from_sha256: Object.fromEntries(sources.map((s) => [s, sourceSha(s, data) ?? 'missing-source'])),
          drafted_by: opts.draftedBy,
        } as Rule);
        last = '';
        break;
      } catch (e) {
        if (!(NoObjectGeneratedError.isInstance(e) || e instanceof ZodError)) throw e;
        last = e.message.slice(0, 300);
      }
    }
    if (last || !out.rules.some((r) => r.id === t.id)) out.failed.push({ heading: t.heading, error: last || 'call budget exhausted' });
  }
  return out;
}
