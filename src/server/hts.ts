// The committed Rev 20 HTS index (codes + description chains, no rates), loaded once per process (server-only).
// Written only by `pnpm hts:import` (scripts/import-hts.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Ch99Lookup, HtsCode, HtsIndex } from '@/domain/hts/buildIndex';
import { lookupOf, type HtsLookup } from '@/domain/classifier/hts';

export const CURRENT_HTS_FILE = join(process.cwd(), 'data', 'hts', '2026-rev20.json');

export interface LoadedHts {
  index: HtsIndex;
  codes: Map<string, HtsCode>;
  chains: Map<string, string[]>;
  lookup: HtsLookup;
}

export const CURRENT_CH99_FILE = join(process.cwd(), 'data', 'hts', '2026-rev20-ch99.json');
let cachedCh99: Ch99Lookup | undefined;

/** Official Chapter 99 subchapter III heading text (verbatim, no rates), written by `pnpm hts:import`. */
export function currentCh99(): Ch99Lookup {
  cachedCh99 ??= JSON.parse(readFileSync(CURRENT_CH99_FILE, 'utf8')) as Ch99Lookup;
  return cachedCh99;
}

let cached: LoadedHts | undefined;

export function currentHtsIndex(): LoadedHts {
  if (cached) return cached;
  const index = JSON.parse(readFileSync(CURRENT_HTS_FILE, 'utf8')) as HtsIndex;
  const lookup = lookupOf(index);
  cached = { index, codes: new Map(index.codes.map((c) => [c.c, c])), chains: lookup.chains, lookup };
  return cached;
}
