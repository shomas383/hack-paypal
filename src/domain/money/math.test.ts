import { describe, expect, it } from 'vitest';
import { addMoney, applyPpm, PPM, roundHalfUpDiv, subMoney } from './math';
import { jpy, usd } from './money';

describe('roundHalfUpDiv', () => {
  it('divides exactly when there is no remainder', () => {
    expect(roundHalfUpDiv(10n, 5n)).toBe(2n);
    expect(roundHalfUpDiv(0n, 7n)).toBe(0n);
  });

  it('rounds half up', () => {
    expect(roundHalfUpDiv(5n, 2n)).toBe(3n); // 2.5 → 3
    expect(roundHalfUpDiv(15n, 10n)).toBe(2n); // 1.5 → 2
    expect(roundHalfUpDiv(14n, 10n)).toBe(1n); // 1.4 → 1
    expect(roundHalfUpDiv(16n, 10n)).toBe(2n); // 1.6 → 2
  });

  it('rejects negative numerators and non-positive denominators', () => {
    expect(() => roundHalfUpDiv(-1n, 2n)).toThrow(RangeError);
    expect(() => roundHalfUpDiv(1n, 0n)).toThrow(RangeError);
  });
});

describe('applyPpm', () => {
  it('applies a rate in parts per million and rounds half up to the minor unit', () => {
    expect(applyPpm(usd(9_500), 125_000n)).toEqual(usd(1_188)); // $95 × 12.5% = $11.875 → $11.88
    expect(applyPpm(usd(6_500), 125_000n)).toEqual(usd(813)); // $65 × 12.5% = $8.125 → $8.13
    expect(applyPpm(usd(20_000), 166_000n)).toEqual(usd(3_320)); // $200 × 16.6% = $33.20
    expect(applyPpm(usd(14_000), 250_000n)).toEqual(usd(3_500)); // $140 × 25% = $35.00
  });

  it('keeps the currency and handles zero', () => {
    expect(applyPpm(jpy(1_000), 125_000n)).toEqual(jpy(125));
    expect(applyPpm(usd(12_345), 0n)).toEqual(usd(0));
    expect(PPM).toBe(1_000_000n);
  });

  it('rejects negative rates', () => {
    expect(() => applyPpm(usd(100), -1n)).toThrow(RangeError);
  });
});

describe('addMoney / subMoney', () => {
  it('adds and subtracts same-currency amounts', () => {
    expect(addMoney(usd(1_693), usd(2_057))).toEqual(usd(3_750));
    expect(subMoney(usd(3_750), usd(1_693))).toEqual(usd(2_057));
  });

  it('refuses to mix currencies', () => {
    expect(() => addMoney(usd(1), jpy(1))).toThrow(TypeError);
    expect(() => subMoney(usd(1), jpy(1))).toThrow(TypeError);
  });
});
