import { describe, expect, it } from 'vitest';
import { ieepaOverride } from '@/server/estimatorReview';
import type { RateExportRow } from './baseRates';
import { segmentNotes } from './ch99Notes';
import type { StrippedText } from './ch99Text';
import { buildHeadingTable, headingsInRange, headingTextSha, outOfForce, overrideQuoteHolds, overrideTies, validUntil, type VerifiedOverride } from './headings';
import { headingAppliesTo, originOf } from './origin';

const QUOTE = 'IEEPA tariffs (9903.01.xx / 9903.02.xx) are still printed in Chapter 99 but terminated (CBP stopped collecting for entries on/after Feb 24, 2026) — never add them.';

// Real Rev 21 text (export rows and note text), cut down; marked where synthetic.
const row = (htsno: string, indent: number, description: string, general = ''): RateExportRow => ({ htsno, indent: String(indent), description, general }) as RateExportRow;
const rows: RateExportRow[] = [
  row('', 0, 'Articles the product of Japan:'),
  row('9903.41.05', 1, 'Bovine (including buffalo) and equine leather (provided for in heading 4104 or 4107)', '40%'),
  row('9903.01.25', 0, 'Articles the product of any country, except for products described in headings 9903.01.26–9903.01.33', 'The duty provided in the applicable subheading + 10%'),
  row('9903.01.86', 0, "Articles the product of India, classified in the subheadings enumerated in subdivision (v)(iii) of U.S. note 2 to this subchapter [Compiler's note: provision terminated. See 90 Fed. Reg. 37963.]", 'The duty provided in the applicable subheading'),
  row('9903.03.01', 0, 'Except for products described in headings 9903.03.02–9903.03.11, articles the product of any country, as provided for in subdivision (aa) of U.S. note 2 to this subchapter', 'The duty provided in the applicable subheading + 10%'),
  row('9903.03.11', 0, 'synthetic: the last heading of the range', 'The duty provided in the applicable subheading'),
  row('9903.05.49', 0, 'Except for products described in headings 9903.05.85–9903.05.92, articles the product of Japan, with an ad valorem (or ad valorem equivalent) rate of duty under column 1 less than 12.5 percent, as provided for in U.S. note 52 to this subchapter', '12.5%'),
  row('9903.05.85', 0, 'Articles that (1) were loaded onto a vessel at the port of loading and in transit on the final mode of transit prior to entry into the United States before 12:01 a.m. eastern time on July 24, 2026; and (2) are entered for consumption, or withdrawn from warehouse for consumption, before 12:01 a.m. eastern time on July 28, 2026', 'The duty provided in the applicable subheading'),
  row('9903.05.97', 0, 'Articles the product of a member state of the European Union, as provided for in subdivision (j)(2) of U.S. note 52 to this subchapter', 'The duty provided in the applicable subheading'),
  row('9903.88.15', 0, 'Except as provided in headings 9903.88.17 … articles the product of China, as provided for in U.S. note 20(r) to this subchapter', 'The duty provided in the applicable subheading + 7.5%'),
];
const table = buildHeadingTable(rows);
const doc = (lines: string[]): StrippedText => ({ revision: 'Revision 21 (2026)', pages: ['p'], lines: lines.map((text) => ({ page: 'p', text })) });
const notes = segmentNotes(doc([
  'SUBCHAPTER III', 'U.S. Notes', '2. (a) x', ...'bcdefghijklmnopqrstuvwxyz'.split('').map((c) => `(${c}) synthetic`),
  "(aa) [Compiler’s note: Subdivisions (aa)(i) through (aa)(viii) of U.S. note 2 to this subchapter and headings",
  '         9903.03.01–9903.03.11 expired at the close of July 23, 2026. See 91 Fed. Reg. 9339.]',
]));

describe('buildHeadingTable', () => {
  it('keeps the unnumbered parent rows in the chain', () => {
    expect(table['9903.41.05']).toEqual({
      text: 'Bovine (including buffalo) and equine leather (provided for in heading 4104 or 4107)',
      chain: 'Articles the product of Japan: Bovine (including buffalo) and equine leather (provided for in heading 4104 or 4107)',
      general: '40%',
    });
    expect(headingsInRange(table, '9903.03.01', '9903.03.11')).toEqual(['9903.03.01', '9903.03.11']);
  });
});

