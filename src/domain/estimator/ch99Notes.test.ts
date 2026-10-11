import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { codeTokens, extractNote52, segmentNotes, type Ch99Notes, type Subdivision } from './ch99Notes';
import { stripPageFurniture, type StrippedText } from './ch99Text';

// Text is real Rev 21 Chapter 99 text (pdftotext -layout, indentation kept where it matters) unless marked synthetic.
const doc = (lines: string[]): StrippedText => ({ revision: 'Revision 21 (2026)', pages: ['p1'], lines: lines.map((text) => ({ page: 'p1', text })) });
// synthetic "(a) synthetic" … lines: a list only opens at its first label
const upTo = (last: string) => 'abcdefghijk'.slice(0, 'abcdefghijk'.indexOf(last) + 1).split('').map((c) => `(${c}) synthetic`);
const paths = (n: Ch99Notes) => n.subdivisions.map((s) => `${s.section} ${s.path}`);
const sub = (n: Ch99Notes, path: string, section = 'III'): Subdivision => {
  const s = n.subdivisions.find((x) => x.section === section && x.path === path);
  if (!s) throw new Error(`no ${section} ${path} in ${paths(n).join(', ')}`);
  return s;
};

const FIXTURE = readFileSync(join(__dirname, '__fixtures__', 'ch99-rev21-note52.txt'), 'utf8');
const CH99_REV21 = (JSON.parse(readFileSync(join(process.cwd(), 'data', 'hts', '2026-rev21-ch99.json'), 'utf8')) as { headings: Record<string, string> })
  .headings;

describe('codeTokens', () => {
  it('reads 10-digit statistical numbers, 8-digit lines and Ch. 99 headings apart', () => {
    const t = codeTokens('0712.34.20    0712.90.8550  0713.10.10 (described in statistical reporting number 8407.21.0080) heading 9903.05.86');
    expect(t.codes10).toEqual(['0712.90.8550', '8407.21.0080']);
    expect(t.codes8).toEqual(['0712.34.20', '0713.10.10']);
    expect(t.ch99).toEqual(['9903.05.86']);
  });

  it('reads Ch. 99 ranges with an en dash or "through"', () => {
    const t = codeTokens('the duties imposed by headings 9903.05.20–9903.05.84 shall not apply; subheadings 9903.45.01 through 9903.45.06');
    expect(t.ch99Ranges).toEqual([['9903.05.20', '9903.05.84'], ['9903.45.01', '9903.45.06']]);
    expect(t.ch99).toEqual([]);
  });

  it('reads 6-digit subheadings, and 4-digit headings only in "heading(s) …" phrases or code-only lines', () => {
    expect(codeTokens('assemblies of the goods of subheading 8504.40 or 8504.50 for telecommunication').codes6).toEqual(['8504.40', '8504.50']);
    const list = codeTokens('                   7219        7302.40.00    7302.90');
    expect(list.headings4).toEqual(['7219']);
    expect(list.codes6).toEqual(['7302.90']);
    expect(list.codes8).toEqual(['7302.40.00']);
    expect(codeTokens('(provided for in heading 4104 or 4107); goat, kid (provided for in heading 4105, 4106, 4112 or 4113)').headings4).toEqual(
      ['4104', '4107', '4105', '4106', '4112', '4113'],
    );
    expect(codeTokens('of headings 7601, 7604 and 7605 that are').headings4).toEqual(['7601', '7604', '7605']);
    // numbers that aren't headings
    expect(codeTokens('pursuant to Proclamation 9705 of March 8, 2018 (83 FR 11619), 1500 kg').headings4).toEqual([]);
  });

  it('reads heading ranges and chapters', () => {
    const t = codeTokens('vehicles of headings 8701 to 8705 and parts; the foregoing provided for in chapter 64; chapters 72 and 73; chapters 1 to 97');
    expect(t.ranges).toEqual([['8701', '8705'], ['01', '97']]);
    expect(t.chapters).toEqual(['64', '72', '73']);
    expect(t.headings4).toEqual([]);
  });
});

