// The estimates service against a stubbed database (no Postgres): validation, the 24 h cache (no model call, no reservation),
// the 'estimate' rate limit, owner-only reads, and answers recomputed by code from the committed estimator data.
import { APICallError } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutError } from './checkout';

const db = vi.hoisted(() => {
  const state = { selectResults: [] as unknown[][], inserts: [] as { values: Record<string, unknown> }[], updates: [] as Record<string, unknown>[] };
  const chain = (): unknown => {
    const result = () => state.selectResults.shift() ?? [];
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy']) c[m] = () => c;
    c.limit = async () => result();
    c.then = (res: (v: unknown) => unknown) => res(result());
    return c;
  };
  return {
    state,
    db: {
      select: () => chain(),
      insert: () => ({ values: async (values: Record<string, unknown>) => void state.inserts.push({ values }) }),
      update: () => ({ set: (v: Record<string, unknown>) => ({ where: async () => void state.updates.push(v) }) }),
    },
  };
});
const limits = vi.hoisted(() => ({ reserveCall: vi.fn(async () => 7n), finishClassifierCall: vi.fn() }));
const classifier = vi.hoisted(() => ({ classifyListingGrounded: vi.fn() }));
vi.mock('./db/client', () => ({ db: db.db }));
vi.mock('./limits/classifierCalls', () => limits);
vi.mock('@/domain/classifier/classifyGrounded', () => classifier);
vi.mock('./env', () => ({ serverEnv: () => ({ classifierReviewThreshold: 0.8 }) }));

const { answerEstimate, getEstimate, runEstimate, startEstimate } = await import('./estimates');
const { descriptionKey, toInputRecord } = await import('@/domain/estimator/request');
const { loadEstimator } = await import('./estimator');

const NOW = new Date('2026-10-11T12:00:00Z');
const req = { title: 'Pokemon card game booster box, Japanese', origin: 'JP', sellingPriceMinor: 9500 };
const readyRow = (over: Record<string, unknown> = {}) => ({
  id: '11111111-1111-4111-8111-111111111111',
  sessionId: 'sess-1',
  status: 'READY',
  input: toInputRecord(req, NOW),
  descriptionKey: descriptionKey(req),
  stage: null,
  classification: { outcome: 'OK', candidates: [{ code: '9504.40.0000', chain: ['Video game consoles…', 'Playing cards'], confidence: 0.92 }], separating: [], reasons: [], meta: null },
  cachedFrom: null,
  error: null,
  callId: 7n,
  createdAt: NOW,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.state.selectResults = [];
  db.state.inserts = [];
  db.state.updates = [];
});

describe('startEstimate', () => {
  it('400 on a non-strict body; 422 for an origin not supported yet — before any reservation', async () => {
    await expect(startEstimate({ ...req, extra: 1 }, 'sess-1', '1.2.3.4', NOW)).rejects.toMatchObject({ status: 400 });
    await expect(startEstimate({ ...req, title: 'x'.repeat(501) }, 'sess-1', '1.2.3.4', NOW)).rejects.toMatchObject({ status: 400 });
    await expect(startEstimate({ ...req, origin: 'KR' }, 'sess-1', '1.2.3.4', NOW)).rejects.toMatchObject({ status: 422 });
    expect(limits.reserveCall).not.toHaveBeenCalled();
  });

  it('cache miss: reserves an "estimate" call, then stores an ESTIMATING row', async () => {
    db.state.selectResults = [[]];
    const r = await startEstimate(req, 'sess-1', '1.2.3.4', NOW);
    expect(r.cached).toBe(false);
    expect(limits.reserveCall).toHaveBeenCalledWith('estimate', 'sess-1', '1.2.3.4', NOW);
    expect(db.state.inserts[0]!.values).toMatchObject({ status: 'ESTIMATING', callId: 7n, descriptionKey: descriptionKey(req), sessionId: 'sess-1' });
  });

  it('cache hit (same description and origin within 24 h): READY at once with the reused classification — no reservation, no model call', async () => {
    db.state.selectResults = [[{ id: 'prev-id', classification: readyRow().classification }]];
    const r = await startEstimate({ ...req, title: '  pokemon CARD game booster box,  japanese ', sellingPriceMinor: 12000 }, 'sess-2', '1.2.3.4', NOW);
    expect(r.cached).toBe(true);
    expect(limits.reserveCall).not.toHaveBeenCalled();
    expect(classifier.classifyListingGrounded).not.toHaveBeenCalled();
    expect(db.state.inserts[0]!.values).toMatchObject({ status: 'READY', cachedFrom: 'prev-id', sessionId: 'sess-2' });
  });

  it('429 from the rate limit propagates and nothing is stored', async () => {
    db.state.selectResults = [[]];
    limits.reserveCall.mockRejectedValueOnce(new CheckoutError(429, 'too many estimate requests — try again later'));
    await expect(startEstimate(req, 'sess-1', '1.2.3.4', NOW)).rejects.toMatchObject({ status: 429 });
    expect(db.state.inserts).toEqual([]);
  });
});

