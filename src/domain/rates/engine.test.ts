// Engine behaviour on SYNTHETIC rows (see __fixtures__/synthetic.ts) — no real tariff data here.
import { describe, expect, it } from 'vitest';
import { jpy, usd } from '../money/money';
import { additiveRow, capRow, compoundRow, exemptRow, syntheticFile } from './__fixtures__/synthetic';
import { computeRow, quoteDuty, type QuoteInput } from './engine';
import type { RateFile } from './schema';

const DATE = '2026-06-01';
const input = (row: { origin: string; hts10: string }, over: Partial<QuoteInput> = {}): QuoteInput => ({
  origin: row.origin,
  hts10: row.hts10,
  entryDate: DATE,
  customsValue: usd(10_000),
  quantity: 1,
  ...over,
});

function ok(r: ReturnType<typeof quoteDuty>) {
  if (r.kind !== 'OK') throw new Error(`expected OK, got UNSUPPORTED: ${r.reason}`);
  return r;
}

describe('combined_cap', () => {
  it('tops a base below the cap up to the cap (below-cap heading)', () => {
    const r = ok(quoteDuty(syntheticFile, input(capRow)));
    expect(r.lines.map((l) => [l.kind, l.chapter99 ?? null, l.amount.amountMinor])).toEqual([
      ['MFN', null, 400n],
      ['TEST_CAP', '9903.00.02', 600n],
    ]);
    expect(r.totalDuty).toEqual(usd(1_000));
    expect(r.effectiveRatePpm).toBe(100_000);
    expect(r.rateVersion).toBe('test-rev1-v1');
  });

  it('adds nothing when the base is at or above the cap (at-or-above heading)', () => {
    const high: RateFile = {
      ...syntheticFile,
      rows: [{ ...capRow, mfn: { type: 'ad_valorem', rate_ppm: 150_000 } }],
    };
    const r = ok(quoteDuty(high, input(capRow)));
    expect(r.lines.map((l) => [l.chapter99 ?? null, l.amount.amountMinor])).toEqual([
      [null, 1_500n],
      ['9903.00.01', 0n],
    ]);
    expect(r.totalDuty).toEqual(usd(1_500));
  });

  it('rounds half up per line and keeps the total exactly round(cap × value)', () => {
    // $0.05: MFN 4% = 0.2¢ → 0¢; cap 10% = 0.5¢ → 1¢; add-on = 1¢ − 0¢.
    const r = ok(quoteDuty(syntheticFile, input(capRow, { customsValue: usd(5) })));
    expect(r.lines.map((l) => l.amount.amountMinor)).toEqual([0n, 1n]);
    expect(r.totalDuty).toEqual(usd(1));
  });
});

describe('compound MFN', () => {
  it('computes specific + case + band components and compares the AVE with the cap', () => {
    // $300 = case $250 + band $50: $1.00 + 2%×250 + 5%×50 = $8.50 (AVE 2.833%) → cap 10% = $30.00.
    const r = ok(
      quoteDuty(syntheticFile, input(compoundRow, { customsValue: usd(30_000), valueSplit: { case: usd(25_000), band: usd(5_000) } })),
    );
    expect(r.lines.map((l) => l.amount.amountMinor)).toEqual([850n, 2_150n]);
    expect(r.totalDuty).toEqual(usd(3_000));
    expect(r.avePpm).toBe(28_333);
  });

  it('charges specific components per unit', () => {
    const r = ok(
      quoteDuty(syntheticFile, input(compoundRow, { customsValue: usd(30_000), quantity: 2, valueSplit: { case: usd(25_000), band: usd(5_000) } })),
    );
    expect(r.lines[0]!.amount).toEqual(usd(950)); // $2.00 + $5.00 + $2.50
  });

  it('refuses without a value split, or when the split does not add up to the customs value', () => {
    expect(quoteDuty(syntheticFile, input(compoundRow, { customsValue: usd(30_000) })).kind).toBe('UNSUPPORTED');
    const bad = quoteDuty(syntheticFile, input(compoundRow, { customsValue: usd(30_000), valueSplit: { case: usd(25_000), band: usd(4_999) } }));
    expect(bad.kind).toBe('UNSUPPORTED');
  });
});

