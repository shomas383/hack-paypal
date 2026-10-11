// Automated duty estimate for one HTS line, origin and price. Pure. NEVER charged: the result types are not QuoteResult,
// and nothing on the checkout / capture / agent path imports this module (noCharge.test.ts). Every amount comes from the
// official base rate text (rateText.ts) and gate-accepted rules, computed by the verified engine's math (computeRow).
import { computeRow, quoteDuty, type QuoteResult } from '@/domain/rates/engine';
import type { Additional, RateFile, RateRow } from '@/domain/rates/schema';
import type { Money } from '@/domain/money/money';
import { coverageIndex, lineVerdicts, type CoverageIndex } from './coverage';
import type { EstimatorData } from './data';
import { headingAppliesTo, originOf } from './origin';
import { toEngineMfn } from './rateText';
import type { Rule } from './rules';

export interface EstimateInput {
  /** Index form: "6203.42.4511", or "9102.21.70" for a component-reporting line. */
  code: string;
  /** ISO 3166 alpha-2 country of origin. */
  origin: string;
  /** YYYY-MM-DD */
  entryDate: string;
  customsValue: Money;
  quantity?: number;
  valueSplit?: { case: Money; band: Money };
  /** Answers to the questions conditional exemptions ask (fact → true/false). */
  facts?: Record<string, boolean>;
}

export type CantReason =
  | 'SPECIAL_PROVISION'
  | 'ORIGIN_UNSUPPORTED'
  | 'BLOCKED_BY_GATE'
  | 'UNKNOWN_CODE'
  | 'NO_RATE'
  | 'UNPARSEABLE'
  | 'NEEDS_MEASURES'
  | 'NEEDS_SPLIT'
  | 'UNMODELED_REGIME'
  | 'PARTIAL_LIST';

export interface CantEstimate {
  kind: 'CANT_ESTIMATE';
  reason: CantReason;
  detail: string;
  /** What names the line: note subdivisions and headings ("note III 16(c)(vii)", "heading 9903.41.05"). */
  refs: string[];
}

export type EstimateOk = Extract<QuoteResult, { kind: 'OK' }>;

export interface Question {
  fact: string;
  /** Official wording the answer turns on (heading or note text), quoted by code. */
  text: string;
  heading: string;
}

/** Where the figure comes from: a human-verified rate row (verified first), or the automated estimator. */
export type EstimateSource = { kind: 'verified'; rateVersion: string } | { kind: 'automated'; estimatorVersion: string };

export const sourceLabel = (s: EstimateSource) => (s.kind === 'verified' ? `Verified rate row (${s.rateVersion})` : `Automated estimate (${s.estimatorVersion})`);

export interface Estimate {
  kind: 'ESTIMATE';
  code: string;
  origin: string;
  source: EstimateSource;
  estimatorVersion: string;
  /** Without any unanswered conditional exemption (the higher figure). */
  result: EstimateOk;
  /** One figure per unanswered question: the result if the answer is yes. */
  ifYes: { question: Question; result: EstimateOk }[];
  disclosures: Disclosure[];
}

/** Always shown; never computed. */
export type Disclosure = 'SPECIAL_PROGRAMS' | 'NOT_A_RULING';

/**
 * SPECIAL_PROGRAMS covers Special-column rates (e.g. "JP", US–Japan Trade Agreement), trade-agreement subchapters and 9902
 * temporary reductions: none is applied, and each can only lower the duty (decision 2026-10-11).
 */
export const DISCLOSURE_TEXT: Record<Disclosure, string> = {
  SPECIAL_PROGRAMS: 'Lower special-program rates may apply; this estimate uses the General rate',
  NOT_A_RULING: 'Estimate — not a customs ruling.',
};

const cant = (reason: CantReason, detail: string, refs: string[] = []): CantEstimate => ({ kind: 'CANT_ESTIMATE', reason, detail, refs });
const digits = (c: string) => c.replace(/\./g, '');

/** Membership of a line in a note subdivision's code list (the subdivision and its children). */
export function listMembership(code: string, listRef: string, data: Pick<EstimatorData, 'notes'>): { kind: 'all' | 'partial' | 'none'; item?: string } {
  const [, section, path] = /^note (\S+) (.+)$/.exec(listRef)!;
  const d = digits(code);
  let partial: string | undefined;
  for (const s of data.notes.subdivisions) {
    if (s.section !== section || !(s.path === path || s.path.startsWith(`${path}(`))) continue;
    for (const t of [...s.codes10, ...s.codes8, ...s.codes6, ...s.headings4].map(digits)) {
      if (d.startsWith(t)) return { kind: 'all', item: `note ${s.section} ${s.path}` };
      if (t.startsWith(d)) partial ??= `note ${s.section} ${s.path}`;
    }
  }
  return partial ? { kind: 'partial', item: partial } : { kind: 'none' };
}

