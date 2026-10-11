// Parser for the HTS General (column 1) rate text — estimator only; the verified rate path never uses it.
import type { Mfn } from '@/domain/rates/schema';

/** Per-unit bases of a specific rate, as the official text names them. */
export type SpecificUnit = 'each' | 'pair' | 'dozen' | 'gross' | 'thousand' | 'head' | 'kg' | 't' | 'liter' | 'm2' | 'm3' | 'bbl' | 'jewel';
/** Value bases of an ad valorem term ("on the case", "on the strap, band or bracelet", …). */
export type ValueBase = 'full_value' | 'case' | 'band' | 'case_and_band' | 'movement' | 'movement_and_case' | 'battery' | 'apparatus';
/** What the buyer/seller must supply for a specific term. */
export type Measure = 'count' | 'pairs' | 'kg' | 'liter' | 'm2' | 'm3' | 'bbl' | 'jewels';

export type RateTerm =
  | { kind: 'ad_valorem'; rate_ppm: number; applies_to: ValueBase }
  | { kind: 'specific'; amount_usd_micros: number; per: SpecificUnit };

export type UnparseableReason = 'EMPTY' | 'REFERS_TO_OTHER_RATE' | 'SPECIAL_MEASURE' | 'SPECIAL_BASE' | 'CONDITIONAL' | 'PRECISION' | 'UNRECOGNISED';

export type ParsedRate =
  | {
      ok: true;
      text: string;
      type: 'free' | 'ad_valorem' | 'specific' | 'compound';
      terms: RateTerm[];
      measures: Measure[];
      splits: Exclude<ValueBase, 'full_value'>[];
    }
  | { ok: false; text: string; reason: UnparseableReason; detail: string };

export function parseRateText(text: string): ParsedRate {
  throw new Error(`not implemented: ${text}`);
}

/** The verified engine's MFN shape, or null when the rate is refused or uses a unit / value base that engine has no input for. */
export function toEngineMfn(p: ParsedRate): Mfn | null {
  throw new Error(`not implemented: ${p.text}`);
}
