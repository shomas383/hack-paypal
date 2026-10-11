// Property tests (SPEC §4.2) over the committed verified rate table. Rule parameters (caps, add-on rates) are read
// from the table — never hard-coded here — so the properties hold for whatever the importer generated.
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyPpm, addMoney } from '../money/math';
import { usd } from '../money/money';
import { inForceDate, loadVerifiedRates } from './__fixtures__/verified';
import { quoteDuty, type QuoteInput } from './engine';
import type { RateRow } from './schema';

const table = loadVerifiedRates();
const DATE = inForceDate(table);
const centsArb = fc.bigInt({ min: 1n, max: 100_000_000n }); // $0.01 – $1,000,000

/** A valid input for a row: satisfies its conditions and, for case/band compound rates, a random split. */
function inputArb(row: RateRow) {
  const facts = Object.fromEntries(row.additional.flatMap((a) => a.conditions.map((c) => [c.fact, c.required_value])));
  const needsSplit = row.mfn.type === 'compound' && row.mfn.components.some((c) => c.kind === 'ad_valorem' && c.applies_to !== 'full_value');
  return fc.record({ cents: centsArb, quantity: fc.integer({ min: 1, max: 5 }), splitPermille: fc.integer({ min: 0, max: 1000 }) }).map(
    ({ cents, quantity, splitPermille }): QuoteInput => {
      const caseMinor = (cents * BigInt(splitPermille)) / 1000n;
      return {
        origin: row.origin,
        hts10: row.hts10,
        entryDate: DATE,
        customsValue: usd(cents),
        quantity,
        ...(needsSplit ? { valueSplit: { case: usd(caseMinor), band: usd(cents - caseMinor) } } : {}),
        ...(Object.keys(facts).length ? { facts } : {}),
      };
    },
  );
}

const quote = (q: QuoteInput) => {
  const r = quoteDuty(table, q);
  if (r.kind !== 'OK') throw new Error(`${q.origin} ${q.hts10}: ${r.reason}`);
  return r;
};

const capOnly = table.rows.filter((r) => r.additional.length === 1 && r.additional[0]!.rule === 'combined_cap');
const additiveOnly = table.rows.filter((r) => r.additional.every((a) => a.rule === 'additive') && r.additional.length > 0);

