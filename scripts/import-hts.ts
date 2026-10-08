// pnpm hts:import — builds the compact Rev 20 HTS index (codes + description chains, no rates) from the official export
// downloaded from hts.usitc.gov, writes it to the protected index folder and stages it. The only writer of that folder
// (.claude/hooks/protect-rates.mjs). Source: the gitignored export in data/source/hts/.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildHtsIndex, chainsOf, type ExportRow } from '../src/domain/hts/buildIndex';

const SOURCE = join('data', 'source', 'hts', 'hts-2026-rev20-export.json');
const OUT = join('data', 'hts', '2026-rev20.json');
// The export carries no revision field. The user downloaded it on 2026-10-07 while hts.usitc.gov showed 2026 Rev 20 as
// current; the string matches the rate table's hts_revision exactly (locked by src/server/hts.test.ts).
const META = {
  hts_revision: '2026 Rev. 20',
  url: 'https://hts.usitc.gov/reststop/exportList?from=0101&to=9999&format=JSON&styles=false',
  exportedOn: '2026-10-07',
};

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

function main() {
  const buf = readFileSync(SOURCE);
  const sha256 = createHash('sha256').update(buf).digest('hex');
  const rows = JSON.parse(buf.toString('utf8')) as ExportRow[];
  const idx = buildHtsIndex(rows, {
    hts_revision: META.hts_revision,
    source: { url: META.url, exportedOn: META.exportedOn, file: SOURCE.replace(/\\/g, '/'), sha256 },
  });

  // Fail fast on the facts we rely on (also covered by src/server/hts.test.ts against the committed file).
  const chains = chainsOf(idx);
  const byCode = new Map(idx.codes.map((c) => [c.c, c]));
  assert(chains.get('6203.42.4511')?.some((d) => d.includes("Men's trousers and breeches")), '6203.42.4511 chain lacks "Men\'s trousers and breeches"');
  assert(!byCode.has('6203.42.4011'), '6203.42.4011 (pre-renumbering) must be absent');
  assert(byCode.has('9006.53.0205'), '9006.53.0205 must be present');
  assert(byCode.get('9102.21.70')?.componentReporting === true, '9102.21.70 must be a component-reporting code');

  const json = JSON.stringify(idx) + '\n';
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, json);

  const ten = idx.codes.filter((c) => !c.componentReporting).length;
  const cr = idx.codes.length - ten;
  console.log(`source ${SOURCE} (${(buf.length / 1e6).toFixed(2)} MB, ${rows.length} rows) sha256 ${sha256.slice(0, 12)}…`);
  console.log(`wrote ${OUT}: ${idx.codes.length} codes (${ten} ten-digit, ${cr} component-reporting 8-digit), ${idx.nodes.length} nodes`);
  console.log(`size ${Buffer.byteLength(json)} bytes (${(Buffer.byteLength(json) / 1e6).toFixed(2)} MB) · content sha256 ${createHash('sha256').update(json).digest('hex').slice(0, 12)}`);
  execFileSync('git', ['add', '--', OUT], { stdio: 'inherit' });
  console.log('staged (git add) — review with git diff --cached --stat, then commit.');
}

try {
  main();
} catch (e) {
  console.error(`HTS IMPORT ABORTED: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
}
