// AG Grid (Community 36.2.0) theme fed from the same CSS variables as the rest of the app (src/app/styles/tokens.css).
// Row/header height live HERE (theme params), never in CSS. No zebra striping. Param names checked against the installed
// ag-grid-community 36.2.0 typings (theming/core/core-css.d.ts, parts/theme/themes.d.ts).
import { themeQuartz, type ColDef } from 'ag-grid-community';
import type { Money } from '@/domain/money/money';
import { formatUsdNumber } from './money';

export const landedGridTheme = themeQuartz.withParams({
  fontFamily: 'var(--font-sans)',
  fontSize: 13,
  headerFontSize: 13,
  headerFontWeight: 500,
  rowHeight: 36,
  headerHeight: 36,
  spacing: 6,
  backgroundColor: 'var(--surface)',
  foregroundColor: 'var(--text)',
  borderColor: 'var(--border)',
  accentColor: 'var(--accent)',
  headerBackgroundColor: 'var(--subtle)',
  headerTextColor: 'var(--text-muted)',
  selectedRowBackgroundColor: 'var(--selected)',
  oddRowBackgroundColor: 'var(--surface)',
  rowHoverColor: 'var(--subtle)',
  wrapperBorderRadius: 8,
  browserColorScheme: 'light',
});

/**
 * A money column: right-aligned cell + header ('numericColumn'), currency in the header only, the shared exact formatter.
 * `value` must return Money (integer minor units); the grid never sees a float amount.
 */
export function moneyColumn<Row>(headerName: string, value: (row: Row) => Money | null): ColDef<Row> {
  return {
    headerName: `${headerName} (USD)`,
    type: 'numericColumn',
    valueGetter: (p) => (p.data ? value(p.data) : null),
    valueFormatter: (p) => (p.value ? formatUsdNumber(p.value as Money) : ''),
    comparator: (a: Money | null, b: Money | null) => {
      const x = a?.amountMinor ?? -1n;
      const y = b?.amountMinor ?? -1n;
      return x < y ? -1 : x > y ? 1 : 0;
    },
    cellStyle: { fontVariantNumeric: 'tabular-nums' },
  };
}
