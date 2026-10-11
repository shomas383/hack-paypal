// pnpm hts:download — downloads the full HTS export from hts.usitc.gov into the gitignored data/source/hts/, and records
// which release it is. exportList ignores any release parameter and its JSON names no revision, so reststop/currentRelease
// is read before and after the download; both readings go into data/source/hts/current-export.meta.json, which
// `pnpm hts:import` requires (src/domain/hts/release.ts). Writes nothing outside data/source/hts/.
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseReleaseName, verifyExportMeta, type ExportMeta } from '../src/domain/hts/release';

const DIR = join('data', 'source', 'hts');
const EXPORT_URL = 'https://hts.usitc.gov/reststop/exportList?from=0101&to=9999&format=JSON&styles=false';
const RELEASE_URL = 'https://hts.usitc.gov/reststop/currentRelease';

async function currentRelease(): Promise<ExportMeta['currentRelease']> {
  const res = await fetch(RELEASE_URL);
  if (!res.ok) throw new Error(`currentRelease: HTTP ${res.status}`);
  return (await res.json()) as ExportMeta['currentRelease'];
}

async function main() {
  const before = await currentRelease();
  const release = parseReleaseName(before.name);
  const res = await fetch(EXPORT_URL);
  if (!res.ok) throw new Error(`exportList: HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  JSON.parse(buf.toString('utf8')); // must be the JSON export, not an error page
  const after = await currentRelease();
  const downloadedAt = new Date().toISOString();
  const file = `hts-export-${release.slug}-${downloadedAt.slice(0, 10)}.json`;
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const meta: ExportMeta = { file, url: EXPORT_URL, downloadedAt, sha256, currentRelease: before, currentReleaseAfter: after };
  verifyExportMeta(meta, sha256); // same checks the import runs
  mkdirSync(DIR, { recursive: true });
  writeFileSync(join(DIR, file), buf);
  writeFileSync(join(DIR, 'current-export.meta.json'), JSON.stringify(meta, null, 1) + '\n');
  console.log(`release ${release.label} (${release.name}); ${file} ${(buf.length / 1e6).toFixed(2)} MB sha256 ${sha256.slice(0, 12)}…`);
}

main().catch((e) => {
  console.error(`HTS DOWNLOAD ABORTED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
});
