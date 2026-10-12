// Local only: the whole Rev 21 sources (gitignored export + Ch. 99 PDF via pdftotext) through the gate with the reference
// rules. Skipped when they're missing (CI). Pins the first green G8 run on JP/EU and the coverage counts, so a change in
// extraction or coverage shows up as a diff here.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGolden, loadVerifiedRates } from '@/domain/rates/__fixtures__/verified';
import { ieepaOverride } from '@/server/estimatorReview';
import { currentHtsIndex } from '@/server/hts';
import { buildEstimatorData } from './data';
import { runGate } from './gate';
import type { RulesFile } from './rules';
import { REFERENCE_RULES } from './__fixtures__/sample';

const CN_RULES = (JSON.parse(readFileSync(join(__dirname, '__fixtures__', 'rules-reference-cn.json'), 'utf8')) as RulesFile).rules;

const SRC = join(process.cwd(), 'data', 'source', 'hts');
const PDF = join(SRC, 'ch99-2026-rev21.pdf');
const EXPORT = join(SRC, 'hts-export-2026-rev21-2026-10-11.json');
const local = spawnSync('pdftotext', ['-v']).status !== null && existsSync(PDF) && existsSync(EXPORT);

describe.skipIf(!local)('estimator gate — full Rev 21 sources, reference rules (local only)', { timeout: 600_000 }, () => {
  const ch99Text = spawnSync('pdftotext', ['-enc', 'UTF-8', '-layout', PDF, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout;
  const index = currentHtsIndex().index;
  const overrides = [ieepaOverride()];
  const data = buildEstimatorData({ version: 'test-e1', asOf: '2026-10-12', exportRows: JSON.parse(readFileSync(EXPORT, 'utf8')), ch99Text, index, rules: [], overrides });
  const { report } = runGate({
    data,
    rules: [...REFERENCE_RULES.rules, ...CN_RULES],
    rulesRevision: REFERENCE_RULES.hts_revision,
    knownCodes: index.codes.map((c) => c.c),
    golden: loadGolden().cases,
    verified: loadVerifiedRates(),
    docs: { 'docs/SPEC.md': readFileSync(join(process.cwd(), 'docs', 'SPEC.md'), 'utf8') },
    origins: ['JP', 'DE', 'CN'],
    overrides,
  });

  it('every check passes; nothing is blocked', () => {
    expect(report.checks.filter((c) => !c.pass).map((c) => `${c.id} ${c.subject}: ${c.detail}`)).toEqual([]);
    expect(report.blockedRules).toEqual([]);
    expect(report.blockedOrigins).toEqual({});
  });

  it('G0: all 120 reviewed IEEPA headings present with their reviewed text; only the two flagged ones stay in force', () => {
    expect(report.overrideTies).toHaveLength(1);
    const t = report.overrideTies[0]!;
    expect(Object.keys(t.tied)).toHaveLength(120);
    expect({ changed: t.changed, missing: t.missing, unlisted: t.unlisted }).toEqual({ changed: [], missing: [], unlisted: ['9903.02.76', '9903.02.81'] });
    expect(data.outOfForce['9903.01.25']).toMatchObject({ why: 'verified_override', ref: 'data/reviews/ieepa-ended-2026-rev21.json (EO 14257 (as amended); reviewed 2026-10-11)' });
  });

  it('the Section 122 headings 9903.03.01–.11 are out of force from note 2(aa)\'s own compiler\'s note, not from the IEEPA override', () => {
    const hs = Object.keys(data.headings).filter((x) => x >= '9903.03.01' && x <= '9903.03.11');
    expect(hs.length).toBeGreaterThan(5);
    for (const h of hs) {
      expect(data.outOfForce[h]?.why).not.toBe('verified_override');
      if (h === '9903.03.02') {
        // its own text closes first: entered "before 12:01 a.m. eastern standard time on February 28, 2026"
        expect(data.outOfForce[h]).toMatchObject({ why: 'entry_window_closed', ref: 'heading 9903.03.02' });
        continue;
      }
      expect(data.outOfForce[h]).toMatchObject({ why: 'note_compiler_note', ref: 'note III 2(aa)' });
      expect(data.outOfForce[h]!.quote).toMatch(/headings 9903\.03\.01–9903\.03\.11 expired at the close of July 23, 2026/);
    }
  });

  it('G8: every JP / DE / CN verified case reproduced exactly, P11 refused on its 232 note, P07 refused as a chapter 98 provision', () => {
    const g8 = Object.fromEntries(report.checks.filter((c) => c.id === 'G8').map((c) => [c.subject, c.detail]));
    expect(Object.keys(g8)).toEqual([
      'P01 JP 9504.40.0000', 'P02 JP 9504.40.0000', 'P03 JP 9102.21.70', 'P04 JP 9006.53.0205', 'P05 CN 9503.00.0090', 'P06 JP 9507.30.6000',
      'P07 JP 9801.00.1098', 'P08 JP 6203.42.4511', 'P09 CN 9504.50.0000', 'P10 JP 9506.31.0000', 'P11 JP 8211.92.9030', 'P12 JP 8523.49.4000',
      'P13 CN 9102.21.70', 'P14 DE 9102.21.70',
    ]);
    expect(g8['P05 CN 9503.00.0090']).toBe('estimate 813 (9903.05.31) vs verified 813 (9903.05.31)');
    expect(g8['P09 CN 9504.50.0000']).toBe('estimate 1500 (9903.05.31) vs verified 1500 (9903.05.31)');
    expect(g8['P13 CN 9102.21.70']).toBe('estimate 7209 (9903.05.31 + 9903.88.15) vs verified 7209 (9903.05.31 + 9903.88.15)');
    expect(g8['P01 JP 9504.40.0000']).toBe('estimate 1188 (9903.05.49) vs verified 1188 (9903.05.49)');
    expect(g8['P08 JP 6203.42.4511']).toBe('estimate 3320 (9903.05.48) vs verified 3320 (9903.05.48)');
    expect(g8['P12 JP 8523.49.4000']).toBe('estimate 0 (9903.05.92) vs verified 0 (9903.05.92)');
    expect(g8['P14 DE 9102.21.70']).toBe('estimate 2900 (9903.05.39) vs verified 2900 (9903.05.39)');
    expect(g8['P11 JP 8211.92.9030']).toMatch(/^refused \(UNMODELED_REGIME: note III 16\(c\)\(vii\)\); verified row records note\(s\) 16/);
    expect(g8['P07 JP 9801.00.1098']).toBe('refused as expected (SPECIAL_PROVISION)');
  });

  it('coverage and out-of-force counts (pinned)', () => {
    // line refusals (232 and other unmodeled regimes; the two flagged civil-aircraft exemption headings stay in force).
    // 2026-10-12: 19 headings whose own entry period has ended are out of force; for JP/DE that frees 9018.31.0080
    // (9903.91.10, enteral syringes of China, before January 1, 2026). CN: no note 52 exemption rules for CN yet.
    expect({ JP: report.coverage.JP!.refused, DE: report.coverage.DE!.refused, CN: report.coverage.CN!.refused, lines: report.coverage.JP!.lines }).toEqual({
      JP: 5446, DE: 4941, CN: 6341, lines: 19926,
    });
    const why = Object.values(data.outOfForce).reduce<Record<string, number>>((m, o) => ((m[o.why] = (m[o.why] ?? 0) + 1), m), {});
    expect(why).toEqual({ compiler_note: 74, entry_window_closed: 22, note_compiler_note: 10, verified_override: 120 });
    expect(report.exclusions.counts).toEqual({ in_effect: 5, expired: 58, unclear: 8 });
    expect(report.listCounts['note III 52(d)']).toMatchObject({ codes: 541, ch98: 6, unknown: [] });
  });
});
