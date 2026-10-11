// The gate: rules and data are published only through these checks. Pure (sources come in as arguments).
// G0 docs-verified overrides still say what they claim (quote in the file)         → fail: every origin blocked
// G1 rule schema and shape (kind ↔ fields; quoted sources ↔ drafted_from_sha256; revision); stale source text  → rule blocked
// G2 every quote is verbatim in its cited source (heading text with parents, or note subdivision text)        → rule blocked
// G3 every number is read by code from the rule's own quote and agrees with the official heading text/rate column → rule blocked
// G4 cited headings exist and are in force; a list belongs to the rule's heading ("As provided in heading …")  → rule blocked
// G5 list scope: subdivision exists, has codes, codes are real lines (ch. 98 counted apart, ≤ 0.5% unknown), count
//    within ±20% of the previous version                                                                      → rule blocked
// G6 footnotes that name a modeled heading only name lines in its list                                         → rule blocked
// G7 coverage: no in-force heading that can apply to the origin is left without a rule or a line             → origin blocked
// G8 golden: automated-only estimates reproduce every verified case of the origin exactly (total and Ch. 99 headings),
//    or refuse naming the same regime the verified row records; expected refusals refuse                     → origin blocked
// G9 the rate-text parser re-reads every verified row's General rate from the export to the stored components → all blocked
import { quoteDuty } from '@/domain/rates/engine';
import type { RateFile } from '@/domain/rates/schema';
import { usd } from '@/domain/money/money';
import { createHash } from 'node:crypto';
import { normaliseText } from './ch99Text';
import { coverageIndex, lineVerdicts, originGaps, type CoverageContext } from './coverage';
import type { EstimatorData } from './data';
import { estimateLine } from './estimate';
import { overrideQuoteHolds, type VerifiedOverride, VERIFIED_OVERRIDES } from './headings';
import { originOf, type OriginGroup } from './origin';
import { toEngineMfn } from './rateText';
import { RuleSchema, type Rule } from './rules';

export interface GoldenCase {
  id: string;
  origin: string;
  hts10?: string | null;
  price_minor?: number;
  quantity?: number;
  value_split?: { case_minor: number; band_minor: number };
  facts?: Record<string, boolean>;
  expected: 'OK' | 'UNSUPPORTED';
}

export interface GateInput {
  data: Omit<EstimatorData, 'rules' | 'blocked'>;
  rules: unknown[];
  rulesRevision: string;
  /** HTS index codes of the same revision (dddd.dd.dddd, or dddd.dd.dd for component reporting). */
  knownCodes: string[];
  golden: GoldenCase[];
  verified: RateFile;
  /** File path → text, for the overrides' quotes (docs/SPEC.md). */
  docs: Record<string, string>;
  overrides?: VerifiedOverride[];
  /** List sizes of the previous published version ("note III 52(b)" → codes), for the drift alarm. */
  previousListCounts?: Record<string, number>;
  /** Origins the gate covers; a golden case of another origin is skipped. */
  origins: string[];
}

export interface GateCheck {
  id: 'G0' | 'G1' | 'G2' | 'G3' | 'G4' | 'G5' | 'G6' | 'G7' | 'G8' | 'G9';
  subject: string;
  pass: boolean;
  detail: string;
}

