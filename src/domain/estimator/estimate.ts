// Automated duty estimate for one HTS line, origin and price. Pure. NEVER charged: the result types are not QuoteResult,
// and nothing on the checkout / capture / agent path imports this module (noCharge.test.ts). Every amount comes from the
// official base rate text (rateText.ts) and gate-accepted rules, computed by the verified engine's math (computeRow).
import { computeRow, quoteDuty, type QuoteResult } from '@/domain/rates/engine';
import type { Additional, RateFile, RateRow } from '@/domain/rates/schema';
import type { Money } from '@/domain/money/money';
import { citesSubdivision, coverageIndex, lineVerdicts, type CoverageIndex } from './coverage';
import { factSource } from './factSources';
import type { EstimatorData } from './data';
import { listMembership } from './lists';
import { headingAppliesTo, originOf, SUPPORTED_ORIGINS } from './origin';
import { toEngineMfn } from './rateText';
import { isListAdditive, type Rule } from './rules';

export { listMembership };

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
  | 'PARTIAL_LIST'
  /** A verified rate row covers the line but turns on facts the input doesn't have yet (asked as questions). */
  | 'NEEDS_FACTS';

export interface CantEstimate {
  kind: 'CANT_ESTIMATE';
  reason: CantReason;
  detail: string;
  /** What names the line: note subdivisions and headings ("note III 16(c)(vii)", "heading 9903.41.05"). */
  refs: string[];
  /** UNMODELED_REGIME: the Chapter 99 headings that are open for the line, with their own official text. */
  headings?: { heading: string; text: string }[];
  /** NEEDS_FACTS: the verified row's open conditions; `required` is the answer the row covers. */
  facts?: VerifiedFact[];
  /** NEEDS_FACTS: the verified row's quote when every open fact has the answer it covers. */
  ifAnswered?: EstimateOk;
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

/** A verified row's condition, asked from the official note text (factSources.ts); `required` is the answer the row covers. */
export interface VerifiedFact {
  fact: string;
  required: boolean;
  question: string;
  quotes: { ref: string; text: string }[];
}

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
  /** Note 20 exclusions in effect that name this line: not applied (they can only lower the duty), named here. */
  exclusions: { ref: string; heading: string }[];
  /** A verified row that turned on facts: the questions and the answers given. */
  answered?: (VerifiedFact & { answer: boolean })[];
}

/** Always shown (EXCLUSION_MAY_APPLY: when `exclusions` names any); never computed. */
export type Disclosure = 'SPECIAL_PROGRAMS' | 'EXCLUSION_MAY_APPLY' | 'NOT_A_RULING';

/**
 * SPECIAL_PROGRAMS covers Special-column rates (e.g. "JP", US–Japan Trade Agreement), trade-agreement subchapters and 9902
 * temporary reductions: none is applied, and each can only lower the duty (decision 2026-10-11). EXCLUSION_MAY_APPLY: an
 * exclusion in effect names some products under this line; it is not applied and can only lower the duty (2026-10-12).
 */
export const DISCLOSURE_TEXT: Record<Disclosure, string> = {
  SPECIAL_PROGRAMS: 'Lower special-program rates may apply; this estimate uses the General rate',
  EXCLUSION_MAY_APPLY: 'An exclusion in effect covers some products under this line; it is not applied here and can only lower the duty',
  NOT_A_RULING: 'Estimate — not a customs ruling.',
};

