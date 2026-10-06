// Integer money math. Rates are parts per million (12.5% = 125_000n); results round half up to the minor unit.
import { money, type Money } from './money';

export const PPM = 1_000_000n;

/** n / d rounded half up. Duty math only deals in non-negative amounts, so negatives are rejected. */
export function roundHalfUpDiv(n: bigint, d: bigint): bigint {
  if (n < 0n) throw new RangeError(`numerator must be non-negative, got ${n}`);
  if (d <= 0n) throw new RangeError(`denominator must be positive, got ${d}`);
  return (n * 2n + d) / (d * 2n);
}

/** m × ppm / 1,000,000, rounded half up to the currency's minor unit. */
export function applyPpm(m: Money, ppm: bigint): Money {
  if (ppm < 0n) throw new RangeError(`rate must be non-negative, got ${ppm} ppm`);
  return money(roundHalfUpDiv(m.amountMinor * ppm, PPM), m.currency);
}

function sameCurrency(a: Money, b: Money): void {
  if (a.currency !== b.currency) throw new TypeError(`currency mismatch: ${a.currency} vs ${b.currency}`);
}

export function addMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor + b.amountMinor, a.currency);
}

export function subMoney(a: Money, b: Money): Money {
  sameCurrency(a, b);
  return money(a.amountMinor - b.amountMinor, a.currency);
}
