// Chapter 99 U.S. notes → subdivisions with the codes they name. Estimator only. Pure (input: stripPageFurniture output).
// - Sections: the chapter's own U.S. notes ("chapter") and statistical notes ("chapter-stat"), then each subchapter's
//   U.S. notes (id = its roman numeral), from the "U.S. Notes" line to the first tariff table ("Heading/ Stat.").
// - A note starts at a line "N." whose N is above the current note by at most 10 (numbered lists inside a note restart at 1;
//   notes 34, 42, 44–49 of subchapter III are simply absent). "[U.S. note N deleted]" is recorded as deleted.
// - Subdivision markers "(a)", "(1)", "(i)", "(A)" (several may open one line) are recognised only at a line start and only
//   when they continue an open list or start a new one; "(i)", "(v)", "(x)", "(ii)" … can be a letter or a roman numeral,
//   resolved by which successor comes first among the following markers. Any other line-start marker is text.
// - Each subdivision keeps only its own text (children are separate), whitespace-folded, with its sha256.
// - Code tokens: 10-digit statistical numbers (dddd.dd.dddd), 8-digit lines, 6-digit subheadings, 4-digit headings (only in
//   "heading(s) …" phrases and in lines made only of codes), chapters ("chapter(s) N"), ranges, and Ch. 99 headings.

export interface CodeTokens {
  codes10: string[];
  /** 8-digit lines, chapter 99 excluded (those are in ch99). */
  codes8: string[];
  codes6: string[];
  headings4: string[];
  chapters: string[];
  /** Ranges of non-99 codes / headings / chapters, as written ("8701", "8705"). */
  ranges: [string, string][];
  ch99: string[];
  ch99Ranges: [string, string][];
}

export interface Subdivision extends CodeTokens {
  /** "chapter", "chapter-stat", or the subchapter's roman numeral ("III"). */
  section: string;
  note: number;
  /** "52(j)(2)"; a note's own text before its first marker is the bare number ("52"). */
  path: string;
  /** Page where it starts. */
  page: string;
  text: string;
  sha256: string;
  /** The opening "As provided in heading(s) …" clause, if any. */
  asProvidedIn: { headings: string[]; ranges: [string, string][] };
  /** The text says "shall not apply" (an exemption from some heading). */
  shallNotApply: boolean;
}

export interface Ch99Notes {
  revision: string;
  sections: { id: string; notes: number[]; deleted: number[] }[];
  subdivisions: Subdivision[];
  /** Line-start markers read as text (neither a continuation nor a new list). */
  ignoredMarkers: { page: string; text: string }[];
}

export interface SegmentOptions {
  /** For an excerpt that starts inside a section's notes: the section and the note open at its first line. */
  startIn?: { section: string; note: number };
}

export function codeTokens(text: string): CodeTokens {
  void text;
  throw new Error('not implemented');
}

export function segmentNotes(s: import('./ch99Text').StrippedText, opts: SegmentOptions = {}): Ch99Notes {
  void s;
  void opts;
  throw new Error('not implemented');
}

export interface Note52 {
  revision: string;
  /** Every subdivision of subchapter III note 52, in document order. */
  subdivisions: Subdivision[];
  /** Exemption heading (9903.05.86 …) → the subdivision that defines it ("As provided in heading …" + "shall not apply"). */
  exemptions: Record<string, Subdivision>;
  /** 52(k): the AVE rule and the 10% / 12.5% caps. */
  k: Subdivision;
  /** Cross-check against the official heading text ("subdivision (x) of U.S. note 52"); empty when consistent. */
  problems: string[];
}

export function extractNote52(notes: Ch99Notes, ch99Headings: Record<string, string>): Note52 {
  void notes;
  void ch99Headings;
  throw new Error('not implemented');
}
