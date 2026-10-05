// Money is integer minor units + currency. Never floats (CLAUDE.md invariant 1).
export type Currency = 'USD' | 'JPY';

export interface Money {
  readonly amountMinor: bigint;
  readonly currency: Currency;
}

/** Minor-unit exponent per currency: USD has cents, JPY is zero-decimal. */
export const EXPONENT: Readonly<Record<Currency, number>> = { USD: 2, JPY: 0 };

function toMinor(amountMinor: bigint | number): bigint {
  if (typeof amountMinor === 'bigint') return amountMinor;
  if (!Number.isSafeInteger(amountMinor)) {
    throw new RangeError(`amountMinor must be a safe integer, got ${amountMinor}`);
  }
  return BigInt(amountMinor);
}

export function money(amountMinor: bigint | number, currency: Currency): Money {
  return { amountMinor: toMinor(amountMinor), currency };
}

export const usd = (amountMinor: bigint | number): Money => money(amountMinor, 'USD');
export const jpy = (amountMinor: bigint | number): Money => money(amountMinor, 'JPY');
