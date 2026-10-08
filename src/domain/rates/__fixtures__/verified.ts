// Loads the committed, generated rate data + eval fixtures (produced by `pnpm rates:import`) for tests.
import { readFileSync } from 'node:fs';
import { CURRENT_HTS_REVISION, goldenFileName, rateFileName } from '../current';
import { validateRateFile } from '../validate';
import type { RateFile } from '../schema';

const read = (rel: string): unknown => JSON.parse(readFileSync(new URL(`../../../../${rel}`, import.meta.url), 'utf8'));

export function loadVerifiedRates(): RateFile {
  const v = validateRateFile(read(`data/rates/${rateFileName()}`), { requiredRevision: CURRENT_HTS_REVISION });
  if (!v.ok || !v.file) throw new Error(`rate data invalid:\n${v.errors.join('\n')}`);
  return v.file;
}

export interface GoldenCase {
  id: string;
  origin: string;
  hts10: string | null;
  price_minor?: number;
  quantity?: number;
  value_split?: { case_minor: number; band_minor: number };
  facts?: Record<string, boolean>;
  expected_total_ppm?: number;
  expected_chapter99?: string;
  expected: 'OK' | 'UNSUPPORTED';
}

export function loadGolden(): { rate_version: string; cases: GoldenCase[] } {
  return read(`data/eval/${goldenFileName()}`) as { rate_version: string; cases: GoldenCase[] };
}

export interface EvalProduct {
  id: string;
  title: string;
  origin: string | null;
  expected: { status: string; hts10: string | null; total_ppm: number | null };
  llm: { hts10: string | null; base_ppm: number; addon_ppm: number; total_ppm: number; confidence: string | null; notes: string };
}

export function loadEvalProducts(): EvalProduct[] {
  return read('data/eval/products.json') as EvalProduct[];
}
