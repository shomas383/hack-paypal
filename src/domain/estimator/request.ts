// Estimate requests (POST /api/estimates) and what is stored for them. Pure. Strict zod; nothing from the model sets an
// amount — prices are the user's, duties are computed by code from the committed estimator data.
import { createHash } from 'node:crypto';
import { z } from 'zod';

/** USD cents. $100,000 is far above any listing on the demo path; larger inputs are refused, not truncated. */
const MAX_PRICE_MINOR = 10_000_000;
const Cents = z.number().int().nonnegative().max(MAX_PRICE_MINOR);

export const EstimateRequest = z.strictObject({
  title: z.string().trim().min(3).max(500),
  details: z.string().trim().max(2000).optional(),
  /** ISO 3166 alpha-2 country of origin (where it was made, not where it was bought). */
  origin: z.string().regex(/^[A-Z]{2}$/),
  /** The selling price to the US buyer = the customs value (USD cents). Shipping is not part of it (SPEC §4.2). */
  sellingPriceMinor: Cents.positive(),
  shippingMinor: Cents.optional(),
  quantity: z.number().int().min(1).max(1000).optional(),
});
export type EstimateRequestT = z.infer<typeof EstimateRequest>;

/** A fact about the product, with where it came from. The API accepts only source 'user' for now. */
export interface Fact<T> {
  value: T | null;
  source: 'user' | 'marking_photo' | 'web_research';
  evidence?: { quote?: string; url?: string; imageRef?: string };
  confidence?: number;
  recordedAt: string;
}

/** What the estimates table stores as `input`. `economics` is reserved (purchase cost, fees, FX → margin; later). */
export interface EstimateInputRecord {
  product: { title: string; details?: string };
  facts: { origin: Fact<string>; attributes: Record<string, Fact<boolean>> };
  pricing: { sellingPriceMinor: number; currency: 'USD'; shippingMinor?: number; quantity: number; valueSplit?: { caseMinor: number; bandMinor: number } };
  economics: null;
}

export function toInputRecord(r: EstimateRequestT, now: Date): EstimateInputRecord {
  return {
    product: { title: r.title, ...(r.details ? { details: r.details } : {}) },
    facts: { origin: { value: r.origin, source: 'user', recordedAt: now.toISOString() }, attributes: {} },
    pricing: { sellingPriceMinor: r.sellingPriceMinor, currency: 'USD', ...(r.shippingMinor !== undefined ? { shippingMinor: r.shippingMinor } : {}), quantity: r.quantity ?? 1 },
    economics: null,
  };
}

/**
 * The classification cache key: the same description (NFKC, case and whitespace folded) and origin within 24 h reuses the
 * stored classification — no model call. The price doesn't change the classification, so it isn't in the key.
 */
export function descriptionKey(r: Pick<EstimateRequestT, 'title' | 'details' | 'origin'>): string {
  const fold = (s: string) => s.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
  return createHash('sha256').update(`${fold(r.title)}\n${fold(r.details ?? '')}\n${r.origin}`).digest('hex');
}
export const CACHE_HOURS = 24;

/** POST /api/estimates/<id>/answers: answers to the exemption questions and the measures a rate needs; no model call. */
export const EstimateAnswers = z.strictObject({
  facts: z.record(z.string().regex(/^[a-z][a-z0-9_]*$/), z.boolean()).optional(),
  valueSplit: z.strictObject({ caseMinor: Cents, bandMinor: Cents }).optional(),
  quantity: z.number().int().min(1).max(1000).optional(),
});
export type EstimateAnswersT = z.infer<typeof EstimateAnswers>;

/** Answers applied to the stored input: facts as user-sourced Fact<boolean>; the case/band split must add up to the price. */
export function applyAnswers(input: EstimateInputRecord, a: EstimateAnswersT, now: Date): EstimateInputRecord | { error: string } {
  if (a.valueSplit && a.valueSplit.caseMinor + a.valueSplit.bandMinor !== input.pricing.sellingPriceMinor)
    return { error: 'the case and band values must add up to the selling price' };
  const attributes = { ...input.facts.attributes };
  for (const [k, v] of Object.entries(a.facts ?? {})) attributes[k] = { value: v, source: 'user', recordedAt: now.toISOString() };
  return {
    ...input,
    facts: { ...input.facts, attributes },
    pricing: { ...input.pricing, ...(a.valueSplit ? { valueSplit: a.valueSplit } : {}), ...(a.quantity !== undefined ? { quantity: a.quantity } : {}) },
  };
}