describe('properties over the verified table', () => {
  it('has rows of each rule family to test', () => {
    expect(capOnly.length).toBeGreaterThan(0);
    expect(additiveOnly.length).toBeGreaterThan(0);
  });

  it.each(table.rows.map((r) => [r.id, r] as const))('%s: duty ≥ 0 and total = Σ lines', (_id, row) => {
    fc.assert(
      fc.property(inputArb(row), (q) => {
        const r = quote(q);
        expect(r.totalDuty.amountMinor >= 0n).toBe(true);
        for (const l of r.lines) expect(l.amount.amountMinor >= 0n).toBe(true);
        expect(r.lines.reduce((s, l) => addMoney(s, l.amount), usd(0))).toEqual(r.totalDuty);
      }),
    );
  });

  it.each(capOnly.map((r) => [r.id, r] as const))('%s (combined cap): total = max(MFN, cap × value)', (_id, row) => {
    const cap = BigInt(row.additional[0]!.rate_ppm);
    fc.assert(
      fc.property(inputArb(row), (q) => {
        const r = quote(q);
        const mfn = r.lines[0]!.amount;
        const capped = applyPpm(q.customsValue, cap);
        expect(r.totalDuty).toEqual(mfn.amountMinor >= capped.amountMinor ? mfn : capped);
      }),
    );
  });

  it.each(additiveOnly.map((r) => [r.id, r] as const))('%s (additive): total = MFN + Σ add-on × value', (_id, row) => {
    fc.assert(
      fc.property(inputArb(row), (q) => {
        const r = quote(q);
        const addOns = row.additional.reduce((s, a) => addMoney(s, applyPpm(q.customsValue, BigInt(a.rate_ppm))), usd(0));
        expect(r.totalDuty).toEqual(addMoney(r.lines[0]!.amount, addOns));
      }),
    );
  });

  it('EU rows (9903.05.39): a 10% combined cap; at or above it the line is 9903.05.38 with no add-on', () => {
    const eu = table.rows.filter((r) => r.origin === 'DE');
    expect(eu.length).toBeGreaterThan(0);
    for (const row of eu) {
      expect(row.additional).toEqual([expect.objectContaining({ rule: 'combined_cap', chapter99: '9903.05.39', chapter99_at_or_above_cap: '9903.05.38', rate_ppm: 100_000 })]);
    }
    // $10 watch (case $8 / band $2): MFN $1.53 + $0.336 + $0.196 ≈ 20.6% AVE ≥ 10% → .38, total = MFN.
    const r = quote({ origin: 'DE', hts10: '9102.21.70', entryDate: DATE, customsValue: usd(1_000), quantity: 1, valueSplit: { case: usd(800), band: usd(200) } });
    expect(r.lines.at(-1)).toMatchObject({ chapter99: '9903.05.38', amount: usd(0) });
    expect(r.totalDuty).toEqual(r.lines[0]!.amount);
  });

  it('CN rows (9903.05.31): total = MFN + additive add-ons from the table (incl. 9903.88.15 where listed), never a cap', () => {
    const cn = table.rows.filter((r) => r.origin === 'CN');
    expect(cn.length).toBeGreaterThan(0);
    for (const row of cn) {
      expect(row.additional.every((a) => a.rule === 'additive')).toBe(true);
      expect(row.additional[0]!.chapter99).toBe('9903.05.31');
    }
  });

  it.each(table.rows.filter((r) => r.mfn.type === 'ad_valorem' || r.mfn.type === 'free').map((r) => [r.id, r] as const))(
    '%s: duty never decreases as the value rises',
    (_id, row) => {
      fc.assert(
        fc.property(inputArb(row), centsArb, (q, extra) => {
          const lower = quote(q).totalDuty.amountMinor;
          const higher = quote({ ...q, customsValue: usd(q.customsValue.amountMinor + extra) }).totalDuty.amountMinor;
          expect(higher >= lower).toBe(true);
        }),
      );
    },
  );

  it('unknown HTS codes or origins → UNSUPPORTED', () => {
    const known = new Set(table.rows.map((r) => `${r.origin}|${r.hts10}`));
    const htsArb = fc
      .tuple(fc.integer({ min: 0, max: 9999 }), fc.integer({ min: 0, max: 99 }), fc.integer({ min: 0, max: 9999 }))
      .map(([a, b, c]) => `${String(a).padStart(4, '0')}.${String(b).padStart(2, '0')}.${String(c).padStart(4, '0')}`);
    const originArb = fc.constantFrom('JP', 'CN', 'DE', 'GB', 'US', 'KR', 'TW', 'MY');
    fc.assert(
      fc.property(originArb, htsArb, centsArb, (origin, hts10, cents) => {
        fc.pre(!known.has(`${origin}|${hts10}`));
        const r = quoteDuty(table, { origin, hts10, entryDate: DATE, customsValue: usd(cents), quantity: 1 });
        expect(r.kind).toBe('UNSUPPORTED');
      }),
    );
  });

  it('entry dates before a row takes effect → UNSUPPORTED', () => {
    const before = fc.date({ min: new Date('2000-01-01'), max: new Date(`${DATE}T00:00:00Z`), noInvalidDate: true }).map((d) => d.toISOString().slice(0, 10));
    fc.assert(
      fc.property(fc.constantFrom(...table.rows), before, (row, entryDate) => {
        fc.pre(entryDate < row.effective_from);
        const r = quoteDuty(table, { origin: row.origin, hts10: row.hts10, entryDate, customsValue: usd(10_000), quantity: 1 });
        expect(r.kind).toBe('UNSUPPORTED');
      }),
    );
  });
});
