// Public estimates (SPEC §4.7). POST stores an ESTIMATING row after reserving the 'estimate' rate limit — unless the same
// description and origin was classified in the last 24 h, in which case its classification is reused (READY at once, no
// model call, no reservation). The grounded classifier runs after the response (next/server `after`), writing each REAL
// stage. Duties are never stored as truth: GET computes them from the committed estimator data (verified rate rows first)
// each time; `result` keeps the last view for the record. Never charged: no quote, listing or order is touched here.
import { randomUUID } from 'node:crypto';
import { anthropic } from '@ai-sdk/anthropic';
import type { LanguageModel } from 'ai';
import { and, desc, eq, gte, isNotNull } from 'drizzle-orm';
import { CLASSIFIER_MODEL } from '@/domain/classifier/classify';
import { classifyListingGrounded } from '@/domain/classifier/classifyGrounded';
import { progressView, type ProgressView } from '@/domain/classifier/progress';
import { dataExpiredText } from '@/domain/estimator/estimate';
import { originOf, SUPPORTED_ORIGINS } from '@/domain/estimator/origin';
import { applyAnswers, CACHE_HOURS, descriptionKey, EstimateAnswers, EstimateRequest, toInputRecord } from '@/domain/estimator/request';
import { estimateViewOf, type EstimateView } from '@/domain/estimator/view';
import { CheckoutError } from './checkout';
import { db } from './db/client';
import { auditLog, estimates, type EstimateClassification } from './db/schema';
import { serverEnv } from './env';
import { loadEstimator } from './estimator';
import { currentHtsIndex } from './hts';
import { finishClassifierCall, reserveCall } from './limits/classifierCalls';
import { currentRateTable } from './rates';

const issues = (e: { issues: { path: PropertyKey[]; message: string }[] }) => e.issues.map((i) => i.path.join('.') || i.message).join(', ');

export async function startEstimate(raw: unknown, sessionId: string, ip: string, now = new Date()): Promise<{ id: string; cached: boolean }> {
  const parsed = EstimateRequest.safeParse(raw);
  if (!parsed.success) throw new CheckoutError(400, `invalid estimate request: ${issues(parsed.error)}`);
  const req = parsed.data;
  const { data } = loadEstimator();
  if (data.validUntil !== null && now.toISOString().slice(0, 10) > data.validUntil) throw new CheckoutError(503, dataExpiredText(data.validUntil));
  if (!originOf(req.origin)) throw new CheckoutError(422, `Estimates are available for goods made in ${SUPPORTED_ORIGINS.join(', ')} for now.`);
  const key = descriptionKey(req);
  const id = randomUUID();
  const input = toInputRecord(req, now);

  const since = new Date(now.getTime() - CACHE_HOURS * 3_600_000);
  const [hit] = await db
    .select({ id: estimates.id, classification: estimates.classification })
    .from(estimates)
    .where(and(eq(estimates.descriptionKey, key), eq(estimates.status, 'READY'), isNotNull(estimates.classification), gte(estimates.createdAt, since)))
    .orderBy(desc(estimates.createdAt))
    .limit(1);
  if (hit?.classification) {
    await db.insert(estimates).values({ id, sessionId, input, descriptionKey: key, status: 'READY', classification: hit.classification, cachedFrom: hit.id });
    await db.insert(auditLog).values({ event: 'estimate.cached', entity: 'estimate', entityId: id, sessionId, data: { cachedFrom: hit.id } });
    return { id, cached: true };
  }

  const callId = await reserveCall('estimate', sessionId, ip, now); // 429 before any model call when over budget
  await db.insert(estimates).values({ id, sessionId, input, descriptionKey: key, status: 'ESTIMATING', callId });
  await db.insert(auditLog).values({ event: 'estimate.started', entity: 'estimate', entityId: id, sessionId, data: {} });
  return { id, cached: false };
}

