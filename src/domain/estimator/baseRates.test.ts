import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadVerifiedRates } from '@/domain/rates/__fixtures__/verified';
import { currentHtsIndex } from '@/server/hts';
import { buildBaseRates, type RateExportRow } from './baseRates';
import { toEngineMfn } from './rateText';

const META = { hts_revision: '2026 Rev. 20', source: { url: 'u', exportedOn: '2026-10-07' } };
// Shaped like the hts.usitc.gov exportList JSON. Text is real Rev 20 text unless marked synthetic.
const row = (htsno: string, indent: number, extra: Partial<RateExportRow> = {}): RateExportRow =>
  ({ htsno, indent: String(indent), description: htsno || 'Other:', superior: null, units: [], general: '', special: '', other: '', footnotes: [], ...extra }) as RateExportRow;
const fn = (columns: string[], value: string) => ({ columns, value, type: 'endnote' });
const NOTE_20G =
  'Pursuant to U.S. note 20(g) to subchapter III, chapter 99, heading 9903.88.04 covers certain goods of this rate line, as indicated by the footnote; please note that statistical reporting descriptions without a footnote are not covered by that heading. ';

const sample: RateExportRow[] = [
  row('0101', 0),
  row('0101.30.00.00', 1, { general: '6.8%' }), // the 10-digit row carries its own rate
  row('0201', 0),
  // Real footnote text (subchapter IV quotas, hyphen range); the column and the General text are synthetic. No code uses it.
  row('0201.10.50', 1, { general: '1%', footnotes: [fn(['general'], 'See subheadings 9904.02.01-9904.02.37. ')] }),
  row('2931', 0),
  row('2931.90', 1),
  row('2931.90.90', 2, { general: '3.7%', footnotes: [fn(['general'], NOTE_20G), fn(['other'], 'See 9903.90.08. ')] }),
  row('2931.90.90.51', 3, { footnotes: [fn(['desc'], 'See 9903.88.04. ')] }),
  row('5201', 0),
  row('5201.00', 1, { footnotes: [fn(['general'], 'See 9903.52.00 through 9903.52.26 and 9904.52.01 through 9904.52.34.')] }),
  row('5201.00.05', 2, { general: 'Free' }),
  row('5201.00.05.00', 3),
  row('6203', 0),
  row('6203.42', 1),
  row('6203.42.45', 2, { general: '16.6%', special: 'Free (AU)', other: '90%' }),
  row('', 3),
  row('6203.42.45.11', 4), // inherits from 6203.42.45
  row('6203.42.45.06', 4, { general: '\n' }), // whitespace-only General text (12 export rows) counts as empty
  row('8888', 0), // synthetic: an 8-digit line with no General text → no rate, never borrowed from higher up
  row('8888.10', 1, { general: '5%' }),
  row('8888.10.00', 2),
  row('8888.10.00.10', 3),
  row('9102', 0),
  row('9102.21', 1),
  row('', 2),
  row('9102.21.70', 3, {
    general: '$1.53 each + 4.2% on the case + 9.8% on the strap, band or bracelet',
    footnotes: [fn(['stat', 'units'], 'See statistical note 1 to this chapter. ')],
  }),
  row('9903', 0),
  row('9903.05.49', 1, { general: '12.5%' }), // chapter 99 rows are never parsed as base rates
];
const CODES = ['0101.30.0000', '2931.90.9051', '5201.00.0500', '6203.42.4511', '6203.42.4506', '8888.10.0010', '9102.21.70'];

