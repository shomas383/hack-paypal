import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { expandHeading, validateHts10 } from '@/domain/classifier/hts';
import { CURRENT_HTS_REVISION, goldenFileName } from '@/domain/rates/current';
import { checkRateKeysAgainstHts } from '@/domain/rates/htsKeys';
import { CURRENT_CH99_FILE, currentCh99, currentHtsIndex, CURRENT_HTS_FILE } from './hts';
import { currentRateTable } from './rates';

// Spot checks against the COMMITTED index of the current revision (built by pnpm hts:import).
const { index, codes, chains, lookup } = currentHtsIndex();

describe(`committed HTS index (${CURRENT_HTS_REVISION})`, () => {
  it('6203.42.4511 is present, with "Men\'s trousers and breeches" and "Blue denim" in its chain', () => {
    const chain = chains.get('6203.42.4511')!.join(' > ');
    expect(chain).toContain("Men's trousers and breeches");
    expect(chain).toContain('Blue denim');
  });

  it('6203.42.4011 (the pre-renumbering P08 code) is absent; 9006.53.0205 is present', () => {
    expect(codes.has('6203.42.4011')).toBe(false);
    expect(codes.has('9006.53.0205')).toBe(true);
  });

  it('9102.21.70 is an 8-digit component-reporting code (Ch. 91 Statistical Note 1); 9102.21.7000 does not exist', () => {
    expect(codes.get('9102.21.70')).toMatchObject({ componentReporting: true });
    expect(codes.has('9102.21.7000')).toBe(false);
    expect(chains.get('9102.21.70')!.join(' > ')).toContain('over 17 jewels');
  });

  it('every eval / golden code is present, except the watch (component reporting) and 9801.00.1098 (Ch. 98, excluded)', () => {
    const products = JSON.parse(readFileSync('data/eval/products.json', 'utf8')) as { expected: { hts10: string | null } }[];
    const golden = JSON.parse(readFileSync(`data/eval/${goldenFileName()}`, 'utf8')) as { cases: { hts10: string }[] };
    const all = new Set([...products.map((p) => p.expected.hts10).filter((h): h is string => !!h), ...golden.cases.map((c) => c.hts10)]);
    const missing = [...all].filter((h) => !codes.has(h)).sort();
    expect(missing).toEqual(['9801.00.1098']); // Ch. 98, excluded by design (P07 US goods returned → UNSUPPORTED)
  });

  it('every row of the current rate table is a real line of the current revision, with the matching component-reporting flag', () => {
    expect(checkRateKeysAgainstHts(currentRateTable().rows, { hts_revision: index.hts_revision, codes }, currentRateTable().hts_revision)).toEqual([]);
    expect(currentRateTable().rows.find((r) => r.hts10 === '9102.21.70')).toMatchObject({ id: 'JP-9102.21.70', component_reporting: true });
  });

  it('contains no Chapter 98/99 codes and no rate fields or rate text', () => {
    expect(index.codes.some((c) => /^9[89]/.test(c.c))).toBe(false);
    const text = readFileSync(CURRENT_HTS_FILE, 'utf8');
    for (const k of ['general', 'special', 'other', 'additionalDuties', 'footnotes']) expect(text).not.toContain(`"${k}":`);
    expect(index.codes.every((c) => /^\d{4}\.\d{2}\.\d{2}(\d{2})?$/.test(c.c))).toBe(true);
  });

  it('expandHeading on the real index: 6203.42 → 39 lines incl. 6203.42.4511; 9102.21 → its 6 component-reporting lines', () => {
    const cotton = expandHeading('6203.42', lookup);
    expect(cotton).toHaveLength(39);
    expect(cotton.map((c) => c.code)).toContain('6203.42.4511');
    const watches = expandHeading('9102.21', lookup);
    expect(watches.map((c) => c.code)).toEqual(['9102.21.10', '9102.21.25', '9102.21.30', '9102.21.50', '9102.21.70', '9102.21.90']);
    expect(watches.every((c) => c.componentReporting)).toBe(true);
    expect(validateHts10('9102.21.70', lookup)).toMatchObject({ ok: true, componentReporting: true });
  });

  it('Ch. 99 lookup: official heading text for every heading the current rate rows use; no rate columns', () => {
    const ch99 = currentCh99();
    expect(ch99.hts_revision).toBe(index.hts_revision);
    expect(ch99.headings['9903.05.49']).toMatch(/the product of Japan.*U\.S\. note 52/);
    expect(ch99.headings['9903.05.31']).toMatch(/the product of China/);
    const used = currentRateTable().rows.flatMap((r) => [
      ...r.additional.flatMap((a) => [a.chapter99, a.chapter99_at_or_above_cap].filter((x): x is string => !!x)),
      ...r.not_applied.map((n) => n.chapter99),
    ]);
    expect(used.filter((h) => !ch99.headings[h])).toEqual([]);
    expect(readFileSync(CURRENT_CH99_FILE, 'utf8')).not.toMatch(/"(general|special|other|additionalDuties)":/);
  });

  it('revision lock: the HTS index revision equals the rate table revision', () => {
    expect(index.hts_revision).toBe(CURRENT_HTS_REVISION);
    expect(index.hts_revision).toBe(currentRateTable().hts_revision);
  });
});
