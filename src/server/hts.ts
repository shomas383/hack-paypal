// The committed Rev 20 HTS index (codes + description chains, no rates), loaded once per process (server-only).
// Written only by `pnpm hts:import` (scripts/import-hts.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chainsOf, type HtsCode, type HtsIndex } from '@/domain/hts/buildIndex';

export const CURRENT_HTS_FILE = join(process.cwd(), 'data', 'hts', '2026-rev20.json');

export interface LoadedHts {
  index: HtsIndex;
  codes: Map<string, HtsCode>;
  chains: Map<string, string[]>;
}

let cached: LoadedHts | undefined;

export function currentHtsIndex(): LoadedHts {
  if (cached) return cached;
  const index = JSON.parse(readFileSync(CURRENT_HTS_FILE, 'utf8')) as HtsIndex;
  cached = { index, codes: new Map(index.codes.map((c) => [c.c, c])), chains: chainsOf(index) };
  return cached;
}
