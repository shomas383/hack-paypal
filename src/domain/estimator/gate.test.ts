import { describe, expect, it } from 'vitest';
import { usd } from '@/domain/money/money';
import { estimateLine } from './estimate';
import { percentToPpm } from './gate';
import { ASOF, REFERENCE_RULES, ruleById, sampleGate, sampleVerified } from './__fixtures__/sample';

const without = (id: string) => REFERENCE_RULES.rules.filter((r) => r.id !== id);
const replaced = (id: string, f: (r: ReturnType<typeof ruleById>) => void) => REFERENCE_RULES.rules.map((r) => (r.id === id ? (f((r = ruleById(id))), r) : r));
const failed = (report: ReturnType<typeof sampleGate>['report']) => report.checks.filter((c) => !c.pass).map((c) => `${c.id} ${c.subject}`);

describe('gate — reference rules on the committed excerpts', () => {
  const { data, report } = sampleGate();

  it('every check passes; no rule or origin is blocked', () => {
    expect(failed(report)).toEqual([]);
    expect(report.blockedRules).toEqual([]);
    expect(report.blockedOrigins).toEqual({});
    expect(data.rules.map((r) => r.id)).toEqual(REFERENCE_RULES.rules.map((r) => r.id));
  });

  it('G8 ran on the JP/DE verified cases in the excerpt, P07 (chapter 98) included', () => {
    const g8 = report.checks.filter((c) => c.id === 'G8').map((c) => c.subject.split(' ')[0]);
    expect(g8).toEqual(expect.arrayContaining(['P01', 'P02', 'P03', 'P07', 'P08', 'P10', 'P12', 'P14']));
    expect(g8).not.toContain('P11');
  });

  it('list sizes, with chapter 98 provisions counted apart (52(d): 6)', () => {
    expect(report.listCounts['note III 52(b)']).toEqual({ codes: 863, ch98: 0, unknown: [] });
    expect(report.listCounts['note III 52(d)']).toMatchObject({ codes: 541, ch98: 6, unknown: [] });
    expect(report.listCounts['note III 52(j)(2)']).toMatchObject({ codes: 43, ch98: 0 });
  });

  it('percentages are read as integers', () => {
    expect(percentToPpm('12.5')).toBe(125000);
    expect(percentToPpm('10')).toBe(100000);
    expect(percentToPpm('0.25')).toBe(2500);
  });
});

describe('gate — deliberately broken rules are blocked, and only what they touch stops', () => {
  it('a JP cap of 15% (G3) blocks the rule, and G8 then blocks JP; DE is untouched', () => {
    const { report, data } = sampleGate(replaced('jp-cap-9903-05-49', (r) => (r.rate_ppm = 150000)));
    expect(report.blockedRules.map((b) => b.id)).toEqual(['jp-cap-9903-05-49']);
    expect(report.blockedRules[0]!.reasons.join(' ')).toMatch(/G3/);
    expect(Object.keys(report.blockedOrigins)).toEqual(['JP']);
    expect(report.alerts.length).toBeGreaterThan(0);
    expect(estimateLine({ code: '9504.40.0000', origin: 'JP', entryDate: ASOF, customsValue: usd(9500) }, data)).toMatchObject({ reason: 'BLOCKED_BY_GATE' });
  });

  it('a misquoted heading text (G2) blocks that exemption; its list lines refuse, other lines still estimate', () => {
    const { report, data } = sampleGate(replaced('exempt-9903-05-86', (r) => (r.quotes[1]!.text = 'Articles provided for in subdivision (c) of U.S. note 52 to this subchapter')));
    expect(report.blockedRules.map((b) => b.id)).toEqual(['exempt-9903-05-86']);
    expect(report.blockedRules[0]!.reasons.join(' ')).toMatch(/G2/);
    expect(estimateLine({ code: '0712.90.8550', origin: 'JP', entryDate: ASOF, customsValue: usd(10000) }, data)).toMatchObject({ reason: 'BLOCKED_BY_GATE' });
    expect(estimateLine({ code: '9504.40.0000', origin: 'JP', entryDate: ASOF, customsValue: usd(9500) }, data).kind).toBe('ESTIMATE');
  });

  it('an EU rule set missing (j)(2): the listed lines refuse for DE (coverage), nothing else changes', () => {
    const { report, data } = sampleGate(without('exempt-9903-05-97'));
    expect(report.blockedOrigins).toEqual({});
    const r = estimateLine({ code: '7102.10.0000', origin: 'DE', entryDate: ASOF, customsValue: usd(10000) }, data);
    expect(r).toMatchObject({ kind: 'CANT_ESTIMATE', reason: 'UNMODELED_REGIME', refs: ['note III 52(j)(2)'] });
    expect(estimateLine({ code: '7102.10.0000', origin: 'JP', entryDate: ASOF, customsValue: usd(10000) }, data).kind).toBe('ESTIMATE');
  });

  it('a rule whose source text changed since drafting is stale (G1)', () => {
    const { report } = sampleGate(replaced('cond-9903-05-88', (r) => (r.drafted_from_sha256['note III 52(d)'] = '0'.repeat(64))));
    expect(report.blockedRules).toEqual([{ id: 'cond-9903-05-88', reasons: [expect.stringMatching(/G1: note III 52\(d\) text changed/)] }]);
  });

  it('an unknown key fails the strict schema (G1)', () => {
    const { report } = sampleGate(replaced('sale-9903-05-91', (r) => Object.assign(r, { surcharge_ppm: 1 })));
    expect(report.blockedRules.map((b) => b.id)).toEqual(['sale-9903-05-91']);
  });

  it('an exemption whose heading adds duty fails G3 (exemptions must add nothing)', () => {
    const { report } = sampleGate(replaced('exempt-9903-05-86', (r) => (r.heading = '9903.05.49')));
    expect(report.blockedRules.find((b) => b.id === 'exempt-9903-05-86')?.reasons.join(' ')).toMatch(/G3.*must add nothing/);
  });

  it('a list that shrinks or grows by more than 20% against the previous version trips the drift alarm (G5)', () => {
    const { report } = sampleGate(undefined, { previousListCounts: { 'note III 52(b)': 600 } });
    expect(report.blockedRules).toEqual([{ id: 'exempt-9903-05-86', reasons: [expect.stringMatching(/G5: note III 52\(b\): 863 codes vs 600/)] }]);
  });

  it('G0: docs that no longer carry the IEEPA quote block every origin', () => {
    const { report } = sampleGate(undefined, { docs: { 'docs/SPEC.md': 'nothing here' } });
    expect(Object.keys(report.blockedOrigins).sort()).toEqual(['EU', 'JP']);
  });

  it('G9: a verified row whose stored components differ from the official text blocks every origin', () => {
    const { verified } = sampleVerified();
    const bad = { ...verified, rows: verified.rows.map((r) => (r.id === 'JP-9504.40.0000' ? { ...r, mfn: { type: 'ad_valorem' as const, rate_ppm: 1 } } : r)) };
    const { report } = sampleGate(undefined, { verified: bad });
    expect(report.checks.find((c) => c.id === 'G9')?.pass).toBe(false);
    expect(Object.keys(report.blockedOrigins).sort()).toEqual(['EU', 'JP']);
  });
});
