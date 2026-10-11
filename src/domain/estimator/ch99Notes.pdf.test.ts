// Local only: the full Rev 20 and Rev 21 Chapter 99 PDFs (gitignored data/source/hts/) through pdftotext. Skipped when the
// PDFs or pdftotext are missing (CI). Pins the whole-document structure and checks the extractor against the known
// Rev 20 → Rev 21 change (HTS_VERIFICATION_SPEC §8.5: the Ch. 99 text differs only in note 20(vvv)(i)(20)).
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { extractNote52, segmentNotes, type Ch99Notes } from './ch99Notes';
import { stripPageFurniture } from './ch99Text';
import { buildMentions, mentionsOf } from './mentions';

const SRC = join(process.cwd(), 'data', 'source', 'hts');
const PDF = (rev: number) => join(SRC, `ch99-2026-rev${rev}.pdf`);
const hasPdftotext = spawnSync('pdftotext', ['-v']).status !== null;
const local = hasPdftotext && existsSync(PDF(20)) && existsSync(PDF(21));

const text = (rev: number) => {
  const r = spawnSync('pdftotext', ['-enc', 'UTF-8', '-layout', PDF(rev), '-'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};
const key = (n: Ch99Notes) => new Map(n.subdivisions.map((s) => [`${s.section} ${s.path}`, s.sha256]));
const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);

describe.skipIf(!local)('Chapter 99 notes — the real Rev 20 / Rev 21 PDFs (local only)', () => {
  const rev21 = segmentNotes(stripPageFurniture(text(21)));
  const rev20 = segmentNotes(stripPageFurniture(text(20)));
  const ch99 = (JSON.parse(readFileSync(join(process.cwd(), 'data', 'hts', '2026-rev21-ch99.json'), 'utf8')) as { headings: Record<string, string> }).headings;

  it('subchapter III: notes and deleted notes', () => {
    const iii = rev21.sections.find((s) => s.id === 'III');
    expect(iii).toEqual({ id: 'III', notes: [1, 2, 3, 5, 6, 7, ...range(13, 21), ...range(29, 33), 35, ...range(37, 41), 43, 50, 51, 52], deleted: [4, ...range(8, 12), ...range(22, 28), 36] });
    expect(rev21.revision).toBe('Revision 21 (2026)');
    expect(rev20.revision).toBe('Revision 20 (2026)');
  });

  it('Rev 20 → Rev 21: same subdivisions; the only changed text is in note 20(vvv)(i)', () => {
    const a = key(rev20);
    const b = key(rev21);
    expect([...b.keys()]).toEqual([...a.keys()]);
    const changed = [...b].filter(([k, h]) => a.get(k) !== h).map(([k]) => k);
    expect(changed).toHaveLength(1);
    expect(changed[0]).toMatch(/^III 20\(vvv\)\(i\)/);
  });

  it('note 52 from the full document equals the committed excerpt and passes the heading cross-check', () => {
    const full = extractNote52(rev21, ch99);
    expect(full.problems).toEqual([]);
    const fixture = segmentNotes(stripPageFurniture(readFileSync(join(__dirname, '__fixtures__', 'ch99-rev21-note52.txt'), 'utf8')), {
      startIn: { section: 'III', note: 51 },
    });
    const ex = extractNote52(fixture, ch99);
    expect(full.subdivisions.map((s) => [s.path, s.sha256])).toEqual(ex.subdivisions.map((s) => [s.path, s.sha256]));
  });

  it('mentions index: 52(b) and 52(j)(2) codes map back; the verified watch line is in no note 52 list', () => {
    const idx = buildMentions(rev21, ch99);
    expect(mentionsOf('0712.90.8550', idx)).toContain('note III 52(b)');
    expect(mentionsOf('3823.11.00', idx)).toContain('note III 52(j)(2)');
    expect(mentionsOf('9102.21.70', idx).filter((r) => /^note III 52\([b-j]\)/.test(r))).toEqual([]);
    // the JP leather heading names its lines through "heading 4104 or 4107"
    expect(mentionsOf('4107.11.80', idx)).toContain('heading 9903.41.05');
  });
});
