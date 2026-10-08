// Builds the compact Rev 20 HTS index from the hts.usitc.gov exportList JSON (pure; used by scripts/import-hts.ts).
// Reads ONLY htsno, indent, description, units and — for Chapter 91 component reporting — the footnote TEXT. Rate columns
// (general / special / other / additionalDuties) are never read: rates live only in the rate data (invariant 2).
// Tree: each row attaches to the nearest shallower row above it (indents may skip levels). Unnumbered rows (htsno "")
// are chain nodes, never codes. Codes: every dotted 10-digit line (normalised dddd.dd.dd.dd → dddd.dd.dddd), plus an
// 8-digit LEAF line whose footnote reads "See statistical note 1 to this chapter" (Ch. 91 Statistical Note 1: watches and
// clocks are reported by component suffix, so the 8-digit line is the classification) → componentReporting: true.
// No other leaf line becomes a code, and no "…00" suffix is ever invented. Chapters 98 and 99 are excluded.

export interface ExportRow {
  htsno: string;
  indent: string;
  description: string;
  units?: string[] | null;
  footnotes?: { value?: unknown }[] | null;
}

export interface HtsCode {
  /** dddd.dd.dddd, or dddd.dd.dd for a component-reporting line. */
  c: string;
  /** Node index of the code's own row. */
  n: number;
  u?: string[];
  componentReporting?: true;
}

export interface HtsIndex {
  hts_revision: string;
  source: { url: string; exportedOn: string; file?: string; sha256?: string };
  /** d = description, p = parent node index (-1 at the root). */
  nodes: { d: string; p: number }[];
  codes: HtsCode[];
}

const RE10 = /^(\d{4}\.\d{2})\.(\d{2})\.(\d{2})$/;
const RE8 = /^\d{4}\.\d{2}\.\d{2}$/;
const STAT_NOTE_1 = /^\s*see statistical note 1 to this chapter\.?\s*$/i;
const EXCLUDED_CHAPTERS = new Set(['98', '99']);

export function buildHtsIndex(rows: ExportRow[], meta: Pick<HtsIndex, 'hts_revision' | 'source'>): HtsIndex {
  if (rows.length === 0) throw new Error('empty export');
  const indents = rows.map((r, i) => {
    if (!/^\d+$/.test(String(r.indent))) throw new Error(`row ${i}: non-integer indent "${r.indent}"`);
    return Number(r.indent);
  });
  if (indents[0] !== 0) throw new Error(`first row must be at indent 0, got ${indents[0]}`);

  // 8-digit prefixes that have at least one 10-digit line → those 8-digit lines are not leaves.
  const hasTen = new Set(rows.filter((r) => RE10.test(r.htsno)).map((r) => r.htsno.slice(0, 10)));

  // Full tree over all rows: parent = nearest shallower row above.
  const parent: number[] = [];
  const chapter: (string | null)[] = [];
  const stack: number[] = [];
  rows.forEach((r, i) => {
    while (stack.length && indents[stack[stack.length - 1]!]! >= indents[i]!) stack.pop();
    const p = stack.length ? stack[stack.length - 1]! : -1;
    parent.push(p);
    chapter.push(r.htsno ? r.htsno.slice(0, 2) : p >= 0 ? chapter[p]! : null);
    stack.push(i);
  });

  // Codes (row index → code).
  const picked: { row: number; c: string; componentReporting: boolean }[] = [];
  const seen = new Set<string>();
  rows.forEach((r, i) => {
    if (chapter[i] && EXCLUDED_CHAPTERS.has(chapter[i]!)) return;
    let c: string | null = null;
    let componentReporting = false;
    const m = RE10.exec(r.htsno);
    if (m) c = `${m[1]}.${m[2]}${m[3]}`;
    else if (RE8.test(r.htsno) && !hasTen.has(r.htsno)) {
      const notes = (r.footnotes ?? []).map((f) => (typeof f?.value === 'string' ? f.value : ''));
      if (notes.some((t) => STAT_NOTE_1.test(t))) {
        c = r.htsno;
        componentReporting = true;
      }
    }
    if (!c) return;
    if (seen.has(c)) throw new Error(`duplicate code ${c}`);
    seen.add(c);
    picked.push({ row: i, c, componentReporting });
  });

  // Keep only the nodes on some code's chain; remap indices in file order.
  const keep = new Set<number>();
  for (const { row } of picked) for (let k = row; k >= 0 && !keep.has(k); k = parent[k]!) keep.add(k);
  const order = [...keep].sort((a, b) => a - b);
  const newIndex = new Map(order.map((rowIdx, j) => [rowIdx, j]));
  const nodes = order.map((rowIdx) => ({ d: rows[rowIdx]!.description, p: parent[rowIdx]! >= 0 ? newIndex.get(parent[rowIdx]!)! : -1 }));
  const codes: HtsCode[] = picked.map(({ row, c, componentReporting }) => {
    const units = rows[row]!.units;
    return {
      c,
      n: newIndex.get(row)!,
      ...(units && units.length ? { u: [...units] } : {}),
      ...(componentReporting ? { componentReporting: true as const } : {}),
    };
  });
  return { hts_revision: meta.hts_revision, source: meta.source, nodes, codes };
}

/** code → description chain (root first). */
export function chainsOf(idx: HtsIndex): Map<string, string[]> {
  const chainOfNode = (n: number): string[] => {
    const out: string[] = [];
    for (let k = n; k >= 0; k = idx.nodes[k]!.p) out.push(idx.nodes[k]!.d);
    return out.reverse();
  };
  return new Map(idx.codes.map((c) => [c.c, chainOfNode(c.n)]));
}
