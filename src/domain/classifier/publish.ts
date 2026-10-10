// Classification lifecycle (SPEC §4.1, §4.5). No classification is quotable by itself: it becomes a `listings` row only
// through a recorded "Publish listing" action, and only once its HTS code is settled (auto-accepted, or accepted /
// overridden by a reviewer). Review-routed results stay PENDING_REVIEW and are never auto-quoted.
// CLASSIFYING: the grounded run is in progress (seller console, polled); FAILED: the run errored (no result, not publishable).
export type ClassificationStatus = 'CLASSIFYING' | 'FAILED' | 'PENDING_REVIEW' | 'AUTO_ACCEPTED' | 'ACCEPTED' | 'OVERRIDDEN' | 'PUBLISHED';

export interface ClassificationInput {
  title: string;
  description?: string;
  origin: string | null;
  /** Seller-entered amounts (integer USD minor units) — never from the model. */
  priceMinor: number;
  shippingMinor: number;
}

export interface ClassificationRecord {
  id: string;
  status: ClassificationStatus;
  /** The settled code: the top candidate when auto-accepted, or the reviewer's choice. Null while pending. */
  hts10: string | null;
  input: ClassificationInput;
}

export function initialStatus(review: { needsReview: boolean }): 'PENDING_REVIEW' | 'AUTO_ACCEPTED' {
  return review.needsReview ? 'PENDING_REVIEW' : 'AUTO_ACCEPTED';
}

export function canPublish(status: ClassificationStatus): boolean {
  return status === 'AUTO_ACCEPTED' || status === 'ACCEPTED' || status === 'OVERRIDDEN';
}

export type ListingDraft = {
  id: string;
  sheetRef: 'CLASSIFIER';
  title: string;
  origin: string;
  hts10: string;
  priceMinor: bigint;
  shippingMinor: bigint;
};

export function listingFromClassification(c: ClassificationRecord): { ok: true; listing: ListingDraft } | { ok: false; error: string } {
  if (!canPublish(c.status)) {
    return { ok: false, error: c.status === 'PENDING_REVIEW' ? 'classification needs human review before it can be published' : `cannot publish a ${c.status} classification` };
  }
  if (!c.hts10) return { ok: false, error: 'no settled HTS code' };
  if (!c.input.origin) return { ok: false, error: 'country of origin is required to publish' };
  return {
    ok: true,
    listing: {
      id: `L-C-${c.id.slice(0, 8)}`,
      sheetRef: 'CLASSIFIER',
      title: c.input.title,
      origin: c.input.origin,
      hts10: c.hts10,
      priceMinor: BigInt(c.input.priceMinor),
      shippingMinor: BigInt(c.input.shippingMinor),
    },
  };
}
