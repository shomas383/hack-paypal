// Which HTS release an export belongs to. The hts.usitc.gov exportList endpoint ignores any release parameter and its
// JSON carries no revision, so the release is read from reststop/currentRelease before and after the download and kept
// in a sidecar next to the file (written by scripts/download-hts.ts). Pure.

export interface HtsRelease {
  /** As hts.usitc.gov names it, e.g. "2026HTSRev21". */
  name: string;
  year: number;
  rev: number;
  /** "2026 Rev. 21" — the hts_revision string used in the index and the rate data. */
  label: string;
  /** "2026-rev21" — used in file names. */
  slug: string;
}

export function parseReleaseName(name: string): HtsRelease {
  throw new Error(`not implemented: ${name}`);
}

export function verifyExportMeta(raw: unknown, fileSha256: string): { release: HtsRelease; meta: { file: string; url: string; downloadedAt: string; sha256: string } } {
  throw new Error(`not implemented: ${String(raw)} ${fileSha256}`);
}
