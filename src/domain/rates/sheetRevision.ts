// The HTS revision and effective dates of the verified rows, read from the Verify tab (columns Y and Z) — never hard-coded
// in the importer. Pure; used by scripts/import-verify-sheet.ts.
import type { HtsRelease } from '@/domain/hts/release';

export function excelSerialDate(serial: string | undefined, where: string): string {
  throw new Error(`not implemented: ${where} ${serial}`);
}

export function readSheetRevision(
  rows: { id: string; y: string | undefined; z: string | undefined }[],
  opts: { indexRevision: string; currentRevision: string },
): { revision: HtsRelease; effectiveFrom: Record<string, string> } {
  throw new Error(`not implemented: ${rows.length} ${opts.indexRevision}`);
}