/** Runs the grounded classifier for an ESTIMATING row (called from `after()`); every stage is written as it starts. */
export async function runEstimate(id: string, model: LanguageModel = anthropic(CLASSIFIER_MODEL)): Promise<void> {
  const [row] = await db.select().from(estimates).where(eq(estimates.id, id));
  if (!row || row.status !== 'ESTIMATING') return;
  try {
    const p = row.input.product;
    const r = await classifyListingGrounded(
      { title: p.title, ...(p.details ? { description: p.details } : {}), origin: row.input.facts.origin.value },
      model,
      {
        threshold: serverEnv().classifierReviewThreshold,
        idx: currentHtsIndex().lookup,
        onStage: async (stage) => {
          await db.update(estimates).set({ stage }).where(and(eq(estimates.id, id), eq(estimates.status, 'ESTIMATING')));
        },
      },
    );
    const chains = new Map((r.kind === 'OK' ? r.candidates : []).map((c) => [c.code, c.chain]));
    const classification: EstimateClassification = {
      outcome: r.kind,
      candidates:
        r.kind === 'OK' ? [...r.choice.candidates].sort((a, b) => b.confidence - a.confidence).map((c) => ({ code: c.hts10, chain: chains.get(c.hts10) ?? [], confidence: c.confidence })) : [],
      separating: r.kind === 'OK' ? r.choice.separating_attributes : [],
      reasons: r.review.reasons,
      meta: r.meta,
    };
    await db.update(estimates).set({ status: 'READY', classification, updatedAt: new Date() }).where(and(eq(estimates.id, id), eq(estimates.status, 'ESTIMATING')));
    if (row.callId !== null) await finishClassifierCall(row.callId, 'OK');
    await db.insert(auditLog).values({ event: 'estimate.classified', entity: 'estimate', entityId: id, sessionId: row.sessionId, data: { outcome: r.kind, candidates: classification.candidates.map((c) => c.code) } });
  } catch (e) {
    const message = e instanceof Error ? e.message.slice(0, 300) : 'estimate failed';
    await db.update(estimates).set({ status: 'FAILED', error: message, updatedAt: new Date() }).where(and(eq(estimates.id, id), eq(estimates.status, 'ESTIMATING')));
    if (row.callId !== null) await finishClassifierCall(row.callId, 'ERROR');
  }
}

export type EstimateResponse = EstimateView & { progress?: ProgressView };

async function ownRow(id: string, sessionId: string | undefined) {
  const [row] = /^[0-9a-f-]{36}$/.test(id) ? await db.select().from(estimates).where(eq(estimates.id, id)) : [];
  // another session's estimate is "not found", never "forbidden"
  if (!row || !sessionId || row.sessionId !== sessionId) throw new CheckoutError(404, 'estimate not found');
  return row;
}

async function viewAndRecord(row: Awaited<ReturnType<typeof ownRow>>, now: Date): Promise<EstimateResponse> {
  const { data } = loadEstimator();
  const verified = currentRateTable();
  const view = estimateViewOf(row, data, verified, now.toISOString().slice(0, 10));
  if (row.status === 'READY') {
    await db.update(estimates).set({ result: view, estimatorVersion: view.estimatorVersion, rateVersion: view.rateVersion }).where(eq(estimates.id, row.id));
    return view;
  }
  const top = row.classification?.candidates[0];
  return { ...view, progress: progressView({ status: row.status === 'ESTIMATING' ? 'CLASSIFYING' : row.status, stage: row.stage, createdAt: row.createdAt, top: top ? { hts10: top.code, confidence: top.confidence } : null }, now) };
}

export async function getEstimate(id: string, sessionId: string | undefined, now = new Date()): Promise<EstimateResponse> {
  return viewAndRecord(await ownRow(id, sessionId), now);
}

/** Answers (exemption facts, case/band split, quantity) → recomputed by code; no model call. */
export async function answerEstimate(id: string, sessionId: string | undefined, raw: unknown, now = new Date()): Promise<EstimateResponse> {
  const parsed = EstimateAnswers.safeParse(raw);
  if (!parsed.success) throw new CheckoutError(400, `invalid answers: ${issues(parsed.error)}`);
  const row = await ownRow(id, sessionId);
  if (row.status !== 'READY') throw new CheckoutError(409, 'the estimate is not ready yet');
  const next = applyAnswers(row.input, parsed.data, now);
  if ('error' in next) throw new CheckoutError(400, next.error);
  await db.update(estimates).set({ input: next, updatedAt: now }).where(eq(estimates.id, id));
  await db.insert(auditLog).values({ event: 'estimate.answered', entity: 'estimate', entityId: id, sessionId: row.sessionId, data: { facts: parsed.data.facts ?? {}, valueSplit: parsed.data.valueSplit ?? null, quantity: parsed.data.quantity ?? null } });
  return viewAndRecord({ ...row, input: next }, now);
}
