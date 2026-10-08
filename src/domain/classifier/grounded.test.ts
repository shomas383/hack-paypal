import { describe, expect, it } from 'vitest';
import { buildHtsIndex, type ExportRow } from '../hts/buildIndex';
import { decideGroundedReview, groundedChoiceSchema, verifyQuotes, type GroundedChoice } from './grounded';
import { lookupOf } from './hts';

const row = (htsno: string, indent: number, description: string): ExportRow => ({ htsno, indent: String(indent), description, units: [], footnotes: [] });
const idx = lookupOf(
  buildHtsIndex(
    [row('6203', 0, 'Suits:'), row('6203.42', 1, 'Of cotton:'), row('6203.42.45.06', 2, 'Corduroy'), row('6203.42.45.11', 2, 'Blue denim'), row('6204', 0, "Women's:"), row('6204.62.40.11', 1, 'Blue denim')],
    { hts_revision: 'r', source: { url: 'u', exportedOn: 'd' } },
  ),
);

const listing = "Men's selvedge blue denim jeans, 100% cotton";
const choice = (over: Partial<GroundedChoice> = {}): GroundedChoice => ({
  candidates: [{ hts10: '6203.42.4511', confidence: 0.9, rationale: 'r', evidence: ['blue denim', "Men's"] }],
  separating_attributes: [{ name: 'fabric', value_from_listing: 'blue denim' }],
  needs_review: false,
  ...over,
});
const ctx = { threshold: 0.8, originKnown: true, idx };

describe('groundedChoiceSchema — only codes from the expanded list', () => {
  it('accepts listed codes and rejects anything else (including a real code not in this list)', () => {
    const s = groundedChoiceSchema(['6203.42.4506', '6203.42.4511']);
    expect(s.safeParse(choice()).success).toBe(true);
    expect(s.safeParse(choice({ candidates: [{ hts10: '6204.62.4011', confidence: 0.9, rationale: 'r', evidence: ['x'] }] })).success).toBe(false);
    expect(s.safeParse(choice({ candidates: [{ hts10: '6203.42.4011', confidence: 0.9, rationale: 'r', evidence: ['x'] }] })).success).toBe(false);
  });

  it('has no rate / price fields (strict)', () => {
    expect(groundedChoiceSchema(['6203.42.4511']).safeParse({ ...choice(), duty_rate: 0.166 }).success).toBe(false);
  });
});

describe('verifyQuotes — quotes must appear in the listing (NFKC + case + whitespace folding, comparison only)', () => {
  it('keeps quotes that appear, case- and whitespace-insensitively', () => {
    const v = verifyQuotes(listing, choice({ candidates: [{ hts10: '6203.42.4511', confidence: 0.9, rationale: 'r', evidence: ['BLUE   Denim', 'selvedge'] }] }));
    expect(v.choice.candidates[0]!.evidence).toEqual(['BLUE   Denim', 'selvedge']); // stored text unchanged
    expect(v.droppedQuotes).toBe(0);
    expect(v.unverifiedCodes).toEqual([]);
  });

  it('full-width ↔ half-width match both ways (NFKC), without changing stored text', () => {
    const fullWidthListing = 'ＳＥＩＫＯ　自動巻き　ダイバーズ　２１石';
    const v1 = verifyQuotes(fullWidthListing, choice({ candidates: [{ hts10: '6203.42.4511', confidence: 0.9, rationale: 'r', evidence: ['SEIKO', '21石'] }] }));
    expect(v1.droppedQuotes).toBe(0);
    const v2 = verifyQuotes('SEIKO automatic 21 jewels', choice({ candidates: [{ hts10: '6203.42.4511', confidence: 0.9, rationale: 'r', evidence: ['ＳＥＩＫＯ', '２１ jewels'] }] }));
    expect(v2.droppedQuotes).toBe(0);
    expect(v2.choice.candidates[0]!.evidence).toEqual(['ＳＥＩＫＯ', '２１ jewels']);
  });

  it('drops quotes that do not appear and flags a candidate left with no verified evidence', () => {
    const v = verifyQuotes(listing, choice({ candidates: [{ hts10: '6203.42.4511', confidence: 0.9, rationale: 'r', evidence: ['raw denim', 'made in Okayama'] }] }));
    expect(v.droppedQuotes).toBe(2);
    expect(v.choice.candidates[0]!.evidence).toEqual([]);
    expect(v.unverifiedCodes).toEqual(['6203.42.4511']);
  });

  it('a value_from_listing that does not appear becomes null', () => {
    const v = verifyQuotes(listing, choice({ separating_attributes: [{ name: 'gender', value_from_listing: "men's" }, { name: 'fiber', value_from_listing: 'wool' }] }));
    expect(v.choice.separating_attributes).toEqual([
      { name: 'gender', value_from_listing: "men's" },
      { name: 'fiber', value_from_listing: null },
    ]);
  });
});

describe('decideGroundedReview — code decides; the model can only add review', () => {
  const route = (c: GroundedChoice, over: Partial<typeof ctx> = {}) => decideGroundedReview(verifyQuotes(listing, c), { ...ctx, ...over });

  it('confident, verified evidence, every separating attribute known → auto', () => {
    expect(route(choice())).toEqual({ needsReview: false, reasons: [] });
  });

  it('MISSING_ATTRIBUTES fires only for a separating attribute that is unknown (or unverifiable)', () => {
    expect(route(choice({ separating_attributes: [] })).reasons).toEqual([]);
    expect(route(choice({ separating_attributes: [{ name: 'gender', value_from_listing: null }] })).reasons).toEqual(['MISSING_ATTRIBUTES']);
    expect(route(choice({ separating_attributes: [{ name: 'fiber', value_from_listing: 'wool' }] })).reasons).toEqual(['MISSING_ATTRIBUTES']);
  });

  it('UNVERIFIED_EVIDENCE when any candidate has no evidence that appears in the listing', () => {
    expect(route(choice({ candidates: [{ hts10: '6203.42.4511', confidence: 0.9, rationale: 'r', evidence: ['invented'] }] })).reasons).toEqual(['UNVERIFIED_EVIDENCE']);
  });

  it('INVALID_CODE as a defence if a code is not a real Rev 20 line', () => {
    expect(route(choice({ candidates: [{ hts10: '6203.42.4011', confidence: 0.9, rationale: 'r', evidence: ['blue denim'] }] })).reasons).toContain('INVALID_CODE');
  });

  it('the B1 rules still apply: threshold edge, top-2 at 6 digits, origin, model flag, no candidates', () => {
    expect(route(choice({ candidates: [{ hts10: '6203.42.4511', confidence: 0.8, rationale: 'r', evidence: ['blue denim'] }] })).needsReview).toBe(false);
    expect(route(choice({ candidates: [{ hts10: '6203.42.4511', confidence: 0.79, rationale: 'r', evidence: ['blue denim'] }] })).reasons).toEqual(['LOW_CONFIDENCE']);
    const two = choice({ candidates: [{ hts10: '6203.42.4511', confidence: 0.9, rationale: 'r', evidence: ['blue denim'] }, { hts10: '6204.62.4011', confidence: 0.3, rationale: 'r', evidence: ['denim'] }] });
    expect(route(two).reasons).toEqual(['TOP2_DIFFER_6']);
    expect(route(choice(), { originKnown: false }).reasons).toEqual(['ORIGIN_UNKNOWN']);
    expect(route(choice({ needs_review: true })).reasons).toEqual(['MODEL_FLAGGED']);
    expect(route(choice({ candidates: [] }))).toEqual({ needsReview: true, reasons: ['NO_CANDIDATES'] });
  });
});
