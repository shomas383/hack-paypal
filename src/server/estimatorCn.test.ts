// Runs in CI: CN (China) estimates over the committed estimator data version (no gitignored sources) — the reference rules
// through the gate, deliberately broken CN rules, the golden CN cases, and what each kind of note 20 / note 31 line does.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { coverageIndex, lineVerdicts } from '@/domain/estimator/coverage';
import { draftContext, draftPrompt } from '@/domain/estimator/draft';
import { estimateLine } from '@/domain/estimator/estimate';
import { classifyExclusions } from '@/domain/estimator/exclusions';
import { runGate, type GateInput } from '@/domain/estimator/gate';
import { originOf } from '@/domain/estimator/origin';
import type { Rule, RulesFile } from '@/domain/estimator/rules';
import { usd } from '@/domain/money/money';
import { loadGolden, loadVerifiedRates } from '@/domain/rates/__fixtures__/verified';
import { loadEstimator } from './estimator';
import { ieepaOverride } from './estimatorReview';
import { currentHtsIndex } from './hts';

const { data } = loadEstimator();
const FIX = join(process.cwd(), 'src', 'domain', 'estimator', '__fixtures__');
const CN_RULES = (JSON.parse(readFileSync(join(FIX, 'rules-reference-cn.json'), 'utf8')) as RulesFile).rules;
const JP_EU_RULES = (JSON.parse(readFileSync(join(FIX, 'rules-reference-jp-eu.json'), 'utf8')) as RulesFile).rules;
const cnRule = (id: string): Rule => structuredClone(CN_RULES.find((r) => r.id === id)!);
const cn = (code: string, priceMinor: number) => estimateLine({ code, origin: 'CN', entryDate: data.asOf, customsValue: usd(priceMinor) }, data);
const heads = (e: ReturnType<typeof cn>) => (e.kind === 'ESTIMATE' ? e.result.lines.map((l) => l.chapter99).filter(Boolean) : e.reason);

function gate(rules: unknown[], over: Partial<GateInput> = {}, reference: Rule[] | null = [...JP_EU_RULES, ...CN_RULES]) {
  return runGate({
    data,
    rules,
    rulesRevision: '2026 Rev. 21',
    knownCodes: currentHtsIndex().index.codes.map((c) => c.c),
    golden: loadGolden().cases.filter((c) => c.origin === 'CN'),
    verified: loadVerifiedRates(),
    docs: { 'docs/SPEC.md': readFileSync(join(process.cwd(), 'docs', 'SPEC.md'), 'utf8') },
    origins: ['CN'],
    overrides: [ieepaOverride()],
    ...(reference ? { reference } : {}),
    ...over,
  });
}
const swap = (id: string, f: (r: Rule) => void) => CN_RULES.map((r) => (r.id === id ? (f((r = cnRule(id))), r) : r));

describe('CN in the committed data version', () => {
  it('the data version carries the CN rules, accepted by the gate; CN is not blocked', () => {
    const cnHeadings = [...data.rules, ...data.blocked.rules.map((b) => b.rule)].filter((r) => r.origins.includes('CN')).map((r) => r.heading).sort();
    expect(cnHeadings).toEqual([
      '9903.05.31', '9903.05.86', '9903.05.87', '9903.05.88', '9903.05.89', '9903.05.90', '9903.05.91', '9903.05.92',
      '9903.88.01', '9903.88.02', '9903.88.03', '9903.88.15', '9903.88.16',
    ]);
    expect(data.blocked.origins.CN).toBeUndefined();
  });

  it('note 52 exemptions lift 9903.05.31 for CN, never a list duty: 52(b) → 9903.05.86 + the List 3 heading', () => {
    const e = cn('0712.90.8550', 10000); // 8.3% General; on 52(b) and 20(f)
    expect(heads(e)).toEqual(['9903.05.86', '9903.88.03']);
    expect(e.kind === 'ESTIMATE' && e.result.totalDuty).toEqual(usd(830 + 2500));
  });

  it('9903.05.92 is asked for CN too: unanswered → the higher figure, and the figure if yes (8523.49.4000)', () => {
    const e = cn('8523.49.4000', 10000);
    expect(heads(e)).toEqual(['9903.05.31', '9903.88.03']);
    expect(e.kind === 'ESTIMATE' && e.ifYes.map((y) => [y.question.heading, Number(y.result.totalDuty.amountMinor)])).toEqual([['9903.05.92', 2500]]);
  });

  it('G8: every CN verified case reproduces exactly (P05, P09, P13 — the watch $72.09 = MFN + 9903.05.31 + 9903.88.15)', () => {
    const verified = loadVerifiedRates();
    for (const c of loadGolden().cases.filter((x) => x.origin === 'CN')) {
      const split = c.value_split ? { valueSplit: { case: usd(c.value_split.case_minor), band: usd(c.value_split.band_minor) } } : {};
      const e = estimateLine({ code: c.hts10!, origin: 'CN', entryDate: data.asOf, customsValue: usd(c.price_minor!), ...split }, data);
      const row = verified.rows.find((r) => r.origin === 'CN' && r.hts10 === c.hts10)!;
      expect(e.kind, c.id).toBe('ESTIMATE');
      if (e.kind !== 'ESTIMATE') continue;
      expect(e.result.lines.map((l) => l.chapter99).filter(Boolean), c.id).toEqual(row.additional.map((a) => a.chapter99));
      if (c.id === 'P13') expect(e.result.totalDuty).toEqual(usd(7209));
    }
  });
});

