// "Trust moment": the offline pure-LLM answers (2026-09-13, data/eval/products.json) checked against the engine.
// A total off by ≥ 0.05 percentage points is a mismatch. Expected: every verified row except P08 is flagged.
import { describe, expect, it } from 'vitest';
import { usd } from '../money/money';
import { loadEvalProducts, loadGolden, loadVerifiedRates } from './__fixtures__/verified';
import { quoteDuty } from './engine';

const MISMATCH_PPM = 500; // 0.05 percentage points
const table = loadVerifiedRates();
const golden = loadGolden();
const products = loadEvalProducts();

function compare() {
  return products
    .filter((p) => p.expected.status === 'VERIFIED')
    .map((p) => {
      const c = golden.cases.find((g) => g.id === p.id)!;
      const r = quoteDuty(table, {
        origin: c.origin,
        hts10: c.hts10!,
        entryDate: '2026-10-05',
        customsValue: usd(c.price_minor!),
        quantity: 1,
        ...(c.value_split ? { valueSplit: { case: usd(c.value_split.case_minor), band: usd(c.value_split.band_minor) } } : {}),
        ...(c.facts ? { facts: c.facts } : {}),
      });
      if (r.kind !== 'OK') throw new Error(`${p.id}: ${r.reason}`);
      return { id: p.id, llm: p.llm.total_ppm, engine: r.effectiveRatePpm, flagged: Math.abs(p.llm.total_ppm - r.effectiveRatePpm) >= MISMATCH_PPM };
    });
}

describe('trust moment: offline LLM vs verified engine', () => {
  const results = compare();

  it('flags every row where the LLM total is wrong, and only those', () => {
    expect(results.filter((r) => r.flagged).map((r) => r.id)).toEqual(['P01', 'P02', 'P03', 'P04', 'P05', 'P06', 'P09', 'P10', 'P11', 'P12']);
    expect(results.filter((r) => !r.flagged).map((r) => r.id)).toEqual(['P08']);
  });

  it('Japan rows: the LLM said 15% (stale IEEPA-era), the engine says 12.5%', () => {
    for (const id of ['P01', 'P02', 'P03', 'P04', 'P06', 'P10']) {
      expect(results.find((r) => r.id === id)).toMatchObject({ llm: 150_000, engine: 125_000, flagged: true });
    }
  });

  it('China rows: P05 claimed 27.5% and P09 15%; the engine says 12.5% (9903.05.31, List 4B suspended)', () => {
    expect(results.find((r) => r.id === 'P05')).toMatchObject({ llm: 275_000, engine: 125_000, flagged: true });
    expect(results.find((r) => r.id === 'P09')).toMatchObject({ llm: 150_000, engine: 125_000, flagged: true });
  });

  it('Section 232 knife and informational-materials exemption are flagged too', () => {
    expect(results.find((r) => r.id === 'P11')).toMatchObject({ llm: 150_000, flagged: true });
    expect(results.find((r) => r.id === 'P12')).toMatchObject({ llm: 150_000, engine: 0, flagged: true });
  });
});
