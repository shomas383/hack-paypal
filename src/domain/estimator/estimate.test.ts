import { describe, expect, it } from 'vitest';
import { usd } from '@/domain/money/money';
import type { EstimatorData } from './data';
import { estimateLine, headingWords, listMembership, type Estimate, type EstimateInput } from './estimate';
import { ASOF, REFERENCE_RULES, sampleData } from './__fixtures__/sample';

// Committed official excerpts + the reference rules (no gate here: gate.test.ts). Expected figures are arithmetic on the
// official rates: 12.5% / 10% caps (note 52(k)), 8.3% for 0712.90.85, $1.53 + 4.2% case + 9.8% band for 9102.21.70.
const data: EstimatorData = { ...sampleData(), rules: REFERENCE_RULES.rules, blocked: { rules: [], origins: {} } };
const input = (code: string, origin: string, cents: number, over: Partial<EstimateInput> = {}): EstimateInput => ({
  code,
  origin,
  entryDate: ASOF,
  customsValue: usd(cents),
  ...over,
});
const ok = (r: ReturnType<typeof estimateLine>): Estimate => {
  if (r.kind !== 'ESTIMATE') throw new Error(`${r.reason}: ${r.detail}`);
  return r;
};
const heads = (e: Estimate) => e.result.lines.filter((l) => l.chapter99).map((l) => l.chapter99);

describe('estimateLine — JP / EU (DE) layer', () => {
  it('JP Free line: total = 12.5% via 9903.05.49 (P01: $95 → $11.88)', () => {
    const e = ok(estimateLine(input('9504.40.0000', 'JP', 9500), data));
    expect(e.result.totalDuty).toEqual(usd(1188));
    expect(heads(e)).toEqual(['9903.05.49']);
    expect(e.disclosures).toEqual(['SPECIAL_PROGRAMS', 'NOT_A_RULING']);
    expect(e.ifYes).toEqual([]);
  });

  it('DE watch: compound rate with the case/band split, total capped at 10% via 9903.05.39 (P14: $290 → $29.00)', () => {
    const e = ok(estimateLine(input('9102.21.70', 'DE', 29000, { valueSplit: { case: usd(24000), band: usd(5000) } }), data));
    expect(e.result.totalDuty).toEqual(usd(2900));
    expect(heads(e)).toEqual(['9903.05.39']);
  });

  it('a compound case/band rate without the split is refused (NEEDS_SPLIT)', () => {
    expect(estimateLine(input('9102.21.70', 'JP', 30000), data)).toMatchObject({ kind: 'CANT_ESTIMATE', reason: 'NEEDS_SPLIT' });
  });

  it('a line in the 52(b) list is exempt via 9903.05.86: only the 8.3% base rate', () => {
    const e = ok(estimateLine(input('0712.90.8550', 'JP', 10000), data));
    expect(e.result.totalDuty).toEqual(usd(830));
    expect(heads(e)).toEqual(['9903.05.86']);
  });

  it('an 8-digit line with only some statistical numbers listed is refused (PARTIAL_LIST)', () => {
    expect(listMembership('0712.90.85', 'note III 52(b)', data).kind).toBe('partial');
    expect(listMembership('0712.90.8510', 'note III 52(b)', data).kind).toBe('none');
    expect(estimateLine(input('0712.90.8510', 'JP', 10000), data)).toMatchObject({ kind: 'ESTIMATE' });
  });

  it('the 52(j)(2) list exempts EU goods (9903.05.97) but not Japanese ones (7102.10.00, Free)', () => {
    const de = ok(estimateLine(input('7102.10.0000', 'DE', 10000), data));
    expect(heads(de)).toEqual(['9903.05.97']);
    expect(de.result.totalDuty).toEqual(usd(0));
    const jp = ok(estimateLine(input('7102.10.0000', 'JP', 10000), data));
    expect(heads(jp)).toEqual(['9903.05.49']);
    expect(jp.result.totalDuty).toEqual(usd(1250));
  });

  it('a rate per kilogram needs a measure the estimate does not take yet (NEEDS_MEASURES; 3823.11: 2.1¢/kg + 3.8%)', () => {
    expect(estimateLine(input('3823.11.0000', 'DE', 10000), data)).toMatchObject({ kind: 'CANT_ESTIMATE', reason: 'NEEDS_MEASURES' });
  });

  it('a conditional exemption (52(d) civil aircraft) unanswered → the higher figure plus the figure if yes; answered → one figure', () => {
    const e = ok(estimateLine(input('8802.11.0145', 'JP', 100000), data));
    expect(heads(e)).toEqual(['9903.05.49']);
    expect(e.ifYes).toHaveLength(1);
    expect(e.ifYes[0]!.question).toMatchObject({ fact: 'civil_aircraft', heading: '9903.05.88' });
    expect(e.ifYes[0]!.question.text).toMatch(/^Articles of civil aircraft/);
    expect(e.ifYes[0]!.result.totalDuty).toEqual(usd(0));
    const yes = ok(estimateLine(input('8802.11.0145', 'JP', 100000, { facts: { civil_aircraft: true } }), data));
    expect(heads(yes)).toEqual(['9903.05.88']);
    expect(yes.ifYes).toEqual([]);
    const no = ok(estimateLine(input('8802.11.0145', 'JP', 100000, { facts: { civil_aircraft: false } }), data));
    expect(no.result.totalDuty).toEqual(usd(12500));
    expect(no.ifYes).toEqual([]);
  });

  it('9903.05.92 is asked only when the line description names one of its words (tapes → asked; playing cards → not)', () => {
    expect(headingWords(data.headings['9903.05.92']!.text)).toContain('tapes');
    const disc = ok(estimateLine(input('8523.49.4000', 'JP', 18000), data));
    expect(disc.ifYes.map((x) => x.question.heading)).toEqual(['9903.05.92']);
    const cards = ok(estimateLine(input('9504.40.0000', 'JP', 9500), data));
    expect(cards.ifYes).toEqual([]);
  });
});

