// Seller console classification (SPEC §4.1, grounded B2 in the service). POST stores a CLASSIFYING row after reserving the
// classifier rate limit; the run itself happens after the response (next/server `after`), writing each REAL stage to the
// row; the console polls GET for progress. Nothing here sets an amount from the model; nothing becomes quotable without
// the recorded Publish action.
import { randomUUID } from 'node:crypto';
import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { and, eq } from 'drizzle-orm';
import { CLASSIFIER_MODEL } from '@/domain/classifier/classify';
import { classifyListingGrounded } from '@/domain/classifier/classifyGrounded';
import { progressView, type ProgressView } from '@/domain/classifier/progress';
import { initialStatus, type ClassificationStatus } from '@/domain/classifier/publish';
import { CheckoutError } from '../checkout';
import { ClassificationRequest } from '../classifier';
import { db } from '../db/client';
import { auditLog, classifications, type GroundedResult } from '../db/schema';
import { serverEnv } from '../env';
import { currentHtsIndex } from '../hts';
import { storedErrorCode } from '@/domain/aiErrorText';
import { failureOutcome, logAiError } from '../aiError';
import { finishClassifierCall, reserveClassifierCall } from '../limits/classifierCalls';

export async function startGroundedClassification(raw: unknown, sellerSession: string, ip: string): Promise<{ id: string }> {
  const parsed = ClassificationRequest.safeParse(raw);
  if (!parsed.success) throw new CheckoutError(400, `invalid listing: ${parsed.error.issues.map((i) => i.path.join('.') || i.message).join(', ')}`);
  const input = parsed.data;
  const callId = await reserveClassifierCall(sellerSession, ip); // 429 before anything else when over budget
  const id = randomUUID();
  await db.insert(classifications).values({
    id,
    sessionId: sellerSession,
    input: { title: input.title, ...(input.description ? { description: input.description } : {}), origin: input.origin, priceMinor: input.priceMinor, shippingMinor: input.shippingMinor },
    model: CLASSIFIER_MODEL,
    result: null,
    needsReview: true,
    reasons: [],
    status: 'CLASSIFYING',
    kind: 'grounded',
    stage: null,
    grounded: null,
    callId,
  });
  await db.insert(auditLog).values({ event: 'classification.started', entity: 'classification', entityId: id, sessionId: sellerSession, data: { kind: 'grounded' } });
  return { id };
}

/** Runs the grounded classifier for a CLASSIFYING row (called from `after()`); every stage is written as it starts. */
export async function runGroundedClassification(id: string, model: LanguageModel = anthropic(CLASSIFIER_MODEL)): Promise<void> {
  const [row] = await db.select().from(classifications).where(eq(classifications.id, id));
  if (!row || row.status !== 'CLASSIFYING') return;
  try {
    const r = await classifyListingGrounded(
      { title: row.input.title, ...(row.input.description ? { description: row.input.description } : {}), origin: row.input.origin },
      model,
      {
        threshold: serverEnv().classifierReviewThreshold,
        idx: currentHtsIndex().lookup,
        onStage: async (stage) => {
          await db.update(classifications).set({ stage }).where(and(eq(classifications.id, id), eq(classifications.status, 'CLASSIFYING')));
        },
      },
    );
    const choice = r.kind === 'OK' ? r.choice : null;
    const top = choice ? [...choice.candidates].sort((a, b) => b.confidence - a.confidence)[0] : undefined;
    // An answer that failed its schema stays in review; its parser text goes to the server log, the row stores a code.
    if (r.kind === 'INVALID_OUTPUT') console.error(`[ai] seller classify: INVALID_OUTPUT stage=${r.stage} ${r.error.replace(/\s+/g, ' ').slice(0, 200)}`);
    const status = initialStatus(r.review);
    const grounded: GroundedResult = { outcome: r.kind, choice, candidates: r.kind === 'OK' ? r.candidates : [], meta: r.meta };
    await db
      .update(classifications)
      .set({ status, grounded, needsReview: r.review.needsReview, reasons: r.review.reasons, baseReasons: r.review.reasons, updatedAt: new Date(), hts10: status === 'AUTO_ACCEPTED' ? (top?.hts10 ?? null) : null, error: r.kind === 'INVALID_OUTPUT' ? 'FAILED' : null })
      .where(and(eq(classifications.id, id), eq(classifications.status, 'CLASSIFYING')));
    if (row.callId !== null) await finishClassifierCall(row.callId, 'OK');
    await db.insert(auditLog).values({ event: 'classification.created', entity: 'classification', entityId: id, sessionId: row.sessionId, data: { kind: 'grounded', status, reasons: r.review.reasons, hts10: top?.hts10 ?? null } });
  } catch (e) {
    // A code only (AI_UNAVAILABLE / FAILED): the provider's message goes to the server log, never to the row or a response.
    const code = logAiError('seller classify', e);
    await db.update(classifications).set({ status: 'FAILED', error: code, updatedAt: new Date() }).where(and(eq(classifications.id, id), eq(classifications.status, 'CLASSIFYING')));
    if (row.callId !== null) await finishClassifierCall(row.callId, failureOutcome(code));
  }
}

