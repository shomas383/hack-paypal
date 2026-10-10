// Orders and duty ledger (seller console): every PayPal sandbox order with its stored quote. Only what a seller needs:
// amounts from the stored quote, HTS / Chapter 99 lines, rate version, status, the PayPal order id. No buyer data.
import { desc, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { orders, quotes } from '../db/schema';

export interface LedgerRow {
  orderId: string;
  date: string;
  listingId: string;
  title: string;
  /** Integer USD minor units as strings (bigint-safe JSON). */
  goodsMinor: string;
  shippingMinor: string;
  dutyMinor: string;
  totalMinor: string;
  hts10: string;
  ch99: string[];
  rateVersion: string;
  status: string;
  paypalOrderId: string | null;
}

export async function ordersLedger(): Promise<LedgerRow[]> {
  const rows = await db
    .select({ o: orders, q: quotes })
    .from(orders)
    .innerJoin(quotes, eq(orders.quoteId, quotes.id))
    .orderBy(desc(orders.createdAt))
    .limit(500);
  return rows.map(({ o, q }) => ({
    orderId: o.id,
    date: o.createdAt.toISOString(),
    listingId: q.listingId,
    title: q.title,
    goodsMinor: q.goodsMinor.toString(),
    shippingMinor: q.shippingMinor.toString(),
    dutyMinor: q.dutyMinor.toString(),
    totalMinor: q.totalMinor.toString(),
    hts10: q.hts10,
    ch99: q.lines.flatMap((l) => (l.chapter99 ? [l.chapter99] : [])),
    rateVersion: q.rateVersion,
    status: o.status,
    paypalOrderId: o.paypalOrderId,
  }));
}
