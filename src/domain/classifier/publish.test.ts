import { describe, expect, it } from 'vitest';
import { canPublish, initialStatus, listingFromClassification, type ClassificationRecord } from './publish';

const rec = (over: Partial<ClassificationRecord> = {}): ClassificationRecord => ({
  id: '7f8e2a10-0000-4000-8000-000000000001',
  status: 'AUTO_ACCEPTED',
  hts10: '9102.21.7000',
  input: { title: 'Automatic diver watch', origin: 'JP', priceMinor: 30_000, shippingMinor: 2_500 },
  ...over,
});

describe('initialStatus — never quotable on its own', () => {
  it('review-routed → PENDING_REVIEW; clean → AUTO_ACCEPTED (still needs Publish)', () => {
    expect(initialStatus({ needsReview: true })).toBe('PENDING_REVIEW');
    expect(initialStatus({ needsReview: false })).toBe('AUTO_ACCEPTED');
  });
});

describe('canPublish — only a settled HTS code can become a listing', () => {
  it('AUTO_ACCEPTED, ACCEPTED, OVERRIDDEN → yes', () => {
    for (const s of ['AUTO_ACCEPTED', 'ACCEPTED', 'OVERRIDDEN'] as const) expect(canPublish(s)).toBe(true);
  });

  it('PENDING_REVIEW and already PUBLISHED → no', () => {
    expect(canPublish('PENDING_REVIEW')).toBe(false);
    expect(canPublish('PUBLISHED')).toBe(false);
  });
});

describe('listingFromClassification', () => {
  it('builds the listing from the settled code and the seller input (no amounts from the model)', () => {
    expect(listingFromClassification(rec())).toEqual({
      ok: true,
      listing: { id: 'L-C-7f8e2a10', sheetRef: 'CLASSIFIER', title: 'Automatic diver watch', origin: 'JP', hts10: '9102.21.7000', priceMinor: 30_000n, shippingMinor: 2_500n },
    });
  });

  it('refuses a PENDING_REVIEW classification', () => {
    expect(listingFromClassification(rec({ status: 'PENDING_REVIEW' }))).toEqual({ ok: false, error: expect.stringMatching(/review/) });
  });

  it('refuses without a settled code or a known origin', () => {
    expect(listingFromClassification(rec({ hts10: null })).ok).toBe(false);
    expect(listingFromClassification(rec({ input: { ...rec().input, origin: null } })).ok).toBe(false);
  });
});
