// Listing → immutable quote record (SPEC §4.3). Duty comes only from quoteDuty(); shipping is a listing charge and is
// NOT part of customs value. Pure: the caller supplies id, session, clock and TTL.
import { usd } from '../money/money';
import { quoteDuty } from '../rates/engine';
import type { RateFile } from '../rates/schema';

export interface ListingForQuote {
  id: string;
  title: string;
  origin: string;
  hts10: string;
  priceMinor: bigint;
  shippingMinor: bigint;
  valueSplit?: { caseMinor: bigint; bandMinor: bigint };
  facts: Record<string, boolean>;
}

/** A duty line as stored (amounts as decimal strings so the record is JSON-safe). */
export interface StoredLine {
  kind: string;
  chapter99?: string;
  amountMinor: string;
  basis: string;
  sourceRef: string;
}

export interface QuoteRecord {
  id: string;
  listingId: string;
  sessionId: string;
  title: string;
  rateVersion: string;
  rateRowId: string;
  origin: string;
  hts10: string;
  entryDate: string;
  goodsMinor: bigint;
  shippingMinor: bigint;
  dutyMinor: bigint;
  totalMinor: bigint;
  currency: 'USD';
  lines: StoredLine[];
  effectiveRatePpm: number;
  createdAt: Date;
  expiresAt: Date;
}

export type BuildQuoteResult = { kind: 'OK'; quote: QuoteRecord } | { kind: 'UNSUPPORTED'; reason: string };

export function buildQuote(
  table: RateFile,
  listing: ListingForQuote,
  opts: { id: string; sessionId: string; now: Date; ttlSeconds: number },
): BuildQuoteResult {
  if (listing.shippingMinor < 0n) return { kind: 'UNSUPPORTED', reason: 'shipping charge must not be negative' };
  const entryDate = opts.now.toISOString().slice(0, 10);
  const r = quoteDuty(table, {
    origin: listing.origin,
    hts10: listing.hts10,
    entryDate,
    customsValue: usd(listing.priceMinor),
    quantity: 1,
    ...(listing.valueSplit ? { valueSplit: { case: usd(listing.valueSplit.caseMinor), band: usd(listing.valueSplit.bandMinor) } } : {}),
    facts: listing.facts,
  });
  if (r.kind !== 'OK') return r;

  const duty = r.totalDuty.amountMinor;
  return {
    kind: 'OK',
    quote: {
      id: opts.id,
      listingId: listing.id,
      sessionId: opts.sessionId,
      title: listing.title,
      rateVersion: r.rateVersion,
      rateRowId: r.rowId,
      origin: listing.origin,
      hts10: listing.hts10,
      entryDate,
      goodsMinor: listing.priceMinor,
      shippingMinor: listing.shippingMinor,
      dutyMinor: duty,
      totalMinor: listing.priceMinor + listing.shippingMinor + duty,
      currency: 'USD',
      lines: r.lines.map((l) => ({
        kind: l.kind,
        ...(l.chapter99 ? { chapter99: l.chapter99 } : {}),
        amountMinor: l.amount.amountMinor.toString(),
        basis: l.basis,
        sourceRef: l.sourceRef,
      })),
      effectiveRatePpm: r.effectiveRatePpm,
      createdAt: opts.now,
      expiresAt: new Date(opts.now.getTime() + opts.ttlSeconds * 1000),
    },
  };
}
