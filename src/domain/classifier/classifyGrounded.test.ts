import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { buildHtsIndex, type ExportRow } from '../hts/buildIndex';
import { classifyListingGrounded, MAX_EXPANDED_LINES } from './classifyGrounded';
import { lookupOf } from './hts';

const row = (htsno: string, indent: number, description: string): ExportRow => ({ htsno, indent: String(indent), description, units: [], footnotes: [] });
const meta = { hts_revision: '2026 Rev. 20', source: { url: 'u', exportedOn: 'd' } };
const idx = lookupOf(
  buildHtsIndex(
    [
      row('6203', 0, "Men's or boys' suits, trousers:"),
      row('6203.42', 1, 'Of cotton:'),
      row('6203.42.45.06', 2, 'Corduroy (347)'),
      row('6203.42.45.11', 2, 'Blue denim (347)'),
      // a heading with more lines than the cap
      row('6110', 0, 'Sweaters:'),
      row('6110.20', 1, 'Of cotton:'),
      ...Array.from({ length: MAX_EXPANDED_LINES + 1 }, (_, i) => row(`6110.20.${String(10 + Math.floor(i / 90)).padStart(2, '0')}.${String(10 + (i % 90)).padStart(2, '0')}`, 2, `Line ${i}`)),
    ],
    meta,
  ),
);

const usage = { inputTokens: { total: 100, noCache: 100, cacheRead: undefined, cacheWrite: undefined }, outputTokens: { total: 20, text: 20, reasoning: undefined } };
const reply = (json: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(json) }], finishReason: { unified: 'stop' as const, raw: 'end_turn' }, usage, warnings: [] });
const model = (...replies: unknown[]) => new MockLanguageModelV4({ doGenerate: replies.map(reply) });

const listing = { title: "Men's selvedge blue denim jeans, 100% cotton", origin: 'JP' };
const headings = (...h: string[]) => ({ headings: h.map((heading) => ({ heading, reason: 'r', evidence: ['denim'] })), needs_review: false });
const pick = (hts10: string, evidence = ['blue denim']) => ({
  candidates: [{ hts10, confidence: 0.9, rationale: 'r', evidence }],
  separating_attributes: [{ name: 'fabric', value_from_listing: 'blue denim' }],
  needs_review: false,
});
const opts = { threshold: 0.8, idx };

describe('classifyListingGrounded — headings → real Rev 20 lines → a choice from that list only', () => {
  it('happy path: expands the heading, offers the real lines with chains, routes the verified choice', async () => {
    const m = model(headings('6203.42'), pick('6203.42.4511'));
    const r = await classifyListingGrounded(listing, m, opts);
    expect(r.kind).toBe('OK');
    expect(r.review).toEqual({ needsReview: false, reasons: [] });
    expect(r.meta).toMatchObject({ headings: ['6203.42'], invalidHeadings: [], expanded: 2, calls: 2, usage: { input: 200, output: 40 } });
    const call2 = JSON.stringify(m.doGenerateCalls[1]?.prompt);
    expect(call2).toContain('6203.42.4511');
    expect(call2).toContain('Blue denim (347)');
    expect(call2).toContain("Men's or boys' suits, trousers:");
  });

  it('call 2 naming a code outside the expanded list is INVALID_OUTPUT → review (the enum rejects it)', async () => {
    const r = await classifyListingGrounded(listing, model(headings('6203.42'), pick('6203.42.4011')), opts);
    expect(r).toMatchObject({ kind: 'INVALID_OUTPUT', stage: 2, review: { needsReview: true, reasons: ['INVALID_OUTPUT'] } });
  });

  it('headings not in Rev 20 are counted; if nothing expands → NO_CANDIDATES without a second call', async () => {
    const m = model(headings('6203.43', '6204.99'));
    const r = await classifyListingGrounded(listing, m, opts);
    expect(r).toMatchObject({ kind: 'STOPPED', review: { needsReview: true, reasons: ['NO_CANDIDATES'] } });
    expect(r.meta.invalidHeadings).toEqual(['6203.43', '6204.99']);
    expect(m.doGenerateCalls).toHaveLength(1);
  });

  it('a mix of valid and invalid headings proceeds with the valid ones and reports the invalid', async () => {
    const r = await classifyListingGrounded(listing, model(headings('6203.42', '6203.43'), pick('6203.42.4511')), opts);
    expect(r.kind).toBe('OK');
    expect(r.meta.invalidHeadings).toEqual(['6203.43']);
  });

  it(`more than ${MAX_EXPANDED_LINES} expanded lines in total → TOO_BROAD without a second call`, async () => {
    const m = model(headings('6110.20'));
    const r = await classifyListingGrounded(listing, m, opts);
    expect(r).toMatchObject({ kind: 'STOPPED', review: { needsReview: true, reasons: ['TOO_BROAD'] } });
    expect(r.meta.expanded).toBe(MAX_EXPANDED_LINES + 1);
    expect(m.doGenerateCalls).toHaveLength(1);
  });

  it('call 1 giving a 10-digit code instead of a heading is INVALID_OUTPUT (stage 1)', async () => {
    const r = await classifyListingGrounded(listing, model({ headings: [{ heading: '6203.42.4511', reason: 'r', evidence: ['x'] }], needs_review: false }), opts);
    expect(r).toMatchObject({ kind: 'INVALID_OUTPUT', stage: 1 });
  });

  it('evidence that is not in the listing → UNVERIFIED_EVIDENCE → review', async () => {
    const r = await classifyListingGrounded(listing, model(headings('6203.42'), pick('6203.42.4511', ['raw denim from Okayama'])), opts);
    expect(r.review.reasons).toContain('UNVERIFIED_EVIDENCE');
    expect(r.meta.droppedQuotes).toBe(1);
  });

  it('API failures are rethrown, not hidden as review', async () => {
    const failing = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({ message: 'overloaded', url: 'https://api.anthropic.com/v1/messages', requestBodyValues: {}, statusCode: 529, isRetryable: false });
      },
    });
    await expect(classifyListingGrounded(listing, failing, opts)).rejects.toThrow(/overloaded/);
  });
});
