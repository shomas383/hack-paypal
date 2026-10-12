// Chapter 99 headings for the estimator: official text (with its unnumbered parent rows, e.g. "Articles the product of
// Japan:" above 9903.41.05), the General column text, and whether the heading is still in force. Pure.
// Out of force, decided only from official text or one docs-verified fact:
// - compiler_note: the heading's own text carries "[Compiler's note: … terminated | suspended | expired …]";
// - note_compiler_note: a compiler's note inside a U.S. note says so for the heading, e.g. note 2(aa): "Subdivisions … and
//   headings 9903.03.01–9903.03.11 expired at the close of July 23, 2026.";
// - entry_window_closed: the heading covers only goods "(2) … entered for consumption, or withdrawn from warehouse for
//   consumption, before 12:01 a.m. … on <date>" and that date is on or before the as-of date (9903.05.85); or its own text
//   gives an entry period "on or after <date>, and through|before <date>" that has ended (9903.88.50, 9903.88.66);
// - verified_override: a reviewed list (data/reviews/) of headings a primary source ends although the HTS still prints them
//   (IEEPA: EO 14389 §1, CBP CSMS # 67834313), each held to the sha256 of its reviewed text (see VerifiedOverride).
import { createHash } from 'node:crypto';
import type { RateExportRow } from './baseRates';
import { codeTokens, type Ch99Notes } from './ch99Notes';
import { normaliseText } from './ch99Text';

export interface HeadingInfo {
  /** Own description, whitespace-folded. */
  text: string;
  /** Unnumbered parent rows + own description, whitespace-folded, joined by " ". */
  chain: string;
  /** General column text as published ("12.5%", "The duty provided in the applicable subheading + 25%"). */
  general: string;
}
export type HeadingTable = Record<string, HeadingInfo>;

const HEADING = /^99\d{2}\.\d{2}\.\d{2}$/;

export function buildHeadingTable(rows: RateExportRow[]): HeadingTable {
  const out: HeadingTable = {};
  const stack: string[] = [];
  for (const r of rows) {
    const indent = Number(r.indent);
    stack.length = indent;
    stack[indent] = normaliseText(r.description ?? '');
    if (!HEADING.test(r.htsno)) continue;
    out[r.htsno] = { text: stack[indent]!, chain: normaliseText(stack.slice(0, indent + 1).join(' ')), general: normaliseText(r.general ?? '') };
  }
  return out;
}

/** Headings of the table within an inclusive range ("9903.05.20", "9903.05.84"). */
export function headingsInRange(t: HeadingTable, from: string, to: string): string[] {
  return Object.keys(t).filter((h) => h >= from && h <= to).sort();
}

export interface OutOfForce {
  why: 'compiler_note' | 'note_compiler_note' | 'entry_window_closed' | 'verified_override';
  /** Where it is said: "heading 9903.01.86", "note III 2(aa)", "docs/SPEC.md". */
  ref: string;
  quote: string;
}

/**
 * A reviewed list of headings the HTS text still prints but a primary source ends (IEEPA: EO 14389 §1, CBP CSMS # 67834313).
 * The text can't tie them to the source, so people did (docs/IEEPA_HEADINGS_REVIEW.md, approved by group). The gate checks
 * `quote` is in `file` (G0). A listed heading is terminated only while it exists in the schedule and the sha256 of its
 * text + General column equals the reviewed one; a changed or missing one — and any heading under `prefixes` that is not
 * listed and not out of force by its own text — stays in force (fails closed) and is reported for re-review.
 */
export interface ReviewedHeading {
  heading: string;
  group: string;
  /** The ended order it implements ("EO 14257 (as amended)"). */
  order: string;
  text_sha256: string;
}
export interface VerifiedOverride {
  /** Heading prefixes the list covers ("9903.01.", "9903.02."). */
  prefixes: string[];
  /** Docs file + sentence that states the fact (G0 checks the sentence is still there). */
  file: string;
  quote: string;
  /** Where the list lives, for refs ("data/reviews/ieepa-ended-2026-rev21.json"). */
  listFile: string;
  reviewedOn: string;
  headings: ReviewedHeading[];
}

/** What a reviewed heading's sha256 covers: its official text with parent rows, a line break, and its General column. */
export const headingTextSha = (info: HeadingInfo) => createHash('sha256').update(`${info.chain}\n${info.general}`).digest('hex');

/**
 * The override's headings against the current table: tied (listed, present, text unchanged → terminated), changed (listed,
 * text differs), missing (listed, not in the schedule), unlisted (under its prefixes, not out of force for another reason).
 */
export function overrideTies(t: HeadingTable, o: VerifiedOverride, alreadyOut: (h: string) => boolean) {
  const tied: Record<string, { order: string; group: string }> = {};
  const changed: string[] = [];
  const missing: string[] = [];
  const listed = new Map(o.headings.map((r) => [r.heading, r]));
  for (const r of o.headings) {
    const info = t[r.heading];
    if (!info) missing.push(r.heading);
    else if (alreadyOut(r.heading)) continue;
    else if (headingTextSha(info) !== r.text_sha256) changed.push(r.heading);
    else tied[r.heading] = { order: r.order, group: r.group };
  }
  const unlisted = Object.keys(t)
    .sort()
    .filter((h) => o.prefixes.some((p) => h.startsWith(p)) && !listed.has(h) && !alreadyOut(h));
  return { tied, changed: changed.sort(), missing: missing.sort(), unlisted };
}

