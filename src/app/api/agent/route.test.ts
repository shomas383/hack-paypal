// /api/agent: whatever the model or the run throws, the stream carries a code, never the provider's message; the reserved
// call is finished as ERROR_UNAVAILABLE (not counted against the limits) for provider outages and ERROR otherwise.
import { APICallError } from 'ai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const RAW = 'Your credit balance is too low to access the Anthropic API.';
const run = vi.hoisted(() => ({ runAgent: vi.fn(), AGENT_MODEL: 'claude-opus-5-5' }));
const limits = vi.hoisted(() => ({ reserveCall: vi.fn(async () => 7n), finishClassifierCall: vi.fn(async () => undefined) }));
vi.mock('@/agent/run', () => run);
vi.mock('@/agent/deps', () => ({ agentDeps: () => ({}) }));
vi.mock('@/server/limits/classifierCalls', () => limits);
vi.mock('@/server/session', () => ({ ensureSessionId: async () => 's-1' }));
vi.mock('@/server/env', () => ({ serverEnv: () => ({ trustedProxyHops: 1 }) }));

const { POST } = await import('./route');
const req = () => new Request('http://localhost/api/agent', { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '203.0.113.7' }, body: JSON.stringify({ message: 'automatic diver watch', budget: '400.00' }) });
const lines = async (r: Response) =>
  (await r.text())
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Record<string, unknown>);
const done = (failure: string | null) => ({ type: 'done', steps: 1, usage: { input: 0, output: 0 }, ms: 1, proposal: null, failure });

describe('POST /api/agent: failures', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('a run that reports a provider outage is finished as ERROR_UNAVAILABLE', async () => {
    run.runAgent.mockImplementationOnce(async ({ onEvent }: { onEvent: (e: unknown) => void }) => {
      onEvent({ type: 'error', code: 'AI_UNAVAILABLE' });
      const d = done('AI_UNAVAILABLE');
      onEvent(d);
      return d;
    });
    await lines(await POST(req()));
    expect(limits.finishClassifierCall).toHaveBeenCalledWith(7n, 'ERROR_UNAVAILABLE');
  });

  it('a run that reports another failure is finished as ERROR; a clean run as OK', async () => {
    run.runAgent.mockImplementationOnce(async () => done('FAILED'));
    await lines(await POST(req()));
    expect(limits.finishClassifierCall).toHaveBeenLastCalledWith(7n, 'ERROR');
    run.runAgent.mockImplementationOnce(async () => done(null));
    await lines(await POST(req()));
    expect(limits.finishClassifierCall).toHaveBeenLastCalledWith(7n, 'OK');
  });

  it('a thrown provider error: the stream has the code only; finished as ERROR_UNAVAILABLE', async () => {
    run.runAgent.mockRejectedValueOnce(new APICallError({ message: RAW, url: 'https://api.anthropic.com/v1/messages', requestBodyValues: {}, statusCode: 401, isRetryable: false }));
    const out = await lines(await POST(req()));
    expect(out).toEqual([{ type: 'error', code: 'AI_UNAVAILABLE' }]);
    expect(limits.finishClassifierCall).toHaveBeenCalledWith(7n, 'ERROR_UNAVAILABLE');
  });

  it('a thrown non-provider error: code FAILED, no message; finished as ERROR', async () => {
    run.runAgent.mockRejectedValueOnce(new Error('relation "quotes" does not exist'));
    const out = await lines(await POST(req()));
    expect(out).toEqual([{ type: 'error', code: 'FAILED' }]);
    expect(limits.finishClassifierCall).toHaveBeenCalledWith(7n, 'ERROR');
  });
});
