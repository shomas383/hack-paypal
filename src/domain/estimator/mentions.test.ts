import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { segmentNotes } from './ch99Notes';
import { stripPageFurniture, type StrippedText } from './ch99Text';
import { buildMentions, mentionsOf } from './mentions';

// Note text is real Rev 21 text, cut down; headings are their real Rev 21 text, cut down.
const doc = (lines: string[]): StrippedText => ({ revision: 'Revision 21 (2026)', pages: ['p1'], lines: lines.map((text) => ({ page: 'p1', text })) });
const notes = segmentNotes(doc([
  'SUBCHAPTER III', 'U.S. Notes', '52.',
  '(b) As provided in heading 9903.05.86, the duties imposed by headings 9903.05.20–9903.05.84 shall not apply to articles',
  '                       0712.32.00    0712.90.8550  0713.10.10',
  '(j)',
  '(2) As provided in heading 9903.05.97, the duties imposed by headings 9903.05.38–9903.05.39 shall not apply to articles',
  '                   3823.11.00  3823.12.00  3823.19.20',
  '53. (a) synthetic: assemblies of the goods of subheading 8504.40 for telecommunication; vehicles of headings 8701 to 8705',
]));
const headings = {
  '9903.41.05': 'Bovine (including buffalo) and equine leather (provided for in heading 4104 or 4107); goat, kid, sheep and lamb leather, the foregoing dyed, colored, stamped or embossed (provided for in heading 4105, 4106, 4112 or 4113)',
  '9903.41.10': 'Footwear with outer soles of leather and uppers wholly or in part of leather, … the foregoing provided for in chapter 64',
  '9903.05.86': 'Articles provided for in subdivision (b) of U.S. note 52 to this subchapter',
};
const idx = buildMentions(notes, headings);

describe('buildMentions / mentionsOf', () => {
  it('a 10-digit mention names only that statistical number', () => {
    expect(mentionsOf('0712.90.8550', idx)).toEqual(['note III 52(b)']);
    expect(mentionsOf('0712.90.8510', idx)).toEqual([]);
  });

  it('an 8-digit line names its statistical numbers, and a line is named by any of its statistical numbers', () => {
    expect(mentionsOf('3823.11.0000', idx)).toEqual(['note III 52(j)(2)']);
    expect(mentionsOf('3823.11.00', idx)).toEqual(['note III 52(j)(2)']);
    expect(mentionsOf('0712.90.85', idx)).toEqual(['note III 52(b)']); // one of its numbers is exempt: the line is named
  });

  it('6-digit subheadings, 4-digit headings, chapters and heading ranges name every line under them', () => {
    expect(mentionsOf('8504.40.9580', idx)).toEqual(['note III 53(a)']);
    expect(mentionsOf('4107.11.8000', idx)).toEqual(['heading 9903.41.05']);
    expect(mentionsOf('4108.00.0000', idx)).toEqual([]);
    expect(mentionsOf('6403.59.6000', idx)).toEqual(['heading 9903.41.10']);
    expect(mentionsOf('8701.10.0000', idx)).toEqual(['note III 53(a)']);
    expect(mentionsOf('8705.10.0010', idx)).toEqual(['note III 53(a)']);
    expect(mentionsOf('8706.00.0000', idx)).toEqual([]);
  });

  it('Chapter 99 headings named in the text are not line mentions; a line with no mention gets []', () => {
    expect(mentionsOf('9903.05.20', idx)).toEqual([]);
    expect(mentionsOf('9102.21.70', idx)).toEqual([]);
    expect(idx.revision).toBe('Revision 21 (2026)');
  });

  it('several refs come back sorted and unique', () => {
    const both = buildMentions(notes, { ...headings, '9903.99.99': 'synthetic: articles of subheading 0712.90 and 0712.90.8550' });
    expect(mentionsOf('0712.90.8550', both)).toEqual(['heading 9903.99.99', 'note III 52(b)']);
  });

  it('the committed note 52 excerpt: every 52(j)(2) code maps back to 52(j)(2)', () => {
    const fx = segmentNotes(stripPageFurniture(readFileSync(join(__dirname, '__fixtures__', 'ch99-rev21-note52.txt'), 'utf8')), {
      startIn: { section: 'III', note: 51 },
    });
    const i = buildMentions(fx, {});
    const j2 = fx.subdivisions.find((s) => s.path === '52(j)(2)')!;
    expect(j2.codes8).toHaveLength(43);
    for (const c of j2.codes8) expect(mentionsOf(c, i)).toContain('note III 52(j)(2)');
    expect(mentionsOf('9102.21.70', i).filter((r) => /^note III 52\(/.test(r))).toEqual([]);
  });
});
