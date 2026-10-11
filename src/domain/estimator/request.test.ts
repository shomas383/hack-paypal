import { describe, expect, it } from 'vitest';
import { usd } from '@/domain/money/money';
import { applyAnswers, descriptionKey, EstimateAnswers, EstimateRequest, toInputRecord } from './request';
import { estimateViewOf } from './view';
import { REFERENCE_RULES, sampleData, sampleVerified } from './__fixtures__/sample';

const NOW = new Date('2026-10-11T12:00:00Z');
const req = { title: 'Automatic diver watch', origin: 'DE', sellingPriceMinor: 29000 };

describe('EstimateRequest / EstimateAnswers (strict)', () => {
  it('accepts the documented shape; refuses unknown keys, floats, over-long text and a lowercase country', () => {
    expect(EstimateRequest.safeParse({ ...req, details: 'steel case', shippingMinor: 2500, quantity: 2 }).success).toBe(true);
    for (const bad of [{ ...req, x: 1 }, { ...req, sellingPriceMinor: 290.5 }, { ...req, sellingPriceMinor: 0 }, { ...req, title: 'ab' }, { ...req, details: 'x'.repeat(2001) }, { ...req, origin: 'de' }, { ...req, sellingPriceMinor: 10_000_001 }])
      expect(EstimateRequest.safeParse(bad).success, JSON.stringify(bad).slice(0, 80)).toBe(false);
    expect(EstimateAnswers.safeParse({ facts: { civil_aircraft: true }, valueSplit: { caseMinor: 1, bandMinor: 2 }, quantity: 1 }).success).toBe(true);
    expect(EstimateAnswers.safeParse({ facts: { 'Not A Fact': true } }).success).toBe(false);
    expect(EstimateAnswers.safeParse({ price: 1 }).success).toBe(false);
  });
});

describe('descriptionKey (24 h classification cache)', () => {
  it('folds case, width and whitespace; differs by details or origin; ignores the price', () => {
    const k = descriptionKey(req);
    expect(descriptionKey({ ...req, title: '  AUTOMATIC   diver ｗａｔｃｈ ' })).toBe(k);
    expect(descriptionKey({ ...req, details: 'gold case' })).not.toBe(k);
    expect(descriptionKey({ ...req, origin: 'JP' })).not.toBe(k);
  });
});

describe('toInputRecord / applyAnswers', () => {
  it('stores the origin as a user fact, pricing in cents, economics reserved', () => {
    expect(toInputRecord(req, NOW)).toEqual({
      product: { title: 'Automatic diver watch' },
      facts: { origin: { value: 'DE', source: 'user', recordedAt: NOW.toISOString() }, attributes: {} },
      pricing: { sellingPriceMinor: 29000, currency: 'USD', quantity: 1 },
      economics: null,
    });
  });
  it('answers become user facts; a case/band split must add up to the selling price', () => {
    const input = toInputRecord(req, NOW);
    const a = applyAnswers(input, { facts: { civil_aircraft: false }, valueSplit: { caseMinor: 24000, bandMinor: 5000 } }, NOW);
    expect(a).toMatchObject({ facts: { attributes: { civil_aircraft: { value: false, source: 'user' } } }, pricing: { valueSplit: { caseMinor: 24000, bandMinor: 5000 } } });
    expect(applyAnswers(input, { valueSplit: { caseMinor: 1, bandMinor: 1 } }, NOW)).toEqual({ error: 'the case and band values must add up to the selling price' });
  });
});

describe('estimateViewOf (on the committed excerpts)', () => {
  const data = { ...sampleData(), rules: REFERENCE_RULES.rules, blocked: { rules: [], origins: {} } };
  const { verified } = sampleVerified();
  const row = (over: object) => ({ id: 'e-1', status: 'READY' as const, input: toInputRecord(req, NOW), classification: null, cachedFrom: null, error: null, ...over });

  it('ESTIMATING: no candidates yet; the not-a-ruling notice is always there', () => {
    const v = estimateViewOf(row({ status: 'ESTIMATING' }), data, verified, '2026-10-11');
    expect(v).toMatchObject({ status: 'ESTIMATING', candidates: [], notice: 'Estimate — not a customs ruling.', origin: 'DE', sellingPriceMinor: 29000 });
  });

  it('READY: the DE watch needs its case/band split, then is the verified row (10% cap); DDP total = price + shipping + duty', () => {
    const classification = { outcome: 'OK' as const, candidates: [{ code: '9102.21.70', chain: ['Wrist watches…'], confidence: 0.9 }], separating: [], reasons: [] };
    const before = estimateViewOf(row({ classification }), data, verified, '2026-10-11');
    expect(before.candidates[0]!.outcome).toMatchObject({ kind: 'CANT_ESTIMATE', reason: 'NEEDS_SPLIT' });
    const answered = applyAnswers(toInputRecord({ ...req, shippingMinor: 2500 }, NOW), { valueSplit: { caseMinor: 24000, bandMinor: 5000 } }, NOW);
    if ('error' in answered) throw new Error(answered.error);
    const after = estimateViewOf(row({ classification, input: answered }), data, verified, '2026-10-11');
    expect(after.candidates[0]!.outcome).toMatchObject({ kind: 'ESTIMATE', source: 'verified', dutyMinor: 2900, ddpTotalMinor: 29000 + 2500 + 2900 });
    expect(Number(usd(2900).amountMinor)).toBe(2900);
    // Each Chapter 99 line carries its heading's official text (from the export), for the page's official-text section.
    const o = after.candidates[0]!.outcome;
    if (o.kind !== 'ESTIMATE') throw new Error('expected an estimate');
    const ch99 = o.lines.find((l) => l.chapter99 === '9903.05.39');
    expect(ch99?.officialText).toBe(data.headings['9903.05.39']!.chain);
    expect(ch99?.officialText).toMatch(/European Union/);
    expect(o.lines.find((l) => !l.chapter99)?.officialText).toBeUndefined();
  });

  it('READY with a stopped classification: no candidates, the reason is shown', () => {
    const v = estimateViewOf(row({ classification: { outcome: 'STOPPED', candidates: [], separating: [], reasons: ['NO_CANDIDATES'] } }), data, verified, '2026-10-11');
    expect(v).toMatchObject({ candidates: [], reasons: ['STOPPED', 'NO_CANDIDATES'] });
  });
});