describe('outOfForce', () => {
  const o = outOfForce(table, notes, '2026-10-11');
  it("the heading's own compiler's note", () => expect(o['9903.01.86']).toMatchObject({ why: 'compiler_note', ref: 'heading 9903.01.86' }));
  it("a compiler's note in a U.S. note naming a heading range (note 2(aa))", () => {
    expect(o['9903.03.01']).toMatchObject({ why: 'note_compiler_note', ref: 'note III 2(aa)' });
    expect(o['9903.03.11']?.quote).toMatch(/expired at the close of July 23, 2026/);
  });
  it('an entry window that closed before the as-of date (9903.05.85), and not before it', () => {
    expect(o['9903.05.85']).toMatchObject({ why: 'entry_window_closed' });
    expect(outOfForce(table, notes, '2026-07-27')['9903.05.85']).toBeUndefined();
  });
  it('a reviewed list terminates a listed heading only while present with its reviewed text; changed, missing and unlisted stay in force', () => {
    expect(o['9903.01.25']).toBeUndefined(); // no list passed
    const t2 = buildHeadingTable([
      ...rows,
      row('9903.02.98', 0, 'synthetic: articles the product of any country', 'The duty provided in the applicable subheading + 10%'),
    ]);
    const override = (headings: VerifiedOverride['headings']): VerifiedOverride => ({
      prefixes: ['9903.01.', '9903.02.'], file: 'docs/SPEC.md', quote: QUOTE, listFile: 'data/reviews/test.json', reviewedOn: '2026-10-11', headings,
    });
    const listed = (h: string, sha = headingTextSha(t2[h]!)) => ({ heading: h, group: '2 reciprocal baseline and its exceptions', order: 'EO 14257 (as amended)', text_sha256: sha });
    const ov = override([listed('9903.01.25'), listed('9903.02.98', '0'.repeat(64)), listed('9903.02.97', 'f'.repeat(64))]);
    const o2 = outOfForce(t2, notes, '2026-10-11', [ov]);
    expect(o2['9903.01.25']).toMatchObject({ why: 'verified_override', ref: 'data/reviews/test.json (EO 14257 (as amended); reviewed 2026-10-11)' });
    expect(o2['9903.02.98']).toBeUndefined(); // listed, but its text changed since review
    const ties = overrideTies(t2, ov, (h) => !!o2[h] && o2[h]!.why !== 'verified_override');
    expect(ties).toEqual({ tied: { '9903.01.25': { order: 'EO 14257 (as amended)', group: '2 reciprocal baseline and its exceptions' } }, changed: ['9903.02.98'], missing: ['9903.02.97'], unlisted: [] });
    // 9903.01.86 is out of force by its own compiler's note, so it is neither listed nor "unlisted"
    expect(overrideTies(t2, override([]), (h) => !!o2[h] && o2[h]!.why !== 'verified_override').unlisted).toEqual(['9903.01.25', '9903.02.98']);
    // the sha covers the General column too
    expect(headingTextSha({ ...t2['9903.01.25']!, general: 'Free' })).not.toBe(headingTextSha(t2['9903.01.25']!));
    expect(o['9903.05.49']).toBeUndefined();
    expect(o['9903.41.05']).toBeUndefined();
    expect(o['9903.88.15']).toBeUndefined();
  });
  it('the committed IEEPA list parses and holds 120 headings from the approved groups', () => {
    const ov = ieepaOverride();
    expect(ov.headings).toHaveLength(120);
    expect(ov.headings.map((h) => h.heading)).not.toEqual(expect.arrayContaining(['9903.02.76']));
    expect(ov.headings.map((h) => h.heading)).not.toEqual(expect.arrayContaining(['9903.02.81']));
    expect(new Set(ov.headings.map((h) => h.order))).toEqual(new Set(['EO 14194 (as amended)', 'EO 14193 (as amended)', 'EO 14195 (as amended)', 'EO 14257 (as amended)', 'EO 14257 (as amended), via EO 14326 (90 FR 37963)', 'EO 14323 (as amended)']));
  });
  it('the override quote is checked against the docs text (Markdown emphasis and line breaks ignored)', () => {
    const q = QUOTE;
    expect(overrideQuoteHolds('- **IEEPA** tariffs (9903.01.xx / 9903.02.xx) are still printed in Chapter 99 but **terminated** (CBP stopped collecting for\n  entries on/after Feb 24, 2026) — never add them.', q)).toBe(true);
    expect(overrideQuoteHolds('IEEPA tariffs (9903.01.xx / 9903.02.xx) are in force', q)).toBe(false);
  });
});

