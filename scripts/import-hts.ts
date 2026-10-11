// pnpm hts:import — builds the compact HTS index (codes + description chains, no rates) from the official export
// downloaded from hts.usitc.gov, writes it to the protected index folder and stages it. The only writer of that folder
// (.claude/hooks/protect-rates.mjs). Source: the gitignored export named by data/source/hts/current-export.meta.json, which
// `pnpm hts:download` writes with the release read from reststop/currentRelease before and after the download. The
// revision label and the output file names come from that release, never from this file.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildCh99Lookup, buildHtsIndex, chainsOf, type ExportRow } from '../src/domain/hts/buildIndex';
import { verifyExportMeta } from '../src/domain/hts/release';
import { CURRENT_HTS_REVISION } from '../src/domain/rates/current';

const SOURCE_DIR = join('data', 'source', 'hts');
const META_FILE = join(SOURCE_DIR, 'current-export.meta.json');
const OUT_DIR = join('data', 'hts');

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main() {
  const rawMeta: unknown = JSON.parse(readFileSync(META_FILE, 'utf8'));
  const metaFile = (rawMeta as { file?: unknown } | null)?.file;
  assert(typeof metaFile === 'string' && /^[\w.-]+\.json$/.test(metaFile), `${META_FILE}: "file" must be a plain file name in ${SOURCE_DIR}`);
  const SOURCE = join(SOURCE_DIR, metaFile);
  const buf = readFileSync(SOURCE);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const { release, meta } = verifyExportMeta(rawMeta, sha256);
  const OUT = join(OUT_DIR, `${release.slug}.json`);
  // Official Chapter 99 subchapter III heading text (9903.xx.xx → description), for citing duty lines verbatim. No rates.
  const OUT_CH99 = join(OUT_DIR, `${release.slug}-ch99.json`);
  const rows = JSON.parse(buf.toString('utf8')) as ExportRow[];
  const idx = buildHtsIndex(rows, {
    hts_revision: release.label,
    source: { url: meta.url, exportedOn: meta.downloadedAt.slice(0, 10), release: release.name, file: SOURCE.replace(/\\/g, '/'), sha256 },
  });

  // Fail fast on the facts we rely on (also covered by src/server/hts.test.ts against the committed file).
  const chains = chainsOf(idx);
  const byCode = new Map(idx.codes.map((c) => [c.c, c]));
  assert(chains.get('6203.42.4511')?.some((d) => d.includes("Men's trousers and breeches")), '6203.42.4511 chain lacks "Men\'s trousers and breeches"');
  assert(!byCode.has('6203.42.4011'), '6203.42.4011 (pre-renumbering) must be absent');
  assert(byCode.has('9006.53.0205'), '9006.53.0205 must be present');
  assert(byCode.get('9102.21.70')?.componentReporting === true, '9102.21.70 must be a component-reporting code');

  const ch99 = buildCh99Lookup(rows, { hts_revision: idx.hts_revision, source: idx.source });
  assert(/the product of Japan/.test(ch99.headings['9903.05.49'] ?? '') && /U\.S\. note 52/.test(ch99.headings['9903.05.49'] ?? ''), '9903.05.49 official text not as expected');
  const ch99Json = JSON.stringify(ch99) + '\n';

  const json = JSON.stringify(idx) + '\n';
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);
  writeFileSync(OUT_CH99, ch99Json);

  const ten = idx.codes.filter((c) => !c.componentReporting).length;
  const cr = idx.codes.length - ten;
  console.log(`release ${release.label} (${release.name}, read before and after the download at ${meta.downloadedAt})`);
  if (release.label !== CURRENT_HTS_REVISION)
    console.log(`NOTE: the verified rate data is on ${CURRENT_HTS_REVISION}; the app keeps loading that index until the rates are re-verified on ${release.label}.`);
  console.log(`source ${SOURCE} (${(buf.length / 1e6).toFixed(2)} MB, ${rows.length} rows) sha256 ${sha256.slice(0, 12)}…`);
  console.log(`wrote ${OUT}: ${idx.codes.length} codes (${ten} ten-digit, ${cr} component-reporting 8-digit), ${idx.nodes.length} nodes`);
  console.log(`size ${Buffer.byteLength(json)} bytes (${(Buffer.byteLength(json) / 1e6).toFixed(2)} MB) · content sha256 ${createHash('sha256').update(json).digest('hex').slice(0, 12)}`);
  console.log(`wrote ${OUT_CH99}: ${Object.keys(ch99.headings).length} Ch. 99 subchapter III headings, ${Buffer.byteLength(ch99Json)} bytes`);
  execFileSync('git', ['add', '--', OUT, OUT_CH99], { stdio: 'inherit' });
  console.log('staged (git add) — review with git diff --cached --stat, then commit.');
}

try {
  main();
} catch (e) {
  console.error(`HTS IMPORT ABORTED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
