// The ONLY place Money becomes a PayPal amount string (CLAUDE.md invariant 1).
// PayPal `value` is a string: integer for JPY (zero-decimal), 2 decimals for USD (docs/PAYPAL.md).
import { EXPONENT, money, type Currency, type Money } from './money';

export function toPayPalValue(m: Money): string {
  if (m.amountMinor < 0n) {
    throw new RangeError(`PayPal amount must be non-negative, got ${m.amountMinor} ${m.currency}`);
  }
  const exp = EXPONENT[m.currency];
  if (exp === 0) return m.amountMinor.toString();
  const digits = m.amountMinor.toString().padStart(exp + 1, '0');
  return `${digits.slice(0, -exp)}.${digits.slice(-exp)}`;
}

/** PayPal amount string → Money, exactly (no floats). Rejects more decimals than the currency allows. */
export function fromPayPalValue(value: string, currency: Currency): Money {
  const exp = EXPONENT[currency];
  const m = /^(\d+)(?:\.(\d+))?$/.exec(value);
  if (!m) throw new RangeError(`not a PayPal amount: "${value}"`);
  const frac = m[2] ?? '';
  if (frac.length > exp) throw new RangeError(`${currency} allows ${exp} decimals, got "${value}"`);
  return money(BigInt(`${m[1]}${frac.padEnd(exp, '0')}`), currency);
}

/** Human display, e.g. "$362.50" — same exact digits as the PayPal value. */
export function formatDisplay(m: Money): string {
  return `${m.currency === 'USD' ? '$' : '¥'}${toPayPalValue(m)}`;
}

/** PayPal money object, e.g. `{ currency_code: 'USD', value: '12.34' }`. */
export function toPayPalAmount(m: Money): { currency_code: Money['currency']; value: string } {
  return { currency_code: m.currency, value: toPayPalValue(m) };
}
