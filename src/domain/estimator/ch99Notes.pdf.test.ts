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

  // The nine out-of-sequence labels of the official numbering (pinned 2026-10-11), each resolved by NUMBERING_FIXES: six
  // are inline enumerations or wrapped text that stay in their subdivision; "(II)" is 20(ll); two item numbers are printed
  // twice. Nothing is left out of sequence, so no list code is in doubt.
  it('every numbering oddity is resolved explicitly; none is left out of sequence (Rev 20 and Rev 21)', () => {
    for (const n of [rev20, rev21]) {
      expect(n.ignoredMarkers.filter((m) => m.why === 'out_of_sequence')).toEqual([]);
      expect(n.numbering.unmatched).toEqual([]);
    }
    expect(rev21.numbering.applied.map((a) => [a.note, a.kind, a.path])).toEqual([
      [17, 'inline_text', '17(c)(2)(B)(iii)'],
      [20, 'inline_text', '20(a)'],
      [20, 'inline_text', '20(a)'],
      [20, 'inline_text', '20(r)'],
      [20, 'inline_text', '20(r)'],
      [20, 'relabel', '20(ll)'],
      [20, 'duplicate', '20(ll)(62bis)'],
      [20, 'duplicate', '20(ttt)(iii)(180bis)'],
      [40, 'inline_text', '40(i)'],
    ]);
    expect(rev21.ignoredMarkers.filter((m) => m.why === 'inline_text')).toHaveLength(6);
    expect(rev21.ignoredMarkers.filter((m) => m.why === 'reference')).toHaveLength(13);
    expect(rev21.ignoredMarkers.filter((m) => m.why === 'not_a_label')).toHaveLength(16);
    // (ll) is its own subdivision again: (gg) keeps only its derived-rate text; heading 9903.88.33 cites 20(ll)
    const gg = rev21.subdivisions.find((s) => s.section === 'III' && s.path === '20(gg)')!;
    expect(gg.text).toMatch(/^For purposes of heading 9903\.88\.28,.*heading 9903\.88\.15\.$/);
    expect(rev21.subdivisions.find((s) => s.section === 'III' && s.path === '20(ll)')!.text).toMatch(/^The U\.S\. Trade Representative.*\[Compiler's note: expired\.\]$/);
    expect(rev21.subdivisions.find((s) => s.section === 'III' && s.path === '20(ll)(62bis)')!.codes10).toEqual(['8544.42.9090']);
    expect(rev21.subdivisions.find((s) => s.section === 'III' && s.path === '20(ttt)(iii)(180bis)')!.codes10).toEqual(['9403.20.0090']);
  });

  it('note 20 list sizes (deduplicated; every code a Rev 21 line, chapter 98 apart)', () => {
    const codes = (path: string) => {
      const subs = rev21.subdivisions.filter((s) => s.section === 'III' && (s.path === path || s.path.startsWith(`${path}(`)));
      return { codes8: new Set(subs.flatMap((s) => s.codes8)).size, codes10: new Set(subs.flatMap((s) => s.codes10)).size };
    };
    expect(codes('20(b)')).toEqual({ codes8: 856, codes10: 0 });
    expect(codes('20(d)')).toEqual({ codes8: 283, codes10: 0 });
    expect(codes('20(f)')).toEqual({ codes8: 5906, codes10: 0 });
    expect(codes('20(s)(i)')).toEqual({ codes8: 2958, codes10: 0 });
    expect(codes('20(u)')).toEqual({ codes8: 546, codes10: 36 });
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
