// Can a stored quote still be acted on (approve, start a PayPal order, invoice)? Pure; the same two checks
// decideCapture applies at capture time. "Stale" means the quote's rate version is not the active table's version —
// never the age of the rates or the quote.
export type QuoteUnusableReason = 'RATE_VERSION_STALE' | 'QUOTE_EXPIRED';

export type QuoteUsability = { ok: true } | { ok: false; reasons: QuoteUnusableReason[] };

export function quoteUsable(q: { rateVersion: string; expiresAt: Date }, now: Date, currentRateVersion: string): QuoteUsability {
  const reasons: QuoteUnusableReason[] = [];
  if (q.rateVersion !== currentRateVersion) reasons.push('RATE_VERSION_STALE');
  if (now.getTime() >= q.expiresAt.getTime()) reasons.push('QUOTE_EXPIRED');
  return reasons.length > 0 ? { ok: false, reasons } : { ok: true };
}

const WORDS: Record<QuoteUnusableReason, string> = { RATE_VERSION_STALE: 'rates changed', QUOTE_EXPIRED: 'quote expired' };

/** User-facing text for a 409: "rates changed / quote expired — get a new quote". */
export function quoteUnusableMessage(reasons: QuoteUnusableReason[]): string {
  return `${reasons.map((r) => WORDS[r]).join(' / ')} — get a new quote`;
}
