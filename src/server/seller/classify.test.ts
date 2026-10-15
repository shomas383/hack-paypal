// getClassificationView against a stubbed database: an interrupted run is closed out (one UPDATE) for the owner, while the
// public read-only view (closeInterrupted: false) reports the same FAILED state without writing anything.
import { APICallError } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const state = { selectResults: [] as unknown[][], updates: 0, sets: [] as Record<string, unknown>[] };
  const chain = (): unknown => {
    const result = () => state.selectResults.shift() ?? [];
    const c: Record<string, unknown> = {};
    for (const m of ['from', 'where', 'orderBy']) c[m] = () => c;
    c.then = (res: (v: unknown) => unknown) => res(result());
    return c;
  };
  return {
    state,
    db: {
      select: () => chain(),
      update: () => ({
        set: (v: Record<string, unknown>) => ({
          where: () => {
            state.sets.push(v);
            return { returning: async () => (state.updates++, [{ id: 'x' }]) };
          },
        }),
      }),
      insert: () => ({ values: async () => undefined }),
    },
  };
});
const limits = vi.hoisted(() => ({ reserveClassifierCall: vi.fn(), finishClassifierCall: vi.fn() }));
vi.mock('../db/client', () => ({ db: db.db }));
vi.mock('../limits/classifierCalls', () => limits);
vi.mock('../env', () => ({ serverEnv: () => ({ classifierReviewThreshold: 0.8 }) }));
vi.mock('../hts', () => ({ currentHtsIndex: () => ({ chains: new Map(), lookup: () => undefined }) }));
const classifier = vi.hoisted(() => ({ classifyListingGrounded: vi.fn() }));
vi.mock('@/domain/classifier/classifyGrounded', () => classifier);

const { getClassificationView, runGroundedClassification } = await import('./classify');

const ID = '0b7a5e1c-1111-4222-8333-444455556666';
const NOW = new Date('2026-10-14T12:00:00Z');
const interrupted = { id: ID, kind: 'grounded', status: 'CLASSIFYING', stage: null, createdAt: new Date(NOW.getTime() - 10 * 60_000), grounded: null, input: { title: 'Watch', origin: 'JP' }, error: null, reasons: [], callId: 7n };

describe('getClassificationView: interrupted runs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.state.updates = 0;
    db.state.sets = [];
    db.state.selectResults = [[interrupted]];
  });

  it('owner read: closes the run out (one UPDATE, the reservation finished) and reports FAILED', async () => {
    const v = await getClassificationView(ID, NOW);
    expect(v.status).toBe('FAILED');
    expect(db.state.updates).toBe(1);
    expect(limits.finishClassifierCall).toHaveBeenCalledWith(7n, 'ERROR');
  });

  it('closeInterrupted: false (public view): reports FAILED and writes nothing', async () => {
    const v = await getClassificationView(ID, NOW, { closeInterrupted: false });
    expect(v.status).toBe('FAILED');
    expect(v.progress.state).toBe('interrupted');
    expect(db.state.updates).toBe(0);
    expect(limits.finishClassifierCall).not.toHaveBeenCalled();
  });
});

describe('runGroundedClassification: a failed model call stores a code, never the provider text', () => {
  const RAW = 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing.';
  const running = { ...interrupted, createdAt: NOW };
  beforeEach(() => {
    vi.clearAllMocks();
    db.state.sets = [];
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('no credit: FAILED with error AI_UNAVAILABLE; the call is finished as ERROR_UNAVAILABLE (not counted)', async () => {
    db.state.selectResults = [[running]];
    classifier.classifyListingGrounded.mockRejectedValueOnce(new APICallError({ message: RAW, url: 'https://api.anthropic.com/v1/messages', requestBodyValues: {}, statusCode: 402, isRetryable: false }));
    await runGroundedClassification(ID, {} as never);
    expect(db.state.sets).toEqual([expect.objectContaining({ status: 'FAILED', error: 'AI_UNAVAILABLE' })]);
    expect(JSON.stringify(db.state.sets)).not.toContain('credit balance');
    expect(limits.finishClassifierCall).toHaveBeenCalledWith(7n, 'ERROR_UNAVAILABLE');
  });

  it('another error: FAILED with error FAILED; finished as ERROR', async () => {
    db.state.selectResults = [[running]];
    classifier.classifyListingGrounded.mockRejectedValueOnce(new Error('connection terminated unexpectedly'));
    await runGroundedClassification(ID, {} as never);
    expect(db.state.sets).toEqual([expect.objectContaining({ status: 'FAILED', error: 'FAILED' })]);
    expect(limits.finishClassifierCall).toHaveBeenCalledWith(7n, 'ERROR');
  });

  it('an answer that fails its schema (INVALID_OUTPUT) stores the code FAILED; the parser text goes to the log only', async () => {
    db.state.selectResults = [[running]];
    classifier.classifyListingGrounded.mockResolvedValueOnce({ kind: 'INVALID_OUTPUT', stage: 1, error: 'No object generated: response did not match schema.', review: { needsReview: true, reasons: ['INVALID_OUTPUT'] }, meta: { calls: 1, usage: { input: 0, output: 0 }, ms: 1 } });
    await runGroundedClassification(ID, {} as never);
    expect(db.state.sets).toEqual([expect.objectContaining({ status: 'PENDING_REVIEW', error: 'FAILED' })]);
    expect(JSON.stringify(db.state.sets)).not.toContain('No object generated');
  });

  it('an older FAILED row that stored raw text is returned as FAILED', async () => {
    db.state.selectResults = [[{ ...interrupted, status: 'FAILED', error: RAW }]];
    const v = await getClassificationView(ID, NOW);
    expect(v.error).toBe('FAILED');
  });
});
