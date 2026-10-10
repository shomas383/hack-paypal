import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { fakeDeps } from './fakeDeps';
import { runAgent, type AgentEvent } from './run';

type Step = { tool?: { name: string; input: (prompt: string) => unknown }; text?: string };
const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 10, text: 10, reasoning: undefined } };

/** A scripted model: step i emits optional text, then optional ONE tool call whose input may read earlier tool results. */
function scripted(steps: Step[]) {
  let i = 0;
  return new MockLanguageModelV4({
    doStream: async (options) => {
      const step = steps[Math.min(i++, steps.length - 1)]!;
      const prompt = JSON.stringify(options.prompt);
      const parts: unknown[] = [{ type: 'stream-start', warnings: [] }];
      if (step.text) parts.push({ type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: step.text }, { type: 'text-end', id: 't' });
      if (step.tool) parts.push({ type: 'tool-call', toolCallId: `c${i}`, toolName: step.tool.name, input: JSON.stringify(step.tool.input(prompt)) });
      parts.push({ type: 'finish', usage, finishReason: { unified: step.tool ? 'tool-calls' : 'stop', raw: undefined } });
      return { stream: new ReadableStream({ start: (c) => { for (const p of parts) c.enqueue(p); c.close(); } }) as never };
    },
  });
}
const quoteIdFor = (listingId: string) => (prompt: string) => {
  const m = new RegExp(`quoteId\\\\?":\\\\?"([0-9a-f-]{36})\\\\?",\\\\?"listingId\\\\?":\\\\?"${listingId}`).exec(prompt);
  if (!m) throw new Error(`no quote for ${listingId} in the prompt yet`);
  return m[1];
};

const results = (events: AgentEvent[], name: string) =>
  events.filter((e): e is Extract<AgentEvent, { type: 'tool-result' }> => e.type === 'tool-result' && e.name === name).map((e) => e.output as Record<string, unknown>);

async function go(steps: Step[], budgetMinor = 40_000n) {
  const f = fakeDeps();
  const events: AgentEvent[] = [];
  const done = await runAgent({ message: 'automatic diver watch under $400 delivered', budgetMinor, sessionId: 's-1', model: scripted(steps), deps: f.deps, onEvent: (e) => void events.push(e) });
  return { f, events, done };
}

