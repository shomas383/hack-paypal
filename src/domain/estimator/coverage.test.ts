import { describe, expect, it } from 'vitest';
import type { RateExportRow } from './baseRates';
import { segmentNotes } from './ch99Notes';
import type { StrippedText } from './ch99Text';
import { citesSubdivision, coverageIndex, lineVerdicts, originGaps, refVerdict, type CoverageContext } from './coverage';
import { buildHeadingTable, outOfForce } from './headings';
import { buildMentions } from './mentions';
import { originOf } from './origin';
import { REFERENCE_RULES } from './__fixtures__/sample';

// Real Rev 21 text, cut down; synthetic where marked. Codes are real lines.
const row = (htsno: string, indent: number, description: string, general: string): RateExportRow => ({ htsno, indent: String(indent), description, general }) as RateExportRow;
const headings = buildHeadingTable([
  row('9903.05.49', 0, 'Except for products described in headings 9903.05.85–9903.05.92, articles the product of Japan, with an ad valorem (or ad valorem equivalent) rate of duty under column 1 less than 12.5 percent, as provided for in U.S. note 52 to this subchapter', '12.5%'),
  row('9903.05.86', 0, 'Articles provided for in subdivision (b) of U.S. note 52 to this subchapter', 'The duty provided in the applicable subheading'),
  row('9903.82.09', 0, 'Except as provided for in headings 9903.82.16, 9903.82.20–9903.82.26 and 9903.85.68, articles of copper and derivative aluminum and steel articles … as provided for in U.S. note 16 to this subchapter', 'The duty provided in the applicable subheading + 25%'),
  row('9903.82.01', 0, 'Articles provided for in subdivision (c) of U.S. note 16 to this subchapter that do not contain any aluminum, steel, or copper', 'No change'),
  row('9903.88.15', 0, 'Except as provided in headings 9903.88.17 … articles the product of China, as provided for in U.S. note 20(r) to this subchapter', 'The duty provided in the applicable subheading + 7.5%'),
  row('9903.45.30', 0, 'synthetic: Articles of glass, when the product of any country', 'The duty provided in the applicable subheading + 10%'),
  row('9915.10.10', 0, 'synthetic: goods of a party to the Agreement', 'Free'),
]);
const doc = (lines: string[]): StrippedText => ({ revision: 'Revision 21 (2026)', pages: ['p'], lines: lines.map((text) => ({ page: 'p', text })) });
const notes = segmentNotes(doc([
  'SUBCHAPTER III', 'TEMPORARY MODIFICATIONS ESTABLISHED PURSUANT TO TRADE LEGISLATION', 'U.S. Notes',
  '16. (a) synthetic preamble naming heading 9903.82.09',
  '(c) synthetic: Heading 9903.82.09 applies to the following derivative steel articles:', '8211.92.90  8211.94.10',
  '(g) Heading 9903.82.13 applies to articles that otherwise meet the criteria of subdivisions (c)(vi)–(viii) and (xi) that are motorcycle parts classifiable in chapter 84, 85 or 87 for use in the manufacturing of motorcycles in the United States.',
  '19. (a) synthetic', '(k) The rates of duty in heading 9903.85.08 apply to all entries of derivative aluminum products classifiable in the following HTSUS provisions: 9507.30.20; 9507.30.60',
  '20. (a) synthetic', ...'bcdefghijklmnopqr'.split('').map((l) => `(${l}) synthetic`),
  '(s) (i) As provided in heading 9903.88.15, … the following subheadings: 9504.40.00',
  '30. synthetic', '40. synthetic', '50. synthetic', // notes advance by ≤ 10
  '52. (a) synthetic', '(b) As provided in heading 9903.05.86, the duties imposed by headings 9903.05.20–9903.05.84 shall not apply to articles that are classifiable in the following provisions of the HTSUS:', '0712.32.00  0712.90.8550',
  'SUBCHAPTER XV', 'MODIFICATIONS ESTABLISHED PURSUANT TO THE DOMINICAN REPUBLIC-CENTRAL AMERICA-UNITED STATES FREE TRADE AGREEMENT', 'U.S. Notes',
  '1. synthetic: goods described in subheading 6203.42.45 of a party to the Agreement',
]));
const ctx = (rules = REFERENCE_RULES.rules): CoverageContext => ({
  headings,
  outOfForce: outOfForce(headings, notes, '2026-10-11', []),
  notes,
  mentions: buildMentions(notes, Object.fromEntries(Object.entries(headings).map(([h, i]) => [h, i.chain])), { '9504.40.0000': [{ on: '9504.40.00', columns: ['general'], text: 'See 9903.45.30.', headings: ['9903.45.30'], ranges: [] }] }),
  rules,
});
const jp = originOf('JP')!;
const c = ctx();
const idx = coverageIndex(c);
const v = (code: string) => lineVerdicts(code, jp, c, idx).map((x) => `${x.ref}: ${x.verdict}`);

