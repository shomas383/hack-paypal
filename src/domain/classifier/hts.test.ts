import { describe, expect, it } from 'vitest';
import { buildHtsIndex, type ExportRow } from '../hts/buildIndex';
import { expandHeading, lookupOf, validateHts10 } from './hts';

const STAT_NOTE = [{ value: 'See statistical note 1 to this chapter. ' }];
const row = (htsno: string, indent: number, description: string, extra: Partial<ExportRow> = {}): ExportRow => ({ htsno, indent: String(indent), description, units: [], footnotes: [], ...extra });
const idx = lookupOf(
  buildHtsIndex(
    [
      row('6203', 0, "Men's suits…:"),
      row('6203.42', 1, 'Of cotton:'),
      row('6203.42.40', 2, 'Other'),
      row('6203.42.40.05', 3, 'Bib and brace overalls'),
      row('6203.42.45', 2, 'Other'),
      row('', 3, "Men's trousers and breeches:"),
      row('6203.42.45.06', 4, 'Corduroy (347)'),
      row('6203.42.45.11', 4, 'Blue denim (347)'),
      row('9102', 0, 'Wrist watches…:'),
      row('9102.21', 1, 'With automatic winding:'),
      row('9102.21.50', 2, 'Other', { footnotes: STAT_NOTE }),
      row('9102.21.70', 2, 'With strap…', { footnotes: STAT_NOTE }),
    ],
    { hts_revision: '2026 Rev. 20', source: { url: 'u', exportedOn: 'd' } },
  ),
);

describe('validateHts10 — only real Rev 20 lines', () => {
  it('a 10-digit code in the index is valid, with its chain', () => {
    expect(validateHts10('6203.42.4511', idx)).toEqual({ ok: true, code: '6203.42.4511', componentReporting: false, chain: ["Men's suits…:", 'Of cotton:', 'Other', "Men's trousers and breeches:", 'Blue denim (347)'] });
  });

  it('a component-reporting 8-digit code is valid only as 8 digits', () => {
    expect(validateHts10('9102.21.70', idx)).toMatchObject({ ok: true, code: '9102.21.70', componentReporting: true });
    expect(validateHts10('9102.21.7000', idx)).toEqual({ ok: false, reason: 'INVALID_CODE' });
  });

  it('anything else is INVALID_CODE: not in Rev 20, an 8-digit non-component line, malformed', () => {
    for (const bad of ['6203.42.4011', '6203.42.45', '6203.42', '620342451', 'abc', '6203.42.4511 ']) {
      expect(validateHts10(bad, idx)).toEqual({ ok: false, reason: 'INVALID_CODE' });
    }
  });
});

describe('expandHeading — a 6- or 8-digit heading to its real Rev 20 lines, in HTS order', () => {
  it('6-digit, dotted or not', () => {
    expect(expandHeading('6203.42', idx).map((c) => c.code)).toEqual(['6203.42.4005', '6203.42.4506', '6203.42.4511']);
    expect(expandHeading('620342', idx).map((c) => c.code)).toEqual(['6203.42.4005', '6203.42.4506', '6203.42.4511']);
  });

  it('8-digit', () => {
    expect(expandHeading('6203.42.45', idx).map((c) => c.code)).toEqual(['6203.42.4506', '6203.42.4511']);
    expect(expandHeading('9102.21.70', idx)).toEqual([expect.objectContaining({ code: '9102.21.70', componentReporting: true })]);
  });

  it('carries each line\'s description chain', () => {
    expect(expandHeading('6203.42.45', idx)[1]!.chain.at(-2)).toBe("Men's trousers and breeches:");
  });

  it('unknown or malformed headings expand to nothing (counted as invalid by the caller)', () => {
    for (const h of ['6203.43', '6203.42.41', '6203', '6203.42.4511', 'x']) expect(expandHeading(h, idx)).toEqual([]);
  });
});