/** The words a heading's own text lists after "including but not limited to" (9903.05.92). */
export function headingWords(text: string): string[] {
  const m = /including but not limited to,? (.+)$/i.exec(text);
  if (!m) return [];
  return m[1]!.split(/,\s*(?:and\s+)?|\s+and\s+/).map((w) => w.trim().toLowerCase()).filter(Boolean);
}

function chainHasWord(chain: string[], words: string[]): boolean {
  const text = chain.join(' ').toLowerCase();
  return words.some((w) => {
    const stem = w.replace(/s$/, '');
    return new RegExp(`\\b${stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`).test(text);
  });
}

function questionFor(rule: Rule, item: string | undefined, data: EstimatorData): Question {
  // an item of the list (52(c)(1) "Etrogs (classifiable in subheading 0805.90.01);") names the article itself;
  // otherwise the heading's own text says what qualifies
  const list = 'list' in rule.scope ? rule.scope.list : undefined;
  const sub = item && list && item !== list ? data.notes.subdivisions.find((s) => `note ${s.section} ${s.path}` === item) : undefined;
  return { fact: rule.condition!.fact, text: sub ? sub.text : data.headings[rule.heading]!.text, heading: rule.heading };
}

const cache = new WeakMap<EstimatorData, CoverageIndex>();

