import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { fromPayPalValue } from '@/domain/money/format';
import { usd } from '@/domain/money/money';
import { formatUsd, formatUsdNumber } from './money';

describe('formatUsd (display only; exact decimal string in, never a float)', () => {
  it('always shows two decimals and a thousands separator', () => {
    expect(formatUsd(usd(0n))).toBe('$0.00');
    expect(formatUsd(usd(1n))).toBe('$0.01');
    expect(formatUsd(usd(34_400n))).toBe('$344.00');
    expect(formatUsd(usd(123_450n))).toBe('$1,234.50');
  });

  it('is exact for values far beyond float precision', () => {
    expect(formatUsd(usd(900_719_925_474_099_312n))).toBe('$9,007,199,254,740,993.12');
  });

  it('number form for tables whose header carries the currency', () => {
    expect(formatUsdNumber(usd(37_709n))).toBe('377.09');
    expect(formatUsdNumber(usd(123_450n))).toBe('1,234.50');
  });

  it('round-trips: stripping "$" and "," gives back the same minor units', () => {
    fc.assert(
      fc.property(fc.bigInt({ min: 0n, max: 10n ** 15n }), (minor) => {
        const shown = formatUsd(usd(minor)).replace(/[$,]/g, '');
        expect(fromPayPalValue(shown, 'USD').amountMinor).toBe(minor);
      }),
    );
  });

  it('refuses non-USD money', () => {
    expect(() => formatUsd({ amountMinor: 100n, currency: 'JPY' })).toThrow(/USD/);
  });
});
