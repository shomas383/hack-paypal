// Base rates for the estimator: the verbatim General-column text of every HTS index code, parsed. Estimator only.
import type { ExportRow, HtsIndex } from '@/domain/hts/buildIndex';
import type { ParsedRate } from './rateText';

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
    footnoteRows: number;
    footnoteRows9903: number;
    footnoteRefs: Record<string, number>;
  };
}

export function buildBaseRates(
  rows: RateExportRow[],
  meta: { hts_revision: string; source: HtsIndex['source']; codes: string[] },
): BaseRates {
  throw new Error(`not implemented: ${rows.length} rows, ${meta.codes.length} codes`);
}
