// Landed-cost quotes compared (agent). Every number is a stored-quote string from the tool result; "within budget" and
// "over by" are computed in code. Sorted by delivered total; pending and unavailable rows follow.
import { overBudgetBy, dollarsToMinor, type QuoteView } from '@/domain/agent/insight';
import { usd } from '@/domain/money/money';
import { formatUsdNumber } from '@/lib/money';
import { SkeletonRows } from '../Skeleton';
import { StatusBadge } from '../StatusBadge';
import s from './QuotesTable.module.css';

export interface QuoteRow {
  id: string;
  listingId: string;
  out?: (QuoteView & { hts?: string; shipping?: string; us_import_duty_est?: string }) | undefined;
  error?: string | undefined;
}

/**
 * ≤ 720 px: one two-line row per quote, so Delivered and Budget are visible without scrolling. Line 1: listing, origin,
 * delivered, budget status. Line 2 (muted): goods, shipping, duty. Same data and order as the table (which is hidden).
 */
function NarrowQuotes({ rows }: { rows: QuoteRow[] }) {
  return (
    <div className={s.narrow}>
      <p className={s.caption}>Landed-cost quotes, sorted by delivered total (USD)</p>
      <ul className={s.cards}>
        {rows.map((r) => {
          const o = r.out;
          if (!o || r.error || o.unsupported) {
            return (
              <li key={r.id} className={s.mrow}>
                <span className={s.mline}>
                  <span className={s.mid}>{r.listingId}</span>
                  <span className={r.error ? s.failed : s.muted}>{r.error ? `This quote failed: ${r.error}` : o?.unsupported ? 'No verified rate for this origin and HTS line, so no quote.' : 'Quoting…'}</span>
                </span>
              </li>
            );
          }
          const over = overBudgetBy(o);
          return (
            <li key={r.id} className={s.mrow} data-testid={`agent-quote-m-${r.listingId}`}>
              <span className={s.mline}>
                <span className={s.mid}>
                  {r.listingId} <span className={s.muted}>{o.origin}</span>
                </span>
                <span className={s.mdelivered}>Delivered {bare(o.delivered_total)}</span>
                {o.within_budget ? (
                  <StatusBadge tone="success">Within</StatusBadge>
                ) : (
                  <StatusBadge tone="danger">{over !== null ? `Over by ${formatUsdNumber(usd(over))}` : 'Over'}</StatusBadge>
                )}
              </span>
              <span className={`${s.mline} ${s.msub}`}>
                Goods {bare(o.goods)} · Shipping {bare(o.shipping)} · Duty {bare(o.us_import_duty_est)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const bare = (v: string | undefined) => {
  const m = dollarsToMinor(v);
  return m === null ? '—' : formatUsdNumber(usd(m));
};

export function QuotesTable({ rows, pending }: { rows: QuoteRow[]; pending: number }) {
  const sorted = [...rows].sort((a, b) => {
    const x = dollarsToMinor(a.out?.delivered_total);
    const y = dollarsToMinor(b.out?.delivered_total);
    if (x === null && y === null) return 0;
    if (x === null) return 1;
    if (y === null) return -1;
    return x < y ? -1 : x > y ? 1 : 0;
  });
  return (
    <>
    <div className={`${s.scroll} ${s.wide}`} role="region" aria-label="Landed-cost quotes" tabIndex={0}>
      <table className={s.table} data-testid="agent-quotes">
        <caption className={s.caption}>Landed-cost quotes, sorted by delivered total</caption>
        <thead>
          <tr>
            <th scope="col">Listing</th>
            <th scope="col">Origin</th>
            <th scope="col">HTS</th>
            <th scope="col" className={s.num}>Goods (USD)</th>
            <th scope="col" className={s.num}>Shipping (USD)</th>
            <th scope="col" className={s.num}>Duty, est. (USD)</th>
            <th scope="col" className={s.num}>Delivered (USD)</th>
            <th scope="col">Budget</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
            const o = r.out;
            if (!o || r.error) {
              return (
                <tr key={r.id}>
                  <th scope="row" className={`${s.mono} ${s.id}`} title={r.listingId}>{r.listingId}</th>
                  <td colSpan={7} className={r.error ? s.failed : s.muted}>
                    {r.error ? `This quote failed: ${r.error}` : 'Quoting…'}
                  </td>
                </tr>
              );
            }
            if (o.unsupported) {
              return (
                <tr key={r.id}>
                  <th scope="row" className={`${s.mono} ${s.id}`} title={r.listingId}>{r.listingId}</th>
                  <td colSpan={7}>
                    <StatusBadge tone="neutral">No verified rate for this origin and HTS line, so no quote.</StatusBadge>
                  </td>
                </tr>
              );
            }
            const over = overBudgetBy(o);
            return (
              <tr key={r.id} data-testid={`agent-quote-${r.listingId}`}>
                <th scope="row" className={`${s.mono} ${s.id}`} title={r.listingId}>{r.listingId}</th>
                <td>{o.origin}</td>
                <td className={s.mono}>{o.hts}</td>
                <td className={s.num}>{bare(o.goods)}</td>
                <td className={s.num}>{bare(o.shipping)}</td>
                <td className={s.num}>{bare(o.us_import_duty_est)}</td>
                <td className={`${s.num} ${s.delivered}`}>{bare(o.delivered_total)}</td>
                <td>
                  {o.within_budget ? (
                    <StatusBadge tone="success">Within</StatusBadge>
                  ) : (
                    <StatusBadge tone="danger">{over !== null ? `Over by ${formatUsdNumber(usd(over))}` : 'Over'}</StatusBadge>
                  )}
                </td>
              </tr>
            );
          })}
          {pending > 0 ? <SkeletonRows rows={pending} cols={8} /> : null}
        </tbody>
      </table>
    </div>
    <NarrowQuotes rows={sorted} />
    </>
  );
}
