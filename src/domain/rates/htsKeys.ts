// Every rate key must be a real line in the official HTS index of the same revision (pure). Used by
// scripts/import-verify-sheet.ts (abort), scripts/validate-rates.ts and tests. 8-digit keys only for component reporting.
export interface HtsCodes {
  hts_revision: string;
  codes: Map<string, { componentReporting?: true }>;
}

export function checkRateKeysAgainstHts(rows: { id: string; hts10: string; component_reporting?: true | undefined }[], hts: HtsCodes, requiredRevision: string): string[] {
  const errors: string[] = [];
  if (hts.hts_revision !== requiredRevision) errors.push(`HTS index revision "${hts.hts_revision}" ≠ rate data revision "${requiredRevision}"`);
  for (const r of rows) {
    const code = hts.codes.get(r.hts10);
    if (!code) {
      errors.push(`${r.id}: ${r.hts10} is not in the HTS index (${hts.hts_revision})`);
      continue;
    }
    if (Boolean(code.componentReporting) !== Boolean(r.component_reporting)) {
      errors.push(`${r.id}: component_reporting ${r.component_reporting ? 'set' : 'not set'} but the HTS index says ${code.componentReporting ? 'component reporting' : 'a 10-digit line'}`);
    }
  }
  return errors;
}
