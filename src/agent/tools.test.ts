import { describe, expect, it } from 'vitest';
import { FAKE_LISTINGS, fakeDeps, INJECTION } from './fakeDeps';
import { AGENT_TOOL_NAMES, buildAgentTools, NOT_SEARCHED, QUERY_NOT_SEARCHED, WITHHELD, type AgentListing } from './tools';

const ctx = { sessionId: 's-1', budgetMinor: 40_000n };
// Call a tool's execute directly (as the model's tool call would).
const run = async <T>(t: { execute?: (input: never, opts: never) => unknown }, input: unknown): Promise<T> =>
  (await t.execute!(input as never, { toolCallId: 't', messages: [] } as never)) as T;

type Search = { results: { listingId: string; match_score: number; untrusted_seller_text: { description: string | null }; seller_text_contains_instructions: boolean }[]; catalog_size: number; withheld_instructions: number };
type Compare = { query: string; compared: { listingId: string; delivered_total?: string; within_budget?: boolean; unsupported?: string }[] };

/** Tools for one run, with a search already done (quotes are only allowed for listings a search returned). */
async function searched(query = 'automatic diver watch', deps = fakeDeps().deps) {
  const tools = buildAgentTools(ctx, deps);
  const s = await run<Search>(tools.search_listings, { query });
  return { tools, s };
}

const watch = (id: string, title: string): AgentListing => ({ id, title, origin: 'JP', priceMinor: 30_000n, shippingMinor: 2_500n, description: null });

