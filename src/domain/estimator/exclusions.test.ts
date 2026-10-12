import { describe, expect, it } from 'vitest';
import type { RateExportRow } from './baseRates';
import { segmentNotes, type Ch99Notes } from './ch99Notes';
import type { StrippedText } from './ch99Text';
import { classifyExclusions, exclusionOf } from './exclusions';
import { buildHeadingTable, outOfForce } from './headings';

// Real Rev 21 note 20 and heading text, cut down; the filler subdivisions "(c) synthetic" … are synthetic.
const doc = (lines: string[]): StrippedText => ({ revision: 'Revision 21 (2026)', pages: ['p'], lines: lines.map((text) => ({ page: 'p', text })) });
const label = (ord: number) => String.fromCharCode(97 + ((ord - 1) % 26)).repeat(Math.floor((ord - 1) / 26) + 1);
const fill = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => `(${label(from + i)}) synthetic`);
const USTR = (h: string) =>
  `The U.S. Trade Representative determined to establish a process by which particular products classified in heading ${h} could be excluded. Pursuant to the product exclusion process, the U.S. Trade Representative has determined that the additional duties provided for in heading ${h} shall not apply to the following particular products, which are provided for in the enumerated statistical reporting numbers:`;

const LINES = [
  'SUBCHAPTER III', 'U.S. Notes',
  '20. (a)  For the purposes of heading 9903.88.01, products of China, as provided for in this note, shall be subject to an additional',
  "         25 percent ad valorem rate of duty. [Compiler's note: only subdivisions",
  '         (vvv) and (www)of this note indicating exclusions are now in effect; consult Customs for more information.]',
  "(b) Heading 9903.88.01 applies to all products of China that are classified in the following 8-digit subheadings, except products of China granted an exclusion by the U.S. Trade Representative. [Compiler's note: Only subdivisions (vvv) and (www) are now in effect. The list of subheadings may begin on following page; read numbers from left to right.]",
  '0301.11.00 0304.72.50 8413.91.90',
  ...fill(3, 7),
  `(h) ${USTR('9903.88.01')} [Compiler's note: expired]`,
  '(1) Pumps (described in statistical reporting number 8413.91.9080)',
  ...fill(9, 25),
  '(z) For purposes of heading 9903.88.21, the additional duties imposed by heading 9903.88.03 or 9903.88.09 shall not apply to entries under subheadings 2202.99.36, 2202.99.37, if such entries are subject to an applied rate of duty under such enumerated subheadings that is derived from another subheading that is subject to the additional duties imposed by heading 9903.88.01.',
  ...fill(27, 70),
  `(sss) (i) ${USTR('9903.88.01')} [Compiler's note: expired.]`,
  '(1) Disposable plastic filters (described in statistical reporting number 3926.90.9989)',
  `(ii) ${USTR('9903.88.02')}`,
  '(1) 9025.19.8010',
  ...fill(72, 73),
  `(vvv) (i) ${USTR('9903.88.01')}`,
  '(1) 8483.50.9040',
  `(www) ${USTR('9903.88.02')}`,
  '(1) Silicon growth furnaces (described in statistical reporting number 8417.80.0000)',
];
const row = (htsno: string, description: string, general = 'The duty provided in the applicable subheading') => ({ htsno, indent: '0', description, general }) as RateExportRow;
const ROWS = [
  row('9903.88.01', 'Except as provided in headings 9903.88.05, 9903.88.66, or 9903.88.69, articles the product of China, as provided for in U.S. note 20(a) to this subchapter and as provided for in the subheadings enumerated in U.S. note 20(b) [to this subchapter]', 'The duty provided in the applicable subheading plus 25%'),
  row('9903.88.05', 'Articles the product of China, as provided for in U.S. note 20(h) to this subchapter, each covered by an exclusion granted by the U.S. Trade Representative'),
  row('9903.88.21', 'Articles the product of China, as provided for in U.S. note 20(z) to this subchapter'),
  row('9903.88.66', 'Effective with respect to entries on or after December 1, 2021, and before June 1, 2023, articles the product of China, as provided for in U.S. note 20(sss) to this subchapter, each covered by an exclusion granted by the U.S. Trade Representative'),
  row('9903.88.69', 'Effective with respect to entries on or after June 15, 2024 and through November 9, 2026, articles the product of China, as provided for in U.S. note 20(vvv) to this subchapter, each covered by an exclusion granted by the U.S. Trade Representative'),
  row('9903.88.70', 'Effective with respect to entries on or after January 1, 2024, and through November 9, 2026, articles the product of China, as provided in U.S. note 20(www) to this subchapter, each covered by an exclusion granted by the U.S. Trade Representative'),
];
const notes = segmentNotes(doc(LINES), { fixes: [] });
const headings = buildHeadingTable(ROWS);
const classify = (asOf: string, n: Ch99Notes = notes) => classifyExclusions(n, headings, outOfForce(headings, n, asOf));
const status = (asOf: string, n?: Ch99Notes) => Object.fromEntries(Object.values(classify(asOf, n).units).map((u) => [u.ref, [u.status, u.heading]]));