export interface ClassificationView {
  id: string;
  status: ClassificationStatus;
  progress: ProgressView;
  input: { title: string; description?: string | undefined; origin: string | null };
  error: 'AI_UNAVAILABLE' | 'FAILED' | 'interrupted' | null;
  reasons: string[];
  /** The review threshold the routing used (for "Confidence 0.62 is below the 0.80 threshold."). */
  threshold: number;
  top: { hts10: string; confidence: number; rationale: string; evidence: string[]; chain: string[]; componentReporting: boolean } | null;
  others: { hts10: string; confidence: number; chain: string[] }[];
  separatingAttributes: { name: string; value_from_listing: string | null }[];
}

/**
 * The seller's view of one classification. Any signed-in seller session may read it (one shop, one shared passcode).
 * Closes out a run that was interrupted (e.g. a restart); with `closeInterrupted: false` (the public read-only view) it
 * reports the same FAILED state without writing.
 */
export async function getClassificationView(id: string, now = new Date(), opts: { closeInterrupted?: boolean } = {}): Promise<ClassificationView> {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new CheckoutError(404, 'classification not found');
  const [row] = await db.select().from(classifications).where(eq(classifications.id, id));
  if (!row || row.kind !== 'grounded') throw new CheckoutError(404, 'classification not found');

  const choice = row.grounded?.choice ?? null;
  const ranked = choice ? [...choice.candidates].sort((a, b) => b.confidence - a.confidence) : [];
  const chainOf = (code: string) => row.grounded?.candidates.find((c) => c.code === code)?.chain ?? currentHtsIndex().chains.get(code) ?? [];
  const progress = progressView({ status: row.status, stage: row.stage ?? null, createdAt: row.createdAt, top: ranked[0] ? { hts10: ranked[0].hts10, confidence: ranked[0].confidence } : null }, now);

  let status = row.status;
  if (progress.state === 'interrupted' && opts.closeInterrupted === false) {
    status = 'FAILED';
  } else if (progress.state === 'interrupted') {
    const closed = await db
      .update(classifications)
      .set({ status: 'FAILED', error: 'interrupted', updatedAt: now })
      .where(and(eq(classifications.id, id), eq(classifications.status, 'CLASSIFYING')))
      .returning({ id: classifications.id });
    if (closed.length && row.callId !== null) await finishClassifierCall(row.callId, 'ERROR');
    status = 'FAILED';
  }

  const top = ranked[0];
  return {
    id: row.id,
    status,
    progress,
    input: { title: row.input.title, description: row.input.description, origin: row.input.origin },
    error: storedErrorCode(row.error), // a code only; older rows that kept raw text read as FAILED
    reasons: row.reasons,
    threshold: serverEnv().classifierReviewThreshold,
    top: top
      ? { hts10: top.hts10, confidence: top.confidence, rationale: top.rationale, evidence: top.evidence, chain: chainOf(top.hts10), componentReporting: row.grounded?.candidates.find((c) => c.code === top.hts10)?.componentReporting ?? false }
      : null,
    others: ranked.slice(1).map((c) => ({ hts10: c.hts10, confidence: c.confidence, chain: chainOf(c.hts10) })),
    separatingAttributes: choice?.separating_attributes ?? [],
  };
}
