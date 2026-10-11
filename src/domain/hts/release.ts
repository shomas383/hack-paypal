// Which HTS release an export belongs to. The hts.usitc.gov exportList endpoint ignores any release parameter and its
// JSON carries no revision, so the release is read from reststop/currentRelease before and after the download and kept
// in a sidecar next to the file (written by scripts/download-hts.ts). Pure.
import { z } from 'zod';

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

const NAME = /^(\d{4})HTSRev(\d{1,3})$/;

export function parseReleaseName(name: string): HtsRelease {
  const m = NAME.exec(name);
  if (!m) throw new Error(`unexpected HTS release name "${name}" (expected e.g. 2026HTSRev21)`);
  const year = Number(m[1]);
  const rev = Number(m[2]);
  return { name, year, rev, label: `${year} Rev. ${rev}`, slug: `${year}-rev${rev}` };
}

/** "2026 Rev. 21" (an hts_revision label) → its release. */
export function releaseFromLabel(label: string): HtsRelease {
  const m = /^(\d{4}) Rev\. (\d{1,3})$/.exec(label);
  if (!m) throw new Error(`unexpected HTS revision label "${label}" (expected e.g. "2026 Rev. 21")`);
  return parseReleaseName(`${m[1]}HTSRev${m[2]}`);
}

const Release = z.object({ name: z.string(), description: z.string().optional(), title: z.string().optional() });

export const ExportMetaSchema = z.strictObject({
  file: z.string().min(1),
  url: z.url(),
  downloadedAt: z.iso.datetime(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  /** reststop/currentRelease, read just before the download … */
  currentRelease: Release,
  /** … and just after it. */
  currentReleaseAfter: Release,
});
export type ExportMeta = z.infer<typeof ExportMetaSchema>;

export function verifyExportMeta(raw: unknown, fileSha256: string): { release: HtsRelease; meta: ExportMeta } {
  const meta = ExportMetaSchema.parse(raw);
  if (meta.sha256 !== fileSha256) throw new Error(`export sha256 ${fileSha256.slice(0, 12)}… does not match the sidecar's ${meta.sha256.slice(0, 12)}…`);
  if (meta.currentRelease.name !== meta.currentReleaseAfter.name)
    throw new Error(`currentRelease changed during the download (${meta.currentRelease.name} → ${meta.currentReleaseAfter.name}); download again`);
  return { release: parseReleaseName(meta.currentRelease.name), meta };
}
