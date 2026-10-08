import { APICallError } from 'ai';
import { MockLanguageModelV4 } from 'ai/test';
import { describe, expect, it } from 'vitest';
import { classifyListing } from './classify';

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
  outputTokens: { total: 10, text: 10, reasoning: undefined },
};
const answer = (json: unknown) =>
  new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: 'text', text: typeof json === 'string' ? json : JSON.stringify(json) }],
      finishReason: { unified: 'stop', raw: 'end_turn' },
      usage,
      warnings: [],
    }),
  });

const good = {
  candidates: [{ hts10: '9102.21.7000', description: 'd', confidence: 0.9, rationale: 'r', evidence: ['21 jewels'] }],
  missing_attributes: [],
  needs_review: false,
};
const watch = { title: 'Automatic diver watch, 21 jewels', origin: 'JP' };

describe('classifyListing (model injected; the model proposes, code routes)', () => {
  it('a valid answer is parsed and routed by decideReview', async () => {
    const r = await classifyListing(watch, answer(good), { threshold: 0.8 });
    expect(r).toEqual({ kind: 'OK', output: good, review: { needsReview: false, reasons: [] } });
  });

  it('only the title / description / origin reach the model — never expected answers or amounts', async () => {
    const model = answer(good);
    await classifyListing(watch, model, { threshold: 0.8 });
    const sent = JSON.stringify(model.doGenerateCalls[0]?.prompt);
    expect(sent).toContain('Automatic diver watch, 21 jewels');
    expect(sent).toContain('Country of origin: JP');
    expect(sent).not.toMatch(/\$|ppm|duty rate is/i);
  });

  it('unknown origin forces review', async () => {
    const r = await classifyListing({ title: 'Vintage denim jeans', origin: null }, answer(good), { threshold: 0.8 });
    expect(r.review).toEqual({ needsReview: true, reasons: ['ORIGIN_UNKNOWN'] });
  });

  it('an answer carrying a rate or price field is INVALID_OUTPUT → review, never auto', async () => {
    const r = await classifyListing(watch, answer({ ...good, duty_rate: 0.15 }), { threshold: 0.8 });
    expect(r.kind).toBe('INVALID_OUTPUT');
    expect(r.review).toEqual({ needsReview: true, reasons: ['INVALID_OUTPUT'] });
  });

  it('non-JSON text is INVALID_OUTPUT → review', async () => {
    expect((await classifyListing(watch, answer('I think it is a watch.'), { threshold: 0.8 })).kind).toBe('INVALID_OUTPUT');
  });

  it('an API failure is rethrown, not hidden as a review result', async () => {
    const failing = new MockLanguageModelV4({
      doGenerate: async () => {
        throw new APICallError({ message: 'rate limited', url: 'https://api.anthropic.com/v1/messages', requestBodyValues: {}, statusCode: 429, isRetryable: false });
      },
    });
    await expect(classifyListing(watch, failing, { threshold: 0.8 })).rejects.toThrow(/rate limited/);
  });
});