describe('segmentNotes', () => {
  it('finds sections, notes (gaps allowed, ≤ 10) and deleted notes; numbered list items are not notes', () => {
    const n = segmentNotes(doc([
      'SUBCHAPTER III', 'TEMPORARY MODIFICATIONS ESTABLISHED PURSUANT TO TRADE LEGISLATION', 'U.S. Notes',
      '1.  (a) For the purposes of heading 9903.88.01, products of China', '(b) second',
      '[U.S. note 2 deleted]',
      '3. [Note deleted.]', // note 36's form
      '4.', '(a) As provided in heading 9903.88.15:',
      '1. Other seats with wooden frames, not upholstered, provided for in [subheading] 9401.69.60, except for such seats', // list item
      '13. (a)  For the purposes of subheading 9903.53.01, the duties', // gap of 9
      '24. synthetic: a gap of 11 is text, not a note',
      ' Heading/ Stat.                         Unit', '9903.01.01 1/ Except for products described in headings 9903.01.02,',
    ]));
    expect(n.sections).toEqual([{ id: 'III', notes: [1, 4, 13], deleted: [2, 3] }]);
    expect(paths(n)).toEqual(['III 1(a)', 'III 1(b)', 'III 4(a)', 'III 13(a)']);
    expect(sub(n, '4(a)').codes8).toEqual(['9401.69.60']);
    expect(sub(n, '13(a)').text).toBe('For the purposes of subheading 9903.53.01, the duties 24. synthetic: a gap of 11 is text, not a note');
    // nothing from the tariff table
    expect(n.subdivisions.some((s) => s.text.includes('9903.01.02'))).toBe(false);
  });

  it('reads the chapter-level U.S. and statistical notes as their own sections', () => {
    const n = segmentNotes(doc(['CHAPTER 99', 'U.S. Notes', '1. The provisions of this chapter', 'Statistical Notes', '1. For statistical reporting', 'SUBCHAPTER I', 'U.S. Notes', '1. text']));
    expect(n.sections.map((s) => s.id)).toEqual(['chapter', 'chapter-stat', 'I']);
    expect(paths(n)).toEqual(['chapter 1', 'chapter-stat 1', 'I 1']);
  });

  it('(h) → (i) → (j) are letters, not a roman list under (h)', () => {
    const n = segmentNotes(doc([
      'SUBCHAPTER III', 'U.S. Notes', '52.', ...upTo('g'),
      '(h) As provided in heading 9903.05.94, the additional duties imposed by heading 9903.05.55 shall not apply to any products',
      '(i) As provided in heading 9903.05.95, the additional duties imposed by headings 9903.05.33, 9903.05.34, 9903.05.37,',
      '(j)',
      '(1) As provided in heading 9903.05.96, the duty imposed by heading 9903.05.81 shall not apply to articles the product',
    ]));
    expect(paths(n).slice(7)).toEqual(['III 52(h)', 'III 52(i)', 'III 52(j)', 'III 52(j)(1)']);
  });

  it('roman lists and upper-case items nest; the next digit closes them', () => {
    const n = segmentNotes(doc([
      'SUBCHAPTER III', 'U.S. Notes', '52.', ...upTo('i'), '(j)', '(1) synthetic', '(2) synthetic', '(3) As provided in heading 9903.05.98', '(4)',
      '     (i) As provided in heading 9903.05.99, the duty imposed by heading 9903.05.54 shall not apply to articles the product',
      '              of Malaysia that are classifiable in the following provisions of the HTSUS:',
      '                   0106.19.91  0106.20.00  0106.90.01       0410.10.00  0602.90.20',
      '     (ii) As provided in heading 9903.06.01, the duty imposed by heading 9903.05.54 shall not apply to the following',
      '     (A) Psyllium seed husks (classifiable in subheading 1211.90.89);',
      '     (B) Boswellia (classifiable in subheading 1301.90.91); and',
      '     (C) Argan oil (classifiable in subheading 1515.90.81)',
      '(5)', '     (i) As provided in heading 9903.06.02',
    ]));
    expect(paths(n).filter((p) => !p.endsWith('(1)') && !p.endsWith('(2)')).slice(9)).toEqual([
      'III 52(j)', 'III 52(j)(3)', 'III 52(j)(4)', 'III 52(j)(4)(i)', 'III 52(j)(4)(ii)',
      'III 52(j)(4)(ii)(A)', 'III 52(j)(4)(ii)(B)', 'III 52(j)(4)(ii)(C)', 'III 52(j)(5)', 'III 52(j)(5)(i)',
    ]);
    expect(sub(n, '52(j)(4)(i)').codes8).toEqual(['0106.19.91', '0106.20.00', '0106.90.01', '0410.10.00', '0602.90.20']);
    expect(sub(n, '52(j)(4)(ii)').codes8).toEqual([]); // children keep their own codes
    expect(sub(n, '52(j)(4)(ii)(B)').codes8).toEqual(['1301.90.91']);
  });

  it('deleted subdivisions leave gaps: note 2 runs (c) → (j) and (m) → (s)', () => {
    const n = segmentNotes(doc([
      'SUBCHAPTER III', 'U.S. Notes', '2. (a) For the purposes of heading 9903.01.01', '(b) Heading 9903.01.02', '(c) For the purposes',
      '(j) For the purposes of heading 9903.01.10, products of Canada, other than products described in headings',
      '(k) Heading 9903.01.11 covers only products of Canada', '(l) For', '(m) For', '(s) For the purposes of heading 9903.01.20',
    ]));
    expect(paths(n)).toEqual(['III 2(a)', 'III 2(b)', 'III 2(c)', 'III 2(j)', 'III 2(k)', 'III 2(l)', 'III 2(m)', 'III 2(s)']);
  });

  it('wrapped cross-references are text: "(o) of this note" inside (n), "(p) of this note" inside (f)', () => {
    const n = segmentNotes(doc([
      'SUBCHAPTER III', 'U.S. Notes', '33.', ...upTo('e'),
      '(f) Except as provided in subdivision',
      '(p) of this note, articles of passenger vehicles', // a skip (f) → (p) would swallow (g) … (p)
      '(g) Subject to a manufacturer\'s import adjustment offset amount',
      '(h) Heading 9903.94.06 applies to all entries of articles', '(i) Heading 9903.94.31 sets forth', '(j) Heading', '(k) Except', '(l) Except',
      '(m) As provided', '(n) Except as provided in',
      '(o) of this note under a provision of chapter 99 that may set forth a lower rate of duty', // exact successor, still a reference
      '(o) The rates of duty set forth in heading 9903.85.12 apply',
      '(c), (h), (i), (j), (l), and (m) to this note, that are classified', // a list of references
    ]));
    expect(paths(n).slice(5)).toEqual(
      ['f', 'g', 'h', 'i', 'j', 'k', 'l', 'm', 'n', 'o'].map((c) => `III 33(${c})`),
    );
    expect(sub(n, '33(f)').text).toBe('Except as provided in subdivision (p) of this note, articles of passenger vehicles');
    expect(n.ignoredMarkers.map((m) => m.text.slice(0, 12))).toEqual(['(p) of this ', '(o) of this ', '(c), (h), (i']);
  });

  it('upper-case roman numerals and the US Code (aa)/(bb) level; acronyms in parentheses are text', () => {
    const n = segmentNotes(doc([
      'SUBCHAPTER III', 'U.S. Notes', '17. (a) Subheadings 9903.45.01', '(b) For the purposes', '(1) Canada;', '(2) the following',
      '(A) all stacked washers', '(i) The term', '(ii) The term "covered washers" means',
      '(aa)(I) it contains payment system electronics;', '(II) it is configured with an externally mounted steel frame',
      '(III) it contains a push button user interface', '(IV) the console containing the user interface is made of steel',
      '(bb)(I) it contains payment system electronics;', '(II) the payment system electronics are enabled',
      '(ABS) plastics (described in statistical reporting number 8413.20.0000)',
    ]));
    expect(paths(n).slice(-8)).toEqual([
      'III 17(b)(2)(A)(ii)(aa)', 'III 17(b)(2)(A)(ii)(aa)(I)', 'III 17(b)(2)(A)(ii)(aa)(II)', 'III 17(b)(2)(A)(ii)(aa)(III)',
      'III 17(b)(2)(A)(ii)(aa)(IV)', 'III 17(b)(2)(A)(ii)(bb)', 'III 17(b)(2)(A)(ii)(bb)(I)', 'III 17(b)(2)(A)(ii)(bb)(II)',
    ]);
    expect(sub(n, '17(b)(2)(A)(ii)(bb)(II)').codes10).toEqual(['8413.20.0000']);
  });

  it('a line-start marker that neither continues nor opens a list is text, and is reported', () => {
    const n = segmentNotes(doc([
      'SUBCHAPTER III', 'U.S. Notes', '20. (a)  For the purposes of heading 9903.88.01, products of China',
      '         (vvv) and (www)of this note indicating exclusions are now in effect; consult Customs for more information.]',
      '(b) next',
    ]));
    expect(paths(n)).toEqual(['III 20(a)', 'III 20(b)']);
    expect(sub(n, '20(a)').text).toContain('(vvv) and (www)of this note');
    expect(n.ignoredMarkers).toEqual([{
      section: 'III', note: 20, path: '20(a)', page: 'p1', why: 'reference',
      text: '(vvv) and (www)of this note indicating exclusions are now in effect; consult Customs for more information.]',
    }]);
    const odd = segmentNotes(doc(['SUBCHAPTER III', 'U.S. Notes', '20. (a) x', '(1) one', '(2) two', '(5) synthetic: a skip whose skipped (3) comes later', '(ABS) plastics', '(3) three']));
    expect(odd.ignoredMarkers.map((m) => [m.path, m.why])).toEqual([['20(a)(2)', 'out_of_sequence'], ['20(a)(2)', 'not_a_label']]);
  });

  it('text is whitespace-folded without its marker; sha256 is of that text; "As provided in" headings and ranges', () => {
    const n = segmentNotes(doc([
      'SUBCHAPTER III', 'U.S. Notes', '52.', ...upTo('j'),
      '(k) As provided in headings 9903.05.38, 9903.05.39, 9903.05.48, 9903.05.49, 9903.05.70, 9903.05.71 and',
      '         9903.05.73–9903.05.76, for any good of a member state of the European Union, Japan, South Korea, Switzerland or',
    ]));
    const k = sub(n, '52(k)');
    expect(k.text).toBe(
      'As provided in headings 9903.05.38, 9903.05.39, 9903.05.48, 9903.05.49, 9903.05.70, 9903.05.71 and 9903.05.73–9903.05.76, for any good of a member state of the European Union, Japan, South Korea, Switzerland or',
    );
    expect(k.sha256).toBe(createHash('sha256').update(k.text).digest('hex'));
    expect(k.asProvidedIn).toEqual({
      headings: ['9903.05.38', '9903.05.39', '9903.05.48', '9903.05.49', '9903.05.70', '9903.05.71'],
      ranges: [['9903.05.73', '9903.05.76']],
    });
    expect(k.shallNotApply).toBe(false);
  });
});

