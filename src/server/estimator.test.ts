// Runs in CI: the committed estimator data version, through the runtime loader (no gitignored sources).
import { describe, expect, it } from 'vitest';
import { estimateLine, estimateVerifiedFirst, sourceLabel } from '@/domain/estimator/estimate';
import { usd } from '@/domain/money/money';
import { quoteDuty } from '@/domain/rates/engine';
import { loadGolden, loadVerifiedRates } from '@/domain/rates/__fixtures__/verified';
import { loadEstimator } from './estimator';

const { data, manifest } = loadEstimator();
const verified = loadVerifiedRates();
const input = (c: { origin: string; hts10?: string | null; price_minor?: number; quantity?: number; value_split?: { case_minor: number; band_minor: number }; facts?: Record<string, boolean> }) => ({
  code: c.hts10 ?? '',
  origin: c.origin,
  entryDate: data.asOf,
  customsValue: usd(c.price_minor ?? 1),
  quantity: c.quantity ?? 1,
  ...(c.value_split ? { valueSplit: { case: usd(c.value_split.case_minor), band: usd(c.value_split.band_minor) } } : {}),
  ...(c.facts ? { facts: c.facts } : {}),
});

describe('loadEstimator — the committed data version', () => {
  it('is the version current.json names, for the committed HTS revision; rules and blocks as the gate left them', () => {
    expect(data.version).toBe('2026-rev21-e1');
    expect(manifest.hts_revision).toBe('2026 Rev. 21');
    expect(data.rules.map((r) => r.heading).sort()).toEqual(['9903.05.39', '9903.05.49', '9903.05.86', '9903.05.88', '9903.05.89', '9903.05.90', '9903.05.91', '9903.05.92', '9903.05.97']);
    expect(data.blocked.rules.map((b) => b.rule.id)).toEqual(['cond-9903-05-87']);
    expect(data.blocked.origins).toEqual({});
    expect(Object.values(data.outOfForce).filter((o) => o.why === 'verified_override')).toHaveLength(120);
  });

  it('G8 over the committed data (automated only): every JP/DE verified case exact; P11 refused on its 232 note; P07 refused', () => {
    for (const c of loadGolden().cases.filter((x) => x.origin === 'JP' || x.origin === 'DE')) {
      const e = estimateLine(input(c), data);
      if (c.id === 'P11') {
        expect(e).toMatchObject({ kind: 'CANT_ESTIMATE', reason: 'UNMODELED_REGIME', refs: ['note III 16(c)(vii)'] });
        continue;
      }
      if (c.expected === 'UNSUPPORTED') {
        expect(e.kind, c.id).toBe('CANT_ESTIMATE');
        continue;
      }
      const v = quoteDuty(verified, { ...input(c), hts10: c.hts10!, entryDate: verified.rows.find((r) => r.hts10 === c.hts10 && r.origin === c.origin)!.effective_from });
      if (e.kind !== 'ESTIMATE' || v.kind !== 'OK') throw new Error(`${c.id}: ${JSON.stringify(e).slice(0, 200)}`);
      expect(e.result.totalDuty, c.id).toEqual(v.totalDuty);
      expect(e.result.lines.map((l) => l.chapter99).filter(Boolean), c.id).toEqual(v.lines.map((l) => l.chapter99).filter(Boolean));
    }
  });
});

describe('estimateVerifiedFirst', () => {
  it('a line with a verified row quotes from it and says so', () => {
    const e = estimateVerifiedFirst(input({ origin: 'JP', hts10: '9504.40.0000', price_minor: 9500 }), data, verified);
    if (e.kind !== 'ESTIMATE') throw new Error(e.detail);
    expect(e.source).toEqual({ kind: 'verified', rateVersion: verified.version });
    expect(sourceLabel(e.source)).toBe(`Verified rate row (${verified.version})`);
    expect(e.result.totalDuty).toEqual(usd(1188));
  });
  it('a line without one is the automated estimate', () => {
    const e = estimateVerifiedFirst(input({ origin: 'JP', hts10: '0712.90.8550', price_minor: 10000 }), data, verified);
    if (e.kind !== 'ESTIMATE') throw new Error(e.detail);
    expect(sourceLabel(e.source)).toBe('Automated estimate (2026-rev21-e1)');
    expect(e.result.lines.map((l) => l.chapter99).filter(Boolean)).toEqual(['9903.05.86']);
  });
  it('a verified row that needs facts the input lacks falls back to the automated path (P11 refuses); with the facts it quotes', () => {
    const p11 = { origin: 'JP', hts10: '8211.92.9030', price_minor: 14000 };
    expect(estimateVerifiedFirst(input(p11), data, verified)).toMatchObject({ kind: 'CANT_ESTIMATE', reason: 'UNMODELED_REGIME' });
    const withFacts = estimateVerifiedFirst(input({ ...p11, facts: { steel_weight_share_ge_15pct: true, steel_us_melted_poured_ge_85pct: false } }), data, verified);
    expect(withFacts).toMatchObject({ kind: 'ESTIMATE', source: { kind: 'verified' } });
  });
});
