import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { usd } from '../money/money';
import { quoteDuty } from './engine';
import { loadVerifiedRates } from './__fixtures__/verified';

// Demo variants: seed listings that are NOT golden cases but reuse a verified row. Each declares its expected engine
// result; this test (and the seed script) check the engine against it exactly.
interface SeedListing {
  id: string;
  origin: string;
  hts10: string;
  price_minor: number;
  shipping_minor: number;
  value_split: { case_minor: number; band_minor: number } | null;
  demo_variant_of?: string;
  expected?: { duty_minor: number; total_minor: number; chapter99: string };
}

const seed = JSON.parse(readFileSync('data/seed/listings.json', 'utf8')) as { listings: SeedListing[] };
const variants = seed.listings.filter((l) => l.demo_variant_of);

describe('seed demo variants: engine result equals the declared expectation', () => {
  it('there is a $380 JP watch variant of P03 (case $320 / band $60)', () => {
    expect(variants.map((v) => v.id)).toContain('L-P03-B');
  });

  it.each(variants.map((v) => [v.id, v] as const))('%s', (_id, v) => {
    expect(v.expected).toBeDefined();
    const r = quoteDuty(loadVerifiedRates(), {
      origin: v.origin,
      hts10: v.hts10,
      entryDate: '2026-10-08',
      customsValue: usd(v.price_minor),
      quantity: 1,
      ...(v.value_split ? { valueSplit: { case: usd(v.value_split.case_minor), band: usd(v.value_split.band_minor) } } : {}),
    });
    if (r.kind !== 'OK') throw new Error(r.reason);
    expect(r.totalDuty.amountMinor).toBe(BigInt(v.expected!.duty_minor));
    expect(BigInt(v.price_minor + v.shipping_minor) + r.totalDuty.amountMinor).toBe(BigInt(v.expected!.total_minor));
    expect(r.lines.map((l) => l.chapter99).filter(Boolean)).toContain(v.expected!.chapter99);
  });

  it('L-P03-B math: MFN $1.53 + 4.2%×$320 + 9.8%×$60 = $20.85 (AVE 5.49% < 12.5%) → combined cap 12.5%×$380 = $47.50 → $452.50 delivered', () => {
    const r = quoteDuty(loadVerifiedRates(), { origin: 'JP', hts10: '9102.21.70', entryDate: '2026-10-08', customsValue: usd(38_000), quantity: 1, valueSplit: { case: usd(32_000), band: usd(6_000) } });
    if (r.kind !== 'OK') throw new Error(r.reason);
    expect(r.lines.map((l) => [l.kind, l.amount.amountMinor])).toEqual([
      ['MFN', 2_085n],
      ['CH99_NOTE52', 2_665n],
    ]);
  });
});
