import { describe, expect, it } from 'vitest';
import { toPayPalValue } from './format';
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

describe('money constructors', () => {
  it('accept safe integers and reject floats', () => {
    expect(usd(1234).amountMinor).toBe(1234n);
    expect(() => usd(12.34)).toThrow(RangeError);
    expect(() => jpy(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
  });
});
