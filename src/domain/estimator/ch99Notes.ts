// Chapter 99 U.S. notes → subdivisions with the codes they name. Estimator only. Pure (input: stripPageFurniture output).
// - Sections: the chapter's own U.S. notes ("chapter") and statistical notes ("chapter-stat"), then each subchapter's
//   U.S. notes (id = its roman numeral), from the "U.S. Notes" line to the first tariff table ("Heading/ Stat.").
// - A note starts at a line "N." whose N is above the current note by at most 10 (numbered lists inside a note restart at 1;
//   notes 34, 42, 44–49 of subchapter III are simply absent); a section's first note may have any number. "[U.S. note N deleted]" and "N. [Note deleted.]" are recorded as deleted.
// - Subdivision markers "(a)", "(1)", "(i)", "(A)" (several may open one line) are recognised only at a line start and only
//   when they continue an open list or start a new one; "(i)", "(v)", "(x)", "(ii)" … can be a letter or a roman numeral,
//   resolved by which successor comes first among the following markers. Any other line-start marker is text.
// - Each subdivision keeps only its own text (children are separate), whitespace-folded, with its sha256.
// - Code tokens: 10-digit statistical numbers (dddd.dd.dddd), 8-digit lines, 6-digit subheadings, 4-digit headings (only in
//   "heading(s) …" phrases and in lines made only of codes), chapters ("chapter(s) N"), ranges, and Ch. 99 headings.
import { createHash } from 'node:crypto';
import { normaliseText, type PdfLine, type StrippedText } from './ch99Text';

export interface CodeTokens {
  codes10: string[];
  /** 8-digit lines, chapter 99 excluded (those are in ch99). */
  codes8: string[];
  codes6: string[];
  headings4: string[];
  chapters: string[];
  /** Ranges of non-99 codes / headings / chapters, as written ("8701", "8705"); chapters padded to 2 digits. */
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
  ignoredMarkers: IgnoredMarker[];
}

export interface IgnoredMarker {
  section: string;
  note: number;
  /** The subdivision whose text the line was kept in. */
  path: string;
  page: string;
  text: string;
  /**
   * reference: a wrapped cross-reference ("(o) of this note"); not_a_label: an acronym such as "(ABS)"; out_of_sequence:
   * a real-looking label that neither continues nor opens a list (an oddity of the official numbering — its text, and the
   * codes in it, stay in the previous subdivision).
   */
  why: 'reference' | 'not_a_label' | 'out_of_sequence';
}

export interface SegmentOptions {
  /** For an excerpt that starts inside a section's notes: the section and the note open at its first line. */
  startIn?: { section: string; note: number };
}

// ---------------------------------------------------------------------------------------------------------------- tokens

const CH99 = String.raw`99\d{2}\.\d{2}\.\d{2}`;
const DASH = String.raw`\s*(?:–|-|through|to)\s*`;
const CH99_RANGE = new RegExp(String.raw`\b(${CH99})${DASH}(${CH99})\b`, 'g');
const DOTTED = String.raw`\d{4}\.\d{2}(?:\.\d{2}(?:\d{2})?)?`;
const DOTTED_RANGE = new RegExp(String.raw`\b(${DOTTED})${DASH}(${DOTTED})(?!\.?\d)`, 'g');
const CODE10 = /\b(\d{4}\.\d{2}\.\d{4})(?!\.?\d)/g;
const CODE8 = /\b(\d{4}\.\d{2}\.\d{2})(?!\.?\d)/g;
const CODE6 = /\b(\d{4}\.\d{2})(?!\.?\d)/g;
const CODE_ONLY_LINE = /^\s*\d{4}(?:\.\d{2}(?:\.\d{2}(?:\d{2})?)?)?(?:\s+\d{4}(?:\.\d{2}(?:\.\d{2}(?:\d{2})?)?)?)*\s*$/;
const SEP = /^(?:\s*,\s*(?:and\s+|or\s+)?|\s+(?:and|or)\s+)/;

const uniq = <T>(xs: T[], key: (x: T) => string = String) => {
  const seen = new Set<string>();
  return xs.filter((x) => (seen.has(key(x)) ? false : (seen.add(key(x)), true)));
};