describe('getEstimate / answerEstimate', () => {
  it('another session (or none) gets 404', async () => {
    db.state.selectResults = [[readyRow()]];
    await expect(getEstimate(readyRow().id, 'someone-else', NOW)).rejects.toMatchObject({ status: 404 });
    db.state.selectResults = [[readyRow()]];
    await expect(getEstimate(readyRow().id, undefined, NOW)).rejects.toMatchObject({ status: 404 });
    await expect(getEstimate('not-a-uuid', 'sess-1', NOW)).rejects.toMatchObject({ status: 404 });
  });

  it('READY: each candidate estimated from the committed data, verified row first; the view is recorded', async () => {
    db.state.selectResults = [[readyRow()]];
    const v = await getEstimate(readyRow().id, 'sess-1', NOW);
    expect(v.candidates).toHaveLength(1);
    expect(v.candidates[0]!.outcome).toMatchObject({ kind: 'ESTIMATE', source: 'verified', dutyMinor: 1188, ddpTotalMinor: 9500 + 1188 });
    expect(v.notice).toBe('Estimate — not a customs ruling.');
    expect(db.state.updates[0]).toMatchObject({ estimatorVersion: '2026-rev21-e4' });
    expect(classifier.classifyListingGrounded).not.toHaveBeenCalled();
  });

  it('ESTIMATING: real progress, no candidates yet', async () => {
    db.state.selectResults = [[readyRow({ status: 'ESTIMATING', classification: null, stage: { stage: 'matching', headings: ['9504'] } })]];
    const v = await getEstimate(readyRow().id, 'sess-1', NOW);
    expect(v.candidates).toEqual([]);
    expect(v.progress?.steps.map((s) => s.state)).toEqual(['done', 'active', 'pending']);
  });

  it('answers are recomputed by code (no model call); a split that does not add up is refused; 409 while classifying', async () => {
    // P12's line: unanswered, the verified row needs its fact, so the automated estimate answers and asks 9903.05.92's question
    const disc = readyRow({ input: toInputRecord({ ...req, sellingPriceMinor: 18000 }, NOW), classification: { ...readyRow().classification, candidates: [{ code: '8523.49.4000', chain: [], confidence: 0.9 }] } });
    db.state.selectResults = [[disc]];
    const before = await getEstimate(disc.id, 'sess-1', NOW);
    expect(before.candidates[0]!.outcome).toMatchObject({ kind: 'ESTIMATE', source: 'automated', dutyMinor: 2250, ifYes: [{ fact: 'informational_material', heading: '9903.05.92', dutyMinor: 0 }] });
    db.state.selectResults = [[disc]];
    const v = await answerEstimate(disc.id, 'sess-1', { facts: { informational_material: true } }, NOW);
    expect(v.answeredFacts).toEqual({ informational_material: true });
    expect(v.candidates[0]!.outcome).toMatchObject({ kind: 'ESTIMATE', source: 'verified', dutyMinor: 0, ifYes: [] });
    expect(classifier.classifyListingGrounded).not.toHaveBeenCalled();
    db.state.selectResults = [[readyRow()]];
    await expect(answerEstimate(readyRow().id, 'sess-1', { valueSplit: { caseMinor: 1, bandMinor: 1 } }, NOW)).rejects.toMatchObject({ status: 400 });
    db.state.selectResults = [[readyRow({ status: 'ESTIMATING' })]];
    await expect(answerEstimate(readyRow().id, 'sess-1', { facts: {} }, NOW)).rejects.toMatchObject({ status: 409 });
    await expect(answerEstimate(readyRow().id, 'sess-1', { facts: { 'Bad Key': true } }, NOW)).rejects.toMatchObject({ status: 400 });
  });
});

