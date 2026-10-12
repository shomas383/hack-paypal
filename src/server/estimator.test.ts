// Runs in CI: the committed estimator data version, through the runtime loader (no gitignored sources).
import { describe, expect, it } from 'vitest';
import { estimateLine, estimateVerifiedFirst, sourceLabel } from '@/domain/estimator/estimate';
import { usd } from '@/domain/money/money';
import { quoteDuty } from '@/domain/rates/engine';
import { loadGolden, loadVerifiedRates } from '@/domain/rates/__fixtures__/verified';
import { factSource } from '@/domain/estimator/factSources';
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
    expect(data.version).toBe('2026-rev21-e4');
    expect(manifest.hts_revision).toBe('2026 Rev. 21');
    expect(data.rules.filter((r) => !r.origins.includes('CN')).map((r) => r.heading).sort()).toEqual(['9903.05.39', '9903.05.49', '9903.05.86', '9903.05.88', '9903.05.89', '9903.05.90', '9903.05.91', '9903.05.92', '9903.05.97']);
    expect(data.blocked.rules.map((b) => b.rule.id)).toEqual(['cond-9903-05-87', 'cn-cond-9903-05-87']); // both drafted as unconditional; GR
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
    expect(sourceLabel(e.source)).toBe('Automated estimate (2026-rev21-e4)');
    expect(e.result.lines.map((l) => l.chapter99).filter(Boolean)).toEqual(['9903.05.86']);
  });
  it('a verified row that needs facts the input lacks asks them (P11), with the verified figure for the answers it covers', () => {
    const p11 = { origin: 'JP', hts10: '8211.92.9030', price_minor: 14000 };
    const asked = estimateVerifiedFirst(input(p11), data, verified);
    expect(asked).toMatchObject({
      kind: 'CANT_ESTIMATE',
      reason: 'NEEDS_FACTS',
      facts: [
        { fact: 'steel_weight_share_ge_15pct', required: true },
        { fact: 'steel_us_melted_poured_ge_85pct', required: false },
      ],
    });
    if (asked.kind !== 'CANT_ESTIMATE') throw new Error('expected questions');
    // The same figure checkout quotes for L-P11 (golden P11: $8.54 + $35.00).
    expect(asked.ifAnswered?.totalDuty).toEqual(usd(4354));
    const withFacts = estimateVerifiedFirst(input({ ...p11, facts: { steel_weight_share_ge_15pct: true, steel_us_melted_poured_ge_85pct: false } }), data, verified);
    expect(withFacts).toMatchObject({ kind: 'ESTIMATE', source: { kind: 'verified' } });
    if (withFacts.kind !== 'ESTIMATE') throw new Error('expected an estimate');
    expect(withFacts.result.totalDuty).toEqual(usd(4354));
    // The questions come from note 16's sentences; the quoted answers come back with the verified figure.
    expect(asked.facts?.map((f) => f.question)).toEqual([
      'Does the steel in it weigh at least 15 percent of the whole article’s weight?',
      'Was at least 85 percent of the steel in it melted and poured in the United States?',
    ]);
    expect(withFacts.answered?.map((a) => [a.fact, a.answer])).toEqual([
      ['steel_weight_share_ge_15pct', true],
      ['steel_us_melted_poured_ge_85pct', false],
    ]);
    // One answer asked, one still open: still asking (only the open one decides now).
    expect(estimateVerifiedFirst(input({ ...p11, facts: { steel_weight_share_ge_15pct: true } }), data, verified)).toMatchObject({ reason: 'NEEDS_FACTS', facts: [{ fact: 'steel_us_melted_poured_ge_85pct' }] });
    // An answer the verified row doesn't cover: the automated path, which refuses on the note and names its heading.
    const other = estimateVerifiedFirst(input({ ...p11, facts: { steel_weight_share_ge_15pct: true, steel_us_melted_poured_ge_85pct: true } }), data, verified);
    expect(other).toMatchObject({ kind: 'CANT_ESTIMATE', reason: 'UNMODELED_REGIME', refs: ['note III 16(c)(vii)'] });
    if (other.kind !== 'CANT_ESTIMATE') throw new Error('expected a refusal');
    expect(other.headings?.map((h) => h.heading)).toEqual(['9903.82.03', '9903.82.06', '9903.82.09']); // the open headings whose own text cites 16(c)(vii)
  });
  it('a refusal names the open headings with their official text', () => {
    const kettle = estimateVerifiedFirst(input({ origin: 'JP', hts10: '7323.93.0015', price_minor: 9000 }), data, verified);
    if (kettle.kind !== 'CANT_ESTIMATE') throw new Error('expected a refusal');
    expect(kettle.headings?.map((h) => h.heading)).toEqual(['9903.82.03', '9903.82.06', '9903.82.09']);
    expect(kettle.headings?.[0]?.text).toBe(data.headings['9903.82.03']!.text);
  });
});

