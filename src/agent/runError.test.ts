// A model call that fails mid-run (no credit, bad key, any provider error) reaches the browser as a code only: the event
// carries no provider text, and the run reports the failure so the route can record it.
import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDeps } from './fakeDeps';
import { runAgent, type AgentEvent } from './run';

const RAW = 'Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing.';
const failing = (error: unknown) =>
  new MockLanguageModelV4({
    doStream: async () => {
      throw error;
    },
  });

async function go(error: unknown) {
  const events: AgentEvent[] = [];
  const done = await runAgent({ message: 'automatic diver watch under $400 delivered', budgetMinor: 40_000n, sessionId: 's-1', model: failing(error), deps: fakeDeps().deps, onEvent: (e) => void events.push(e) });
  return { events, done };
}

describe('runAgent: a failed model call', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => undefined));
  afterEach(() => vi.restoreAllMocks());

  it('no credit (400 billing): one error event with code AI_UNAVAILABLE and no provider text; done.failure set', async () => {
    const { events, done } = await go(new APICallError({ message: RAW, url: 'https://api.anthropic.com/v1/messages', requestBodyValues: {}, statusCode: 400, isRetryable: false }));
    expect(events.filter((e) => e.type === 'error')).toEqual([{ type: 'error', code: 'AI_UNAVAILABLE' }]);
    expect(JSON.stringify(events)).not.toContain('credit balance');
    expect(done.failure).toBe('AI_UNAVAILABLE');
  });

  it('any other error: code FAILED, no message text', async () => {
    const { events, done } = await go(new Error('socket hang up while reading secret things'));
    expect(events.filter((e) => e.type === 'error')).toEqual([{ type: 'error', code: 'FAILED' }]);
    expect(JSON.stringify(events)).not.toContain('secret things');
    expect(done.failure).toBe('FAILED');
  });
});
