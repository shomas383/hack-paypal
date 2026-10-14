// getClassificationView against a stubbed database: an interrupted run is closed out (one UPDATE) for the owner, while the
// public read-only view (closeInterrupted: false) reports the same FAILED state without writing anything.
import { beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => {
  const state = { selectResults: [] as unknown[][], updates: 0 };
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
      update: () => ({ set: () => ({ where: () => ({ returning: async () => (state.updates++, [{ id: 'x' }]) }) }) }),
      insert: () => ({ values: async () => undefined }),
    },
  };
});
const limits = vi.hoisted(() => ({ reserveClassifierCall: vi.fn(), finishClassifierCall: vi.fn() }));
vi.mock('../db/client', () => ({ db: db.db }));
vi.mock('../limits/classifierCalls', () => limits);
vi.mock('../env', () => ({ serverEnv: () => ({ classifierReviewThreshold: 0.8 }) }));
vi.mock('../hts', () => ({ currentHtsIndex: () => ({ chains: new Map() }) }));

const { getClassificationView } = await import('./classify');

const ID = '0b7a5e1c-1111-4222-8333-444455556666';
const NOW = new Date('2026-10-14T12:00:00Z');
const interrupted = { id: ID, kind: 'grounded', status: 'CLASSIFYING', stage: null, createdAt: new Date(NOW.getTime() - 10 * 60_000), grounded: null, input: { title: 'Watch', origin: 'JP' }, error: null, reasons: [], callId: 7n };

describe('getClassificationView: interrupted runs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.state.updates = 0;
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
