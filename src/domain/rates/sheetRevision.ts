// The HTS revision and effective dates of the verified rows, read from the Verify tab (columns Y and Z) — never hard-coded
// in the importer. Pure; used by scripts/import-verify-sheet.ts.
import { releaseFromLabel, type HtsRelease } from '@/domain/hts/release';

/** An Excel date serial ("46304") → "2026-10-09". A date typed as text is refused: re-enter it as a date. */
export function excelSerialDate(serial: string | undefined, where: string): string {
  if (!serial || !/^\d+$/.test(serial)) throw new Error(`${where}: expected an Excel date, got "${serial ?? ''}" (re-enter it as a date, not text)`);
  return new Date(Date.UTC(1899, 11, 30) + Number(serial) * 86_400_000).toISOString().slice(0, 10);
}

export function readSheetRevision(
  rows: { id: string; y: string | undefined; z: string | undefined }[],
  opts: { indexRevision: string; currentRevision: string },
): { revision: HtsRelease; effectiveFrom: Record<string, string> } {
  if (rows.length === 0) throw new Error('Verify: no VERIFIED rows to read a revision from');
  let revision: HtsRelease | undefined;
  const effectiveFrom: Record<string, string> = {};
  for (const r of rows) {
    if (!r.y) throw new Error(`${r.id} Y: HTS revision missing`);
    const rel = releaseFromLabel(r.y);
    if (revision && rel.label !== revision.label) throw new Error(`${r.id} Y: "${rel.label}" differs from the other rows' "${revision.label}"`);
    revision ??= rel;
    effectiveFrom[r.id] = excelSerialDate(r.z, `${r.id} Z`);
  }
  if (revision!.label !== opts.indexRevision) throw new Error(`sheet revision "${revision!.label}" ≠ HTS index revision "${opts.indexRevision}"`);
  if (revision!.label !== opts.currentRevision)
    throw new Error(`sheet revision "${revision!.label}" ≠ CURRENT_HTS_REVISION "${opts.currentRevision}" (src/domain/rates/current.ts)`);
  return { revision: revision!, effectiveFrom };
}
