// Classifier service (SPEC §4.1): rate-limited LLM call → stored classification → (later, recorded) Publish → listing.
// Nothing here sets an amount from the model, and nothing becomes quotable without publishClassification().
import { randomUUID } from 'node:crypto';
import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { and, eq, inArray } from 'drizzle-orm';
import { z } from 'zod';
import { CLASSIFIER_MODEL, classifyListing } from '@/domain/classifier/classify';
import { canPublish, initialStatus, listingFromClassification, type ClassificationStatus } from '@/domain/classifier/publish';
import { topCandidate } from '@/domain/classifier/review';
import { CheckoutError } from './checkout';
import { db } from './db/client';
import { auditLog, classifications, listings } from './db/schema';
import { serverEnv } from './env';
import { finishClassifierCall, reserveClassifierCall } from './limits/classifierCalls';

/** Seller input. Amounts are integer USD minor units entered by the seller. */
export const ClassificationRequest = z
  .object({
    title: z.string().trim().min(3).max(500),
    description: z.string().trim().max(5000).optional(),
    origin: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable(),
    priceMinor: z.number().int().positive(),
    shippingMinor: z.number().int().nonnegative(),
  })
  .strict();

const PUBLISHABLE: ClassificationStatus[] = ['AUTO_ACCEPTED', 'ACCEPTED', 'OVERRIDDEN'];

export async function createClassification(raw: unknown, sessionId: string, ip: string, model: LanguageModel = anthropic(CLASSIFIER_MODEL)) {
  const parsed = ClassificationRequest.safeParse(raw);
  if (!parsed.success) throw new CheckoutError(400, `invalid listing: ${parsed.error.issues.map((i) => i.path.join('.') || i.message).join(', ')}`);
  const input = parsed.data;

  const callId = await reserveClassifierCall(sessionId, ip); // 429 before any LLM call when over budget
  let c;
  try {
    c = await classifyListing(
      { title: input.title, ...(input.description ? { description: input.description } : {}), origin: input.origin },
      model,
      { threshold: serverEnv().classifierReviewThreshold },
    );
  } catch (e) {
    await finishClassifierCall(callId, 'ERROR');
    throw e;
  }
  await finishClassifierCall(callId, 'OK');

  const status = initialStatus(c.review);
  const hts10 = status === 'AUTO_ACCEPTED' && c.kind === 'OK' ? (topCandidate(c.output)?.hts10 ?? null) : null;
  const id = randomUUID();
  await db.insert(classifications).values({
    id,
    sessionId,
    input: {
      title: input.title,
      ...(input.description ? { description: input.description } : {}),
      origin: input.origin,
      priceMinor: input.priceMinor,
      shippingMinor: input.shippingMinor,
    },
    model: CLASSIFIER_MODEL,
    result: c.kind === 'OK' ? c.output : null,
    error: c.kind === 'OK' ? null : c.error,
    needsReview: c.review.needsReview,
    reasons: c.review.reasons,
    status,
    hts10,
  });
  await db.insert(auditLog).values({ event: 'classification.created', entity: 'classification', entityId: id, sessionId, data: { status, reasons: c.review.reasons, hts10 } });
  return { id, status, hts10, review: c.review, result: c.kind === 'OK' ? c.output : null };
}

/** The recorded "Publish listing" action: the only way a classification becomes quotable. */
export async function publishClassification(id: string, sessionId: string) {
  const [row] = await db.select().from(classifications).where(eq(classifications.id, id));
  if (!row || row.sessionId !== sessionId) throw new CheckoutError(404, 'classification not found');
  if (!canPublish(row.status)) {
    throw new CheckoutError(409, row.status === 'PUBLISHED' ? 'already published' : 'classification needs human review before it can be published');
  }
  const built = listingFromClassification({ id: row.id, status: row.status, hts10: row.hts10, input: row.input });
  if (!built.ok) throw new CheckoutError(409, built.error);
  const l = built.listing;

  await db.transaction(async (tx) => {
    // Listing first (classifications.listing_id references it); a concurrent second publish hits the same id → no-op.
    await tx.insert(listings).values({ ...l, currency: 'USD', valueSplit: null, facts: {} }).onConflictDoNothing({ target: listings.id });
    // Conditional on the status, so a double click cannot publish twice; 0 rows → throw → the whole transaction rolls back.
    const updated = await tx
      .update(classifications)
      .set({ status: 'PUBLISHED', listingId: l.id, publishedBy: sessionId, publishedAt: new Date() })
      .where(and(eq(classifications.id, id), inArray(classifications.status, PUBLISHABLE)))
      .returning({ id: classifications.id });
    if (updated.length === 0) throw new CheckoutError(409, 'already published');
    await tx.insert(auditLog).values({ event: 'classification.published', entity: 'classification', entityId: id, sessionId, data: { listingId: l.id, hts10: l.hts10 } });
  });
  return { listingId: l.id, hts10: l.hts10 };
}