describe('coverage verdicts (JP)', () => {
  it('a line in a modeled list is modeled; a line named by a 232 list is unmodeled with its open heading', () => {
    expect(v('0712.90.8550')).toEqual(['note III 52(b): modeled']);
    expect(lineVerdicts('8211.92.9030', jp, c, idx)).toEqual([{ ref: 'note III 16(c)', verdict: 'unmodeled', open: ['9903.82.09'] }]);
  });
  it('a chapter named in note text is context, not a list (16(g) "chapter 84, 85 or 87")', () => {
    expect(v('8523.49.4000')).toEqual([]);
  });
  it('a subdivision whose only heading left the schedule is out of force (19(k) → 9903.85.08)', () => {
    expect(v('9507.30.6000')).toEqual(['note III 19(k): out_of_force']);
  });
  it('a list governed by another country\'s heading is not for this origin (20(s)(i) → China)', () => {
    expect(v('9504.40.0000')).toContain('note III 20(s)(i): not_for_origin');
  });
  it("a line's own footnote names a heading → that heading decides (9903.45.30, any country → unmodeled)", () => {
    expect(v('9504.40.0000')).toContain('footnote 9903.45.30: unmodeled');
  });
  it('trade-agreement subchapters are special programs (not applied, disclosed)', () => {
    expect(v('6203.42.4511')).toEqual(['note XV 1: special_program']);
  });
  it('without its rule, the 52(b) list is unmodeled', () => {
    const c2 = ctx(REFERENCE_RULES.rules.filter((r) => r.id !== 'exempt-9903-05-86'));
    expect(refVerdict('note III 52(b)', jp, c2, coverageIndex(c2))).toEqual({ ref: 'note III 52(b)', verdict: 'unmodeled', open: ['9903.05.86'] });
  });
});

