// Re-verification on HTS 2026 Rev. 21 (HTS_VERIFICATION_SPEC §8): the Rev 21 data must equal the Rev 20 data in every
// rate-bearing field. Only the revision, dates and the appended re-verification note may differ.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { HtsIndex } from '@/domain/hts/buildIndex';
import type { RateFile, RateRow } from './schema';

const read = <T>(rel: string): T => JSON.parse(readFileSync(new URL(`../../../${rel}`, import.meta.url), 'utf8')) as T;
const v5 = read<RateFile>('data/rates/2026-rev20-v5.json');
const r21 = read<RateFile>('data/rates/2026-rev21-v1.json');
const RE_VERIFIED = 'Re-verified against 2026 Rev. 21 by full text comparison; no change to rate, heading or note text; see HTS_VERIFICATION_SPEC §8.';

describe('rates 2026-rev21-v1 vs 2026-rev20-v5', () => {
  it('has the same rows (id, key, origin, listings) in the same order', () => {
    expect(r21.rows.map((r) => [r.id, r.hts10, r.origin, r.listings])).toEqual(v5.rows.map((r) => [r.id, r.hts10, r.origin, r.listings]));
  });

  it('every rate-bearing field is identical', () => {
    const rateFields = (r: RateRow) => ({
      component_reporting: r.component_reporting,
      description: r.description,
      mfn: r.mfn,
      special_note: r.special_note,
      additional: r.additional,
      not_applied: r.not_applied,
      exemptions_checked: r.exemptions_checked,
      ruling: r.ruling,
      verified_by: r.verified_by,
    });
    for (const [i, r] of r21.rows.entries()) expect(rateFields(r), r.id).toEqual(rateFields(v5.rows[i]!));
    expect(r21.regime_notes).toEqual(v5.regime_notes);
  });

  it('only the revision, dates, HTS-line citations and the appended note differ', () => {
    for (const [i, r] of r21.rows.entries()) {
      const old = v5.rows[i]!;
      expect(r.hts_revision).toBe('2026 Rev. 21');
      expect(r.effective_from).toBe('2026-10-09');
      expect(r.effective_to).toBeNull();
      expect(r.verified_on).toBe('2026-10-11');
      // Citations: the same refs, with "(HTS 2026 Rev. 20)" on the base line now naming Rev. 21.
      expect(r.source_refs).toEqual(old.source_refs.map((s) => ({ ...s, ref: s.ref.replace('2026 Rev. 20', '2026 Rev. 21') })));
      // Evidence: the Rev 20 evidence (per merged listing) with the re-verification note appended.
      expect(r.evidence.split(' | ').map((e) => e.replace(` ${RE_VERIFIED}`, '').replace(RE_VERIFIED, '').trim())).toEqual(
        old.evidence.split(' | ').map((e) => e.trim()),
      );
      expect(r.evidence).toContain(RE_VERIFIED);
    }
    expect(r21.hts_revision).toBe('2026 Rev. 21');
    expect(v5.hts_revision).toBe('2026 Rev. 20'); // history stays as it was
  });

  it('golden cases are identical (same prices, splits, facts, expected duty and headings)', () => {
    const g5 = read<{ rate_version: string; cases: unknown[] }>('data/eval/golden-2026-rev20-v5.json');
    const g21 = read<{ rate_version: string; cases: unknown[] }>('data/eval/golden-2026-rev21-v1.json');
    expect(g21.rate_version).toBe('2026-rev21-v1');
    expect(g21.cases).toEqual(g5.cases);
  });
});

describe('rates 2026-rev21-v2 vs 2026-rev21-v1 (house-style text only)', () => {
  const v2 = read<RateFile>('data/rates/2026-rev21-v2.json');
  // The five strings the importer rewrote (note/heading numbers only); everything else, every figure included, is v1's.
  const HOUSE: Record<string, string> = {
    'note 52(f)(1): Section 232 article': 'U.S. note 52(f)(1)',
    'note 16 (Section 232) checked': 'note 16 checked',
    'note 16 (Section 232): 9102 not listed': 'note 16: 9102 not listed',
    'IEEPA tariffs (9903.01.xx / 9903.02.xx) terminated; CBP stopped collecting for entries on/after Feb 24, 2026. Never added.':
      'Headings 9903.01.xx / 9903.02.xx terminated (EO 14389); CBP stopped collecting for entries on/after Feb 24, 2026. Never added.',
  };
  const restyle = (v: unknown): unknown =>
    typeof v === 'string' ? (HOUSE[v] ?? v) : Array.isArray(v) ? v.map(restyle) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, restyle(x)])) : v;
  it('equals v1 with only those strings rewritten (rows, figures, evidence, regime notes)', () => {
    expect(v2).toEqual({ ...(restyle(r21) as RateFile), version: '2026-rev21-v2' });
  });
  it('golden cases are identical to v1', () => {
    const g1 = read<{ rate_version: string; cases: unknown[] }>('data/eval/golden-2026-rev21-v1.json');
    const g2 = read<{ rate_version: string; cases: unknown[] }>('data/eval/golden-2026-rev21-v2.json');
    expect(g2.rate_version).toBe('2026-rev21-v2');
    expect(g2.cases).toEqual(g1.cases);
  });
});

describe('HTS index 2026-rev21 vs 2026-rev20', () => {
  it('codes and description chains are identical; only the revision and source differ', () => {
    const i20 = read<HtsIndex>('data/hts/2026-rev20.json');
    const i21 = read<HtsIndex>('data/hts/2026-rev21.json');
    expect(i21.hts_revision).toBe('2026 Rev. 21');
    expect(i21.source.release).toBe('2026HTSRev21');
    expect(i21.codes).toEqual(i20.codes);
    expect(i21.nodes).toEqual(i20.nodes);
    const c20 = read<{ headings: Record<string, string> }>('data/hts/2026-rev20-ch99.json');
    const c21 = read<{ headings: Record<string, string> }>('data/hts/2026-rev21-ch99.json');
    expect(c21.headings).toEqual(c20.headings);
  });
});
