// Chapter 99 headings for the estimator: official text (with its unnumbered parent rows, e.g. "Articles the product of
// Japan:" above 9903.41.05), the General column text, and whether the heading is still in force. Pure.
// Out of force, decided only from official text or one docs-verified fact:
// - compiler_note: the heading's own text carries "[Compiler's note: … terminated | suspended | expired …]";
// - note_compiler_note: a compiler's note inside a U.S. note says so for the heading, e.g. note 2(aa): "Subdivisions … and
//   headings 9903.03.01–9903.03.11 expired at the close of July 23, 2026.";
// - entry_window_closed: the heading covers only goods "(2) … entered for consumption, or withdrawn from warehouse for
//   consumption, before 12:01 a.m. … on <date>" and that date is on or before the as-of date (9903.05.85);
// - verified_override: docs/SPEC.md records, from a verified source, that IEEPA headings 9903.01.xx / 9903.02.xx are still
//   printed but terminated (Learning Resources, Inc. v. Trump). The quote is checked against docs/SPEC.md by the gate.
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
 * A fact the HTS text doesn't carry, recorded in docs from a primary source. The gate checks `quote` is in `file` (G0), and a
 * heading counts as terminated only when its own text, or the text of a U.S. note it cites, names one of `executiveOrders`
 * ("Executive Order 14323"); a heading that can't be tied stays in force (fails closed).
 */
export interface VerifiedOverride {
  /** Heading prefixes it covers ("9903.01.", "9903.02."). */
  prefixes: string[];
  file: string;
  quote: string;
  executiveOrders: string[];
}

/**
 * docs/SPEC.md §4.2: CBP CSMS # 67834313 (2026-02-22, read 2026-10-11) — IEEPA duties not collected for goods entered on or
 * after 12:00 a.m. ET Feb 24, 2026, per the Feb 20, 2026 EO "Ending Certain Tariff Actions" (EOs 14193, 14194, 14195,
 * 14245, 14257, 14323, 14329; "affects IEEPA duties only").
 */
export const VERIFIED_OVERRIDES: VerifiedOverride[] = [
  {
    prefixes: ['9903.01.', '9903.02.'],
    file: 'docs/SPEC.md',
    quote:
      'IEEPA tariffs (9903.01.xx / 9903.02.xx) are still printed in Chapter 99 but terminated (CBP stopped collecting for entries on/after Feb 24, 2026) — never add them.',
    executiveOrders: ['14193', '14194', '14195', '14245', '14257', '14323', '14329'],
  },
];

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII', 'XIII', 'XIV', 'XV', 'XVI', 'XVII', 'XVIII', 'XIX', 'XX', 'XXI', 'XXII', 'XXIII'];
const EO_NUMBER = /\bExecutive Order (?:No\. )?(\d{5})\b/g;

/** Where a heading names one of the EOs: its own text, else a note it cites ("U.S. note 2"); null when nowhere. */
export function executiveOrderTie(h: string, t: HeadingTable, notes: Ch99Notes, eos: string[]): { eo: string; where: string } | null {
  const info = t[h];
  if (!info) return null;
  const hit = (text: string) => [...text.matchAll(EO_NUMBER)].map((m) => m[1]!).find((n) => eos.includes(n));
  const own = hit(info.chain);
  if (own) return { eo: own, where: `heading ${h}` };
  const section = ROMAN[Number(h.slice(2, 4))];
  for (const n of new Set([...info.chain.matchAll(/(?<!general )\bU\.S\. notes? (\d+)/g)].map((m) => Number(m[1])))) {
    for (const s of notes.subdivisions) {
      if (s.section !== section || s.note !== n) continue;
      const e = hit(s.text);
      if (e) return { eo: e, where: `note ${s.section} ${s.path}` };
    }
  }
  return null;
}

/** Headings an override covers that aren't out of force for another reason, split into tied (→ terminated) and untied. */
export function overrideTies(t: HeadingTable, notes: Ch99Notes, o: VerifiedOverride, alreadyOut: (h: string) => boolean) {
  const tied: Record<string, { eo: string; where: string }> = {};
  const untied: string[] = [];
  for (const h of Object.keys(t).sort()) {
    if (!o.prefixes.some((p) => h.startsWith(p)) || alreadyOut(h)) continue;
    const tie = executiveOrderTie(h, t, notes, o.executiveOrders);
    if (tie) tied[h] = tie;
    else untied.push(h);
  }
  return { tied, untied };
}

const OWN_NOTE = /\[Compiler['’]s note:[^\]]*?\b(terminated|suspended|expired)\b[^\]]*\]/i;
const COMPILER_NOTE = /\[Compiler['’]s note:([^\]]*)\]/gi;
const STATUS_VERB = /\b(?:are|is|were|was|have been|has been)\s+(terminated|suspended)\b|\bexpired\b/i;
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WINDOW =
  /that \(1\) were loaded onto a vessel.*?\(2\) are entered for consumption, or withdrawn from warehouse for consumption, before 12:01 a\.m\. [a-z ]*time on ([A-Z][a-z]+) (\d{1,2}), (\d{4})/;

/** "July 28, 2026" parts → "2026-07-28", or null. */
const isoDate = (month: string, day: string, year: string) => {
  const m = MONTHS.indexOf(month);
  return m < 0 ? null : `${year}-${String(m + 1).padStart(2, '0')}-${day.padStart(2, '0')}`;
};

export function outOfForce(t: HeadingTable, notes: Ch99Notes, asOf: string, overrides: VerifiedOverride[] = VERIFIED_OVERRIDES): Record<string, OutOfForce> {
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
    const { tied } = overrideTies(t, notes, o, (h) => !!out[h]);
    for (const [h, tie] of Object.entries(tied)) set(h, { why: 'verified_override', ref: `${o.file} (Executive Order ${tie.eo}, named in ${tie.where})`, quote: o.quote });
  }
  return out;
}

/** True when `quote` is in the docs text after removing Markdown emphasis and folding whitespace. */
export function overrideQuoteHolds(docText: string, quote: string): boolean {
  return normaliseText(docText.replace(/\*\*|__/g, '')).includes(normaliseText(quote));
}