export interface GateReport {
  checks: GateCheck[];
  blockedRules: { id: string; reasons: string[] }[];
  blockedOrigins: Partial<Record<OriginGroup, string[]>>;
  alerts: string[];
  listCounts: Record<string, { codes: number; ch98: number; unknown: string[] }>;
  coverage: Record<string, { lines: number; refused: number; byRef: Record<string, number> }>;
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const pct = (ppm: number) => `${Math.floor(ppm / 10_000)}${ppm % 10_000 ? `.${String(ppm % 10_000).padStart(4, '0').replace(/0+$/, '')}` : ''}`;
/** "12.5" → 125000 (integers only). */
export function percentToPpm(s: string): number {
  const [i, f = ''] = s.split('.');
  return Number(i) * 10_000 + Number(f.padEnd(4, '0').slice(0, 4));
}
const PERCENTS = /(\d+(?:\.\d+)?)\s*(?:percent\b|%)/g;
const NO_ADD_ON = 'The duty provided in the applicable subheading';

/** Official text a quote may cite. */
export function sourceText(source: string, data: GateInput['data']): string | undefined {
  if (source.startsWith('heading ')) return data.headings[source.slice(8)]?.chain;
  const m = /^note (\S+) (.+)$/.exec(source);
  return m ? data.notes.subdivisions.find((s) => s.section === m[1] && s.path === m[2])?.text : undefined;
}

export const sourceSha = (source: string, data: GateInput['data']) => {
  const t = sourceText(source, data);
  return t === undefined ? undefined : sha(t);
};

function listCodes(list: string, data: GateInput['data']) {
  const [, section, path] = /^note (\S+) (.+)$/.exec(list)!;
  const subs = data.notes.subdivisions.filter((s) => s.section === section && (s.path === path || s.path.startsWith(`${path}(`)));
  return { exists: subs.some((s) => s.path === path), codes: [...new Set(subs.flatMap((s) => [...s.codes10, ...s.codes8]))], subs };
}

export function runGate(input: GateInput): { data: EstimatorData; report: GateReport } {
  const { data } = input;
  const checks: GateCheck[] = [];
  const alerts: string[] = [];
  const check = (id: GateCheck['id'], subject: string, pass: boolean, detail: string) => {
    checks.push({ id, subject, pass, detail });
    if (!pass) alerts.push(`${id} ${subject}: ${detail}`);
    return pass;
  };
  const blockedOrigins: GateReport['blockedOrigins'] = {};
  const blockOrigin = (g: OriginGroup, why: string) => (blockedOrigins[g] ??= []).push(why);
  const groups = [...new Set(input.origins.map((o) => originOf(o)!.group))];

  // G0
  for (const o of input.overrides ?? VERIFIED_OVERRIDES) {
    const ok = check('G0', o.file, overrideQuoteHolds(input.docs[o.file] ?? '', o.quote), `override for ${o.prefixes.join(', ')}: quote must be in ${o.file}`);
    if (!ok) for (const g of groups) blockOrigin(g, `G0 ${o.file} no longer says what the override claims`);
  }

  // G1–G6 per rule
  const known = new Set(input.knownCodes);
  const known8 = new Set(input.knownCodes.map((c) => c.slice(0, 10)));
  const accepted: Rule[] = [];
  const blockedRules: { rule: Rule | null; id: string; reasons: string[] }[] = [];
  const listCounts: GateReport['listCounts'] = {};
  input.rules.forEach((raw, i) => {
    const reasons: string[] = [];
    const fail = (id: GateCheck['id'], subject: string, ok: boolean, detail: string) => {
      if (!check(id, subject, ok, detail)) reasons.push(`${id}: ${detail}`);
    };
    const parsed = RuleSchema.safeParse(raw);
    const rid = (raw as { id?: unknown })?.id;
    const subject = typeof rid === 'string' ? rid : `rules[${i}]`;
    if (!parsed.success) {
      fail('G1', subject, false, `schema: ${parsed.error.issues.map((x) => `${x.path.join('.')} ${x.message}`).join('; ')}`);
      blockedRules.push({ rule: null, id: subject, reasons });
      return;
    }
    const r = parsed.data;
    // G1 shape
    const cap = r.kind === 'combined_cap';
    fail('G1', r.id, input.rulesRevision === data.hts_revision, `rules are for ${input.rulesRevision}, data is ${data.hts_revision}`);
    fail('G1', r.id, cap === (r.rate_ppm !== undefined && r.cap_heading_at_or_above !== undefined && r.numbers.rate_ppm !== undefined), 'rate_ppm, cap_heading_at_or_above and numbers.rate_ppm are for combined_cap and required there');
    fail('G1', r.id, !cap || 'all' in r.scope, 'combined_cap applies to all lines');
    fail('G1', r.id, (r.kind === 'conditional_exempt') === (r.condition !== undefined), 'condition is for conditional_exempt and required there');
    fail('G1', r.id, !(r.kind === 'exempt' || r.kind === 'conditional_exempt') || !('all' in r.scope), 'an exemption needs a list or heading_words scope');
    const sources = [...new Set(r.quotes.map((q) => q.source))].sort();
    fail('G1', r.id, JSON.stringify(Object.keys(r.drafted_from_sha256).sort()) === JSON.stringify(sources), 'drafted_from_sha256 must name exactly the quoted sources');
    for (const s of sources) {
      const now = sourceSha(s, data);
      if (now !== undefined && r.drafted_from_sha256[s] !== undefined) fail('G1', r.id, now === r.drafted_from_sha256[s], `${s} text changed since drafting (stale; needs re-drafting)`);
    }
    // G2
    for (const q of r.quotes) {
      const t = sourceText(q.source, data);
      fail('G2', r.id, t !== undefined && t.includes(normaliseText(q.text)), `quote not verbatim in ${q.source}: "${q.text.slice(0, 80)}…"`);
    }
    // G3
    const h = data.headings[r.heading];
    if (cap && h) {
      const q = r.quotes[r.numbers.rate_ppm!];
      const nums = q ? [...q.text.matchAll(PERCENTS)].map((m) => percentToPpm(m[1]!)) : [];
      fail('G3', r.id, nums.length > 0 && nums.every((n) => n === r.rate_ppm), `rate ${pct(r.rate_ppm!)}% must be every percentage in quote ${r.numbers.rate_ppm} (found ${nums.map(pct).join(', ') || 'none'})`);
      fail('G3', r.id, !!q && q.text.includes(r.heading), `the rate quote must name ${r.heading}`);
      fail('G3', r.id, h.general === `${pct(r.rate_ppm!)}%`, `${r.heading} General column is "${h.general}", expected "${pct(r.rate_ppm!)}%"`);
      fail('G3', r.id, h.chain.includes(`less than ${pct(r.rate_ppm!)} percent`), `${r.heading} text must say "less than ${pct(r.rate_ppm!)} percent"`);
      const above = data.headings[r.cap_heading_at_or_above!];
      fail('G3', r.id, !!above && above.chain.includes(`equal to or greater than ${pct(r.rate_ppm!)} percent`) && above.general === NO_ADD_ON, `${r.cap_heading_at_or_above} must say "equal to or greater than ${pct(r.rate_ppm!)} percent" and add nothing`);
    } else if (h) {
      fail('G3', r.id, r.numbers.rate_ppm === undefined && r.rate_ppm === undefined, 'this kind carries no number');
      fail('G3', r.id, h.general === NO_ADD_ON, `${r.heading} General column must add nothing ("${NO_ADD_ON}"), is "${h.general}"`);
    }
    // G4
    for (const x of [r.heading, ...(r.cap_heading_at_or_above ? [r.cap_heading_at_or_above] : [])]) {
      fail('G4', r.id, !!data.headings[x], `${x} is not a heading of ${data.hts_revision}`);
      fail('G4', r.id, !data.outOfForce[x], `${x} is out of force (${data.outOfForce[x]?.why}: ${data.outOfForce[x]?.ref})`);
    }
    if ('list' in r.scope) {
      const own = data.notes.subdivisions.find((s) => `note ${s.section} ${s.path}` === (r.scope as { list: string }).list);
      fail('G4', r.id, !!own && own.asProvidedIn.headings.includes(r.heading) && own.shallNotApply, `${r.scope.list} must open "As provided in heading ${r.heading}" and say "shall not apply"`);
    }
    if ('heading_words' in r.scope) fail('G4', r.id, r.scope.heading_words === r.heading, 'heading_words must be the rule heading');
    // G5
    if ('list' in r.scope) {
      const { exists, codes } = listCodes(r.scope.list, data);
      const ch98 = codes.filter((c) => c.startsWith('98'));
      const real = codes.filter((c) => !c.startsWith('98'));
      const unknown = real.filter((c) => !(c.length === 12 ? known.has(c) : known8.has(c) || known.has(c)));
      listCounts[r.scope.list] = { codes: codes.length, ch98: ch98.length, unknown };
      fail('G5', r.id, exists && real.length > 0, `${r.scope.list} must exist and list codes`);
      fail('G5', r.id, unknown.length <= Math.floor(real.length * 0.005), `${unknown.length} listed codes are not ${data.hts_revision} lines: ${unknown.slice(0, 10).join(', ')}`);
      const prev = input.previousListCounts?.[r.scope.list];
      if (prev !== undefined) fail('G5', r.id, Math.abs(codes.length - prev) <= prev * 0.2, `${r.scope.list}: ${codes.length} codes vs ${prev} in the previous version (> ±20%)`);
    }
    // G6
    if ('list' in r.scope) {
      const outside: string[] = [];
      const listed = listCodes(r.scope.list, data).codes.map((t) => t.replace(/\./g, ''));
      for (const [c, v] of Object.entries(data.base.codes)) {
        const named = (v.fn ?? []).some((f) => f.headings.includes(r.heading) || f.ranges.some(([a, b]) => r.heading >= a && r.heading <= b));
        if (named && !listed.some((t) => c.replace(/\./g, '').startsWith(t))) outside.push(c);
      }
      fail('G6', r.id, outside.length === 0, `lines with a footnote to ${r.heading} outside ${r.scope.list}: ${outside.slice(0, 10).join(', ')}`);
    }
    if (reasons.length) blockedRules.push({ rule: r, id: r.id, reasons });
    else accepted.push(r);
  });

  // G9
  const g9: string[] = [];
  for (const row of input.verified.rows) {
    const b = data.base.codes[row.hts10];
    const p = b?.r ? data.base.rateRows[b.r] : undefined;
    const mfn = p ? toEngineMfn(p) : null;
    // components and type only: a verified row's text is the sheet's shorthand ("4.2% case"), the export's is official
    const strip = (m: unknown) => JSON.stringify(m, (k, v) => (k === 'text' ? undefined : v));
    if (!mfn || strip(mfn) !== strip(row.mfn)) g9.push(`${row.id}: export "${p?.text ?? '—'}" → ${JSON.stringify(mfn)} ≠ stored ${JSON.stringify(row.mfn)}`);
  }
  if (!check('G9', 'parser', g9.length === 0, g9.join('; ') || `${input.verified.rows.length} verified rows re-parsed`)) for (const g of groups) blockOrigin(g, 'G9 parser self-check failed');

  // G7
  const ctx: CoverageContext = { headings: data.headings, outOfForce: data.outOfForce, notes: data.notes, mentions: data.mentions, rules: accepted };
  const idx = coverageIndex(ctx);
  const coverage: GateReport['coverage'] = {};
  for (const iso of input.origins) {
    const o = originOf(iso)!;
    const gaps = originGaps(o, ctx, idx);
    if (!check('G7', `origin ${iso}`, gaps.length === 0, gaps.length ? `in-force headings that can apply to ${iso} with no rule and no line: ${gaps.join(', ')}` : 'no origin-level gap')) {
      blockOrigin(o.group, `G7 unplaced headings ${gaps.join(', ')}`);
    }
    const byRef: Record<string, number> = {};
    let refused = 0;
    for (const c of Object.keys(data.base.codes)) {
      const open = lineVerdicts(c, o, ctx, idx).filter((v) => v.verdict === 'unmodeled');
      if (!open.length) continue;
      refused++;
      for (const v of open) byRef[v.ref.replace(/^(note \S+ \d+).*/, '$1')] = (byRef[v.ref.replace(/^(note \S+ \d+).*/, '$1')] ?? 0) + 1;
    }
    coverage[iso] = { lines: Object.keys(data.base.codes).length, refused, byRef };
  }

  // G8 (with what passed so far)
  const result: EstimatorData = { ...data, rules: accepted, blocked: { rules: blockedRules.filter((b) => b.rule).map((b) => ({ rule: b.rule!, reasons: b.reasons })), origins: {} } };
  for (const c of input.golden) {
    const o = originOf(c.origin);
    if (!o || !input.origins.includes(c.origin)) continue;
    const est = estimateLine(
      {
        code: c.hts10 ?? '',
        origin: c.origin,
        entryDate: data.asOf,
        customsValue: usd(c.price_minor ?? 1),
        quantity: c.quantity ?? 1,
        ...(c.value_split ? { valueSplit: { case: usd(c.value_split.case_minor), band: usd(c.value_split.band_minor) } } : {}),
        ...(c.facts ? { facts: c.facts } : {}),
      },
      result,
    );
    let ok: boolean;
    let detail: string;
    if (c.expected === 'UNSUPPORTED') {
      ok = est.kind === 'CANT_ESTIMATE';
      detail = est.kind === 'CANT_ESTIMATE' ? `refused as expected (${est.reason})` : 'estimated a case the verified data refuses';
    } else {
      const v = quoteDuty(input.verified, {
        origin: c.origin,
        hts10: c.hts10!,
        entryDate: input.verified.rows.find((r) => r.origin === c.origin && r.hts10 === c.hts10)?.effective_from ?? data.asOf,
        customsValue: usd(c.price_minor!),
        quantity: c.quantity ?? 1,
        ...(c.value_split ? { valueSplit: { case: usd(c.value_split.case_minor), band: usd(c.value_split.band_minor) } } : {}),
        ...(c.facts ? { facts: c.facts } : {}),
      });
      if (v.kind !== 'OK') {
        ok = false;
        detail = `verified quote failed: ${v.reason}`;
      } else if (est.kind === 'ESTIMATE') {
        const hv = v.lines.filter((l) => l.chapter99).map((l) => l.chapter99).join(' + ');
        const he = est.result.lines.filter((l) => l.chapter99).map((l) => l.chapter99).join(' + ');
        ok = est.result.totalDuty.amountMinor === v.totalDuty.amountMinor && he === hv;
        detail = `estimate ${est.result.totalDuty.amountMinor} (${he}) vs verified ${v.totalDuty.amountMinor} (${hv})`;
      } else {
        // a refusal is right only when it names a regime the verified row records and the rules don't model
        const row = input.verified.rows.find((r) => r.origin === c.origin && r.hts10 === c.hts10)!;
        const modeled = new Set(accepted.flatMap((r) => [r.heading, r.cap_heading_at_or_above]));
        const disclosed = new Set(
          row.additional.filter((a) => !modeled.has(a.chapter99)).flatMap((a) => [...a.ref.matchAll(/\bnote (\d+)/g)].map((m) => m[1]!)),
        );
        const named = new Set(est.refs.flatMap((r) => [.../^note III (\d+)/.exec(r)?.slice(1) ?? []]));
        ok = est.reason === 'UNMODELED_REGIME' && [...named].some((n) => disclosed.has(n));
        detail = `refused (${est.reason}: ${est.refs.join(', ')}); verified row records note(s) ${[...disclosed].join(', ') || 'none'} outside the rules`;
      }
    }
    if (!check('G8', `${c.id} ${c.origin} ${c.hts10}`, ok, detail)) blockOrigin(o.group, `G8 ${c.id} ${c.origin}`);
  }

  result.blocked.origins = blockedOrigins;
  return {
    data: result,
    report: { checks, blockedRules: blockedRules.map((b) => ({ id: b.id, reasons: b.reasons })), blockedOrigins, alerts, listCounts, coverage },
  };
}
