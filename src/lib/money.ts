// The one display formatter for USD (docs/design/brief.md). Intl.NumberFormat gets the EXACT decimal string from
// toPayPalValue (supported since ES2023 Intl.NumberFormat v3), so no float ever touches an amount (invariant 1).
import { toPayPalValue } from '@/domain/money/format';
import type { Money } from '@/domain/money/money';

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USD_NUMBER = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

type DecimalString = `${number}`;

function exact(m: Money): DecimalString {
  if (m.currency !== 'USD') throw new RangeError(`formatUsd expects USD, got ${m.currency}`);
  return toPayPalValue(m) as DecimalString;
}

/** "$1,234.50" — for prose and single amounts. */
export function formatUsd(m: Money): string {
  return USD.format(exact(m));
}

/** "1,234.50" — for table cells whose column header carries the currency ("Duty (USD)"). */
export function formatUsdNumber(m: Money): string {
  return USD_NUMBER.format(exact(m));
}
