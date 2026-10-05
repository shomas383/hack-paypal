// The ONLY place Money becomes a PayPal amount string (CLAUDE.md invariant 1).
// PayPal `value` is a string: integer for JPY (zero-decimal), 2 decimals for USD (docs/PAYPAL.md).
import { EXPONENT, type Money } from './money';

export function toPayPalValue(m: Money): string {
  if (m.amountMinor < 0n) {
    throw new RangeError(`PayPal amount must be non-negative, got ${m.amountMinor} ${m.currency}`);
  }
  const exp = EXPONENT[m.currency];
  if (exp === 0) return m.amountMinor.toString();
  const digits = m.amountMinor.toString().padStart(exp + 1, '0');
  return `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
}

/** PayPal money object, e.g. `{ currency_code: 'USD', value: '12.34' }`. */
export function toPayPalAmount(m: Money): { currency_code: Money['currency']; value: string } {
  return { currency_code: m.currency, value: toPayPalValue(m) };
}