describe('classifyExclusions — note 20 subdivisions that say a list duty "shall not apply"', () => {
  it('in effect: named by the note-wide compiler\'s note and its heading\'s entry period has not ended', () => {
    expect(status('2026-10-12')).toEqual({
      'note III 20(h)': ['expired', '9903.88.05'],
      'note III 20(z)': ['unclear', '9903.88.21'],
      'note III 20(sss)(i)': ['expired', '9903.88.66'],
      'note III 20(sss)(ii)': ['expired', '9903.88.66'],
      'note III 20(vvv)(i)': ['in_effect', '9903.88.69'],
      'note III 20(www)': ['in_effect', '9903.88.70'],
    });
  });

  it('says why: its own compiler\'s note, its heading\'s ended period, or the note-wide note that leaves it out', () => {
    const { units, inEffect } = classify('2026-10-12');
    expect(inEffect).toEqual({ ref: 'note III 20(a)', labels: ['vvv', 'www'], quote: 'only subdivisions (vvv) and (www)of this note indicating exclusions are now in effect' });
    expect(units['note III 20(h)']!.why).toBe("its own compiler's note: [Compiler's note: expired]");
    expect(units['note III 20(sss)(ii)']!.why).toBe('heading 9903.88.66 is out of force (entry_window_closed: on or after December 1, 2021, and before June 1, 2023)');
    expect(units['note III 20(z)']!.why).toBe("no compiler's note marks it expired, but note III 20(a) names only (vvv), (www) as in effect");
    expect(units['note III 20(vvv)(i)']!.why).toBe("named in effect by note III 20(a); heading 9903.88.69 in force");
  });

  it('after the entry period ends (November 9, 2026) the in-effect ones are expired, whatever the compiler\'s note says', () => {
    expect(status('2026-11-10')['note III 20(vvv)(i)']).toEqual(['expired', '9903.88.69']);
    expect(status('2026-11-10')['note III 20(www)']).toEqual(['expired', '9903.88.70']);
  });

  it('a ref inside a unit (an item) belongs to it; refs outside note 20 exclusions belong to none', () => {
    const c = classify('2026-10-12');
    expect(exclusionOf('note III 20(vvv)(i)(1)', c)?.ref).toBe('note III 20(vvv)(i)');
    expect(exclusionOf('note III 20(www)(1)', c)?.ref).toBe('note III 20(www)');
    expect(exclusionOf('note III 20(b)', c)).toBeNull();
    expect(exclusionOf('note III 52(b)', c)).toBeNull();
  });

  it('fails closed (unclear): an unresolved numbering oddity inside it, a heading that adds duty, or no single heading citing it', () => {
    const odd: Ch99Notes = { ...notes, ignoredMarkers: [{ section: 'III', note: 20, path: '20(vvv)(i)(1)', page: 'p', text: '(7) x', why: 'out_of_sequence' }] };
    expect(classify('2026-10-12', odd).units['note III 20(vvv)(i)']).toMatchObject({ status: 'unclear', why: 'an out-of-sequence label inside it (20(vvv)(i)(1)): its items are in doubt' });
    const adds = buildHeadingTable(ROWS.map((r) => (r.htsno === '9903.88.70' ? { ...r, general: 'The duty provided in the applicable subheading + 25%' } : r)));
    expect(classifyExclusions(notes, adds, outOfForce(adds, notes, '2026-10-12')).units['note III 20(www)']).toMatchObject({ status: 'unclear', why: 'heading 9903.88.70 adds duty ("The duty provided in the applicable subheading + 25%")' });
    const none = buildHeadingTable(ROWS.filter((r) => r.htsno !== '9903.88.21'));
    expect(classifyExclusions(notes, none, {}).units['note III 20(z)']).toMatchObject({ status: 'unclear', heading: null, why: 'no heading cites U.S. note 20(z)' });
  });

  it('an item under a unit that names other Chapter 99 headings is not part of the exclusion (note 21, printed "(21) (a)" after 20(www)(14))', () => {
    const n = segmentNotes(doc([
      ...LINES,
      ...Array.from({ length: 12 }, (_, i) => `(${i + 2}) synthetic`),
      '(14) Machines designed for lifting, handling, loading, or unloading of solar wafers (described in statistical reporting number 8486.40.0030)',
      '(21) (a)  Except as provided in notes 21(u), 21(v), 21(w) and 21(x) of this subdivision, for the purposes of subheadings 9903.89.05',
      ...fill(2, 15),
      '(p) Subheading 9903.89.49 and superior text thereto shall apply to all products of the United Kingdom that are either—',
      '(1) single-malt Irish or Scotch Whiskies (provided for in subheading 2208.30.30), or',
      '(2) provided for in the subheadings enumerated below: 6110.11.00 6203.11.60',
    ]), { fixes: [] });
    expect(n.subdivisions.map((s) => s.path)).toContain('20(www)(21)(p)(2)');
    const c = classifyExclusions(n, headings, outOfForce(headings, n, '2026-10-12'));
    expect(exclusionOf('note III 20(www)(14)', c)?.ref).toBe('note III 20(www)');
    expect(exclusionOf('note III 20(www)(21)(a)', c)).toBeNull();
    expect(exclusionOf('note III 20(www)(21)(p)(2)', c)).toBeNull();
    expect(c.foreign).toEqual(['20(www)(21)(a)', '20(www)(21)(p)']);
  });

  it('counts', () => {
    expect(classify('2026-10-12').counts).toEqual({ in_effect: 2, expired: 3, unclear: 1 });
  });
});
