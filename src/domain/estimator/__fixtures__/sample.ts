// Estimator test data from committed official excerpts (no gitignored sources): the Rev 21 export rows of a few lines and
// their parents plus headings 9903.05.38–.99 / 9903.06.xx (export-sample-rev21.json, cut from the 2026-10-11 export), the
// note 52 pages of the Ch. 99 PDF text (ch99-rev21-note52.txt), and the hand-written reference rules.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildHtsIndex } from '@/domain/hts/buildIndex';
import { ieepaOverride } from '@/server/estimatorReview';
import { currentHtsIndex } from '@/server/hts';
import { loadGolden, loadVerifiedRates } from '@/domain/rates/__fixtures__/verified';
import type { RateFile } from '@/domain/rates/schema';
import type { RateExportRow } from '../baseRates';
import { buildEstimatorData } from '../data';
import { runGate, type GateInput } from '../gate';
import type { Rule, RulesFile } from '../rules';

const read = (f: string) => readFileSync(join(__dirname, f), 'utf8');
export const SAMPLE_ROWS = JSON.parse(read('export-sample-rev21.json')) as RateExportRow[];
export const NOTE52_TEXT = read('ch99-rev21-note52.txt');
export const REFERENCE_RULES = JSON.parse(read('rules-reference-jp-eu.json')) as RulesFile;
export const ASOF = '2026-10-11';

/** The reviewed IEEPA list, narrowed to the listed headings the excerpt carries (none: no 9903.01/.02 rows in the sample). */
export const sampleOverride = () => {
  const o = ieepaOverride();
  const present = new Set(SAMPLE_ROWS.map((r) => r.htsno));
  return { ...o, headings: o.headings.filter((h) => present.has(h.heading)) };
};

export const sampleIndex = () =>
  buildHtsIndex(SAMPLE_ROWS, { hts_revision: '2026 Rev. 21', source: { url: 'export-sample-rev21.json', exportedOn: '2026-10-11' } });

export function sampleData() {
  return buildEstimatorData({ version: 'test-e1', asOf: ASOF, exportRows: SAMPLE_ROWS, ch99Text: NOTE52_TEXT, index: sampleIndex(), rules: [], notesStartIn: { section: 'III', note: 51 }, overrides: [sampleOverride()] });
}

/**
 * The verified rows and golden cases whose lines are in the sample. P11 is left out: its Section 232 regime lives in note 16,
 * which the note 52 excerpt doesn't carry (the full-document test covers it).
 */
export function sampleVerified(): { verified: RateFile; golden: GateInput['golden'] } {
  const codes = new Set(sampleIndex().codes.map((c) => c.c));
  const v = loadVerifiedRates();
  const verified = { ...v, rows: v.rows.filter((r) => codes.has(r.hts10)) };
  const golden = loadGolden().cases.filter((c) => c.id !== 'P11' && (codes.has(c.hts10 ?? '') || (c.hts10 ?? '').startsWith('98')));
  return { verified, golden };
}

export function sampleGate(rules: unknown[] = REFERENCE_RULES.rules, over: Partial<GateInput> = {}) {
  const { verified, golden } = sampleVerified();
  return runGate({
    data: sampleData(),
    rules,
    rulesRevision: REFERENCE_RULES.hts_revision,
    knownCodes: currentHtsIndex().index.codes.map((c) => c.c), // the committed Rev 21 index (G5 checks lists against all lines)
    golden,
    verified,
    docs: { 'docs/SPEC.md': readFileSync(join(process.cwd(), 'docs', 'SPEC.md'), 'utf8') },
    origins: ['JP', 'DE'],
    overrides: [sampleOverride()],
    ...over,
  });
}

export const ruleById = (id: string): Rule => structuredClone(REFERENCE_RULES.rules.find((r) => r.id === id)!);
