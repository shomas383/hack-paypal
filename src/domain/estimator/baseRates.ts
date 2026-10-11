// Base rates for the estimator: the verbatim General-column text of every HTS index code, parsed. Estimator only — the
// verified rate path (data/rates, checkout, agent) never reads this. Pure; used by the estimator build.
// - Rate-bearing row: the code's own row if its General text is non-blank, else its 8-digit line. A rate is never
//   borrowed from a 6-digit subheading or heading (no rates live there in Rev 20); none found → null (fail closed).
// - Chapter 99 footnotes: every footnote on the code's row or an ancestor that names a 99xx.xx.xx heading, with its
//   column (a Column 2 "other" footnote doesn't apply to column 1 origins), verbatim text, headings and ranges.
import type { ExportRow, HtsIndex } from '@/domain/hts/buildIndex';
import { parseRateText, type ParsedRate } from './rateText';

export type RateExportRow = Omit<ExportRow, 'footnotes'> & {
  general?: string | null;
  special?: string | null;
  other?: string | null;
  footnotes?: { columns?: unknown; value?: unknown }[] | null;
};

export interface Ch99Footnote {
  /** htsno of the row that carries the footnote (the code's own row or an ancestor). */
  on: string;
  columns: string[];
  text: string;
  /** 99xx.xx.xx headings named on their own. */
  headings: string[];
  /** "A through B" / "A-B" ranges. */
  ranges: [string, string][];
}

export interface BaseRates {
  hts_revision: string;
  source: HtsIndex['source'];
  /** Rate-bearing export row (htsno as in the export) → its parsed General text. */
  rateRows: Record<string, ParsedRate>;
  /** Index code → its rate-bearing row (null: none, fail closed) and its Chapter 99 footnotes. */
  codes: Record<string, { r: string | null; fn?: Ch99Footnote[] }>;
  counts: {
    codes: number;
    missingRate: number;
    byType: Record<'free' | 'ad_valorem' | 'specific' | 'compound' | 'unparseable', number>;
    unparseableByReason: Record<string, number>;
    /** Rows in chapters 1–97 with a footnote naming any 99xx heading / a 9903 heading. */
    footnoteRows: number;
    footnoteRows9903: number;
    /** "<columns> <heading or A–B range>" → rows. */
    footnoteRefs: Record<string, number>;
  };
}

const RE10 = /^(\d{4}\.\d{2})\.(\d{2})\.(\d{2})$/;
const RE8 = /^\d{4}\.\d{2}\.\d{2}$/;
const HEADING = /\b99\d{2}\.\d{2}\.\d{2}\b/g;
const RANGE = /\b(99\d{2}\.\d{2}\.\d{2})\s*(?:through|-|–)\s*(99\d{2}\.\d{2}\.\d{2})\b/g;
const EXCLUDED_CHAPTERS = new Set(['98', '99']);

/** dddd.dd.dd.dd → dddd.dd.dddd (the index form); 8-digit lines stay as they are. */
const codeOf = (htsno: string) => {
  const m = RE10.exec(htsno);
  return m ? `${m[1]}.${m[2]}${m[3]}` : htsno;
};
const blank = (s: string | null | undefined) => !s || s.trim() === '';

function ch99Refs(text: string): { headings: string[]; ranges: [string, string][] } | null {
  const ranges = [...text.matchAll(RANGE)].map((m) => [m[1]!, m[2]!] as [string, string]);
  const headings = [...new Set(text.replace(RANGE, ' ').match(HEADING) ?? [])];
  return headings.length || ranges.length ? { headings, ranges } : null;
}

function footnotesOf(r: RateExportRow): Ch99Footnote[] {
  const out: Ch99Footnote[] = [];
  for (const f of r.footnotes ?? []) {
    const text = typeof f?.value === 'string' ? f.value : '';
    const refs = ch99Refs(text);
    if (!refs) continue;
    const columns = Array.isArray(f.columns) ? f.columns.filter((c): c is string => typeof c === 'string') : [];
    out.push({ on: r.htsno, columns, text, ...refs });
  }
  return out;
}

export function buildBaseRates(
  rows: RateExportRow[],
  meta: { hts_revision: string; source: HtsIndex['source']; codes: string[] },
): BaseRates {
  // Tree as in buildHtsIndex: parent = nearest shallower row above (indents may skip levels).
  const parent: number[] = [];
  const stack: number[] = [];
  rows.forEach((r, i) => {
    const indent = Number(r.indent);
    while (stack.length && Number(rows[stack[stack.length - 1]!]!.indent) >= indent) stack.pop();
    parent.push(stack.length ? stack[stack.length - 1]! : -1);
    stack.push(i);
  });
  const ancestors = (i: number): number[] => {
    const out: number[] = [];
    for (let k = parent[i]!; k >= 0; k = parent[k]!) out.push(k);
    return out;
  };

  const rowOfCode = new Map<string, number>();
  const counts: BaseRates['counts'] = {
    codes: 0,
    missingRate: 0,
    byType: { free: 0, ad_valorem: 0, specific: 0, compound: 0, unparseable: 0 },
    unparseableByReason: {},
    footnoteRows: 0,
    footnoteRows9903: 0,
    footnoteRefs: {},
  };
  rows.forEach((r, i) => {
    if (!r.htsno || EXCLUDED_CHAPTERS.has(r.htsno.slice(0, 2))) return;
    const c = codeOf(r.htsno);
    if (rowOfCode.has(c)) throw new Error(`duplicate export line ${r.htsno}`);
    rowOfCode.set(c, i);
    const fns = footnotesOf(r);
    if (!fns.length) return;
    counts.footnoteRows++;
    if (fns.some((f) => [...f.headings, ...f.ranges.flat()].some((h) => h.startsWith('9903.')))) counts.footnoteRows9903++;
    const keys = new Set(fns.flatMap((f) => [...f.headings, ...f.ranges.map(([a, b]) => `${a}–${b}`)].map((ref) => `${f.columns.join('+')} ${ref}`)));
    for (const k of keys) counts.footnoteRefs[k] = (counts.footnoteRefs[k] ?? 0) + 1;
  });

  const rateRows: BaseRates['rateRows'] = {};
  const codes: BaseRates['codes'] = {};
  for (const c of meta.codes) {
    const i = rowOfCode.get(c);
    if (i === undefined) throw new Error(`code ${c} is not in the export (index and export must be the same release)`);
    let rateRow: number | null = null;
    if (!blank(rows[i]!.general)) rateRow = i;
    else if (!RE8.test(rows[i]!.htsno)) {
      const eight = ancestors(i).find((k) => rows[k]!.htsno !== '');
      if (eight !== undefined && RE8.test(rows[eight]!.htsno) && !blank(rows[eight]!.general)) rateRow = eight;
    }
    const fn = [...ancestors(i).reverse(), i].flatMap((k) => footnotesOf(rows[k]!));
    counts.codes++;
    if (rateRow === null) {
      counts.missingRate++;
      codes[c] = { r: null, ...(fn.length ? { fn } : {}) };
      continue;
    }
    const htsno = rows[rateRow]!.htsno;
    const parsed = (rateRows[htsno] ??= parseRateText(rows[rateRow]!.general!));
    if (parsed.ok) counts.byType[parsed.type]++;
    else {
      counts.byType.unparseable++;
      counts.unparseableByReason[parsed.reason] = (counts.unparseableByReason[parsed.reason] ?? 0) + 1;
    }
    codes[c] = { r: htsno, ...(fn.length ? { fn } : {}) };
  }
  return { hts_revision: meta.hts_revision, source: meta.source, rateRows, codes, counts };
}