describe('headingAppliesTo', () => {
  const jp = originOf('JP')!;
  const de = originOf('DE')!;
  it('names the origin (also through a parent row), any country, or no country → can apply', () => {
    expect(headingAppliesTo(table['9903.41.05']!, jp)).toBe(true);
    expect(headingAppliesTo(table['9903.01.25']!, de)).toBe(true);
    expect(headingAppliesTo({ text: 'x', chain: 'Articles of iron or steel', general: '' }, jp)).toBe(true);
    expect(headingAppliesTo(table['9903.05.97']!, de)).toBe(true);
  });
  it('names other countries only → not for this origin', () => {
    expect(headingAppliesTo(table['9903.41.05']!, de)).toBe(false);
    expect(headingAppliesTo(table['9903.05.97']!, jp)).toBe(false);
    expect(headingAppliesTo(table['9903.88.15']!, jp)).toBe(false);
  });
  it('EU is DE only until the member list is verified', () => {
    expect(originOf('FR')).toBeNull();
    expect(originOf('KR')).toBeNull();
  });
  it('CN: China, but not "Hong Kong, China" (9903.05.43 is Hong Kong\'s heading)', () => {
    const cn = originOf('CN')!;
    expect(cn).toMatchObject({ iso: 'CN', group: 'CN' });
    const t = buildHeadingTable([
      row('9903.05.31', 0, 'Except for products described in headings 9903.05.85–9903.05.92, articles the product of China, as provided for in U.S. note 52 to this subchapter', 'The duty provided in the applicable subheading + 12.5%'),
      row('9903.05.43', 0, 'Except for products described in headings 9903.05.85–9903.05.92, articles the product of Hong Kong, China, as provided for in U.S. note 52 to this subchapter', 'The duty provided in the applicable subheading + 12.5%'),
      row('9903.01.24', 0, 'Except for products described in headings 9903.01.21, 9903.01.22, 9903.01.23, articles the product of China and Hong Kong, as provided for in U.S. note 2(u) to this subchapter', 'The duty provided in the applicable subheading + 10%'),
    ]);
    expect(headingAppliesTo(t['9903.05.31']!, cn)).toBe(true);
    expect(headingAppliesTo(t['9903.05.43']!, cn)).toBe(false);
    expect(headingAppliesTo(t['9903.01.24']!, cn)).toBe(true);
    expect(headingAppliesTo(table['9903.88.15']!, cn)).toBe(true);
    expect(headingAppliesTo(table['9903.41.05']!, cn)).toBe(false);
  });
});

describe('headingAppliesTo — civil-aircraft headings name their country with "of …" (no "product of")', () => {
  // real Rev 21 heading text
  const t = buildHeadingTable([
    row('9903.96.02', 0, 'Articles of civil aircraft (all aircraft other than military aircraft); their engines, parts, and components; their other parts, components, and subassemblies; and ground flight simulators and their parts and components of Japan, excluding unmanned aircraft, classified in the subheadings enumerated in subdivision (b) of U.S. note 35 to this subchapter.', 'The duty provided in the applicable subheading'),
    row('9903.02.76', 0, 'Articles of civil aircraft (all aircraft other than military aircraft); their engines, parts, and components; their other parts, components, and subassemblies; and ground flight simulators and their parts and components of the European Union, excluding unmanned aircraft, provided for in subdivision (v)(xxii) of U.S. note 2 to this subchapter', 'The duty provided in the applicable subheading'),
    row('9903.96.01', 0, 'Effective with respect to entries on or after June 30, 2025, articles of civil aircraft (all aircraft other than military aircraft); their engines, parts, and components; their other parts, components, and subassemblies; and ground flight simulators and their parts and components of the United Kingdom, classified in the subheadings enumerated in subdivision (a) of U.S. note 35 to this subchapter.', 'The duty provided in the applicable subheading'),
  ]);
  const [jp, de, cn] = ['JP', 'DE', 'CN'].map((o) => originOf(o)!);
  it('applies only to the origin it names', () => {
    expect([jp, de, cn].map((o) => headingAppliesTo(t['9903.96.02']!, o))).toEqual([true, false, false]);
    expect([jp, de, cn].map((o) => headingAppliesTo(t['9903.02.76']!, o))).toEqual([false, true, false]);
    expect([jp, de, cn].map((o) => headingAppliesTo(t['9903.96.01']!, o))).toEqual([false, false, false]);
  });
});