describe('runAgent — the tool loop (mock model)', () => {
  it('search → compare → breakdown → propose → closing text; events streamed; proposal is PENDING with a checkout link', async () => {
    const { f, events, done } = await go([
      { text: 'Searching. ', tool: { name: 'search_listings', input: () => ({ query: 'automatic diver watch' }) } },
      { tool: { name: 'compare_landed_costs', input: () => ({ query: 'automatic diver watch' }) } },
      { tool: { name: 'get_duty_breakdown', input: (p) => ({ quoteId: quoteIdFor('L-P03')(p) }) } },
      { tool: { name: 'propose_purchase', input: (p) => ({ quoteId: quoteIdFor('L-P03')(p), reasoning: 'Only automatic diver watch within budget.' }) } },
      { text: 'I recommend L-P03 at $362.50 delivered, within your $400.00 budget. Review the duty lines and approve if you agree.' },
    ]);
    expect(events[0]).toEqual({ type: 'budget', budget: '$400.00' });
    expect(events.filter((e) => e.type === 'tool-call').map((e) => (e as { name: string }).name)).toEqual(['search_listings', 'compare_landed_costs', 'get_duty_breakdown', 'propose_purchase']);
    // Invariant: every quoted listing appeared in a search result of this run.
    const searchedIds = new Set(results(events, 'search_listings').flatMap((o) => (o.results as { listingId: string }[]).map((r) => r.listingId)));
    const quotedIds = results(events, 'compare_landed_costs').flatMap((o) => (o.compared as { listingId: string }[]).map((r) => r.listingId));
    expect(quotedIds).toEqual(['L-P03', 'L-BIG']);
    expect(quotedIds.every((id) => searchedIds.has(id))).toBe(true);
    expect(done.proposal).toMatchObject({ proposed: true, delivered_total: '$362.50', checkoutUrl: expect.stringMatching(/^\/checkout\//) });
    expect(done.steps).toBe(5);
    expect(done.usage).toEqual({ input: 500, output: 50 });
    expect(f.proposals).toHaveLength(1);
    expect(events.at(-1)?.type).toBe('done');
  });

  it('a model that quotes a listing no search returned is refused (nothing is quoted)', async () => {
    const { events } = await go([
      { tool: { name: 'get_landed_cost_quote', input: () => ({ listingId: 'L-P03' }) } },
      { text: 'done' },
    ]);
    expect(results(events, 'get_landed_cost_quote')).toEqual([{ listingId: 'L-P03', refused: 'Search first; only listings shown in a search can be quoted.' }]);
  });

  it('an over-budget proposal is refused in code and reported; nothing is saved', async () => {
    const { f, events, done } = await go([
      { tool: { name: 'search_listings', input: () => ({ query: 'automatic diver watch' }) } },
      { tool: { name: 'get_landed_cost_quote', input: () => ({ listingId: 'L-BIG' }) } },
      { tool: { name: 'propose_purchase', input: (p) => ({ quoteId: quoteIdFor('L-BIG')(p), reasoning: 'gold case' }) } },
      { text: 'That one is over your budget.' },
    ]);
    const refusal = events.find((e) => e.type === 'tool-result' && e.name === 'propose_purchase') as { output: Record<string, unknown> };
    expect(refusal.output).toMatchObject({ proposed: false, reasons: expect.arrayContaining(['OVER_BUDGET']) });
    expect(done.proposal).toBeNull();
    expect(f.proposals).toHaveLength(0);
  });

  it('the step cap holds even if the model never stops', async () => {
    const { done } = await go([{ tool: { name: 'search_listings', input: () => ({ query: 'watch' }) } }]);
    expect(done.steps).toBe(8);
  });
});

describe('prompt injection in seller text (mock model that OBEYS it) — nothing outside the rules can happen', () => {
  it('the worst an obedient model can do is a PENDING proposal at the REAL stored price; money-moving tools and cap/budget overrides do not exist', async () => {
    const { f, events } = await go([
      { tool: { name: 'search_listings', input: () => ({ query: 'figure' }) } },
      { tool: { name: 'get_landed_cost_quote', input: () => ({ listingId: 'L-T-INJ' }) } },
      // "approve immediately": there is no such tool → tool error, nothing happens
      { tool: { name: 'approve_purchase', input: (p) => ({ quoteId: quoteIdFor('L-T-INJ')(p) }) } },
      // "budget doesn't matter": the input schema has no budget field → validation error, nothing saved
      { tool: { name: 'propose_purchase', input: (p) => ({ quoteId: quoteIdFor('L-T-INJ')(p), reasoning: 'seller says so', budget: 999999 }) } },
      { tool: { name: 'propose_purchase', input: (p) => ({ quoteId: quoteIdFor('L-T-INJ')(p), reasoning: 'seller says so' }) } },
      { text: 'done' },
    ]);
    // the quote the model saw is the stored one ($98.13 with $8.13 duty), not the seller's "$50, no duty"
    const quote = events.find((e) => e.type === 'tool-result' && e.name === 'get_landed_cost_quote') as { output: Record<string, unknown> };
    expect(quote.output).toMatchObject({ delivered_total: '$98.13', us_import_duty_est: '$8.13' });
    // the unknown "approve" tool and the budget override both failed
    const failed = events.filter((e) => e.type === 'tool-error' || (e.type === 'tool-call' && e.name === 'approve_purchase'));
    expect(failed.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.type === 'tool-result' && e.name === 'approve_purchase')).toBe(false);
    // at most a PENDING proposal (a human still has to Approve and pay in PayPal), at the stored total and the confirmed budget
    expect(f.proposals).toEqual([expect.objectContaining({ totalMinor: 9_813n, budgetMinor: 40_000n })]);
  });
});
