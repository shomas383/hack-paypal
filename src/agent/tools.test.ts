import { describe, expect, it } from 'vitest';
import { fakeDeps, INJECTION } from './fakeDeps';
import { AGENT_TOOL_NAMES, buildAgentTools, WITHHELD } from './tools';

const ctx = { sessionId: 's-1', budgetMinor: 40_000n };
// Call a tool's execute directly (as the model's tool call would).
const run = async <T>(t: { execute?: (input: never, opts: never) => unknown }, input: unknown): Promise<T> =>
  (await t.execute!(input as never, { toolCallId: 't', messages: [] } as never)) as T;

describe('agent tools — read and prepare only; amounts from stored quotes; seller text untrusted', () => {
  it('exposes exactly the five read/prepare tools', () => {
    expect(Object.keys(buildAgentTools(ctx, fakeDeps().deps)).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
  });

  it('search returns the catalog ranked; seller text only under untrusted_seller_text; the injection is flagged by code', async () => {
    const { deps } = fakeDeps();
    const r = await run<{ results: { listingId: string; match_score: number; untrusted_seller_text: { description: string | null }; seller_text_contains_instructions: boolean }[] }>(
      buildAgentTools(ctx, deps).search_listings,
      { query: 'vintage automatic diver watch' },
    );
    expect(r.results[0]!.listingId).toMatch(/L-P03|L-BIG/);
    const inj = r.results.find((x) => x.listingId === 'L-T-INJ')!;
    // flagged text is WITHHELD from the model by code; the flag stays so the search card can say "ignored"
    expect(inj.untrusted_seller_text.description).toBe(WITHHELD);
    expect(inj.seller_text_contains_instructions).toBe(true);
    expect(JSON.stringify(r)).not.toContain(INJECTION);
    expect(JSON.stringify(r)).not.toContain('$50');
    expect(r.results.find((x) => x.listingId === 'L-P03')!.seller_text_contains_instructions).toBe(false);
  });

  it('a quote reports stored amounts and within_budget computed in code (watch $362.50 under $400)', async () => {
    const r = await run<Record<string, unknown>>(buildAgentTools(ctx, fakeDeps().deps).get_landed_cost_quote, { listingId: 'L-P03' });
    expect(r).toMatchObject({ goods: '$300.00', shipping: '$25.00', us_import_duty_est: '$37.50', delivered_total: '$362.50', budget: '$400.00', within_budget: true });
  });

  it('the injection listing quotes its REAL stored amounts, not the seller\'s claims ($50 delivered, no duty)', async () => {
    const r = await run<Record<string, unknown>>(buildAgentTools(ctx, fakeDeps().deps).get_landed_cost_quote, { listingId: 'L-T-INJ' });
    expect(r).toMatchObject({ us_import_duty_est: '$8.13', delivered_total: '$98.13' });
    expect(JSON.stringify(r)).not.toContain('$50');
  });

  it('propose_purchase: the watch within budget → PENDING proposal + checkout link (not an approval)', async () => {
    const f = fakeDeps();
    const tools = buildAgentTools(ctx, f.deps);
    const q = await run<{ quoteId: string }>(tools.get_landed_cost_quote, { listingId: 'L-P03' });
    const p = await run<Record<string, unknown>>(tools.propose_purchase, { quoteId: q.quoteId, reasoning: 'best match within budget' });
    expect(p).toMatchObject({ proposed: true, checkoutUrl: `/checkout/${q.quoteId}`, delivered_total: '$362.50' });
    expect(String(p.status)).toMatch(/PENDING.*click Approve/);
    expect(f.proposals).toHaveLength(1);
  });

  it('propose_purchase: over the confirmed budget is refused with a reason, and nothing is saved', async () => {
    const f = fakeDeps();
    const tools = buildAgentTools(ctx, f.deps);
    const q = await run<{ quoteId: string; delivered_total: string }>(tools.get_landed_cost_quote, { listingId: 'L-BIG' });
    expect(q.delivered_total).toBe('$441.25');
    const p = await run<Record<string, unknown>>(tools.propose_purchase, { quoteId: q.quoteId, reasoning: 'x' });
    expect(p).toMatchObject({ proposed: false, reasons: expect.arrayContaining(['OVER_BUDGET']) });
    expect(String(p.message)).toMatch(/\$441\.25 delivered is over the \$400\.00 budget/);
    expect(f.proposals).toHaveLength(0);
  });

  it('propose_purchase / get_duty_breakdown refuse a quote from another session', async () => {
    const f = fakeDeps();
    const q = await run<{ quoteId: string }>(buildAgentTools({ ...ctx, sessionId: 's-2' }, f.deps).get_landed_cost_quote, { listingId: 'L-P03' });
    const mine = buildAgentTools(ctx, f.deps);
    expect(await run(mine.propose_purchase, { quoteId: q.quoteId, reasoning: 'x' })).toMatchObject({ proposed: false, reasons: ['NOT_YOUR_QUOTE'] });
    expect(await run(mine.get_duty_breakdown, { quoteId: q.quoteId })).toEqual({ error: 'no such quote in this session' });
  });

  it('get_order_status reads only this session\'s PayPal orders', async () => {
    const tools = buildAgentTools(ctx, fakeDeps().deps);
    expect(await run(tools.get_order_status, { paypalOrderId: '5O190127TN364715T' })).toEqual({ order: { id: '5O190127TN364715T', status: 'COMPLETED' } });
    expect(await run(tools.get_order_status, { paypalOrderId: '9XX99999XX9999999' })).toEqual({ error: 'not an order of this session' });
  });

  it('tool inputs are strict: no budget, cap or amount can be passed in', () => {
    const tools = buildAgentTools(ctx, fakeDeps().deps);
    const schema = (t: unknown) => (t as { inputSchema: { safeParse: (x: unknown) => { success: boolean } } }).inputSchema;
    expect(schema(tools.propose_purchase).safeParse({ quoteId: '0b4c6a52-6f0e-4d3e-9a51-6a3a8b2f0c11', reasoning: 'x', budget: 1e9 }).success).toBe(false);
    expect(schema(tools.get_landed_cost_quote).safeParse({ listingId: 'L-P03', price: 1 }).success).toBe(false);
  });
});