export function estimateLine(input: EstimateInput, data: EstimatorData): Estimate | CantEstimate {
  const code = input.code;
  if (/^9[89]/.test(code)) return cant('SPECIAL_PROVISION', `${code} is a chapter ${code.slice(0, 2)} special provision: can't estimate`);
  const origin = originOf(input.origin);
  if (!origin) return cant('ORIGIN_UNSUPPORTED', `origin ${input.origin} is not supported yet (JP and DE only)`);
  const blockedOrigin = data.blocked.origins[origin.group];
  if (blockedOrigin) return cant('BLOCKED_BY_GATE', `${origin.group} estimates are blocked by the gate: ${blockedOrigin.join('; ')}`);

  const line = data.base.codes[code];
  if (!line) return cant('UNKNOWN_CODE', `${code} is not an HTS ${data.hts_revision} line`);
  if (line.r === null) return cant('NO_RATE', `${code} has no General rate text`);
  const parsed = data.base.rateRows[line.r]!;
  if (!parsed.ok) return cant('UNPARSEABLE', `${line.r} General rate "${parsed.text}" can't be computed (${parsed.reason}: ${parsed.detail})`);
  const mfn = toEngineMfn(parsed);
  if (!mfn) return cant('NEEDS_MEASURES', `${line.r} General rate "${parsed.text}" needs ${[...parsed.measures, ...parsed.splits].join(', ')}`);

  // a rule the gate blocked whose scope names the line: we can't know whether it applies
  for (const b of data.blocked.rules) {
    if (!b.rule.origins.includes(origin.group)) continue;
    // a heading that is out of force, not in the schedule or for other countries can't apply, blocked rule or not
    const h = data.headings[b.rule.heading];
    if (!h || data.outOfForce[b.rule.heading] || !headingAppliesTo(h, origin)) continue;
    const s = b.rule.scope;
    const names =
      'list' in s
        ? listMembership(code, s.list, data).kind !== 'none'
        : 'heading_words' in s
          ? chainHasWord(data.chains.get(code) ?? [], headingWords(data.headings[s.heading_words]?.text ?? ''))
          : true;
    if (names) return cant('BLOCKED_BY_GATE', `rule ${b.rule.id} (${b.rule.heading}) was blocked by the gate: ${b.reasons.join('; ')}`, [`heading ${b.rule.heading}`]);
  }

  let idx = cache.get(data);
  if (!idx) cache.set(data, (idx = coverageIndex({ ...data })));
  const verdicts = lineVerdicts(code, origin, { ...data }, idx);
  const open = verdicts.filter((v) => v.verdict === 'unmodeled');
  if (open.length) {
    const hs = [...new Set(open.flatMap((v) => v.open))];
    return cant(
      'UNMODELED_REGIME',
      `can't estimate for ${origin.iso}: ${open.map((v) => v.ref).join(', ')} name${open.length === 1 ? 's' : ''} this line and ${open.length === 1 ? "isn't" : "aren't"} modeled yet${hs.length ? ` (${hs.join(', ')})` : ''}`,
      open.map((v) => v.ref),
    );
  }

  const rules = data.rules.filter((r) => r.origins.includes(origin.group));
  let exemptBy: Rule | undefined;
  const unanswered: { rule: Rule; question: Question }[] = [];
  for (const r of rules) {
    if (r.kind !== 'exempt' && r.kind !== 'conditional_exempt') continue;
    let item: string | undefined;
    if ('list' in r.scope) {
      const m = listMembership(code, r.scope.list, data);
      if (m.kind === 'partial') return cant('PARTIAL_LIST', `only some statistical numbers under ${code} are listed in ${m.item} (${r.heading}); choose the 10-digit number`, [m.item!]);
      if (m.kind === 'none') continue;
      item = m.item;
    } else if ('heading_words' in r.scope) {
      if (!chainHasWord(data.chains.get(code) ?? [], headingWords(data.headings[r.scope.heading_words]!.text))) continue;
    } else continue;
    if (r.kind === 'exempt') {
      exemptBy ??= r;
      continue;
    }
    const answer = input.facts?.[r.condition!.fact];
    if (answer === true) exemptBy ??= r;
    else if (answer === undefined) unanswered.push({ rule: r, question: questionFor(r, item, data) });
  }

  const cap = rules.find((r) => r.kind === 'combined_cap');
  const additional = (exempt?: Rule): Additional[] => {
    if (exempt) return [{ program: exempt.id, chapter99: exempt.heading, rule: 'exempt', rate_ppm: 0, basis: 'full_value', conditions: [], ref: exempt.quotes[0]!.source }];
    if (!cap) return [];
    return [
      {
        program: cap.id,
        chapter99: cap.heading,
        ...(cap.cap_heading_at_or_above ? { chapter99_at_or_above_cap: cap.cap_heading_at_or_above } : {}),
        rule: 'combined_cap',
        rate_ppm: cap.rate_ppm!,
        basis: 'full_value',
        compare: 'ave',
        conditions: [],
        ref: cap.quotes[cap.numbers.rate_ppm ?? 0]!.source,
      },
    ];
  };
  const row = (exempt?: Rule): Pick<RateRow, 'id' | 'hts10' | 'mfn' | 'additional' | 'source_refs'> => ({
    id: `estimate-${origin.iso}-${code}`,
    hts10: code,
    mfn,
    additional: additional(exempt),
    source_refs: [{ kind: 'hts_line', ref: `${line.r} General (HTS ${data.hts_revision})` }],
  });
  const run = (exempt?: Rule): EstimateOk | CantEstimate => {
    const r = computeRow(row(exempt), data.version, {
      origin: origin.iso,
      hts10: code,
      entryDate: input.entryDate,
      customsValue: input.customsValue,
      quantity: input.quantity ?? 1,
      ...(input.valueSplit ? { valueSplit: input.valueSplit } : {}),
    });
    if (r.kind === 'OK') return r;
    return cant(/case\/band/.test(r.reason) ? 'NEEDS_SPLIT' : 'NEEDS_MEASURES', r.reason);
  };

  const result = run(exemptBy);
  if (result.kind === 'CANT_ESTIMATE') return result;
  const ifYes: Estimate['ifYes'] = [];
  if (!exemptBy) {
    for (const u of unanswered) {
      const r = run(u.rule);
      if (r.kind === 'CANT_ESTIMATE') return r;
      ifYes.push({ question: u.question, result: r });
    }
  }
  return {
    kind: 'ESTIMATE',
    code,
    origin: origin.iso,
    source: { kind: 'automated', estimatorVersion: data.version },
    estimatorVersion: data.version,
    result,
    ifYes,
    disclosures: ['SPECIAL_PROGRAMS', 'NOT_A_RULING'],
  };
}

/**
 * Verified first: when a human-verified rate row exists for this origin and line and quotes for this input, its figure
 * (the checkout's own math and data) is the estimate, labelled as such. Otherwise — no row, or the row needs facts the input
 * doesn't give (e.g. P11's steel facts) — the automated estimator answers. Still an estimate: nothing here is charged.
 */
export function estimateVerifiedFirst(input: EstimateInput, data: EstimatorData, verified: RateFile): Estimate | CantEstimate {
  if (verified.rows.some((r) => r.origin === input.origin && r.hts10 === input.code)) {
    const q = quoteDuty(verified, {
      origin: input.origin,
      hts10: input.code,
      entryDate: input.entryDate,
      customsValue: input.customsValue,
      quantity: input.quantity ?? 1,
      ...(input.valueSplit ? { valueSplit: input.valueSplit } : {}),
      ...(input.facts ? { facts: input.facts } : {}),
    });
    if (q.kind === 'OK') {
      return {
        kind: 'ESTIMATE',
        code: input.code,
        origin: input.origin,
        source: { kind: 'verified', rateVersion: verified.version },
        estimatorVersion: data.version,
        result: q,
        ifYes: [],
        disclosures: ['SPECIAL_PROGRAMS', 'NOT_A_RULING'],
      };
    }
  }
  return estimateLine(input, data);
}