describe('agent tools — read and prepare only; amounts from stored quotes; seller text untrusted', () => {
  it('exposes exactly the read/prepare tools', () => {
    expect(Object.keys(buildAgentTools(ctx, fakeDeps().deps)).sort()).toEqual([...AGENT_TOOL_NAMES].sort());
    expect(AGENT_TOOL_NAMES).toContain('compare_landed_costs');
  });

  it('search returns ONLY matching listings (no score-0 rows): what the model sees is what the page renders', async () => {
    const { s } = await searched();
    expect(s.results.map((r) => r.listingId)).toEqual(['L-BIG', 'L-P03']); // score 3 each, then id
    expect(s.results.every((r) => r.match_score > 0)).toBe(true);
    expect(s.catalog_size).toBe(FAKE_LISTINGS.length);
  });

  it('a Japanese-titled listing does not match an English query (so it is neither shown nor quotable)', async () => {
    const extra = [...FAKE_LISTINGS, watch('L-C-JA', '自動巻き ダイバーズウォッチ ステンレスケース')];
    const { tools, s } = await searched('automatic diver watch', fakeDeps({ listListings: async () => extra }).deps);
    expect(s.results.map((r) => r.listingId)).not.toContain('L-C-JA');
    expect(await run(tools.get_landed_cost_quote, { listingId: 'L-C-JA' })).toEqual({ listingId: 'L-C-JA', refused: NOT_SEARCHED });
  });

  it('withheld_instructions is counted in code over the WHOLE catalog, even when the flagged listing does not match', async () => {
    const { s } = await searched();
    expect(s.results.map((r) => r.listingId)).not.toContain('L-T-INJ');
    expect(s.withheld_instructions).toBe(1);
  });

  it('a matching flagged listing has its text withheld; the flag stays so the search card can say "ignored"', async () => {
    const { s } = await searched('figure');
    const inj = s.results.find((x) => x.listingId === 'L-T-INJ')!;
    expect(inj.untrusted_seller_text.description).toBe(WITHHELD);
    expect(inj.seller_text_contains_instructions).toBe(true);
    expect(JSON.stringify(s)).not.toContain(INJECTION);
    expect(JSON.stringify(s)).not.toContain('$50');
  });

  it('get_landed_cost_quote refuses a listing no search in this run returned', async () => {
    const tools = buildAgentTools(ctx, fakeDeps().deps);
    expect(await run(tools.get_landed_cost_quote, { listingId: 'L-P03' })).toEqual({ listingId: 'L-P03', refused: NOT_SEARCHED });
    expect(NOT_SEARCHED).toBe('Search first; only listings shown in a search can be quoted.');
  });

  it('a quote reports stored amounts and within_budget computed in code (watch $362.50 under $400)', async () => {
    const { tools } = await searched();
    const r = await run<Record<string, unknown>>(tools.get_landed_cost_quote, { listingId: 'L-P03' });
    expect(r).toMatchObject({ goods: '$300.00', shipping: '$25.00', us_import_duty_est: '$37.50', delivered_total: '$362.50', budget: '$400.00', within_budget: true });
  });

  it('compare_landed_costs quotes every listing the search returned for that query, sorted by delivered total', async () => {
    const { tools } = await searched();
    const c = await run<Compare>(tools.compare_landed_costs, { query: 'automatic diver watch' });
    expect(c.compared.map((x) => [x.listingId, x.delivered_total, x.within_budget])).toEqual([
      ['L-P03', '$362.50', true],
      ['L-BIG', '$441.25', false],
    ]);
  });

  it('compare_landed_costs refuses a query that was not searched in this run', async () => {
    const tools = buildAgentTools(ctx, fakeDeps().deps);
    expect(await run(tools.compare_landed_costs, { query: 'automatic diver watch' })).toEqual({ query: 'automatic diver watch', error: QUERY_NOT_SEARCHED });
  });

  it('compares at most 6 listings, chosen in score-then-id order', async () => {
    const many = [...FAKE_LISTINGS, ...['A', 'B', 'C', 'D', 'E', 'F'].map((x) => watch(`L-W-${x}`, `Automatic diver watch ${x}`))];
    const { tools } = await searched('automatic diver watch', fakeDeps({ listListings: async () => many }).deps);
    const c = await run<Compare>(tools.compare_landed_costs, { query: 'automatic diver watch' });
    expect(c.compared).toHaveLength(6);
    // all eight match with score 3 → the first six by id: L-BIG, L-P03, L-W-A, L-W-B, L-W-C, L-W-D
    expect(c.compared.map((x) => x.listingId).sort()).toEqual(['L-BIG', 'L-P03', 'L-W-A', 'L-W-B', 'L-W-C', 'L-W-D']);
  });

  it('the comparison is the same with extra seller listings that do not match (Japanese title, other products)', async () => {
    const base = await searched();
    const extra = [...FAKE_LISTINGS, watch('L-C-JA', '自動巻き ダイバーズウォッチ'), { ...watch('L-C-KNIFE', 'Chef knife, stainless steel'), origin: 'JP' }];
    const more = await searched('automatic diver watch', fakeDeps({ listListings: async () => extra }).deps);
    const ids = async (t: typeof base.tools) => (await run<Compare>(t.compare_landed_costs, { query: 'automatic diver watch' })).compared.map((x) => x.listingId);
    expect(await ids(more.tools)).toEqual(await ids(base.tools));
  });

  it('duty lines carry the official HTS / Chapter 99 text, quoted verbatim from the lookup (no wording of our own)', async () => {
    const { tools } = await searched();
    const r = await run<{ duty_lines: { kind: string; chapter99: string | null; official_text: string | null }[] }>(tools.get_landed_cost_quote, { listingId: 'L-P03' });
    expect(r.duty_lines[0]).toMatchObject({ kind: 'MFN', official_text: expect.stringContaining('Having over 17 jewels') });
    expect(r.duty_lines[1]).toMatchObject({ chapter99: '9903.05.49', official_text: expect.stringMatching(/the product of Japan.*U\.S\. note 52/) });
  });

  it('Chapter 99 lines carry no internal program label (heading, official text, basis and sources only)', async () => {
    const { tools } = await searched();
    const r = await run<{ duty_lines: Record<string, unknown>[] }>(tools.get_landed_cost_quote, { listingId: 'L-P03' });
    expect(r.duty_lines[1]).not.toHaveProperty('kind');
    expect(Object.keys(r.duty_lines[1]!).sort()).toEqual(['amount', 'basis', 'chapter99', 'official_text', 'source']);
    expect(JSON.stringify(r)).not.toMatch(/S301|FORCED/i);
    expect(r.duty_lines[0]).toMatchObject({ kind: 'MFN' });
  });

  it("the injection listing quotes its REAL stored amounts, not the seller's claims ($50 delivered, no duty)", async () => {
    const { tools } = await searched('figure');
    const r = await run<Record<string, unknown>>(tools.get_landed_cost_quote, { listingId: 'L-T-INJ' });
    expect(r).toMatchObject({ us_import_duty_est: '$8.13', delivered_total: '$98.13' });
    expect(JSON.stringify(r)).not.toContain('$50');
  });

  it('propose_purchase: the watch within budget → PENDING proposal + checkout link (not an approval)', async () => {
    const f = fakeDeps();
    const { tools } = await searched('automatic diver watch', f.deps);
    const q = await run<{ quoteId: string }>(tools.get_landed_cost_quote, { listingId: 'L-P03' });
    const p = await run<Record<string, unknown>>(tools.propose_purchase, { quoteId: q.quoteId, reasoning: 'best match within budget' });
    expect(p).toMatchObject({ proposed: true, checkoutUrl: `/checkout/${q.quoteId}`, delivered_total: '$362.50' });
    expect(String(p.status)).toMatch(/PENDING.*click Approve/);
    expect(f.proposals).toHaveLength(1);
  });

  it('propose_purchase: over the confirmed budget is refused with a reason, and nothing is saved', async () => {
    const f = fakeDeps();
    const { tools } = await searched('automatic diver watch', f.deps);
    const q = await run<{ quoteId: string; delivered_total: string }>(tools.get_landed_cost_quote, { listingId: 'L-BIG' });
    expect(q.delivered_total).toBe('$441.25');
    const p = await run<Record<string, unknown>>(tools.propose_purchase, { quoteId: q.quoteId, reasoning: 'x' });
    expect(p).toMatchObject({ proposed: false, reasons: expect.arrayContaining(['OVER_BUDGET']) });
    expect(String(p.message)).toMatch(/\$441\.25 delivered is over the \$400\.00 budget/);
    expect(f.proposals).toHaveLength(0);
  });

  it('propose_purchase / get_duty_breakdown refuse a quote from another session', async () => {
    const f = fakeDeps();
    const other = buildAgentTools({ ...ctx, sessionId: 's-2' }, f.deps);
    await run(other.search_listings, { query: 'automatic diver watch' });
    const q = await run<{ quoteId: string }>(other.get_landed_cost_quote, { listingId: 'L-P03' });
    const mine = buildAgentTools(ctx, f.deps);
    expect(await run(mine.propose_purchase, { quoteId: q.quoteId, reasoning: 'x' })).toMatchObject({ proposed: false, reasons: ['NOT_YOUR_QUOTE'] });
    expect(await run(mine.get_duty_breakdown, { quoteId: q.quoteId })).toEqual({ error: 'no such quote in this session' });
  });

  it("get_order_status reads only this session's PayPal orders", async () => {
    const tools = buildAgentTools(ctx, fakeDeps().deps);
    expect(await run(tools.get_order_status, { paypalOrderId: '5O190127TN364715T' })).toEqual({ order: { id: '5O190127TN364715T', status: 'COMPLETED' } });
    expect(await run(tools.get_order_status, { paypalOrderId: '9XX99999XX9999999' })).toEqual({ error: 'not an order of this session' });
  });

  it('tool inputs are strict: no budget, cap, amount or listing list can be passed in', () => {
    const tools = buildAgentTools(ctx, fakeDeps().deps);
    const schema = (t: unknown) => (t as { inputSchema: { safeParse: (x: unknown) => { success: boolean } } }).inputSchema;
    expect(schema(tools.propose_purchase).safeParse({ quoteId: '0b4c6a52-6f0e-4d3e-9a51-6a3a8b2f0c11', reasoning: 'x', budget: 1e9 }).success).toBe(false);
    expect(schema(tools.get_landed_cost_quote).safeParse({ listingId: 'L-P03', price: 1 }).success).toBe(false);
    expect(schema(tools.compare_landed_costs).safeParse({ query: 'watch', listingIds: ['L-C-JA'] }).success).toBe(false);
  });
});