describe('factSource: verified-row facts asked from the official note 16 sentences (committed Rev 21 text)', () => {
  const knife = { code: '8211.92.9030', lineRefs: ['note III 16(c)(vii)'] };
  it('the knife: both questions, thresholds parsed from the quotes, the trimmed sentences shown', () => {
    const w = factSource('steel_weight_share_ge_15pct', data.notes, knife);
    expect(w).toEqual({
      fact: 'steel_weight_share_ge_15pct',
      threshold: 15,
      question: 'Does the steel in it weigh at least 15 percent of the whole article’s weight?',
      quotes: [
        { ref: 'note III 16(c)', text: '…only apply where the weight of the applicable metal is at least 15 percent of the weight of the imported article.' },
        { ref: 'note III 16(c)(vii)', text: 'Derivative steel articles' },
      ],
    });
    const m = factSource('steel_us_melted_poured_ge_85pct', data.notes, knife);
    expect(m).toEqual({
      fact: 'steel_us_melted_poured_ge_85pct',
      threshold: 85,
      question: 'Was at least 85 percent of the steel in it melted and poured in the United States?',
      quotes: [{ ref: 'note III 16(e)', text: '…at least 85 percent of the steel content of the article must be composed of steel that was melted and poured in the United States.' }],
    });
  });
  it('fails closed: a threshold that differs from the official text, a metal the list title does not name, a line the sentence does not cover', () => {
    expect(factSource('steel_weight_share_ge_20pct', data.notes, knife)).toBeNull();
    expect(factSource('steel_us_melted_poured_ge_80pct', data.notes, knife)).toBeNull();
    expect(factSource('aluminum_weight_share_ge_15pct', data.notes, knife)).toBeNull();
    // chapters 72, 73, 74 and 76 are outside the weight condition (16(c)): a steel kettle (7323) is never asked it
    expect(factSource('steel_weight_share_ge_15pct', data.notes, { code: '7323.93.0015', lineRefs: ['note III 16(c)(vii)'] })).toBeNull();
    // 16(e)'s steel sentence lists (c)(iv), (vii), (x) and (xi); not (c)(ix)
    expect(factSource('steel_us_melted_poured_ge_85pct', data.notes, { code: '8211.92.9030', lineRefs: ['note III 16(c)(ix)'] })).toBeNull();
    expect(factSource('informational_material', data.notes, knife)).toBeNull();
    expect(factSource('steel_weight_share_ge_15pct', data.notes, { code: '8211.92.9030', lineRefs: [] })).toBeNull();
  });
  it('house style: no program names in the questions or quotes', () => {
    for (const f of ['steel_weight_share_ge_15pct', 'steel_us_melted_poured_ge_85pct']) expect(JSON.stringify(factSource(f, data.notes, knife))).not.toMatch(/Section 232|\b301\b|IEEPA/i);
  });
});
