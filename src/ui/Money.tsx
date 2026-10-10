// Displays Money with the shared exact formatter, in tabular figures. `bare` drops the "$" for cells whose header
// carries the currency.
import type { Money as MoneyT } from '@/domain/money/money';
import { formatUsd, formatUsdNumber } from '@/lib/money';
import s from './Money.module.css';

export function Money({ value, bare = false, strong = false, className, ...rest }: { value: MoneyT; bare?: boolean; strong?: boolean; className?: string; 'data-testid'?: string }) {
  return (
    <span {...rest} className={`${s.money} ${strong ? s.strong : ''} ${className ?? ''}`}>
      {bare ? formatUsdNumber(value) : formatUsd(value)}
    </span>
  );
}
