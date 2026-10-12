// The committed estimator data version (current.json → <version>/), loaded once per process (server-only). Written only by
// `pnpm estimator:build` (hook-guarded). The mentions index and the description chains are rebuilt here from the committed
// notes, headings, base rates and HTS index, exactly as the build did. Estimate mode only: nothing on the checkout, capture,
// quote or agent path imports this (noCharge.test.ts).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { BaseRates } from '@/domain/estimator/baseRates';
import type { Ch99Notes } from '@/domain/estimator/ch99Notes';
import type { EstimatorData } from '@/domain/estimator/data';
import type { HeadingTable, OutOfForce } from '@/domain/estimator/headings';
import { buildMentions } from '@/domain/estimator/mentions';
import type { OriginGroup } from '@/domain/estimator/origin';
import type { Rule } from '@/domain/estimator/rules';
import { currentHtsIndex } from './hts';

const DIR = join(process.cwd(), 'data', 'estimator');

export interface EstimatorManifest {
  version: string;
  hts_revision: string;
  as_of: string;
  /** Absent in versions before 2026-rev21-e3 (no end recorded). */
  valid_until?: string | null;
  rules: string;
}

const readJson = <T>(...parts: string[]) => JSON.parse(readFileSync(join(DIR, ...parts), 'utf8')) as T;

let cached: { data: EstimatorData; manifest: EstimatorManifest } | undefined;

export function currentEstimatorVersion(): string {
  return readJson<{ version: string }>('current.json').version;
}

export function loadEstimator(): { data: EstimatorData; manifest: EstimatorManifest } {
  if (cached) return cached;
  const version = currentEstimatorVersion();
  const manifest = readJson<EstimatorManifest>(version, 'manifest.json');
  const hts = currentHtsIndex();
  if (manifest.hts_revision !== hts.index.hts_revision)
    throw new Error(`estimator data ${version} is for ${manifest.hts_revision}, the HTS index is ${hts.index.hts_revision} — run pnpm estimator:build`);
  const { headings, outOfForce } = readJson<{ headings: HeadingTable; outOfForce: Record<string, OutOfForce> }>(version, 'headings.json');
  const notes = readJson<Ch99Notes>(version, 'notes.json');
  const base = readJson<BaseRates>(version, 'base-rates.json');
  const rules = readJson<{ rules: Rule[]; blocked: { rule: Rule; reasons: string[] }[] }>(version, 'rules.json');
  const report = readJson<{ blockedOrigins: Partial<Record<OriginGroup, string[]>> }>(version, 'report.json');
  // as in buildEstimatorData: Ch. 99 subchapter III heading text with parent rows, and each line's own Ch. 99 footnotes
  const ch99Text = Object.fromEntries(Object.entries(headings).filter(([h]) => h.startsWith('9903.')).map(([h, i]) => [h, i.chain]));
  const data: EstimatorData = {
    version,
    hts_revision: manifest.hts_revision,
    asOf: manifest.as_of,
    validUntil: manifest.valid_until ?? null,
    headings,
    outOfForce,
    notes,
    mentions: buildMentions(notes, ch99Text, Object.fromEntries(Object.entries(base.codes).map(([c, v]) => [c, v.fn]))),
    base,
    chains: hts.chains,
    rules: rules.rules,
    blocked: { rules: rules.blocked, origins: report.blockedOrigins },
  };
  cached = { data, manifest };
  return cached;
}
