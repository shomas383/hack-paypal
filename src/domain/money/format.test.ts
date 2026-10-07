import { describe, expect, it } from 'vitest';
import { fromPayPalValue, toPayPalValue } from './format';
import { jpy, usd } from './money';

describe('toPayPalValue', () => {
  it('formats USD with exactly 2 decimals', () => {
    expect(toPayPalValue(usd(1234n))).toBe('12.34');
    expect(toPayPalValue(usd(5n))).toBe('0.05');
    expect(toPayPalValue(usd(100n))).toBe('1.00');
    expect(toPayPalValue(usd(0n))).toBe('0.00');
  });

  it('formats JPY as an integer (exponent 0, no decimals)', () => {
    expect(toPayPalValue(jpy(1234n))).toBe('1234');
    expect(toPayPalValue(jpy(0n))).toBe('0');
  });

  it('handles values beyond Number.MAX_SAFE_INTEGER without precision loss', () => {
    expect(toPayPalValue(usd(9007199254740993n))).toBe('90071992547409.93');
  });

  it('rejects negative amounts (PayPal amount values are non-negative)', () => {
    expect(() => toPayPalValue(usd(-1n))).toThrow(RangeError);
  });
});

describe('fromPayPalValue', () => {
  it('parses PayPal amount strings into exact minor units', () => {
    expect(fromPayPalValue('362.50', 'USD')).toEqual(usd(36_250n));
    expect(fromPayPalValue('0.05', 'USD')).toEqual(usd(5n));
    expect(fromPayPalValue('12', 'USD')).toEqual(usd(1_200n));
    expect(fromPayPalValue('1234', 'JPY')).toEqual(jpy(1_234n));
  });

  it('round-trips with toPayPalValue', () => {
    for (const m of [usd(0n), usd(1n), usd(36_250n), usd(9007199254740993n)]) {
      expect(fromPayPalValue(toPayPalValue(m), 'USD')).toEqual(m);
    }
  });

  it('rejects malformed values, too many decimals and decimals on JPY', () => {
    for (const bad of ['', '-1.00', '1.234', '1,00', 'abc', '1.']) expect(() => fromPayPalValue(bad, 'USD')).toThrow(RangeError);
    expect(() => fromPayPalValue('1.5', 'JPY')).toThrow(RangeError);
  });
});

describe('money constructors', () => {
  it('accept safe integers and reject floats', () => {
    expect(usd(1234).amountMinor).toBe(1234n);
    expect(() => usd(12.34)).toThrow(RangeError);
    expect(() => jpy(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});
