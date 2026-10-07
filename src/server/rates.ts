// The current verified rate table, loaded and validated once per process (server-only).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { RateFile } from '@/domain/rates/schema';
import { validateRateFile } from '@/domain/rates/validate';

export const CURRENT_RATE_FILE = join(process.cwd(), 'data', 'rates', '2026-rev20-v1.json');
const REQUIRED_HTS_REVISION = '2026 Rev. 20';

let cached: RateFile | undefined;

export function currentRateTable(): RateFile {
  if (cached) return cached;
  const result = validateRateFile(JSON.parse(readFileSync(CURRENT_RATE_FILE, 'utf8')), { requiredRevision: REQUIRED_HTS_REVISION });
  if (!result.ok || !result.file) throw new Error(`rate table invalid:\n${result.errors.join('\n')}`);
  cached = result.file;
  return cached;
}