describe('note 52 — the committed Rev 21 excerpt (pages 99-III-393 … 434)', () => {
  const notes = segmentNotes(stripPageFurniture(FIXTURE), { startIn: { section: 'III', note: 51 } });
  const n52 = extractNote52(notes, CH99_REV21);

  it('has subdivisions (a)–(k) and (j)(1)–(j)(13)', () => {
    const p = n52.subdivisions.map((s) => s.path);
    expect(p.filter((x) => /^52\([a-z]\)$/.test(x))).toEqual('abcdefghijk'.split('').map((c) => `52(${c})`));
    expect(p.filter((x) => /^52\(j\)\(\d+\)$/.test(x))).toEqual(Array.from({ length: 13 }, (_, i) => `52(j)(${i + 1})`));
    expect(p.filter((x) => /^52\(c\)\(\d+\)$/.test(x))).toHaveLength(16);
    expect(p.filter((x) => /^52\(f\)\(\d+\)$/.test(x))).toHaveLength(8);
  });

  it('maps every exemption heading to the subdivision that defines it', () => {
    const want: Record<string, string> = {
      '9903.05.86': '52(b)', '9903.05.87': '52(c)', '9903.05.88': '52(d)', '9903.05.89': '52(e)', '9903.05.90': '52(f)',
      '9903.05.93': '52(g)', '9903.05.94': '52(h)', '9903.05.95': '52(i)', '9903.05.96': '52(j)(1)', '9903.05.97': '52(j)(2)',
      '9903.05.98': '52(j)(3)', '9903.05.99': '52(j)(4)(i)', '9903.06.01': '52(j)(4)(ii)',
    };
    const tail: [string, string][] = [
      ['9903.06.02', '(5)(i)'], ['9903.06.03', '(5)(ii)'], ['9903.06.04', '(6)(i)'], ['9903.06.05', '(6)(ii)'], ['9903.06.06', '(6)(iii)'],
      ['9903.06.07', '(7)(i)'], ['9903.06.08', '(7)(ii)'], ['9903.06.09', '(7)(iii)'], ['9903.06.10', '(8)(i)'], ['9903.06.11', '(8)(ii)'],
      ['9903.06.12', '(9)(i)'], ['9903.06.13', '(9)(ii)'], ['9903.06.14', '(10)(i)'], ['9903.06.15', '(10)(ii)'], ['9903.06.16', '(11)(i)'],
      ['9903.06.17', '(11)(ii)'], ['9903.06.18', '(12)(i)'], ['9903.06.19', '(12)(ii)'], ['9903.06.20', '(13)(i)'], ['9903.06.21', '(13)(ii)'],
    ];
    for (const [h, p] of tail) want[h] = `52(j)${p}`;
    expect(Object.fromEntries(Object.entries(n52.exemptions).map(([h, s]) => [h, s.path]))).toEqual(want);
    for (const s of Object.values(n52.exemptions)) expect(s.shallNotApply).toBe(true);
  });

  it('agrees with the official heading texts ("subdivision (x) of U.S. note 52")', () => {
    expect(n52.problems).toEqual([]);
    const tampered = { ...CH99_REV21, '9903.05.97': CH99_REV21['9903.05.97']!.replace('(j)(2)', '(j)(9)') };
    expect(extractNote52(notes, tampered).problems.join('\n')).toMatch(/9903\.05\.97/);
    const missing = { ...CH99_REV21 };
    delete missing['9903.05.86'];
    expect(extractNote52(notes, missing).problems.join('\n')).toMatch(/9903\.05\.86/);
  });

  it('code counts per list (pinned; equal to a raw count of the same PDF lines)', () => {
    const count = (p: string) => ({ c8: sub(notes, p).codes8.length, c10: sub(notes, p).codes10.length });
    expect(count('52(b)')).toEqual({ c8: 856, c10: 7 });
    expect(count('52(d)')).toEqual({ c8: 541, c10: 0 });
    expect(count('52(e)')).toEqual({ c8: 700, c10: 0 });
    expect(count('52(j)(1)')).toEqual({ c8: 48, c10: 1 });
    expect(count('52(j)(2)')).toEqual({ c8: 43, c10: 0 });
    expect(count('52(j)(3)')).toEqual({ c8: 134, c10: 0 });
    expect(count('52(c)')).toEqual({ c8: 0, c10: 0 });
    const c = n52.subdivisions.filter((s) => /^52\(c\)\(\d+\)$/.test(s.path)).flatMap((s) => s.codes8);
    expect(new Set(c).size).toBe(16);
    expect(count('52(f)')).toEqual({ c8: 0, c10: 0 });
    expect(sub(notes, '52(f)(7)').ch99).toEqual(['9903.79.01']);
    expect(sub(notes, '52(j)(2)').codes8.slice(0, 3)).toEqual(['3823.11.00', '3823.12.00', '3823.19.20']);
    expect(sub(notes, '52(j)(2)').codes8).toContain('8112.92.07');
  });

  it('loses no code: every distinct code token of the excerpt lands in a subdivision', () => {
    const all = [...new Set(FIXTURE.match(/\b(?!99)\d{4}\.\d{2}\.\d{2}(?:\d{2})?\b(?![.\d])/g) ?? [])].sort();
    const got = [...new Set(notes.subdivisions.flatMap((s) => [...s.codes8, ...s.codes10]))].sort();
    expect(got).toEqual(all);
    // codes are unique within a subdivision: 52(a) names 9802.00.40/.50/.60 twice, kept once
    expect(sub(notes, '52(a)').codes8).toEqual(['9802.00.40', '9802.00.50', '9802.00.60', '9802.00.80']);
    expect(sub(notes, '52(a)').ranges).toEqual([['01', '97']]); // "subheadings in chapters 1 to 97"
  });

  it('52(k): the AVE rule and both caps, verbatim after whitespace folding', () => {
    expect(n52.k.path).toBe('52(k)');
    expect(n52.k.text).toContain(
      'the ad valorem equivalent rate of duty of such good shall be determined by dividing the amount of duty payable under column 1-General by the customs value of the good.',
    );
    expect(n52.k.text).toContain(
      'For headings 9903.05.39 and 9903.05.76, articles for which the applicable column 1 duty rate is less than 10 percent, the sum of the column 1 duty rate and the additional ad valorem rate of duty is 10 percent ad valorem.',
    );
    expect(n52.k.text).toContain(
      'For headings 9903.05.49, 9903.05.71 and 9903.05.74, articles for which the applicable column 1 duty rate is less than 12.5 percent, the sum of the column 1 duty rate and the additional ad valorem rate of duty is 12.5 percent ad valorem.',
    );
    expect(n52.k.text).not.toMatch(/Heading\/ Stat\.|9903\.01\.01/); // stops before the tariff table
  });

  it('(a) is the general rule, not an exemption list', () => {
    expect(sub(notes, '52(a)').text).toMatch(/^Except as provided in headings 9903\.05\.85–9903\.06\.21 and in subdivisions \(b\) through \(k\)/);
    expect(Object.values(n52.exemptions).map((s) => s.path)).not.toContain('52(a)');
  });
});
