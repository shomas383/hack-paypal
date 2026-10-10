// Code-computed facts about the agent's quotes (docs/design/wireframes.md §1). Amounts come only from the stored-quote
// strings the tools returned ("$377.09"), parsed exactly into integer minor units — never floats, never the model's text.
import { fromPayPalValue } from '../money/format';

export interface QuoteView {
  listingId: string;
  origin?: string;
  goods?: string;
  delivered_total?: string;
  budget?: string;
  within_budget?: boolean;
  unsupported?: string;
}

export interface InsightSide {
  listingId: string;
  origin: string;
  goodsMinor: bigint;
  deliveredMinor: bigint;
}

/** "$377.09" → 37709n; anything else → null. */
export function dollarsToMinor(s: string | undefined): bigint | null {
  const m = /^\$(\d+\.\d{2})$/.exec(s ?? '');
  return m ? fromPayPalValue(m[1]!, 'USD').amountMinor : null;
}

function sides(rows: QuoteView[]): InsightSide[] {
  return rows.flatMap((r) => {
    if (r.unsupported || r.within_budget !== true) return [];
    const goodsMinor = dollarsToMinor(r.goods);
    const deliveredMinor = dollarsToMinor(r.delivered_total);
    if (goodsMinor === null || deliveredMinor === null || !r.origin) return [];
    return [{ listingId: r.listingId, origin: r.origin, goodsMinor, deliveredMinor }];
  });
}

const minBy = (xs: InsightSide[], k: (x: InsightSide) => bigint) => xs.reduce((a, b) => (k(b) < k(a) ? b : a));

/** When the lowest goods price (within budget) isn't the lowest delivered total, both sides; otherwise null. */
export function priceInsight(rows: QuoteView[]): { lowestGoods: InsightSide; lowestDelivered: InsightSide } | null {
  const xs = sides(rows);
  if (xs.length < 2) return null;
  const lowestGoods = minBy(xs, (x) => x.goodsMinor);
  const lowestDelivered = minBy(xs, (x) => x.deliveredMinor);
  return lowestGoods.listingId === lowestDelivered.listingId ? null : { lowestGoods, lowestDelivered };
}

/** Delivered − budget, in minor units, when the quote is over budget; null otherwise. */
export function overBudgetBy(r: QuoteView): bigint | null {
  const delivered = dollarsToMinor(r.delivered_total);
  const budget = dollarsToMinor(r.budget);
  if (delivered === null || budget === null || delivered <= budget) return null;
  return delivered - budget;
}

/** The single completion announcement for screen readers. */
export function runSummary(rows: QuoteView[], proposal: { listingId: string; delivered_total: string } | null): string {
  const ok = rows.filter((r) => !r.unsupported);
  const within = ok.filter((r) => r.within_budget === true).length;
  const head = `Found ${ok.length} ${ok.length === 1 ? 'quote' : 'quotes'}, ${within} within budget.`;
  return proposal ? `${head} Prepared a purchase for ${proposal.listingId} at ${proposal.delivered_total}.` : `${head} No purchase was prepared.`;
}
