import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Ch99LayoutError, normaliseText, stripPageFurniture } from './ch99Text';

// Page heads exactly as `pdftotext -enc UTF-8 -layout` prints them for the Rev 21 Ch. 99 PDF (indentation kept).
const TITLE = '                   Harmonized Tariff Schedule of the United States Revision 21 (2026)';
const ANNOT = '                                                                Annotated for Statistical Reporting Purposes';
const head = (n: number, con = 'U.S. Notes (con.)') =>
  [TITLE, '', ANNOT, '', 'XXII', `99 - III - ${n}`, '', con].join('\n');
const page = (n: number, body: string, con?: string) => `\f${head(n, con)}\n\n${body}\n`;

const FIXTURE = readFileSync(join(__dirname, '__fixtures__', 'ch99-rev21-note52.txt'), 'utf8');

describe('stripPageFurniture', () => {
  it('drops the page head and keeps the body, tagged with the printed page number', () => {
    const s = stripPageFurniture(page(406, '(1) As provided in heading 9903.05.96, the duty imposed by heading 9903.05.81 shall not apply'));
    expect(s.revision).toBe('Revision 21 (2026)');
    expect(s.pages).toEqual(['99 - III - 406']);
    expect(s.lines.map((l) => l.text.trim()).filter(Boolean)).toEqual([
      '(1) As provided in heading 9903.05.96, the duty imposed by heading 9903.05.81 shall not apply',
    ]);
    expect(s.lines.every((l) => l.page === '99 - III - 406')).toBe(true);
  });

  it('keeps body text that shares a line with "U.S. Notes (con.)"', () => {
    const s = stripPageFurniture(page(395, '                       0201.10.05    0201.30.04', 'U.S. Notes (con.)                    0201.10.10    0201.10.50'));
    const body = s.lines.map((l) => l.text.trim()).filter(Boolean);
    expect(body).toEqual(['0201.10.10    0201.10.50', '0201.10.05    0201.30.04']);
  });

  it('accepts the head lines in another order and the title and section on one line (real Rev 21 variants)', () => {
    const odd = ['\fHarmonized Tariff Schedule of the United States Revision 21 (2026)', '99 - III - 176', '', ANNOT, 'XXII', 'U.S. Notes (con.)', '', '(a) text'].join('\n');
    const joined = [`\f${TITLE}                                               XXII`, ANNOT, '99 - III - 177', 'U.S. Notes (con.)', '(b) text'].join('\n');
    expect(stripPageFurniture(odd + '\n' + joined).lines.map((l) => l.text.trim()).filter(Boolean)).toEqual(['(a) text', '(b) text']);
  });

  it('subchapter opening pages ("99-III-1" after the SUBCHAPTER title) and table pages (no page number)', () => {
    const opening = [`\f            Harmonized Tariff Schedule of the United States Revision 21 (2026)`, '', ANNOT, '', '            SUBCHAPTER III', '',
      '            TEMPORARY MODIFICATIONS ESTABLISHED PURSUANT TO TRADE LEGISLATION', '', '                    XXII', '                 99-III-1', '', 'U.S. Notes', '1. (a) text'].join('\n');
    const table = [`\f${TITLE}`, '', ANNOT, '', ' Heading/ Stat.            Unit', '9903.01.01 1/ Except for products'].join('\n');
    const s = stripPageFurniture(opening + '\n' + table);
    expect(s.pages).toEqual(['99-III-1', 'pdf page 2']);
    expect(s.lines.map((l) => l.text.trim()).filter(Boolean)).toEqual([
      'SUBCHAPTER III', 'TEMPORARY MODIFICATIONS ESTABLISHED PURSUANT TO TRADE LEGISLATION', 'U.S. Notes', '1. (a) text',
      'Heading/ Stat.            Unit', '9903.01.01 1/ Except for products',
    ]);
  });

  it('reads a whole file as pdftotext writes it (form feed after each page, not before)', () => {
    const whole = `${head(1)}\n(a) one\n\f${head(2)}\n(b) two\n\f`;
    const s = stripPageFurniture(whole);
    expect(s.pages).toEqual(['99 - III - 1', '99 - III - 2']);
    expect(s.lines.map((l) => l.text.trim()).filter(Boolean)).toEqual(['(a) one', '(b) two']);
  });

  it('fails closed on layout surprises', () => {
    // a page that doesn't open with the title (merged pages / a changed layout)
    expect(() => stripPageFurniture(`\f(a) text\n${TITLE}\n${ANNOT}\n`)).toThrow(Ch99LayoutError);
    expect(() => stripPageFurniture(page(400, `(a) text\n${TITLE}`))).toThrow(Ch99LayoutError);
    // a page without the "Annotated …" line
    expect(() => stripPageFurniture(`\f${TITLE}\n99 - III - 400\n(a) text\n`)).toThrow(Ch99LayoutError);
    // two page numbers on one page
    expect(() => stripPageFurniture(page(400, '(a) text\n                99 - III - 401'))).toThrow(Ch99LayoutError);
    // two revisions in one file
    expect(() => stripPageFurniture(page(400, 'a') + page(401, 'b').replace('Revision 21', 'Revision 20'))).toThrow(Ch99LayoutError);
    // no pages at all
    expect(() => stripPageFurniture('')).toThrow(Ch99LayoutError);
  });

  it('reads CRLF text the same as LF', () => {
    const lf = page(406, '(1) text');
    expect(stripPageFurniture(lf.replace(/\n/g, '\r\n'))).toEqual(stripPageFurniture(lf));
  });

  it('strips every head in the committed note 52 excerpt (pages 99-III-393 … 434) and nothing else', () => {
    const s = stripPageFurniture(FIXTURE);
    expect(s.revision).toBe('Revision 21 (2026)');
    expect(s.pages).toEqual(Array.from({ length: 42 }, (_, i) => `99 - III - ${393 + i}`));
    for (const l of s.lines) {
      expect(l.text).not.toMatch(/Harmonized Tariff Schedule|Annotated for Statistical Reporting|99 - III - \d+|U\.S\. Notes \(con\.\)/);
      expect(l.text.trim()).not.toBe('XXII');
    }
    // body survives: every code token of the raw excerpt is still there, same multiset
    const tokens = (t: string) => (t.match(/\b\d{4}\.\d{2}\.\d{2}(?:\d{2})?\b/g) ?? []).sort();
    expect(tokens(s.lines.map((l) => l.text).join('\n'))).toEqual(tokens(FIXTURE));
    expect(s.lines.some((l) => l.text.trim() === '52.')).toBe(true);
  });
});

describe('normaliseText', () => {
  it('folds whitespace and line breaks; keeps quotes, dashes and hyphens', () => {
    expect(normaliseText('  less than 12.5\n   percent, the “Special”  sub-column 9903.05.20–9903.05.84 \n')).toBe(
      'less than 12.5 percent, the “Special” sub-column 9903.05.20–9903.05.84',
    );
  });
});