const OWN_NOTE = /\[Compiler['’]s note:[^\]]*?\b(terminated|suspended|expired)\b[^\]]*\]/i;
const COMPILER_NOTE = /\[Compiler['’]s note:([^\]]*)\]/gi;
const STATUS_VERB = /\b(?:are|is|were|was|have been|has been)\s+(terminated|suspended)\b|\bexpired\b/i;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WINDOW =
  /that \(1\) were loaded onto a vessel.*?\(2\) are entered for consumption, or withdrawn from warehouse for consumption, before 12:01 a\.m\. [a-z ]*time on ([A-Z][a-z]+) (\d{1,2}), (\d{4})/;
/** "on or after June 4, 2020, and through December 31, 2020" / "… and before June 1, 2023": an entry period with an end. */
const PERIOD = /\bon or after [A-Z][a-z]+ \d{1,2}, \d{4},? and (through|before) ([A-Z][a-z]+) (\d{1,2}), (\d{4})/;

/** "July 28, 2026" parts → "2026-07-28", or null. */
const isoDate = (month: string, day: string, year: string) => {
  const m = MONTHS.indexOf(month);
  return m < 0 ? null : `${year}-${String(m + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
};

export function outOfForce(t: HeadingTable, notes: Ch99Notes, asOf: string, overrides: VerifiedOverride[] = []): Record<string, OutOfForce> {
  const out: Record<string, OutOfForce> = {};
  const set = (h: string, o: OutOfForce) => {
    if (t[h] && !out[h]) out[h] = o;
  };
  for (const [h, info] of Object.entries(t)) {
    const own = OWN_NOTE.exec(info.chain);
    if (own) set(h, { why: 'compiler_note', ref: `heading ${h}`, quote: own[0] });
    const w = WINDOW.exec(info.text);
    if (w) {
      const d = isoDate(w[1]!, w[2]!, w[3]!);
      if (d !== null && d <= asOf) set(h, { why: 'entry_window_closed', ref: `heading ${h}`, quote: w[0] });
    }
    // "through D" covers D itself; "before D" ends on D. A period that hasn't begun yet stays in force (fails closed).
    const p = PERIOD.exec(info.text);
    if (p) {
      const d = isoDate(p[2]!, p[3]!, p[4]!);
      if (d !== null && (p[1] === 'through' ? d < asOf : d <= asOf)) set(h, { why: 'entry_window_closed', ref: `heading ${h}`, quote: p[0] });
    }
  }
  for (const s of notes.subdivisions) {
    for (const m of s.text.matchAll(COMPILER_NOTE)) {
      for (const sentence of m[1]!.split(/(?<=\.)\s+(?=[A-Z])/)) {
        if (!STATUS_VERB.test(sentence)) continue;
        const tok = codeTokens(sentence);
        const hs = [...tok.ch99, ...tok.ch99Ranges.flatMap(([a, b]) => headingsInRange(t, a, b))];
        for (const h of hs) set(h, { why: 'note_compiler_note', ref: `note ${s.section} ${s.path}`, quote: sentence.trim() });
      }
    }
  }
  for (const o of overrides) {
    const { tied } = overrideTies(t, o, (h) => !!out[h]);
    for (const [h, tie] of Object.entries(tied)) set(h, { why: 'verified_override', ref: `${o.listFile} (${tie.order}; reviewed ${o.reviewedOn})`, quote: o.quote });
  }
  return out;
}

const DATED = /\b(on or after|through|before) (?:12:01 a\.m\. [a-z ]*time on )?([A-Z][a-z]+) (\d{1,2}), (\d{4})/g;
const dayBefore = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);

/**
 * The last date the data stays right: before the earliest future date in an in-force heading's own text or in a note's text
 * where something starts or ends ("through November 9, 2026" → 2026-11-09; "on or after November 10, 2026" or "before
 * November 10, 2026" → 2026-11-09). Null when no such date is ahead. Out-of-force headings are left out (their text no longer
 * applies); ties keep the first found (headings in order, then notes).
 */
export function validUntil(t: HeadingTable, notes: Ch99Notes, outOfForce: Record<string, OutOfForce>, asOf: string): { date: string; ref: string; quote: string } | null {
  let best: { date: string; ref: string; quote: string } | null = null;
  const scan = (text: string, ref: string) => {
    for (const m of text.matchAll(DATED)) {
      const d = isoDate(m[2]!, m[3]!, m[4]!);
      if (d === null) continue;
      const last = m[1] === 'through' ? d : dayBefore(d);
      if (last < asOf || (m[1] !== 'through' && d <= asOf)) continue;
      if (!best || last < best.date) best = { date: last, ref, quote: m[0] };
    }
  };
  for (const h of Object.keys(t).sort()) if (!outOfForce[h]) scan(t[h]!.text, `heading ${h}`);
  for (const s of notes.subdivisions) scan(s.text, `note ${s.section} ${s.path}`);
  return best;
}

/** True when `quote` is in the docs text after removing Markdown emphasis and folding whitespace. */
export function overrideQuoteHolds(docText: string, quote: string): boolean {
  return normaliseText(docText.replace(/\*\*|__/g, '')).includes(normaliseText(quote));
}
