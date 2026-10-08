// Structural (zod) + semantic checks for a rate data file. Pure; used by `pnpm rates:validate` and tests.
import { RateFileSchema, type RateFile } from './schema';

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  file?: RateFile;
}

export function validateRateFile(data: unknown, opts: { requiredRevision: string }): ValidationResult {
  const parsed = RateFileSchema.safeParse(data);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`) };
  }
  const file = parsed.data;
  const errors: string[] = [];

  if (file.hts_revision !== opts.requiredRevision) {
    errors.push(`hts_revision: file has "${file.hts_revision}", required "${opts.requiredRevision}"`);
  }

  const seen = new Set<string>();
  file.rows.forEach((row, i) => {
    const at = `rows[${i}] ${row.id}`;
    if (row.hts_revision !== opts.requiredRevision) {
      errors.push(`${at}: hts_revision "${row.hts_revision}", required "${opts.requiredRevision}"`);
    }
    if (row.id !== `${row.origin}-${row.hts10}`) errors.push(`${at}: id must be "${row.origin}-${row.hts10}"`);
    const eightDigit = row.hts10.length === 10;
    if (eightDigit && row.component_reporting !== true) {
      errors.push(`${at}: an 8-digit key needs component_reporting: true (HTS Ch. 91 Statistical Note 1)`);
    }
    if (!eightDigit && row.component_reporting) errors.push(`${at}: component_reporting is only for an 8-digit key, not a 10-digit line`);

    const key = `${row.origin}|${row.hts10}`;
    if (seen.has(key)) errors.push(`${at}: duplicate (origin, hts10) ${row.origin} ${row.hts10}`);
    seen.add(key);

    if (row.mfn.type === 'specific' || row.mfn.type === 'compound') {
      const caseBand = row.mfn.components.some((c) => c.kind === 'ad_valorem' && c.applies_to !== 'full_value');
      if (row.mfn.type !== 'compound' && caseBand) {
        errors.push(`${at}: case/band components are only allowed in a compound rate`);
      }
    }

    row.additional.forEach((a, j) => {
      const aat = `${at} additional[${j}] ${a.chapter99}`;
      if (a.rule === 'combined_cap' && !a.chapter99_at_or_above_cap) {
        errors.push(`${aat}: combined_cap needs chapter99_at_or_above_cap`);
      }
      if (a.rule !== 'combined_cap' && a.chapter99_at_or_above_cap) {
        errors.push(`${aat}: chapter99_at_or_above_cap is only for combined_cap`);
      }
      if (a.rule === 'exempt' && a.rate_ppm !== 0) errors.push(`${aat}: exempt rule must have rate_ppm 0`);
    });

    if (row.ruling.status !== 'none' && !row.ruling.number) {
      errors.push(`${at}: ruling status "${row.ruling.status}" needs a ruling number`);
    }
    if (row.effective_to !== null && row.effective_to <= row.effective_from) {
      errors.push(`${at}: effective_to must be after effective_from`);
    }
  });

  return errors.length ? { ok: false, errors } : { ok: true, errors, file };
}