describe('valid_until of the committed estimator data', () => {
  it('the November 9 / 10 boundaries (an exclusion ending, note 31 headings starting) do not block estimates during judging', async () => {
    const { data } = loadEstimator();
    expect(data.validUntil === null || data.validUntil >= '2026-12-31').toBe(true);
    db.state.selectResults = [[]];
    await expect(startEstimate(req, 'sess-1', '1.2.3.4', new Date('2026-11-12T12:00:00Z'))).resolves.toMatchObject({ cached: false });
  });

  it('after a valid_until, POST refuses before any reservation or model call: "Estimate data needs a rebuild (valid until …)"', async () => {
    const { data } = loadEstimator();
    const kept = data.validUntil;
    data.validUntil = '2026-11-30';
    try {
      await expect(startEstimate(req, 'sess-1', '1.2.3.4', new Date('2026-12-01T12:00:00Z'))).rejects.toMatchObject({
        status: 503,
        message: 'Estimate data needs a rebuild (valid until 2026-11-30)',
      });
      expect(limits.reserveCall).not.toHaveBeenCalled();
    } finally {
      data.validUntil = kept;
    }
  });
});

describe('runEstimate: a failed model call stores a code, never the provider text', () => {
  const RAW = 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing.';
  const estimating = () => readyRow({ status: 'ESTIMATING', classification: null });
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('no credit: FAILED with error AI_UNAVAILABLE; the call is finished as ERROR_UNAVAILABLE (not counted)', async () => {
    db.state.selectResults = [[estimating()]];
    classifier.classifyListingGrounded.mockRejectedValueOnce(new APICallError({ message: RAW, url: 'https://api.anthropic.com/v1/messages', requestBodyValues: {}, statusCode: 400, isRetryable: false }));
    await runEstimate(estimating().id);
    expect(db.state.updates).toEqual([expect.objectContaining({ status: 'FAILED', error: 'AI_UNAVAILABLE' })]);
    expect(JSON.stringify(db.state.updates)).not.toContain('credit balance');
    expect(limits.finishClassifierCall).toHaveBeenCalledWith(7n, 'ERROR_UNAVAILABLE');
  });

  it('another error: FAILED with error FAILED; finished as ERROR', async () => {
    db.state.selectResults = [[estimating()]];
    classifier.classifyListingGrounded.mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
    await runEstimate(estimating().id);
    expect(db.state.updates).toEqual([expect.objectContaining({ status: 'FAILED', error: 'FAILED' })]);
    expect(limits.finishClassifierCall).toHaveBeenCalledWith(7n, 'ERROR');
  });

  it('an older row that stored raw text is returned as FAILED (no provider text in the response)', async () => {
    db.state.selectResults = [[readyRow({ status: 'FAILED', classification: null, error: RAW })]];
    const v = await getEstimate(readyRow().id, 'sess-1', NOW);
    expect(v.error).toBe('FAILED');
    expect(JSON.stringify(v)).not.toContain('credit balance');
  });
});
