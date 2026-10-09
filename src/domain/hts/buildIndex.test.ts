import { describe, expect, it } from 'vitest';
import { buildCh99Lookup, buildHtsIndex, chainsOf, type ExportRow } from './buildIndex';

const STAT_NOTE = [{ columns: ['stat', 'units'], value: 'See statistical note 1 to this chapter. ', type: 'endnote' }];
// Shaped like the hts.usitc.gov exportList JSON, including rate fields that must never reach the index.
const row = (htsno: string, indent: number, description: string, extra: Partial<ExportRow> & Record<string, unknown> = {}): ExportRow =>
  ({ htsno, indent: String(indent), description, superior: htsno ? null : 'true', units: [], general: '', special: '', other: '', footnotes: [], ...extra }) as ExportRow;

const sample: ExportRow[] = [
  row('6203', 0, "Men's or boys' suits…:"),
  row('6203.42', 1, 'Of cotton:'),
  row('6203.42.45', 2, 'Other', { general: '16.6%', special: 'Free (AU)', other: '90%' }),
  row('', 3, 'Other:'),
  row('', 5, "Men's trousers and breeches:"), // skips indent 4: attaches to the nearest shallower row ("Other:")
  row('6203.42.45.11', 6, 'Blue denim (347)', { units: ['doz.', 'kg'] }),
  row('6203.42.45.06', 6, 'Corduroy (347)', { units: ['doz.', 'kg'] }),
  row('9102', 0, 'Wrist watches…:'),
  row('9102.21', 1, 'With automatic winding:'),
  row('', 2, 'Having over 17 jewels in the movement:'),
  row('9102.21.70', 3, 'With strap, band or bracelet of textile material or of base metal…', { footnotes: STAT_NOTE, general: '$1.53 + 4.2%' }),
  row('9102.21.90', 3, 'Other', { footnotes: [] }), // a leaf WITHOUT the note → not a code
  row('9801', 0, 'Products of the United States when returned…'),
  row('9801.00.10.98', 1, 'Other', { units: ['X'] }),
  row('9903', 0, 'Additional duties…'),
  row('9903.05.49', 1, 'Japan…'),
];

describe('buildCh99Lookup — official Chapter 99 subchapter III heading text, description only', () => {
  const rows = [
    row('9903', 0, 'Subchapter III…'),
    row('9903.05.49', 1, 'Except for products described in headings 9903.05.85–9903.05.92, articles the product of Japan, … as provided for in U.S. note 52 to this subchapter', { general: 'The duty provided in the applicable subheading + 12.5%' }),
    row('9903.05.48.00', 1, 'not an 8-digit heading'),
    row('9902.12.34', 1, 'subchapter II — not included'),
    row('6203.42.45.11', 1, 'Blue denim (347)'),
  ];
  const lookup = buildCh99Lookup(rows, { hts_revision: '2026 Rev. 20', source: { url: 'u', exportedOn: 'd' } });

  it('keeps 9903.xx.xx headings with their official description, verbatim', () => {
    expect(lookup.headings).toEqual({ '9903.05.49': rows[1]!.description });
    expect(lookup.hts_revision).toBe('2026 Rev. 20');
  });

  it('never carries rate columns or rate text', () => {
    expect(JSON.stringify(lookup)).not.toMatch(/"general"|12\.5%|applicable subheading/);
  });
});

describe('buildHtsIndex', () => {
  const idx = buildHtsIndex(sample, { hts_revision: '2026 Rev. 20', source: { url: 'u', exportedOn: '2026-10-07' } });
  const chains = chainsOf(idx);

  it('normalises dotted 10-digit codes and keeps their description chain, unnumbered parents included', () => {
    expect(chains.get('6203.42.4511')).toEqual(["Men's or boys' suits…:", 'Of cotton:', 'Other', 'Other:', "Men's trousers and breeches:", 'Blue denim (347)']);
    expect(idx.codes.find((c) => c.c === '6203.42.4511')?.u).toEqual(['doz.', 'kg']);
  });

  it('a skipped indent attaches to the nearest shallower row above it', () => {
    expect(chains.get('6203.42.4506')?.at(-2)).toBe("Men's trousers and breeches:");
  });

  it('unnumbered rows are chain nodes, never codes', () => {
    expect(idx.codes.map((c) => c.c)).not.toContain('');
    expect(idx.codes.every((c) => /^\d{4}\.\d{2}\.\d{2}(\d{2})?$/.test(c.c))).toBe(true);
  });

  it('an 8-digit leaf with "See statistical note 1 to this chapter" is an 8-digit code with componentReporting', () => {
    expect(idx.codes.find((c) => c.c === '9102.21.70')).toMatchObject({ componentReporting: true });
    expect(chains.get('9102.21.70')).toContain('Having over 17 jewels in the movement:');
  });

  it('other leaf 8-digit lines, and 8-digit lines with 10-digit children, are not codes; no …00 is invented', () => {
    const codes = idx.codes.map((c) => c.c);
    expect(codes).not.toContain('9102.21.90');
    expect(codes).not.toContain('6203.42.45');
    expect(codes).not.toContain('9102.21.7000');
  });

  it('excludes chapters 98 and 99 entirely (codes and their nodes)', () => {
    expect(idx.codes.some((c) => /^9[89]/.test(c.c))).toBe(false);
    expect(idx.nodes.some((n) => /returned|Additional duties/.test(n.d))).toBe(false);
  });

  it('never carries rate fields or rate text', () => {
    const text = JSON.stringify(idx);
    for (const k of ['general', 'special', 'other', 'additionalDuties', 'footnotes', 'quotaQuantity']) expect(text).not.toContain(`"${k}"`);
    expect(text).not.toMatch(/16\.6%|Free \(AU\)|90%|\$1\.53/);
    expect(idx.hts_revision).toBe('2026 Rev. 20');
  });

  it('fails on a non-integer indent, a first row not at indent 0, or a duplicate code', () => {
    const meta = { hts_revision: 'r', source: { url: 'u', exportedOn: 'd' } };
    expect(() => buildHtsIndex([row('6203', 0, 'a'), row('6203.42', 1.5, 'b')], meta)).toThrow(/indent/);
    expect(() => buildHtsIndex([row('6203', 1, 'a')], meta)).toThrow(/first row/);
    expect(() => buildHtsIndex([row('6203', 0, 'a'), row('6203.42.45.11', 1, 'x'), row('6203.42.45.11', 1, 'y')], meta)).toThrow(/duplicate/);
  });
});