/** "heading(s) 4104, 4106 or 4112" / "headings 8701 to 8705" / "chapters 72 and 73": the items after the keyword. */
function listAfter(text: string, keyword: RegExp, item: string): { singles: string[]; ranges: [string, string][] } {
  const singles: string[] = [];
  const ranges: [string, string][] = [];
  const itemRange = new RegExp(String.raw`^(${item})${DASH}(${item})(?!\d)(?!\.\d)`);
  const itemOne = new RegExp(String.raw`^(${item})(?!\d)(?!\.\d)`);
  for (const m of text.matchAll(keyword)) {
    let rest = text.slice(m.index + m[0].length);
    for (;;) {
      const r = itemRange.exec(rest);
      const o = r ? null : itemOne.exec(rest);
      if (r) ranges.push([r[1]!, r[2]!]);
      else if (o) singles.push(o[1]!);
      else break;
      rest = rest.slice((r ?? o)![0].length);
      const sep = SEP.exec(rest);
      if (!sep) break;
      rest = rest.slice(sep[0].length);
    }
  }
  return { singles, ranges };
}

export function codeTokens(text: string): CodeTokens {
  const ch99Ranges = [...text.matchAll(CH99_RANGE)].map((m) => [m[1]!, m[2]!] as [string, string]);
  let t = text.replace(CH99_RANGE, ' ');
  const ch99 = (t.match(new RegExp(String.raw`\b${CH99}(?!\.?\d)`, 'g')) ?? []);
  t = t.replace(new RegExp(String.raw`\b${CH99}(?!\.?\d)`, 'g'), ' ');

  const ranges: [string, string][] = [...t.matchAll(DOTTED_RANGE)].map((m) => [m[1]!, m[2]!]);
  t = t.replace(DOTTED_RANGE, ' ');

  const codes10 = [...t.matchAll(CODE10)].map((m) => m[1]!).filter((c) => !c.startsWith('99'));
  const codes8 = [...t.matchAll(CODE8)].map((m) => m[1]!);
  const codes6 = [...t.matchAll(CODE6)].map((m) => m[1]!).filter((c) => !c.startsWith('99'));

  const h = listAfter(t, /\bheadings?\s+/g, String.raw`\d{4}`);
  const headings4 = [...h.singles];
  for (const line of t.split('\n')) {
    if (CODE_ONLY_LINE.test(line)) headings4.push(...line.trim().split(/\s+/).filter((x) => /^\d{4}$/.test(x)));
  }
  ranges.push(...h.ranges);
  const c = listAfter(t, /\bchapters?\s+/g, String.raw`\d{1,2}`);
  const pad = (s: string) => s.padStart(2, '0');
  ranges.push(...c.ranges.map(([a, b]) => [pad(a), pad(b)] as [string, string]));

  const pair = (r: [string, string]) => r.join('|');
  return {
    codes10: uniq(codes10),
    codes8: uniq(codes8),
    codes6: uniq(codes6),
    headings4: uniq(headings4),
    chapters: uniq(c.singles.map(pad)),
    ranges: uniq(ranges, pair),
    ch99: uniq(ch99),
    ch99Ranges: uniq(ch99Ranges, pair),
  };
}

// ---------------------------------------------------------------------------------------------------------- markers

// 'double': US Code style (aa), (bb) … as their own level (subchapter III notes on cotton and on washers); note 20 instead
// continues (z) → (aa) → … (zzz) as 'lower'.
type Kind = 'lower' | 'double' | 'roman' | 'digit' | 'upper' | 'upperRoman';
const ROMAN: [string, number][] = [['l', 50], ['xl', 40], ['x', 10], ['ix', 9], ['v', 5], ['iv', 4], ['i', 1]];
const toRoman = (n: number) => {
  let out = '';
  for (const [s, v] of ROMAN) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
};
const romanValue = (s: string): number | null => {
  let n = 0;
  let rest = s;
  for (const [sym, v] of ROMAN) {
    while (rest.startsWith(sym)) {
      n += v;
      rest = rest.slice(sym.length);
    }
  }
  return rest === '' && n > 0 && toRoman(n) === s ? n : null;
};
const repeatOrd = (s: string, base: string) => (/^(.)\1*$/.test(s) ? (s.length - 1) * 26 + (s.charCodeAt(0) - base.charCodeAt(0)) + 1 : null);

