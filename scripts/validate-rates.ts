// pnpm rates:validate — schema + semantic checks on every rate data file. Exit 1 on any failure.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { validateRateFile } from '../src/domain/rates/validate';

// The HTS revision every row was verified against (docs/HTS_VERIFICATION_SPEC.md). Bump together with a re-verification.
const REQUIRED_HTS_REVISION = '2026 Rev. 20';
const DIR = join('data', 'rates');

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
  const result = validateRateFile(data, { requiredRevision: REQUIRED_HTS_REVISION });
  if (result.ok && result.file) {
    console.log(`PASS ${path}: ${result.file.rows.length} rows, version ${result.file.version}, ${result.file.hts_revision}`);
  } else {
    failed++;
    console.error(`FAIL ${path}:`);
    for (const err of result.errors) console.error(`  - ${err}`);
  }
}
process.exit(failed ? 1 : 0);
