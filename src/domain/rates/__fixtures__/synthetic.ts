// SYNTHETIC test data — NOT real tariff rates, HTS codes or headings. Codes use the reserved-looking 0000.xx / 9903.00.xx
// ranges so they can never be mistaken for a real row. Real rates live only in the generated data file under data/.
import type { RateFile, RateRow } from '../schema';

const base = {
  listings: ['T01'],
  not_applied: [],
  exemptions_checked: { done: true as const, refs: ['synthetic exemption check'] },
  source_refs: [{ kind: 'hts_line' as const, ref: 'synthetic line' }],
  ruling: { number: null, status: 'none' as const },
  evidence: 'synthetic',
  verified_by: 'test',
  verified_on: '2026-01-01',
  hts_revision: 'TEST Rev. 1',
  effective_from: '2026-01-01',
  effective_to: null,
};

/** Ad valorem 4% + 10% combined cap (cap rule like JP 9903.05.48/.49, synthetic numbers). */
export const capRow: RateRow = {
  ...base,
  id: 'XA-0000.00.0001',
  hts10: '0000.00.0001',
  origin: 'XA',
  description: 'synthetic capped article',
  mfn: { type: 'ad_valorem', rate_ppm: 40_000 },
  additional: [
    {
      program: 'TEST_CAP',
      chapter99: '9903.00.02',
      chapter99_at_or_above_cap: '9903.00.01',
      rule: 'combined_cap',
      rate_ppm: 100_000,
      basis: 'full_value',
      compare: 'ave',
      conditions: [],
      ref: 'synthetic note',
    },
  ],
};

/** Compound MFN ($1.00 each + 2% case + 5% band) + 10% combined cap. */
export const compoundRow: RateRow = {
  ...base,
  id: 'XA-0000.00.0002',
  hts10: '0000.00.0002',
  origin: 'XA',
  description: 'synthetic compound article',
  mfn: {
    type: 'compound',
    text: '$1.00 each + 2% case + 5% band',
    components: [
      { kind: 'specific', amount_usd_micros: 1_000_000, per: 'each' },
      { kind: 'ad_valorem', rate_ppm: 20_000, applies_to: 'case' },
      { kind: 'ad_valorem', rate_ppm: 50_000, applies_to: 'band' },
    ],
  },
  additional: capRow.additional,
};

/** Free MFN + additive 10%, with a required listing fact. */
export const additiveRow: RateRow = {
  ...base,
  id: 'XB-0000.00.0003',
  hts10: '0000.00.0003',
  origin: 'XB',
  description: 'synthetic additive article',
  mfn: { type: 'free' },
  additional: [
    {
      program: 'TEST_ADD',
      chapter99: '9903.00.03',
      rule: 'additive',
      rate_ppm: 100_000,
      basis: 'full_value',
      conditions: [{ fact: 'test_fact', required_value: true, ref: 'synthetic condition' }],
      ref: 'synthetic note',
    },
  ],
  not_applied: [{ program: 'TEST_SUSPENDED', chapter99: '9903.00.04', reason: 'suspended', ref: 'synthetic note' }],
};

/** Free MFN + exempt heading (no add-on). */
export const exemptRow: RateRow = {
  ...base,
  id: 'XA-0000.00.0005',
  hts10: '0000.00.0005',
  origin: 'XA',
  description: 'synthetic exempt article',
  mfn: { type: 'free' },
  additional: [
    {
      program: 'TEST_CAP',
      chapter99: '9903.00.05',
      rule: 'exempt',
      rate_ppm: 0,
      basis: 'full_value',
      conditions: [],
      ref: 'synthetic exemption',
    },
  ],
};

export const syntheticFile: RateFile = {
  version: 'test-rev1-v1',
  hts_revision: 'TEST Rev. 1',
  generated_from: { file: 'synthetic', tab: 'Verify', sha256: '0'.repeat(64) },
  regime_notes: ['synthetic'],
  rows: [capRow, compoundRow, additiveRow, exemptRow],
};