describe('originGaps', () => {
  it('a heading that can apply, has no rule and names no line blocks the origin; one that adds nothing does not', () => {
    const gaps = originGaps(jp, c, idx);
    expect(gaps).not.toContain('9903.82.01'); // "No change"
    expect(gaps).not.toContain('9903.82.09'); // governs 16(c)(vii)
    expect(gaps).not.toContain('9903.45.30'); // named by a footnote
    expect(gaps).not.toContain('9915.10.10'); // special program subchapter
    expect(gaps).not.toContain('9903.88.15'); // China
    expect(gaps).toEqual([]);
    const lone = buildHeadingTable([row('9903.45.99', 0, 'synthetic: Articles of any country', 'The duty provided in the applicable subheading + 5%')]);
    const c3 = { ...c, headings: { ...headings, ...lone } };
    expect(originGaps(jp, c3, coverageIndex(c3))).toEqual(['9903.45.99']);
  });

  it('an exemption list does not place the heading it exempts from (the IEEPA 9903.01.25 hole); a cited list does place its heading', () => {
    const h = buildHeadingTable([
      row('9903.01.25', 0, 'Articles the product of any country, … as provided for in subdivision (v) of U.S. note 2 to this subchapter', 'The duty provided in the applicable subheading + 10%'),
      row('9903.04.62', 0, 'Patented pharmaceutical articles that are the product of Japan, … as provided for in subdivisions (c) and (f) of U.S. note 40 to this subchapter', '15%'),
    ]);
    const n = segmentNotes(doc([
      'SUBCHAPTER III', 'U.S. Notes', '2. (a) synthetic', ...'bcdefghijklmnopqrstu'.split('').map((l) => `(${l}) synthetic`),
      '(v) (i) synthetic', '(ii) synthetic', '(iii) The additional duties imposed by heading 9903.01.25 shall not apply to articles classifiable in the following provisions: 0101.21.00  0101.29.00',
      '10. synthetic', '20. synthetic', '30. synthetic', '40. (a) synthetic', '(b) synthetic',
      '(c) The headings provided in subdivision (a) of this note apply to articles that are classifiable in the following provisions of the HTSUS: 3002.12.00  3004.90.92',
    ]));
    const cx: CoverageContext = { headings: h, outOfForce: {}, notes: n, mentions: buildMentions(n, {}), rules: [] };
    expect(originGaps(jp, cx, coverageIndex(cx))).toEqual(['9903.01.25']);
  });
});

describe('citesSubdivision (which headings a refusal names)', () => {
  // Real Rev 21 heading texts (9903.82.09, .02, .03).
  const h09 = 'Except as provided for in headings 9903.82.16, 9903.82.20–9903.82.26 and 9903.85.68, articles of copper and derivative aluminum and steel articles, as provided for in subdivisions (c)(vi)–(viii) and (xi) of U.S. note 16 to this subchapter';
  const h02 = 'Except as provided for in headings 9903.82.14, 9903.85.67 and 9903.85.68, articles of aluminum, of steel or of copper and derivative aluminum or steel articles, as provided for in subdivisions (c)(i)–(v) of U.S. note 16 to this subchapter';
  const h03 = 'Except for articles classifiable in chapters 72, 73, 74 or 76, articles where the weight of the applicable metal is less than 15 percent of the weight of the imported article, as provided for in subdivision (c) of U.S. note 16 to this subchapter';
  it('ranges, relative items and parents; the note number and subchapter must match', () => {
    expect(citesSubdivision('9903.82.09', h09, 'note III 16(c)(vii)')).toBe(true);
    expect(citesSubdivision('9903.82.09', h09, 'note III 16(c)(xi)')).toBe(true); // "and (xi)" is relative to (c)
    expect(citesSubdivision('9903.82.09', h09, 'note III 16(c)(ix)')).toBe(false);
    expect(citesSubdivision('9903.82.02', h02, 'note III 16(c)(vii)')).toBe(false);
    expect(citesSubdivision('9903.82.02', h02, 'note III 16(c)(iv)')).toBe(true);
    expect(citesSubdivision('9903.82.03', h03, 'note III 16(c)(vii)')).toBe(true); // (c) covers its children
    const h06 = 'Except as provided for in headings 9903.82.15 and 9903.85.68, articles of copper and derivative aluminum and steel articles, as provided for in subdivisions (c)(ii), (iv), (vi)–(viii), (xi) and (e) of U.S. note 16 to this subchapter';
    expect(citesSubdivision('9903.82.06', h06, 'note III 16(e)')).toBe(true); // a lone letter is top-level
    expect(citesSubdivision('9903.82.06', h06, 'note III 16(c)(iv)')).toBe(true);
    expect(citesSubdivision('9903.82.06', h06, 'note III 16(c)(iii)')).toBe(false);
    expect(citesSubdivision('9903.82.09', h09, 'note III 17(c)(vii)')).toBe(false);
    expect(citesSubdivision('9903.82.09', h09, 'note II 16(c)(vii)')).toBe(false);
  });
});