describe('additive, exempt and conditions', () => {
  it('adds an additive program on the full value when its condition facts hold', () => {
    const r = ok(quoteDuty(syntheticFile, input(additiveRow, { customsValue: usd(6_500), facts: { test_fact: true } })));
    expect(r.lines.map((l) => [l.kind, l.chapter99 ?? null, l.amount.amountMinor])).toEqual([
      ['MFN', null, 0n],
      ['TEST_ADD', '9903.00.03', 650n],
    ]);
    expect(r.totalDuty).toEqual(usd(650));
  });

  it('refuses when a required fact is missing or different', () => {
    const missing = quoteDuty(syntheticFile, input(additiveRow));
    expect(missing).toMatchObject({ kind: 'UNSUPPORTED' });
    if (missing.kind === 'UNSUPPORTED') expect(missing.reason).toMatch(/test_fact/);
    expect(quoteDuty(syntheticFile, input(additiveRow, { facts: { test_fact: false } })).kind).toBe('UNSUPPORTED');
  });

  it('records an exempt heading with no add-on', () => {
    const r = ok(quoteDuty(syntheticFile, input(exemptRow, { customsValue: usd(18_000) })));
    expect(r.lines.map((l) => [l.chapter99 ?? null, l.amount.amountMinor])).toEqual([
      [null, 0n],
      ['9903.00.05', 0n],
    ]);
    expect(r.totalDuty).toEqual(usd(0));
    expect(r.effectiveRatePpm).toBe(0);
  });

  it('cites a source for every line', () => {
    const r = ok(quoteDuty(syntheticFile, input(capRow)));
    for (const line of r.lines) expect(line.sourceRef.length).toBeGreaterThan(0);
  });
});

describe('UNSUPPORTED — never guesses', () => {
  const cases: [string, QuoteInput][] = [
    ['unknown HTS', input({ origin: 'XA', hts10: '0000.00.9999' })],
    ['unknown origin', input({ origin: 'ZZ', hts10: capRow.hts10 })],
    ['entry before effective_from', input(capRow, { entryDate: '2025-12-31' })],
    ['non-USD value', input(capRow, { customsValue: jpy(10_000) })],
    ['zero value', input(capRow, { customsValue: usd(0) })],
    ['zero quantity', input(capRow, { quantity: 0 })],
    ['fractional quantity', input(capRow, { quantity: 1.5 })],
    ['malformed date', input(capRow, { entryDate: '06/01/2026' })],
  ];
  it.each(cases)('%s', (_name, q) => {
    const r = quoteDuty(syntheticFile, q);
    expect(r.kind).toBe('UNSUPPORTED');
    if (r.kind === 'UNSUPPORTED') expect(r.reason.length).toBeGreaterThan(0);
  });

  it('honours effective_to (exclusive)', () => {
    const ended: RateFile = { ...syntheticFile, rows: [{ ...capRow, effective_to: '2026-06-01' }] };
    expect(quoteDuty(ended, input(capRow, { entryDate: '2026-05-31' })).kind).toBe('OK');
    expect(quoteDuty(ended, input(capRow, { entryDate: '2026-06-01' })).kind).toBe('UNSUPPORTED');
  });
});

describe('computeRow (the math quoteDuty runs after its lookup and date check)', () => {
  const file = syntheticFile;
  it.each(file.rows.map((r) => [r.id, r] as const))('%s: same result as quoteDuty', (_id, row) => {
    const i = input(row, row.mfn.type === 'compound' ? { valueSplit: { case: usd(8_000), band: usd(2_000) } } : {});
    expect(computeRow(row, file.version, i)).toEqual(quoteDuty(file, i));
  });
  it('validates the input itself (it has no lookup in front of it)', () => {
    expect(computeRow(capRow, 'v', input(capRow, { customsValue: jpy(1000) })).kind).toBe('UNSUPPORTED');
    expect(computeRow(capRow, 'v', input(capRow, { quantity: 0 })).kind).toBe('UNSUPPORTED');
  });
});
