// Everything the estimator and the gate read, built from official sources (pure; the build script does the I/O).
import { chainsOf, type HtsIndex } from '@/domain/hts/buildIndex';
import { buildBaseRates, type BaseRates, type RateExportRow } from './baseRates';
import { segmentNotes, type Ch99Notes, type SegmentOptions } from './ch99Notes';
import { stripPageFurniture } from './ch99Text';
import { buildHeadingTable, outOfForce, type HeadingTable, type OutOfForce, type VerifiedOverride } from './headings';
import { buildMentions, type MentionsIndex } from './mentions';
import type { OriginGroup } from './origin';
import type { Rule } from './rules';

export interface EstimatorData {
  /** Estimator data version, e.g. "2026-rev21-e1". */
  version: string;
  hts_revision: string;
  /** Out-of-force decisions (entry windows) are made as of this date (YYYY-MM-DD). */
  asOf: string;
  /** The last date the data stays right (headings.ts validUntil, scoped by the gate's accepted rules); after it, estimates refuse until a rebuild. Null: no end. */
  validUntil: string | null;
  headings: HeadingTable;
  outOfForce: Record<string, OutOfForce>;
  notes: Ch99Notes;
  mentions: MentionsIndex;
  base: BaseRates;
  /** Index code → official description chain (root first). */
  chains: Map<string, string[]>;
  /** Rules accepted by the gate. */
  rules: Rule[];
  /** Rules the gate blocked (their lines are refused), and origins it blocked (all their lines are refused). */
  blocked: { rules: { rule: Rule; reasons: string[] }[]; origins: Partial<Record<OriginGroup, string[]>> };
}

export interface EstimatorSources {
  version: string;
  asOf: string;
  exportRows: RateExportRow[];
  /** `pdftotext -enc UTF-8 -layout` output of the Chapter 99 PDF of the same release. */
  ch99Text: string;
  index: HtsIndex;
  rules: Rule[];
  overrides?: VerifiedOverride[];
  /** Tests on an excerpt of the Ch. 99 text that starts inside a note (segmentNotes `startIn`). */
  notesStartIn?: SegmentOptions['startIn'];
}

export function buildEstimatorData(src: EstimatorSources): Omit<EstimatorData, 'rules' | 'blocked'> {
  const notes = segmentNotes(stripPageFurniture(src.ch99Text), src.notesStartIn ? { startIn: src.notesStartIn } : {});
  const headings = buildHeadingTable(src.exportRows);
  // with parent rows: "Sugars … provided for in subheading 1701.12.10 …" above 9903.17.01 is that heading's scope
  const ch99Text: Record<string, string> = Object.fromEntries(Object.entries(headings).filter(([h]) => h.startsWith('9903.')).map(([h, i]) => [h, i.chain]));
  const base = buildBaseRates(src.exportRows, { hts_revision: src.index.hts_revision, source: src.index.source, codes: src.index.codes.map((c) => c.c) });
  const oof = outOfForce(headings, notes, src.asOf, src.overrides);
  return {
    version: src.version,
    hts_revision: src.index.hts_revision,
    asOf: src.asOf,
    // set by the gate from the rules it accepts (headings.ts validUntil)
    validUntil: null,
    headings,
    outOfForce: oof,
    notes,
    mentions: buildMentions(notes, ch99Text, Object.fromEntries(Object.entries(base.codes).map(([c, v]) => [c, v.fn]))),
    base,
    chains: chainsOf(src.index),
  };
}