describe('estimateLine — refusals', () => {
  it('chapter 98 / 99 lines are special provisions', () => {
    expect(estimateLine(input('9801.00.1098', 'JP', 1000), data)).toMatchObject({ reason: 'SPECIAL_PROVISION' });
  });
  it('origins other than JP and DE are not supported yet (EU = DE only until the member list is verified)', () => {
    expect(estimateLine(input('9504.40.0000', 'CN', 1000), data)).toMatchObject({ reason: 'ORIGIN_UNSUPPORTED' });
    expect(estimateLine(input('9504.40.0000', 'FR', 1000), data)).toMatchObject({ reason: 'ORIGIN_UNSUPPORTED' });
  });
  it('a code that is not a line of the revision', () => {
    expect(estimateLine(input('9504.40.9999', 'JP', 1000), data)).toMatchObject({ reason: 'UNKNOWN_CODE' });
  });
  it('an origin the gate blocked refuses every line', () => {
    const blocked = { ...data, blocked: { rules: [], origins: { JP: ['G8 P01 JP'] } } };
    expect(estimateLine(input('9504.40.0000', 'JP', 9500), blocked)).toMatchObject({ reason: 'BLOCKED_BY_GATE' });
    expect(estimateLine(input('9102.21.70', 'DE', 29000, { valueSplit: { case: usd(24000), band: usd(5000) } }), blocked).kind).toBe('ESTIMATE');
  });
  it('a blocked list rule refuses the lines its list names', () => {
    const rule = REFERENCE_RULES.rules.find((r) => r.id === 'exempt-9903-05-86')!;
    const d = { ...data, rules: data.rules.filter((r) => r !== rule), blocked: { rules: [{ rule, reasons: ['G2: test'] }], origins: {} } };
    expect(estimateLine(input('0712.90.8550', 'JP', 10000), d)).toMatchObject({ reason: 'BLOCKED_BY_GATE' });
    expect(estimateLine(input('9504.40.0000', 'JP', 9500), d).kind).toBe('ESTIMATE');
  });
});
