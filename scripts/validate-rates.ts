// pnpm rates:validate — schema + semantic checks on every rate data file; the CURRENT version's keys are also checked
// against the official HTS index (every key a real line of the current revision; 8-digit keys only for component reporting). Older
// versions are kept as history (stored quotes reference them) and are not key-checked. Exit 1 on any failure.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HtsIndex } from '../src/domain/hts/buildIndex';
import { releaseFromLabel } from '../src/domain/hts/release';
import { CURRENT_HTS_REVISION, rateFileName } from '../src/domain/rates/current';
import { checkRateKeysAgainstHts } from '../src/domain/rates/htsKeys';
import { validateRateFile } from '../src/domain/rates/validate';

// The HTS revision every row was verified against (docs/HTS_VERIFICATION_SPEC.md). Bump together with a re-verification.
const REQUIRED_HTS_REVISION = CURRENT_HTS_REVISION;
const DIR = join('data', 'rates');
const HTS_INDEX = join('data', 'hts', `${releaseFromLabel(REQUIRED_HTS_REVISION).slug}.json`);

let files: string[] = [];
try {
  files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
} catch {
  // missing directory → reported below
}
if (files.length === 0) {
  console.error(`rates:validate — no rate files in ${DIR}/ (generate with pnpm rates:import)`);
  process.exit(1);
}

const hts = JSON.parse(readFileSync(HTS_INDEX, 'utf8')) as HtsIndex;
const htsCodes = { hts_revision: hts.hts_revision, codes: new Map(hts.codes.map((c) => [c.c, c.componentReporting ? { componentReporting: true as const } : {}])) };

let failed = 0;
for (const name of files) {
  const path = join(DIR, name);
  let data: unknown;
  try {
    data = JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    console.error(`FAIL ${path}: not valid JSON (${e instanceof Error ? e.message : String(e)})`);
    failed++;
    continue;
  }
  const current = name === rateFileName();
  // History files keep the revision they were verified on; only the current file must be on the current revision.
  const own = (data as { hts_revision?: unknown } | null)?.hts_revision;
  const result = validateRateFile(data, { requiredRevision: current || typeof own !== 'string' ? REQUIRED_HTS_REVISION : own });
  const keyErrors = result.ok && result.file && current ? checkRateKeysAgainstHts(result.file.rows, htsCodes, REQUIRED_HTS_REVISION) : [];
  if (result.ok && result.file && keyErrors.length === 0) {
    console.log(
      `PASS ${path}: ${result.file.rows.length} rows, version ${result.file.version}, ${result.file.hts_revision}` +
        (current ? `, every key a real ${hts.hts_revision} line (HTS index)` : ' (history; keys not checked against the HTS index)'),
    );
  } else {
    failed++;
    console.error(`FAIL ${path}:`);
    for (const err of [...result.errors, ...keyErrors]) console.error(`  - ${err}`);
  }
}
process.exit(failed ? 1 : 0);
