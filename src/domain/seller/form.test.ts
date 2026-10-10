import { describe, expect, it } from 'vitest';
import { parseUsdInput } from './form';

describe('parseUsdInput (seller price fields → integer minor units; never floats)', () => {
  it('accepts dollars with up to 2 decimals', () => {
    expect(parseUsdInput('300')).toBe(30_000);
    expect(parseUsdInput('300.5')).toBe(30_050);
    expect(parseUsdInput(' 25.00 ')).toBe(2_500);
    expect(parseUsdInput('$1,250.00')).toBe(125_000);
  });

  it('zero only when allowed (shipping), never negative or malformed', () => {
    expect(parseUsdInput('0')).toBeNull();
    expect(parseUsdInput('0', { allowZero: true })).toBe(0);
    expect(parseUsdInput('-1')).toBeNull();
    expect(parseUsdInput('1.234')).toBeNull();
    expect(parseUsdInput('abc')).toBeNull();
    expect(parseUsdInput('')).toBeNull();
  });

  it('caps at $1,000,000', () => {
    expect(parseUsdInput('1000000')).toBe(100_000_000);
    expect(parseUsdInput('1000000.01')).toBeNull();
  });
});