describe('buildBaseRates — General-column text for every index code, verbatim + parsed', () => {
  const br = buildBaseRates(sample, { ...META, codes: CODES });

  it('resolves each code to its rate-bearing row: itself, else its 8-digit line', () => {
    expect(br.codes['0101.30.0000']!.r).toBe('0101.30.00.00');
    expect(br.codes['6203.42.4511']!.r).toBe('6203.42.45');
    expect(br.codes['6203.42.4506']!.r).toBe('6203.42.45');
    expect(br.codes['5201.00.0500']!.r).toBe('5201.00.05');
    expect(br.codes['9102.21.70']!.r).toBe('9102.21.70');
    expect(br.rateRows['6203.42.45']).toMatchObject({ ok: true, type: 'ad_valorem', text: '16.6%' });
    expect(toEngineMfn(br.rateRows['9102.21.70']!)).toMatchObject({ type: 'compound' });
  });

  it('never borrows a rate from above the 8-digit line: no General text there → no rate (fail closed)', () => {
    expect(br.codes['8888.10.0010']!.r).toBeNull();
    expect(br.counts.missingRate).toBe(1);
  });

  it('keeps only the rate rows that some code uses, and never parses chapter 99', () => {
    expect(Object.keys(br.rateRows).sort()).toEqual(['0101.30.00.00', '2931.90.90', '5201.00.05', '6203.42.45', '9102.21.70']);
  });

  it('collects Chapter 99 footnotes on the code and its ancestors, with column, verbatim text, headings and ranges', () => {
    expect(br.codes['2931.90.9051']!.fn).toEqual([
      { on: '2931.90.90', columns: ['general'], text: NOTE_20G, headings: ['9903.88.04'], ranges: [] },
      { on: '2931.90.90', columns: ['other'], text: 'See 9903.90.08. ', headings: ['9903.90.08'], ranges: [] },
      { on: '2931.90.90.51', columns: ['desc'], text: 'See 9903.88.04. ', headings: ['9903.88.04'], ranges: [] },
    ]);
    expect(br.codes['5201.00.0500']!.fn).toEqual([
      {
        on: '5201.00',
        columns: ['general'],
        text: 'See 9903.52.00 through 9903.52.26 and 9904.52.01 through 9904.52.34.',
        headings: [],
        ranges: [['9903.52.00', '9903.52.26'], ['9904.52.01', '9904.52.34']],
      },
    ]);
    expect(br.codes['9102.21.70']!.fn).toBeUndefined(); // "See statistical note 1" names no Chapter 99 heading
  });

  it('counts codes per rate type, refusals per reason, and footnote rows per column + reference', () => {
    expect(br.counts.codes).toBe(7);
    expect(br.counts.byType).toEqual({ free: 1, ad_valorem: 4, specific: 0, compound: 1, unparseable: 0 });
    expect(br.counts.unparseableByReason).toEqual({});
    // Rows (not codes) in chapters 1–97 whose footnotes name a Chapter 99 heading; the 9903 count is subchapter III only.
    expect(br.counts.footnoteRows).toBe(4);
    expect(br.counts.footnoteRows9903).toBe(3);
    expect(br.counts.footnoteRefs).toEqual({
      'general 9904.02.01–9904.02.37': 1,
      'general 9903.88.04': 1,
      'other 9903.90.08': 1,
      'desc 9903.88.04': 1,
      'general 9903.52.00–9903.52.26': 1,
      'general 9904.52.01–9904.52.34': 1,
    });
  });

  it('refuses a code the export does not have (the index and the export must be the same release)', () => {
    expect(() => buildBaseRates(sample, { ...META, codes: ['1234.56.7890'] })).toThrow(/1234\.56\.7890/);
  });
});

// Local only: the export is gitignored (data/source/). Pins the facts measured on 2026-10-10 against the real file.
const EXPORT = join(process.cwd(), 'data', 'source', 'hts', 'hts-2026-rev20-export.json');
describe.skipIf(!existsSync(EXPORT))('buildBaseRates — the real Rev 20 export (local only)', () => {
  const rows = JSON.parse(readFileSync(EXPORT, 'utf8')) as RateExportRow[];
  const { index } = currentHtsIndex();
  const br = buildBaseRates(rows, { hts_revision: index.hts_revision, source: index.source, codes: index.codes.map((c) => c.c) });
  const tenDigit = index.codes.filter((c) => !c.componentReporting).map((c) => c.c);

  it('every index code has a rate row; ten-digit codes split as measured', () => {
    expect(br.counts.missingRate).toBe(0);
    expect(tenDigit.length).toBe(19_831);
    const byType = (t: string) => tenDigit.filter((c) => {
      const p = br.rateRows[br.codes[c]!.r!]!;
      return (p.ok ? p.type : 'unparseable') === t;
    }).length;
    expect(byType('free')).toBe(7_333);
    expect(byType('ad_valorem')).toBe(10_300);
  });

  it('footnotes: 951 rows name a Chapter 99 heading; 765 name a 9903 heading, 680 of those on Column 2 (9903.90.08/.09)', () => {
    expect(br.counts.footnoteRows).toBe(951);
    expect(br.counts.footnoteRows9903).toBe(765);
    const sub3 = Object.fromEntries(Object.entries(br.counts.footnoteRefs).filter(([k]) => / 9903\.\d\d\.\d\d(–|$)/.test(k)));
    expect(sub3).toEqual({
      'other 9903.90.08': 553,
      'other 9903.90.09': 127,
      'general 9903.41.05': 55,
      'general 9903.41.10': 24,
      'general 9903.27.09': 1,
      'general 9903.55.01': 1,
      'general 9903.88.04': 1,
      'general 9903.91.08': 1,
      'desc 9903.88.04': 4,
      'desc 9903.52.00–9903.52.26': 3,
    });
    expect(br.counts.footnoteRefs['desc 9904.52.01–9904.52.34']).toBe(1);
    expect(br.counts.footnoteRefs['desc 9904.52.35–9904.52.50']).toBe(2);
  });

  it('G9: the official General text of every verified row re-parses to that row\'s stored MFN', () => {
    for (const r of loadVerifiedRates().rows) {
      const parsed = br.rateRows[br.codes[r.hts10]!.r!]!;
      const mfn = toEngineMfn(parsed);
      expect(mfn, `${r.id}: ${parsed.text}`).not.toBeNull();
      if (r.mfn.type === 'free' || r.mfn.type === 'ad_valorem') expect(mfn, r.id).toEqual(r.mfn);
      else expect(mfn, r.id).toMatchObject({ type: r.mfn.type, components: r.mfn.components });
    }
  });
});