describe('CN lines', () => {
  it('a line on one list: 9903.05.31 (12.5%) plus that list\'s heading, cumulative', () => {
    expect(heads(cn('0101.21.0010', 10000))).toEqual(['9903.05.31', '9903.88.15']); // 20(s)(i), Free
    expect(heads(cn('2845.40.0000', 10000))).toEqual(['9903.05.31', '9903.88.01']); // 20(b), Free
    expect(heads(cn('0301.11.0010', 10000))).toEqual(['9903.05.31', '9903.88.03']); // 20(f), Free
    const l2 = cn('3901.10.1000', 10000); // 20(d), 6.5%
    expect(heads(l2)).toEqual(['9903.05.31', '9903.88.02']);
    expect(l2.kind === 'ESTIMATE' && l2.result.totalDuty).toEqual(usd(650 + 1250 + 2500));
  });

  it('20(u) (9903.88.16, suspended) adds nothing: a line only on it pays 9903.05.31 alone', () => {
    expect(heads(cn('0304.75.1000', 10000))).toEqual(['9903.05.31']);
  });

  it('an exclusion in effect (20(vvv)) can only lower the duty: the list duty is estimated and the subdivision named', () => {
    const e = cn('0304.72.5000', 10000); // 20(f) and 20(vvv)(iii)(1); also expired 20(iii)(1), 20(oo)(1), 20(ttt)(iii)(1)
    expect(heads(e)).toEqual(['9903.05.31', '9903.88.03']);
    expect(e.kind === 'ESTIMATE' && e.exclusions).toEqual([{ ref: 'note III 20(vvv)(iii)(1)', heading: '9903.88.69', until: 'through November 9, 2026' }]);
    expect(e.kind === 'ESTIMATE' && e.disclosures).toContain('EXCLUSION_MAY_APPLY');
  });

  it('an expired exclusion is ignored (20(yy), 9903.88.46)', () => {
    const e = cn('0712.90.8510', 10000);
    expect(heads(e)).toEqual(['9903.05.31', '9903.88.03']);
    expect(e.kind === 'ESTIMATE' && e.exclusions).toEqual([]);
  });

  it('fail closed: note 31 lines, 20(s)(ii) described products, 20(g), and unclear exclusions (20(z))', () => {
    expect(cn('4015.12.1010', 10000)).toMatchObject({ kind: 'CANT_ESTIMATE', reason: 'UNMODELED_REGIME', refs: expect.arrayContaining(['note III 31(i)']) });
    expect(cn('6307.90.9825', 10000)).toMatchObject({ kind: 'CANT_ESTIMATE', reason: 'UNMODELED_REGIME', refs: expect.arrayContaining(['note III 20(s)(ii)']) });
    expect(cn('9401.69.6001', 10000)).toMatchObject({ kind: 'CANT_ESTIMATE', reason: 'UNMODELED_REGIME', refs: expect.arrayContaining(['note III 20(g)']) });
    const ctx = { ...data };
    const z = lineVerdicts('2202.99.3600', originOf('CN')!, ctx, coverageIndex(ctx)).find((v) => v.ref === 'note III 20(z)');
    expect(z).toEqual({ ref: 'note III 20(z)', verdict: 'unmodeled', open: ['9903.88.21'] });
  });

  it('JP and DE are untouched by the CN rules (0101.21.0010: the 12.5% / 10% cap only)', () => {
    const jp = estimateLine({ code: '0101.21.0010', origin: 'JP', entryDate: data.asOf, customsValue: usd(10000) }, data);
    expect(heads(jp)).toEqual(['9903.05.49']);
    const de = estimateLine({ code: '0101.21.0010', origin: 'DE', entryDate: data.asOf, customsValue: usd(10000) }, data);
    expect(heads(de)).toEqual(['9903.05.39']);
  });
});