/** Every reading of a marker label: kind → ordinal (1 = first of its list). */
function readings(label: string): [Kind, number][] {
  const out: [Kind, number][] = [];
  if (/^\d+$/.test(label)) out.push(['digit', Number(label)]);
  if (/^[a-z]+$/.test(label)) {
    const l = repeatOrd(label, 'a');
    if (l !== null) out.push(['lower', l]);
    if (/^([a-z])\1$/.test(label)) out.push(['double', label.charCodeAt(0) - 96]);
    const r = romanValue(label);
    if (r !== null) out.push(['roman', r]);
  }
  if (/^[A-Z]+$/.test(label)) {
    const u = repeatOrd(label, 'A');
    if (u !== null) out.push(['upper', u]);
    const r = romanValue(label.toLowerCase());
    if (r !== null) out.push(['upperRoman', r]);
  }
  return out;
}

const LEAD_MARKER = /^\(([a-z]{1,4}|\d{1,3}|[A-Z]{1,4})\)\s*/;
/** A wrapped cross-reference, not a subdivision: "(o) of this note", "(vvv) and (www)of …", "(c), (h), …", "(C)” appears". */
const REFERENCE_TAIL = /^(?:of|to|and|or|through)\b|^[”"’,;:.)]/;

/** Leading markers of a line, with the text after each; `reference` when they are a wrapped cross-reference. */
function leadingMarkers(text: string): { markers: { label: string; rest: string }[]; reference: boolean } {
  const markers: { label: string; rest: string }[] = [];
  let rest = text.trimStart();
  for (let m = LEAD_MARKER.exec(rest); m; m = LEAD_MARKER.exec(rest)) {
    rest = rest.slice(m[0].length);
    markers.push({ label: m[1]!, rest });
  }
  return { markers, reference: markers.length > 0 && REFERENCE_TAIL.test(rest) };
}

interface Level {
  kind: Kind;
  ord: number;
  label: string;
}
/** Deleted subdivisions leave no trace in the text (note 2 of subchapter III runs (c) → (j), (m) → (s)). */
const MAX_LABEL_GAP = 10;
type Move = { type: 'advance'; depth: number; kind: Kind; ord: number; gap: number } | { type: 'push'; kind: Kind; gap: 0 };

/**
 * A skip from label L to o is believed unless a skipped label (L, o) of that kind turns up later before o's successor does
 * ("(p) of this note" wrapped inside (f), followed by the real (g), is not a skip to (p)).
 */
function skipHolds(kind: Kind, from: number, to: number, later: string[]): boolean {
  for (const label of later) {
    for (const [k, o] of readings(label)) {
      if (k !== kind) continue;
      if (o === to + 1) return true;
      if (o > from && o < to) return false;
    }
  }
  return true;
}

/** Possible moves, innermost first: continue an open list (exact successor, or skipping ≤ MAX_LABEL_GAP labels) or open one. */
function moves(label: string, stack: Level[], later: string[]): Move[] {
  const rs = readings(label);
  const out: Move[] = [];
  for (let d = stack.length - 1; d >= 0; d--) {
    for (const [k, o] of rs) {
      const { kind, ord } = stack[d]!;
      const gap = o - ord - 1;
      if (kind !== k || gap < 0 || gap > MAX_LABEL_GAP) continue;
      if (gap > 0 && !skipHolds(k, ord, o, later)) continue;
      out.push({ type: 'advance', depth: d, kind: k, ord: o, gap });
    }
  }
  const inner = stack.at(-1)?.kind;
  for (const [k, o] of rs) if (o === 1 && k !== inner) out.push({ type: 'push', kind: k, gap: 0 });
  return out;
}

const successorOf = (m: Move) => ({ kind: m.kind, ord: m.type === 'advance' ? m.ord + 1 : 2 });

/**
 * Pick among ambiguous moves by whose successor label appears first among the later markers of the note; with no
 * evidence, an exact successor, then a new list, then the smallest skip.
 */
function choose(cands: Move[], later: string[]): Move {
  if (cands.length === 1) return cands[0]!;
  for (const label of later) {
    const rs = readings(label);
    for (const c of cands) {
      const s = successorOf(c);
      if (rs.some(([k, o]) => k === s.kind && o === s.ord)) return c;
    }
  }
  const rank = (m: Move) => (m.gap > 0 ? 2 + m.gap : m.type === 'advance' ? 0 : 1);
  return [...cands].sort((a, b) => rank(a) - rank(b))[0]!;
}

// ------------------------------------------------------------------------------------------------------- segmentation

const SUBCHAPTER = /^SUBCHAPTER ([IVXL]+)$/;
const SUBCHAPTER_DELETED = /^\[SUBCHAPTER [IVXL]+ deleted\]$/;
const US_NOTES = /^U\.S\. Notes$/;
const STAT_NOTES = /^Statistical Notes$/;
const TABLE = /^Heading\/ Stat\./;
const NOTE_START = /^(\d{1,3})\.(?:\s+(.*))?$/;
const NOTE_DELETED = /^\[U\.S\. note (\d+) deleted\]$/;
/** "36. [Note deleted.]" */
const NOTE_DELETED_INLINE = /^\[Note deleted\.?\]$/;
const MAX_NOTE_GAP = 10;

interface NoteLines {
  section: string;
  note: number;
  /** First line: the text after "N." (may be empty). */
  lines: PdfLine[];
}

/** Pass 1: sections and notes, with each note's raw lines. */
function splitNotes(s: StrippedText, opts: SegmentOptions) {
  const sections: Ch99Notes['sections'] = [];
  const notes: NoteLines[] = [];
  let section: Ch99Notes['sections'][number] | undefined;
  let current: NoteLines | undefined;
  let subchapter: string | null = null;
  let seenSubchapter = false;
  const open = (id: string) => {
    section = { id, notes: [], deleted: [] };
    sections.push(section);
    current = undefined;
  };
  if (opts.startIn) {
    open(opts.startIn.section);
    section!.notes.push(opts.startIn.note);
    current = { section: opts.startIn.section, note: opts.startIn.note, lines: [] };
    notes.push(current);
  }
  for (const line of s.lines) {
    const t = line.text.trim();
    let m: RegExpExecArray | null;
    if ((m = SUBCHAPTER.exec(t))) {
      subchapter = m[1]!;
      seenSubchapter = true;
      section = undefined;
      current = undefined;
    } else if (SUBCHAPTER_DELETED.test(t)) {
      subchapter = null;
      seenSubchapter = true;
      section = undefined;
      current = undefined;
    } else if (US_NOTES.test(t)) {
      if (subchapter !== null) open(subchapter);
      else if (!seenSubchapter) open('chapter');
    } else if (STAT_NOTES.test(t)) {
      if (subchapter !== null) open(`${subchapter}-stat`);
      else if (!seenSubchapter) open('chapter-stat');
    } else if (TABLE.test(t)) {
      section = undefined;
      current = undefined;
    } else if (section) {
      const last = section.notes.at(-1) ?? 0;
      const lastSeen = Math.max(last, section.deleted.at(-1) ?? 0);
      if ((m = NOTE_DELETED.exec(t)) && Number(m[1]) > lastSeen) {
        section.deleted.push(Number(m[1]));
        current = undefined;
      } else if ((m = NOTE_START.exec(t)) && Number(m[1]) > lastSeen && (lastSeen === 0 || Number(m[1]) - lastSeen <= MAX_NOTE_GAP)) {
        if (NOTE_DELETED_INLINE.test(m[2] ?? '')) {
          section.deleted.push(Number(m[1]));
          current = undefined;
          continue;
        }
        section.notes.push(Number(m[1]));
        current = { section: section.id, note: Number(m[1]), lines: [{ page: line.page, text: m[2] ?? '' }] };
        notes.push(current);
      } else if (current) current.lines.push(line);
    }
  }
  return { sections, notes };
}

const AS_PROVIDED = /^As provided (?:for )?in headings?\s+/;

function asProvidedIn(text: string): Subdivision['asProvidedIn'] {
  const out: Subdivision['asProvidedIn'] = { headings: [], ranges: [] };
  const m = AS_PROVIDED.exec(text);
  if (!m) return out;
  const one = new RegExp(String.raw`^(${CH99})(?:\s*–\s*(${CH99}))?`);
  let rest = text.slice(m[0].length);
  for (;;) {
    const i = one.exec(rest);
    if (!i) break;
    if (i[2]) out.ranges.push([i[1]!, i[2]]);
    else out.headings.push(i[1]!);
    rest = rest.slice(i[0].length);
    const sep = SEP.exec(rest);
    if (!sep) break;
    rest = rest.slice(sep[0].length);
  }
  return out;
}

function makeSubdivision(section: string, note: number, path: string, page: string, raw: string[]): Subdivision {
  const text = normaliseText(raw.join('\n'));
  return {
    section,
    note,
    path,
    page,
    text,
    sha256: createHash('sha256').update(text).digest('hex'),
    asProvidedIn: asProvidedIn(text),
    shallNotApply: /\bshall not apply\b/.test(text),
    ...codeTokens(raw.join('\n')),
  };
}

export function segmentNotes(s: StrippedText, opts: SegmentOptions = {}): Ch99Notes {
  const { sections, notes } = splitNotes(s, opts);
  const subdivisions: Subdivision[] = [];
  const ignoredMarkers: Ch99Notes['ignoredMarkers'] = [];

  for (const n of notes) {
    const lead = n.lines.map((l) => leadingMarkers(l.text));
    const firstLabels = lead.map((x) => (x.reference ? undefined : x.markers[0]?.label));
    const stack: Level[] = [];
    let open: { path: string; page: string; raw: string[]; always: boolean } | undefined;
    const close = () => {
      if (open && (open.always || normaliseText(open.raw.join(' ')) !== '')) subdivisions.push(makeSubdivision(n.section, n.note, open.path, open.page, open.raw));
      open = undefined;
    };
    const pathOf = () => `${n.note}${stack.map((l) => `(${l.label})`).join('')}`;

    for (const [i, line] of n.lines.entries()) {
      const { markers: found, reference } = lead[i]!;
      const markers = reference ? [] : found;
      let rest = line.text;
      let accepted = 0;
      for (const mk of markers) {
        const later = [...markers.slice(accepted + 1).map((x) => x.label), ...firstLabels.slice(i + 1).filter((x): x is string => !!x)];
        const cands = moves(mk.label, stack, later);
        if (cands.length === 0) break;
        const mv = choose(cands, later);
        if (mv.type === 'advance') {
          stack.length = mv.depth + 1;
          stack[mv.depth] = { kind: mv.kind, ord: mv.ord, label: mk.label };
        } else stack.push({ kind: mv.kind, ord: 1, label: mk.label });
        close();
        open = { path: pathOf(), page: line.page, raw: [], always: true };
        rest = mk.rest;
        accepted++;
      }
      if (!open) open = { path: pathOf(), page: line.page, raw: [], always: false };
      if (accepted === 0 && found.length > 0) {
        const why = reference ? 'reference' : readings(found[0]!.label).length === 0 ? 'not_a_label' : 'out_of_sequence';
        ignoredMarkers.push({ section: n.section, note: n.note, path: open.path, page: line.page, text: line.text.trim(), why });
      }
      open.raw.push(rest);
    }
    close();
  }
  return { revision: s.revision, sections, subdivisions, ignoredMarkers };
}

// ------------------------------------------------------------------------------------------------------------- note 52

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

const CITES_52 = /\bsubdivision ((?:\([a-z0-9]+\))+) of U\.S\. note 52\b/;

export function extractNote52(notes: Ch99Notes, ch99Headings: Record<string, string>): Note52 {
  const subdivisions = notes.subdivisions.filter((s) => s.section === 'III' && s.note === 52);
  const k = subdivisions.find((s) => s.path === '52(k)');
  if (!k) throw new Error('U.S. note 52(k) to subchapter III not found');
  const problems: string[] = [];
  const exemptions: Record<string, Subdivision> = {};
  for (const s of subdivisions) {
    if (!s.shallNotApply || s.asProvidedIn.headings.length !== 1 || s.asProvidedIn.ranges.length !== 0) continue;
    const h = s.asProvidedIn.headings[0]!;
    if (exemptions[h]) problems.push(`${h} is defined by both ${exemptions[h].path} and ${s.path}`);
    else exemptions[h] = s;
  }
  for (const [h, s] of Object.entries(exemptions)) {
    const text = ch99Headings[h];
    if (text === undefined) problems.push(`${h} (defined by ${s.path}) is not in the HTS Ch. 99 lookup`);
  }
  for (const [h, text] of Object.entries(ch99Headings)) {
    const m = CITES_52.exec(text);
    if (!m) continue;
    const cited = `52${m[1]}`;
    const got = exemptions[h]?.path;
    if (got !== cited) problems.push(`${h}: the heading text cites subdivision ${cited}; the extracted note has ${got ?? 'no subdivision for it'}`);
  }
  for (const h of ['9903.05.39', '9903.05.49']) {
    if (!k.asProvidedIn.headings.includes(h)) problems.push(`52(k) does not open with "As provided in headings … ${h}"`);
  }
  return { revision: notes.revision, subdivisions, exemptions, k, problems };
}
