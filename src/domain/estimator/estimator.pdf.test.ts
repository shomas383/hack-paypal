// Local only: the whole Rev 21 sources (gitignored export + Ch. 99 PDF via pdftotext) through the gate with the reference
// rules. Skipped when they're missing (CI). Pins the first green G8 run on JP/EU and the coverage counts, so a change in
// extraction or coverage shows up as a diff here.
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadGolden, loadVerifiedRates } from '@/domain/rates/__fixtures__/verified';
import { currentHtsIndex } from '@/server/hts';
import { buildEstimatorData } from './data';
import { runGate } from './gate';
import { REFERENCE_RULES } from './__fixtures__/sample';

const SRC = join(process.cwd(), 'data', 'source', 'hts');
const PDF = join(SRC, 'ch99-2026-rev21.pdf');
const EXPORT = join(SRC, 'hts-export-2026-rev21-2026-10-11.json');
const local = spawnSync('pdftotext', ['-v']).status !== null && existsSync(PDF) && existsSync(EXPORT);

describe.skipIf(!local)('estimator gate — full Rev 21 sources, reference rules (local only)', { timeout: 600_000 }, () => {
  const ch99Text = spawnSync('pdftotext', ['-enc', 'UTF-8', '-layout', PDF, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 }).stdout;
  const index = currentHtsIndex().index;
  const data = buildEstimatorData({ version: 'test-e1', asOf: '2026-10-11', exportRows: JSON.parse(readFileSync(EXPORT, 'utf8')), ch99Text, index, rules: [] });
  const { report } = runGate({
    data,
    rules: REFERENCE_RULES.rules,
    rulesRevision: REFERENCE_RULES.hts_revision,
    knownCodes: index.codes.map((c) => c.c),
    golden: loadGolden().cases,
    verified: loadVerifiedRates(),
    docs: { 'docs/SPEC.md': readFileSync(join(process.cwd(), 'docs', 'SPEC.md'), 'utf8') },
    origins: ['JP', 'DE'],
  });

  // State 2026-10-11, strict G0 (decision pending): the Rev 21 text names only EO 14323 of the seven EOs the CSMS lists, so
  // only 9903.01.77/.78 are tied; the 120 others stay in force and G7 blocks JP and EU through the ones that reach every line.
  it('G0: 2 IEEPA headings tied to an EO, 120 untied and kept in force; G7 then blocks JP and EU; no rule is blocked', () => {
    expect(report.overrideTies).toHaveLength(1);
    expect(report.overrideTies[0]!.tied).toEqual({
      '9903.01.77': { eo: '14323', where: 'heading 9903.01.77' },
      '9903.01.78': { eo: '14323', where: 'heading 9903.01.78' },
    });
    expect(report.overrideTies[0]!.untied).toHaveLength(120);
    expect(report.overrideTies[0]!.untied).toEqual(expect.arrayContaining(['9903.01.25', '9903.01.29', '9903.02.01', '9903.02.20', '9903.02.73']));
    expect(report.checks.filter((c) => !c.pass).map((c) => `${c.id} ${c.subject}`)).toEqual(['G0 docs/SPEC.md EO ties', 'G7 origin JP', 'G7 origin DE']);
    expect(report.blockedOrigins).toEqual({
      JP: ['G7 unplaced headings 9903.01.25, 9903.01.29, 9903.02.01, 9903.02.73'],
      EU: ['G7 unplaced headings 9903.01.25, 9903.01.29, 9903.02.01, 9903.02.20'],
    });
    expect(report.blockedRules).toEqual([]);
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

  it('G8: every JP / DE verified case reproduced exactly, P11 refused on its 232 note, P07 refused as a chapter 98 provision', () => {
    const g8 = Object.fromEntries(report.checks.filter((c) => c.id === 'G8').map((c) => [c.subject, c.detail]));
    expect(Object.keys(g8)).toEqual([
      'P01 JP 9504.40.0000', 'P02 JP 9504.40.0000', 'P03 JP 9102.21.70', 'P04 JP 9006.53.0205', 'P06 JP 9507.30.6000', 'P07 JP 9801.00.1098',
      'P08 JP 6203.42.4511', 'P10 JP 9506.31.0000', 'P11 JP 8211.92.9030', 'P12 JP 8523.49.4000', 'P14 DE 9102.21.70',
    ]);
    expect(g8['P01 JP 9504.40.0000']).toBe('estimate 1188 (9903.05.49) vs verified 1188 (9903.05.49)');
    expect(g8['P08 JP 6203.42.4511']).toBe('estimate 3320 (9903.05.48) vs verified 3320 (9903.05.48)');
    expect(g8['P12 JP 8523.49.4000']).toBe('estimate 0 (9903.05.92) vs verified 0 (9903.05.92)');
    expect(g8['P14 DE 9102.21.70']).toBe('estimate 2900 (9903.05.39) vs verified 2900 (9903.05.39)');
    expect(g8['P11 JP 8211.92.9030']).toMatch(/^refused \(UNMODELED_REGIME: note III 16\(c\)\(vii\)\); verified row records note\(s\) 16/);
    expect(g8['P07 JP 9801.00.1098']).toBe('refused as expected (SPECIAL_PROVISION)');
  });

  it('coverage and out-of-force counts (pinned)', () => {
    // line refusals before the origin block (the block refuses every line on top): untied IEEPA headings named by note 2's lists
    expect({ JP: report.coverage.JP!.refused, DE: report.coverage.DE!.refused, lines: report.coverage.JP!.lines }).toEqual({ JP: 6434, DE: 5987, lines: 19926 });
    const why = Object.values(data.outOfForce).reduce<Record<string, number>>((m, o) => ((m[o.why] = (m[o.why] ?? 0) + 1), m), {});
    expect(why).toEqual({ compiler_note: 74, entry_window_closed: 3, note_compiler_note: 10, verified_override: 2 });
    expect(report.listCounts['note III 52(d)']).toMatchObject({ codes: 541, ch98: 6, unknown: [] });
  });
});
