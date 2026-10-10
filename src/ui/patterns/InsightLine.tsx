// Listing IDs are running text here (sans); mono is for table cells and HTS / Ch. 99 codes.
// Code-computed: shown only when the lowest goods price (within budget) isn't the lowest delivered total.
import { priceInsight, type QuoteView } from '@/domain/agent/insight';
import { usd } from '@/domain/money/money';
import { formatUsd } from '@/lib/money';
import s from './InsightLine.module.css';

export function InsightLine({ rows }: { rows: QuoteView[] }) {
  const i = priceInsight(rows);
  if (!i) return null;
  const g = i.lowestGoods;
  const d = i.lowestDelivered;
  return (
    <p className={s.insight} data-testid="agent-insight">
      <span>
        Lowest goods price: {g.listingId} ({g.origin}) {formatUsd(usd(g.goodsMinor))} → delivered {formatUsd(usd(g.deliveredMinor))}
      </span>
      <span className={s.sep} aria-hidden="true">
        ·
      </span>
      <span>
        Lowest delivered: {d.listingId} ({d.origin}) <strong>{formatUsd(usd(d.deliveredMinor))}</strong>
      </span>
    </p>
  );
}