describe('validUntil — the earliest future date in an in-force heading\'s or a note\'s own period text', () => {
  const t = buildHeadingTable([
    row('9903.88.50', 0, 'Effective with respect to entries on or after June 4, 2020, and through December 31, 2020, articles the product of China, as provided for in U.S. note 20(ccc) to this subchapter', 'The duty provided in the applicable subheading'),
    row('9903.88.69', 0, 'Effective with respect to entries on or after June 15, 2024 and through November 9, 2026, articles the product of China, as provided for in U.S. note 20(vvv) to this subchapter', 'The duty provided in the applicable subheading'),
    row('9903.91.12', 0, 'Effective with respect to entries, on or after November 10, 2026, of intermodal chassis …', 'The duty provided in subheadings 8716.39.00, 8716.90.30 or 8716.90.50 + 100%'),
    row('9903.91.06', 0, 'Effective with respect to entries on or after January 1, 2026, articles the product of China, as provided for in subdivision (g) of U.S. note 31 to this subchapter', 'The duty provided in the applicable subheading + 25%'),
  ]);
  const notes = segmentNotes(doc(['SUBCHAPTER III', 'U.S. Notes', '31. (a) synthetic: goods entered on or after December 1, 2026 are subject to (b)']));
  it('"through D" → valid through D; "on or after D" → valid through the day before; past dates and out-of-force headings are ignored', () => {
    const o = outOfForce(t, notes, '2026-10-12');
    expect(validUntil(t, notes, o, '2026-10-12')).toEqual({ date: '2026-11-09', ref: 'heading 9903.88.69', quote: 'through November 9, 2026' });
    expect(validUntil(t, notes, outOfForce(t, notes, '2026-11-10'), '2026-11-10')).toEqual({ date: '2026-11-30', ref: 'note III 31(a)', quote: 'on or after December 1, 2026' });
    expect(validUntil(t, notes, outOfForce(t, notes, '2026-12-01'), '2026-12-01')).toBeNull();
  });
});

describe('outOfForce — an entry period in the heading\'s own text that has ended', () => {
  // real Rev 21 heading text (cut where marked …)
  const t = buildHeadingTable([
    row('9903.88.09', 0, 'Articles the product of China, as provided for in U.S. note 20(l) to this subchapter and as provided for in the subheadings enumerated in U.S. notes 20(f) or 20(g) to this subchapter, if exported to the United States before May 10, 2019 and entered for consumption, or withdrawn from warehouse for consumption, on or after May 10, 2019, and before June 15, 2019', 'The duty provided in the applicable subheading + 10%'),
    row('9903.88.50', 0, 'Effective with respect to entries on or after June 4, 2020, and through December 31, 2020, articles the product of China, as provided for in U.S. note 20(ccc) to this subchapter, each covered by an exclusion granted by the U.S. Trade Representative', 'The duty provided in the applicable subheading'),
    row('9903.88.66', 0, 'Effective with respect to entries on or after December 1, 2021, and before June 1, 2023, articles the product of China, as provided for in U.S. note 20(sss) to this subchapter, each covered by an exclusion granted by the U.S. Trade Representative', 'The duty provided in the applicable subheading'),
    row('9903.88.69', 0, 'Effective with respect to entries on or after June 15, 2024 and through November 9, 2026, articles the product of China, as provided for in U.S. note 20(vvv) to this subchapter, each covered by an exclusion granted by the U.S. Trade Representative', 'The duty provided in the applicable subheading'),
    row('9903.91.12', 0, 'Effective with respect to entries, on or after November 10, 2026, of intermodal chassis, subassemblies thereof, and parts thereof …', 'The duty provided in subheadings 8716.39.00, 8716.90.30 or 8716.90.50 + 100%'),
  ]);
  const none = segmentNotes(doc([]));

  it('"through D" ends after D, "before D" on D; a period not yet ended, or not yet begun, stays in force (fails closed)', () => {
    const o = outOfForce(t, none, '2026-10-12');
    expect(o['9903.88.09']).toEqual({ why: 'entry_window_closed', ref: 'heading 9903.88.09', quote: 'on or after May 10, 2019, and before June 15, 2019' });
    expect(o['9903.88.50']).toEqual({ why: 'entry_window_closed', ref: 'heading 9903.88.50', quote: 'on or after June 4, 2020, and through December 31, 2020' });
    expect(o['9903.88.66']?.quote).toBe('on or after December 1, 2021, and before June 1, 2023');
    expect(o['9903.88.69']).toBeUndefined();
    expect(o['9903.91.12']).toBeUndefined();
    expect(outOfForce(t, none, '2026-11-09')['9903.88.69']).toBeUndefined();
    expect(outOfForce(t, none, '2026-11-10')['9903.88.69']).toMatchObject({ why: 'entry_window_closed' });
    expect(outOfForce(t, none, '2023-05-31')['9903.88.66']).toBeUndefined();
    expect(outOfForce(t, none, '2023-06-01')['9903.88.66']).toMatchObject({ why: 'entry_window_closed' });
  });
});