const cant = (reason: CantReason, detail: string, refs: string[] = []): CantEstimate => ({ kind: 'CANT_ESTIMATE', reason, detail, refs });

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
  if (!origin) return cant('ORIGIN_UNSUPPORTED', `origin ${input.origin} is not supported yet (${SUPPORTED_ORIGINS.join(', ')} only)`);
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
    // The headings to name: a heading or footnote ref is its own heading; a note ref, the open headings whose own text
    // cites that subdivision (a note governs many headings; naming all of them says nothing).
    const named = [...new Set(open.flatMap((v) => (v.ref.startsWith('note ') ? v.open.filter((h) => citesSubdivision(h, data.headings[h]?.text ?? '', v.ref)) : v.open)))];
    return {
      ...cant(
        'UNMODELED_REGIME',
        `can't estimate for ${origin.iso}: ${open.map((v) => v.ref).join(', ')} name${open.length === 1 ? 's' : ''} this line and ${open.length === 1 ? "isn't" : "aren't"} modeled yet${hs.length ? ` (${hs.join(', ')})` : ''}`,
        open.map((v) => v.ref),
      ),
      headings: named.flatMap((h) => (data.headings[h] ? [{ heading: h, text: data.headings[h].text }] : [])),
    };
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

  // The origin's scope-all layer (a combined cap, or an additive rate: 9903.05.31), which note 52's exemptions lift; then the
  // list duties of every list the line is on (cumulative, per note 52(a) and the notes defining them), never exempted here.
  const layer = rules.find((r) => r.kind === 'combined_cap' || (r.kind === 'additive' && 'all' in r.scope));
  const listDuties: Rule[] = [];
  for (const r of rules.filter(isListAdditive)) {
    const m = listMembership(code, r.scope.list, data);
    if (m.kind === 'partial') return cant('PARTIAL_LIST', `only some statistical numbers under ${code} are listed in ${m.item} (${r.heading}); choose the 10-digit number`, [m.item!]);
    if (m.kind === 'all') listDuties.push(r);
  }
  listDuties.sort((a, b) => a.heading.localeCompare(b.heading));
  /** Where an additive rate is stated: the note that imposes it, else the heading. */
  const additiveRef = (r: Rule) => r.quotes.find((q) => q.source.startsWith('note '))?.source ?? `heading ${r.heading}`;
  const additive = (r: Rule): Additional => ({ program: r.id, chapter99: r.heading, rule: 'additive', rate_ppm: r.rate_ppm!, basis: 'full_value', conditions: [], ref: additiveRef(r) });
  const additional = (exempt?: Rule): Additional[] => {
    const lists = listDuties.map(additive);
    if (exempt) return [{ program: exempt.id, chapter99: exempt.heading, rule: 'exempt', rate_ppm: 0, basis: 'full_value', conditions: [], ref: exempt.quotes[0]!.source }, ...lists];
    if (!layer) return lists;
    if (layer.kind === 'additive') return [additive(layer), ...lists];
    return [
      {
        program: layer.id,
        chapter99: layer.heading,
        ...(layer.cap_heading_at_or_above ? { chapter99_at_or_above_cap: layer.cap_heading_at_or_above } : {}),
        rule: 'combined_cap',
        rate_ppm: layer.rate_ppm!,
        basis: 'full_value',
        compare: 'ave',
        conditions: [],
        ref: layer.quotes[layer.numbers.rate_ppm ?? 0]!.source,
      },
      ...lists,
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
  const exclusions = exclusionsOf(verdicts);
  return {
    kind: 'ESTIMATE',
    code,
    origin: origin.iso,
    source: { kind: 'automated', estimatorVersion: data.version },
    estimatorVersion: data.version,
    result,
    ifYes,
    disclosures: disclosuresFor(exclusions),
    exclusions,
  };
}

const exclusionsOf = (verdicts: ReturnType<typeof lineVerdicts>) => verdicts.filter((v) => v.verdict === 'exclusion').map((v) => ({ ref: v.ref, heading: v.heading! }));
const disclosuresFor = (exclusions: Estimate['exclusions']): Disclosure[] => ['SPECIAL_PROGRAMS', ...(exclusions.length ? (['EXCLUSION_MAY_APPLY'] as const) : []), 'NOT_A_RULING'];

/** Note 20 exclusions in effect that name the line, for an origin (none when it is unsupported). */
function lineExclusions(code: string, iso: string, data: EstimatorData): Estimate['exclusions'] {
  const origin = originOf(iso);
  if (!origin) return [];
  let idx = cache.get(data);
  if (!idx) cache.set(data, (idx = coverageIndex({ ...data })));
  return exclusionsOf(lineVerdicts(code, origin, { ...data }, idx));
}

/**
 * Verified first: when a human-verified rate row exists for this origin and line and quotes for this input, its figure
 * (the checkout's own math and data) is the estimate, labelled as such. Otherwise — no row, or the row needs facts the input
 * doesn't give (e.g. P11's steel facts) — the automated estimator answers. Still an estimate: nothing here is charged.
 */
export function estimateVerifiedFirst(input: EstimateInput, data: EstimatorData, verified: RateFile): Estimate | CantEstimate {
  const row = verified.rows.find((r) => r.origin === input.origin && r.hts10 === input.code);
  const askable = (c: { fact: string; required_value: boolean }, lineRefs: string[]): VerifiedFact | null => {
    const s = factSource(c.fact, data.notes, { code: input.code, lineRefs });
    return s ? { fact: c.fact, required: c.required_value, question: s.question, quotes: s.quotes } : null;
  };
  if (row) {
    const quote = (facts: Record<string, boolean> | undefined) =>
      quoteDuty(verified, {
        origin: input.origin,
        hts10: input.code,
        entryDate: input.entryDate,
        customsValue: input.customsValue,
        quantity: input.quantity ?? 1,
        ...(input.valueSplit ? { valueSplit: input.valueSplit } : {}),
        ...(facts ? { facts } : {}),
      });
    // The row's conditions are facts the buyer-side listing records (e.g. P11's steel facts). An estimate asks the open
    // ones; an answer the row doesn't cover goes to the automated path, which refuses or estimates on its own terms.
    const conditions = row.additional.flatMap((a) => a.conditions);
    const contradicted = conditions.some((c) => input.facts?.[c.fact] !== undefined && input.facts[c.fact] !== c.required_value);
    const open = [...new Map(conditions.filter((c) => input.facts?.[c.fact] === undefined).map((c) => [c.fact, c])).values()];
    if (!contradicted && open.length) {
      // The automated path first when it can estimate (it asks its own official question, e.g. 9903.05.92 for P12, and an
      // answer then quotes the verified row); the row's own facts are asked only where the automated path refuses (P11).
      const auto = estimateLine(input, data);
      if (auto.kind === 'ESTIMATE') return auto;
      // Every open fact must be askable from its official sentence; otherwise the refusal stands.
      const asked = open.map((c) => askable(c, auto.refs));
      if (asked.some((a) => a === null)) return auto;
      const covered = quote({ ...input.facts, ...Object.fromEntries(open.map((c) => [c.fact, c.required_value])) });
      return {
        ...cant('NEEDS_FACTS', `${row.id} turns on ${open.map((c) => c.fact).join(', ')}`),
        facts: asked as VerifiedFact[],
        ...(covered.kind === 'OK' ? { ifAnswered: covered } : {}),
      };
    }
    const q = quote(input.facts);
    if (q.kind === 'OK') {
      const given = [...new Map(conditions.filter((c) => input.facts?.[c.fact] !== undefined).map((c) => [c.fact, c])).values()];
      const refs = given.length ? ((l) => (l.kind === 'CANT_ESTIMATE' ? l.refs : []))(estimateLine(input, data)) : [];
      const answered = given.flatMap((c) => {
        const a = askable(c, refs);
        return a ? [{ ...a, answer: input.facts![c.fact]! }] : [];
      });
      const exclusions = lineExclusions(input.code, input.origin, data);
      return {
        kind: 'ESTIMATE',
        code: input.code,
        origin: input.origin,
        source: { kind: 'verified', rateVersion: verified.version },
        estimatorVersion: data.version,
        result: q,
        ifYes: [],
        disclosures: disclosuresFor(exclusions),
        exclusions,
        ...(answered.length ? { answered } : {}),
      };
    }
  }
  return estimateLine(input, data);
}