describe('drafting context for CN headings (official text only)', () => {
  it('heading and neighbours, its "+ N%" General column, and the note 20 subdivisions that define it with their items', () => {
    expect(draftContext('9903.88.15', data).sources).toEqual([
      'heading 9903.88.14', 'heading 9903.88.15', 'heading 9903.88.16', 'general 9903.88.15', 'note III 20(r)', 'note III 20(s)', 'note III 20(s)(i)', 'note III 20(s)(ii)',
    ]);
    expect(draftContext('9903.88.16', data).sources).toEqual(['heading 9903.88.15', 'heading 9903.88.16', 'heading 9903.88.17', 'general 9903.88.16', 'note III 20(t)', 'note III 20(u)']);
    expect(draftContext('9903.05.31', data).sources).toEqual(['heading 9903.05.30', 'heading 9903.05.31', 'heading 9903.05.32', 'general 9903.05.31', 'note III 52(a)', 'note III 52(k)']);
    const p = draftPrompt(draftContext('9903.88.03', data), data);
    expect(p).toMatch(/### general 9903\.88\.03\nThe duty provided in the applicable subheading \+ 25%/);
    expect(p).toMatch(/\[\d+ HTSUS provisions listed\]/);
    expect(p).not.toMatch(/0301\.11\.00|cn-add|250000/);
  });
});

describe('note 20 exclusions in the committed data (counts pinned)', () => {
  it('5 in effect ((vvv)(i)–(iv), (www)), 58 expired, 8 unclear ((z)–(gg): derived-rate entries the note-wide compiler\'s note leaves out)', () => {
    const c = classifyExclusions(data.notes, data.headings, data.outOfForce);
    expect(c.counts).toEqual({ in_effect: 5, expired: 58, unclear: 8 });
    expect(Object.values(c.units).filter((u) => u.status === 'in_effect').map((u) => u.ref)).toEqual([
      'note III 20(vvv)(i)', 'note III 20(vvv)(ii)', 'note III 20(vvv)(iii)', 'note III 20(vvv)(iv)', 'note III 20(www)',
    ]);
    expect(Object.values(c.units).filter((u) => u.status === 'unclear').map((u) => u.ref)).toEqual(
      ['z', 'aa', 'bb', 'cc', 'dd', 'ee', 'ff', 'gg'].map((l) => `note III 20(${l})`),
    );
  });
});

describe('gate — CN reference rules and deliberately broken ones (committed data)', { timeout: 300_000 }, () => {
  const { report } = gate(CN_RULES);

  it('every CN rule passes G1–G6 and GR; G7 places every CN heading; G8 green', () => {
    expect(report.checks.filter((c) => !c.pass).map((c) => `${c.id} ${c.subject}: ${c.detail}`)).toEqual([]);
    expect(report.blockedOrigins).toEqual({});
  });

  it('list sizes, deduplicated, no unknown codes', () => {
    expect(report.listCounts['note III 20(b)']).toEqual({ codes: 856, ch98: 0, unknown: [] });
    expect(report.listCounts['note III 20(d)']).toEqual({ codes: 283, ch98: 0, unknown: [] });
    expect(report.listCounts['note III 20(f)']).toEqual({ codes: 5906, ch98: 0, unknown: [] });
    expect(report.listCounts['note III 20(s)(i)']).toEqual({ codes: 2958, ch98: 0, unknown: [] });
  });

  it('a List 3 rate of 30% (G3), a misquote (G2), additive on suspended 9903.88.16 (G4), a list of described products (G4)', () => {
    const r = gate([
      ...swap('cn-add-9903-88-03', (x) => (x.rate_ppm = 300000)),
      { ...cnRule('cn-add-9903-88-15'), id: 'misquote', quotes: [{ source: 'note III 20(r)', text: 'shall be subject to an additional 10 percent ad valorem rate of duty' }, ...cnRule('cn-add-9903-88-15').quotes.slice(1)] },
      { ...cnRule('cn-not-9903-88-16'), id: 'list-4b', kind: 'additive', rate_ppm: 150000, numbers: { rate_ppm: 0 }, quotes: [{ source: 'general 9903.88.16', text: 'The duty provided in the applicable subheading + 15%' }], drafted_from_sha256: { 'general 9903.88.16': cnRule('cn-add-9903-88-15').drafted_from_sha256['general 9903.88.15']! } },
      { ...cnRule('cn-add-9903-88-15'), id: 'described', scope: { list: 'note III 20(s)(ii)' } },
    ], {}, null).report;
    const why = (id: string) => r.blockedRules.find((b) => b.id === id)?.reasons.join(' ') ?? '';
    expect(why('cn-add-9903-88-03')).toMatch(/G3/);
    expect(why('misquote')).toMatch(/G2/);
    expect(why('list-4b')).toMatch(/G4: 9903\.88\.16 is out of force/);
    expect(why('described')).toMatch(/G4: note III 20\(s\)\(ii\) must be a list of 8-digit subheadings/);
    // the blocked misquoted 9903.88.15 rule names P13's line (20(s)(i)) → P13 refuses → G8 blocks CN
    expect(Object.keys(r.blockedOrigins)).toEqual(['CN']);
  });

  it('a list with an unresolved numbering oddity inside it is blocked (G5); its lines refuse', () => {
    const odd = { ...data, notes: { ...data.notes, ignoredMarkers: [...data.notes.ignoredMarkers, { section: 'III', note: 20, path: '20(b)', page: 'p', text: '(7) x', why: 'out_of_sequence' as const }] } };
    const r = gate(CN_RULES, { data: odd });
    expect(r.report.blockedRules.find((b) => b.id === 'cn-add-9903-88-01')?.reasons.join(' ')).toMatch(/G5: an out-of-sequence label inside note III 20\(b\)/);
    expect(estimateLine({ code: '2845.40.0000', origin: 'CN', entryDate: data.asOf, customsValue: usd(10000) }, r.data)).toMatchObject({ reason: 'BLOCKED_BY_GATE' });
  });

  it('the first live drafting run (2026-10-12): five rules match; its 9903.88.15 on all of 20(s) (with the described products) is blocked by G4 and GR', () => {
    const run1 = (JSON.parse(readFileSync(join(FIX, 'rules-drafted-cn-2026-10-12-run1.json'), 'utf8')) as RulesFile).rules;
    const r = gate(run1).report;
    expect(r.blockedRules.map((b) => b.id)).toEqual(['cn-add-9903-88-15']);
    expect(r.blockedRules[0]!.reasons.join(' ')).toMatch(/G4: note III 20\(s\) must be a list of 8-digit subheadings.*GR: scope: drafted \{"list":"note III 20\(s\)"\}/);
    expect(Object.keys(r.blockedOrigins)).toEqual(['CN']); // P13 (on 20(s)(i)) then refuses → G8
    const final = (JSON.parse(readFileSync(join(FIX, 'rules-drafted-cn-2026-10-12.json'), 'utf8')) as RulesFile).rules;
    expect(gate(final).report.blockedRules).toEqual([]);
  });

  it('GR: a drafted CN rule that differs from the reference (List 2 scope on 20(f)) is blocked', () => {
    const r = gate(swap('cn-add-9903-88-02', (x) => (x.scope = { list: 'note III 20(f)' }))).report;
    expect(r.blockedRules.find((b) => b.id === 'cn-add-9903-88-02')?.reasons.join(' ')).toMatch(/GR: scope/);
  });
});
