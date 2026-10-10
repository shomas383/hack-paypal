// Golden tests: the engine must reproduce every VERIFIED sheet row exactly (total = round½↑(R × price), or the case's
// exact expected_duty_minor where R × price isn't a whole cent — compound rates with additive add-ons; heading = O).
// Expected values come from data/eval/golden-*.json (generated from the Verify tab), not from this file.
import { describe, expect, it } from 'vitest';
import { roundHalfUpDiv, PPM } from '../money/math';
import { usd } from '../money/money';
import { loadGolden, loadVerifiedRates, type GoldenCase } from './__fixtures__/verified';
import { quoteDuty, type QuoteInput } from './engine';

const table = loadVerifiedRates();
const golden = loadGolden();
const ENTRY_DATE = '2026-10-05'; // verification date

function toInput(c: GoldenCase): QuoteInput {
  return {
    origin: c.origin,
    hts10: c.hts10 ?? '',
    entryDate: ENTRY_DATE,
    customsValue: usd(c.price_minor ?? 1),
    quantity: c.quantity ?? 1,
    ...(c.value_split ? { valueSplit: { case: usd(c.value_split.case_minor), band: usd(c.value_split.band_minor) } } : {}),
    ...(c.facts ? { facts: c.facts } : {}),
  };
}

describe('golden: verified sheet rows (HTS 2026 Rev. 20)', () => {
  it('uses the committed rate version', () => {
    expect(golden.rate_version).toBe(table.version);
    expect(golden.cases.filter((c) => c.expected === 'OK')).toHaveLength(13);
  });

  it('no program is named after a Section 301 / forced-labor action the HTS does not name (rates-v3 rename)', () => {
    const programs = table.rows.flatMap((r) => [...r.additional.map((a) => a.program), ...r.not_applied.map((n) => n.program)]);
    expect(programs.filter((p) => /^S301_|FORCED/i.test(p))).toEqual([]);
    expect(programs).toContain('CH99_NOTE52');
  });

  it.each(golden.cases.filter((c) => c.expected === 'OK').map((c) => [c.id, c] as const))(
    '%s reproduces the sheet total and Ch.99 heading',
    (_id, c) => {
      const r = quoteDuty(table, toInput(c));
      if (r.kind !== 'OK') throw new Error(`${c.id}: UNSUPPORTED — ${r.reason}`);
      const expected = c.expected_duty_minor !== undefined ? BigInt(c.expected_duty_minor) : roundHalfUpDiv(BigInt(c.price_minor!) * BigInt(c.expected_total_ppm!), PPM);
      expect(r.totalDuty).toEqual(usd(expected));
      expect(r.lines.map((l) => l.chapter99)).toContain(c.expected_chapter99);
      expect(r.rateVersion).toBe(table.version);
    },
  );

  it.each(golden.cases.filter((c) => c.expected === 'UNSUPPORTED').map((c) => [`${c.id} (${c.origin})`, c] as const))(
    '%s is UNSUPPORTED',
    (_id, c) => {
      expect(quoteDuty(table, toInput(c)).kind).toBe('UNSUPPORTED');
    },
  );

  // Readable dollar figures (plan, 2026-10-05) — the same numbers the cases above derive from R × price.
  it('matches the reviewed dollar amounts', () => {
    const cents = Object.fromEntries(
      golden.cases
        .filter((c) => c.expected === 'OK')
        .map((c) => {
          const r = quoteDuty(table, toInput(c));
          return [c.id, r.kind === 'OK' ? Number(r.totalDuty.amountMinor) : null];
        }),
    );
    expect(cents).toEqual({
      P01: 1_188, P02: 3_125, P03: 3_750, P04: 2_250, P05: 813, P06: 4_375,
      P08: 3_320, P09: 1_500, P10: 3_750, P11: 4_354, P12: 0, P13: 7_209, P14: 2_900,
    });
  });

  it('buyer-facing refs and regime notes use heading and note numbers only (no "List 4…" or "301" wording)', () => {
    const texts = [
      ...table.regime_notes,
      ...table.rows.flatMap((r) => [
        ...r.additional.map((a) => a.ref),
        ...r.source_refs.map((s) => s.ref),
        ...r.not_applied.flatMap((n) => [n.reason, n.ref]),
        ...r.exemptions_checked.refs,
      ]),
    ];
    expect(texts.filter((s) => /List 4|\b301\b/.test(s))).toEqual([]);
  });

  it('P14 DE watch: MFN $16.51 topped up to the 10% EU combined cap via 9903.05.39 ($12.49) = $29.00', () => {
    const c = golden.cases.find((x) => x.id === 'P14')!;
    expect(c).toMatchObject({ origin: 'DE', hts10: '9102.21.70', price_minor: 29_000, value_split: { case_minor: 24_000, band_minor: 5_000 }, expected_duty_minor: 2_900 });
    const r = quoteDuty(table, toInput(c));
    if (r.kind !== 'OK') throw new Error(r.reason);
    expect(r.lines.map((l) => [l.kind, l.chapter99 ?? null, Number(l.amount.amountMinor)])).toEqual([
      ['MFN', null, 1_651],
      ['CH99_NOTE52', '9903.05.39', 1_249],
    ]);
    expect(29_000 + 2_500 + Number(r.totalDuty.amountMinor)).toBe(34_400); // delivered with the $25 demo shipping
    const row = table.rows.find((x) => x.id === 'DE-9102.21.70')!;
    expect(row.additional).toEqual([expect.objectContaining({ rule: 'combined_cap', rate_ppm: 100_000, chapter99_at_or_above_cap: '9903.05.38' })]);
  });

  it('P13 CN watch: MFN $16.09 + 9903.05.31 $35.00 + 9903.88.15 $21.00 = $72.09 (cumulative, note 52(a)); 9903.88.16 not applied', () => {
    const c = golden.cases.find((x) => x.id === 'P13')!;
    expect(c).toMatchObject({ origin: 'CN', hts10: '9102.21.70', price_minor: 28_000, value_split: { case_minor: 23_000, band_minor: 5_000 }, expected_duty_minor: 7_209 });
    const r = quoteDuty(table, toInput(c));
    if (r.kind !== 'OK') throw new Error(r.reason);
    expect(r.lines.map((l) => [l.kind, l.chapter99 ?? null, Number(l.amount.amountMinor)])).toEqual([
      ['MFN', null, 1_609],
      ['CH99_NOTE52', '9903.05.31', 3_500],
      ['CH99_NOTE20_LIST4A', '9903.88.15', 2_100],
    ]);
    expect(28_000 + 2_500 + Number(r.totalDuty.amountMinor)).toBe(37_709); // delivered with the $25 demo shipping
    const row = table.rows.find((x) => x.id === 'CN-9102.21.70')!;
    expect(row.not_applied).toEqual([expect.objectContaining({ program: 'CH99_NOTE20_LIST4B', chapter99: '9903.88.16' })]);
  });

  it('P03 compound watch: MFN $16.93 (AVE 5.64%) topped up to 12.5% via 9903.05.49', () => {
    const r = quoteDuty(table, toInput(golden.cases.find((c) => c.id === 'P03')!));
    if (r.kind !== 'OK') throw new Error(r.reason);
    expect(r.lines.map((l) => [l.kind, l.chapter99 ?? null, Number(l.amount.amountMinor)])).toEqual([
      ['MFN', null, 1_693],
      ['CH99_NOTE52', '9903.05.49', 2_057],
    ]);
    expect(r.avePpm).toBe(56_433);
  });

  it('P11 knife: MFN $8.54 + Section 232 $35.00; note 52 additional duty exempt via 9903.05.90', () => {
    const r = quoteDuty(table, toInput(golden.cases.find((c) => c.id === 'P11')!));
    if (r.kind !== 'OK') throw new Error(r.reason);
    expect(r.lines.map((l) => [l.kind, l.chapter99 ?? null, Number(l.amount.amountMinor)])).toEqual([
      ['MFN', null, 854],
      ['S232_DERIVATIVE_STEEL', '9903.82.09', 3_500],
      ['CH99_NOTE52', '9903.05.90', 0],
    ]);
  });

  it('P08 denim: base 16.6% ≥ cap → 9903.05.48, no add-on', () => {
    const r = quoteDuty(table, toInput(golden.cases.find((c) => c.id === 'P08')!));
    if (r.kind !== 'OK') throw new Error(r.reason);
    expect(r.lines.at(-1)).toMatchObject({ chapter99: '9903.05.48', amount: usd(0) });
  });

  it('P11 / P12 refuse to quote without the listing facts their rows depend on', () => {
    for (const id of ['P11', 'P12']) {
      const noFacts: GoldenCase = { ...golden.cases.find((c) => c.id === id)! };
      delete noFacts.facts;
      expect(quoteDuty(table, toInput(noFacts)).kind).toBe('UNSUPPORTED');
    }
  });

  it('refuses entry dates before the Rev. 20 rows take effect', () => {
    const c = golden.cases.find((x) => x.id === 'P01')!;
    expect(quoteDuty(table, { ...toInput(c), entryDate: '2026-09-27' }).kind).toBe('UNSUPPORTED');
  });
});
