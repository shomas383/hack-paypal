// Mentions index: every code that a Chapter 99 note subdivision, a Ch. 99 heading's official text, or a line's own Chapter 99
// footnote names → where. Estimator only. Pure. It exists for the coverage rule (gate G7): a line named by a regime the
// estimator doesn't model can't be estimated, so the index errs towards over-matching (a 4-digit heading names every line
// under it, and a line is named when any of its statistical numbers is).
// Keys are digit strings without dots: chapter (2), heading (4), subheading (6), line (8), statistical number (10).
// Refs: "note III 52(b)" (subchapter III, U.S. note 52(b)), "note chapter 1", "heading 9903.41.05" (its text names the line),
// "footnote 9904.02.01–9904.02.37" (the line's own footnote). Chapter 99 headings named in text are not line mentions.
// Not line-specific (kept, but left out by `lineOnly`): chapters named in note text ("additional U.S. note 3 to chapter 2",
// "vehicles of chapter 87", "parts … in chapters 84, 85, or 87" — context or qualifiers there, never a list), and chapter
// ranges covering ≥ BROAD_CHAPTERS chapters ("subheadings in chapters 1 to 97"). In a heading's own text a chapter is the
// scope ("Footwear … provided for in chapter 64", 9903.41.10) and names its lines.
import type { Ch99Footnote } from './baseRates';
import { codeTokens, type Ch99Notes, type CodeTokens } from './ch99Notes';

export interface MentionsIndex {
  revision: string;
  /** Line-specific mentions. */
  byDigits: Record<string, string[]>;
  /** Chapters named in note text (context, not a list). */
  context: Record<string, string[]>;
  /** broad: a chapter range in note text, or one covering ≥ BROAD_CHAPTERS chapters anywhere — not line-specific. */
  ranges: { from: string; to: string; ref: string; broad?: true }[];
}

const digits = (code: string) => code.replace(/\./g, '');
export const BROAD_CHAPTERS = 90;
const span = (a: string, b: string) => Number(b) - Number(a) + 1;

/** Footnote columns that bind column 1 (general) origins; a Column 2 ("other") or Special-only footnote doesn't. */
const appliesToGeneral = (f: Ch99Footnote) => f.columns.length === 0 || f.columns.some((c) => c !== 'other' && c !== 'special');

export function buildMentions(notes: Ch99Notes, ch99Headings: Record<string, string>, footnotes: Record<string, Ch99Footnote[] | undefined> = {}): MentionsIndex {
  const byDigits: Record<string, string[]> = {};
  const context: Record<string, string[]> = {};
  const ranges: MentionsIndex['ranges'] = [];
  const put = (map: Record<string, string[]>, k: string, ref: string) => {
    const refs = (map[k] ??= []);
    if (!refs.includes(ref)) refs.push(ref);
  };
  const add = (ref: string, t: CodeTokens, inNote: boolean) => {
    for (const c of [...t.codes10, ...t.codes8, ...t.codes6, ...t.headings4]) {
      const k = digits(c);
      if (!k.startsWith('99')) put(byDigits, k, ref);
    }
    for (const c of t.chapters) put(inNote ? context : byDigits, c, ref);
    for (const [a, b] of t.ranges) {
      const from = digits(a);
      const to = digits(b);
      const broad = from.length === 2 && to.length === 2 && (inNote || span(from, to) >= BROAD_CHAPTERS);
      ranges.push({ from, to, ref, ...(broad ? { broad: true as const } : {}) });
    }
  };
  for (const s of notes.subdivisions) add(`note ${s.section} ${s.path}`, s, true);
  for (const [h, text] of Object.entries(ch99Headings)) add(`heading ${h}`, codeTokens(text), false);
  for (const [code, fns] of Object.entries(footnotes)) {
    for (const f of fns ?? []) {
      if (!appliesToGeneral(f)) continue;
      for (const h of f.headings) put(byDigits, digits(code), `footnote ${h}`);
      for (const [a, b] of f.ranges) put(byDigits, digits(code), `footnote ${a}–${b}`);
    }
  }
  return { revision: notes.revision, byDigits, context, ranges };
}

/**
 * Every ref naming this code (index form "6203.42.4511" or "9102.21.70"), via itself, any prefix, or a range. Sorted, unique.
 * `lineOnly` leaves out what isn't line-specific (note-text chapters, broad ranges).
 */
export function mentionsOf(code: string, idx: MentionsIndex, opts: { lineOnly?: boolean } = {}): string[] {
  const d = digits(code);
  const out = new Set<string>();
  for (const len of [2, 4, 6, 8, 10]) {
    if (len > d.length) break;
    for (const r of idx.byDigits[d.slice(0, len)] ?? []) out.add(r);
  }
  if (!opts.lineOnly) for (const r of idx.context[d.slice(0, 2)] ?? []) out.add(r);
  // a line is named when one of its statistical numbers is
  if (d.length < 10) for (const [k, refs] of Object.entries(idx.byDigits)) if (k.length > d.length && k.startsWith(d)) for (const r of refs) out.add(r);
  for (const r of idx.ranges) {
    if (opts.lineOnly && r.broad) continue;
    if (d.length >= r.from.length && d.length >= r.to.length && d.slice(0, r.from.length) >= r.from && d.slice(0, r.to.length) <= r.to) out.add(r.ref);
  }
  return [...out].sort();
}
