// Mentions index: every code that a Chapter 99 note subdivision or a Ch. 99 heading's official text names → where. Estimator
// only. Pure. It exists for the coverage rule (gate G7): a line named by a regime the estimator doesn't model can't be
// estimated, so the index errs towards over-matching (a 4-digit heading or a chapter names every line under it, and a line
// is named when any of its statistical numbers is).
// Keys are digit strings without dots: chapter (2), heading (4), subheading (6), line (8), statistical number (10).
// Refs: "note III 52(b)" (subchapter III, U.S. note 52(b)), "note chapter 1", "heading 9903.41.05". Chapter 99 headings
// named in the text (9903.05.20–9903.05.84 …) are not line mentions.
import { codeTokens, type Ch99Notes, type CodeTokens } from './ch99Notes';

export interface MentionsIndex {
  revision: string;
  byDigits: Record<string, string[]>;
  ranges: { from: string; to: string; ref: string }[];
}

const digits = (code: string) => code.replace(/\./g, '');

export function buildMentions(notes: Ch99Notes, ch99Headings: Record<string, string>): MentionsIndex {
  const byDigits: Record<string, string[]> = {};
  const ranges: MentionsIndex['ranges'] = [];
  const add = (ref: string, t: CodeTokens) => {
    for (const c of [...t.codes10, ...t.codes8, ...t.codes6, ...t.headings4, ...t.chapters]) {
      const k = digits(c);
      if (k.startsWith('99') && k.length > 2) continue;
      const refs = (byDigits[k] ??= []);
      if (!refs.includes(ref)) refs.push(ref);
    }
    for (const [a, b] of t.ranges) ranges.push({ from: digits(a), to: digits(b), ref });
  };
  for (const s of notes.subdivisions) add(`note ${s.section} ${s.path}`, s);
  for (const [h, text] of Object.entries(ch99Headings)) add(`heading ${h}`, codeTokens(text));
  return { revision: notes.revision, byDigits, ranges };
}

/** Every ref naming this code (index form "6203.42.4511" or "9102.21.70"), via itself, any prefix, or a range. Sorted, unique. */
export function mentionsOf(code: string, idx: MentionsIndex): string[] {
  const d = digits(code);
  const out = new Set<string>();
  for (const len of [2, 4, 6, 8, 10]) {
    if (len > d.length) break;
    for (const r of idx.byDigits[d.slice(0, len)] ?? []) out.add(r);
  }
  // a line is named when one of its statistical numbers is
  for (const [k, refs] of Object.entries(idx.byDigits)) if (k.length > d.length && k.startsWith(d)) for (const r of refs) out.add(r);
  for (const r of idx.ranges) {
    if (d.length >= r.from.length && d.length >= r.to.length && d.slice(0, r.from.length) >= r.from && d.slice(0, r.to.length) <= r.to) out.add(r.ref);
  }
  return [...out].sort();
}
