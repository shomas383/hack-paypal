// Mentions index: every code that a Chapter 99 note subdivision or a Ch. 99 heading's official text names → where. Estimator
// only. Pure. It exists for the coverage rule (gate G7): a line named by a regime the estimator doesn't model can't be
// estimated, so the index errs towards over-matching (a 4-digit heading or a chapter names every line under it).
// Keys are digit strings without dots: chapter (2), heading (4), subheading (6), line (8), statistical number (10).
// Refs: "note III 52(b)" (subchapter III, U.S. note 52(b)), "note chapter 1", "heading 9903.41.05".
import type { Ch99Notes } from './ch99Notes';

export interface MentionsIndex {
  revision: string;
  byDigits: Record<string, string[]>;
  ranges: { from: string; to: string; ref: string }[];
}

export function buildMentions(notes: Ch99Notes, ch99Headings: Record<string, string>): MentionsIndex {
  void notes;
  void ch99Headings;
  throw new Error('not implemented');
}

/** Every ref naming this code (index form "6203.42.4511" or "9102.21.70"), via itself, any prefix, or a range. Sorted, unique. */
export function mentionsOf(code: string, idx: MentionsIndex): string[] {
  void code;
  void idx;
  throw new Error('not implemented');
}
