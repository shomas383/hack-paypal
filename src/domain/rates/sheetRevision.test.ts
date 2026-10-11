import { describe, expect, it } from 'vitest';
import { releaseFromLabel } from '@/domain/hts/release';
import { excelSerialDate, readSheetRevision } from './sheetRevision';

// Excel date serials as the sheet stores them: 46304 = 2026-10-09, 46306 = 2026-10-11.
const row = (id: string, y: string | undefined, z: string | undefined) => ({ id, y, z });
const OK = { indexRevision: '2026 Rev. 21', currentRevision: '2026 Rev. 21' };

describe('releaseFromLabel — the hts_revision label back to its release', () => {
  it('maps "2026 Rev. 21" to 2026HTSRev21 / 2026-rev21', () => {
    expect(releaseFromLabel('2026 Rev. 21')).toEqual({ name: '2026HTSRev21', year: 2026, rev: 21, label: '2026 Rev. 21', slug: '2026-rev21' });
  });
  it('refuses near misses', () => {
    for (const l of ['2026 Rev 21', '2026 Rev. 21 ', 'Rev. 21', '2026 rev. 21', '2026 Revision 21', '']) expect(() => releaseFromLabel(l), l).toThrow(/revision label/);
  });
});

describe('excelSerialDate', () => {
  it('reads a date serial as YYYY-MM-DD', () => {
    expect(excelSerialDate('46304', 'Z12')).toBe('2026-10-09');
    expect(excelSerialDate('46306', 'V12')).toBe('2026-10-11');
  });
  it('refuses text dates and blanks (a date typed as text must be re-entered as a date)', () => {
    for (const s of [undefined, '', '2026-10-09', '10/9/2026', '46304.5']) expect(() => excelSerialDate(s, 'Z12')).toThrow(/Z12/);
  });
});

describe('readSheetRevision — Verify tab columns Y (HTS revision) and Z (effective from) of the VERIFIED rows', () => {
  it('returns the revision and each row\'s effective date', () => {
    const r = readSheetRevision([row('P01', '2026 Rev. 21', '46304'), row('P14', '2026 Rev. 21', '46304')], OK);
    expect(r.revision.label).toBe('2026 Rev. 21');
    expect(r.revision.slug).toBe('2026-rev21');
    expect(r.effectiveFrom).toEqual({ P01: '2026-10-09', P14: '2026-10-09' });
  });

  it('refuses a missing or malformed revision on any row', () => {
    expect(() => readSheetRevision([row('P01', undefined, '46304')], OK)).toThrow(/P01.*Y/);
    expect(() => readSheetRevision([row('P01', '2026 Rev 21', '46304')], OK)).toThrow(/revision label/);
  });

  it('refuses rows on different revisions', () => {
    expect(() => readSheetRevision([row('P01', '2026 Rev. 21', '46304'), row('P02', '2026 Rev. 20', '46304')], { ...OK })).toThrow(/P02.*2026 Rev\. 20.*2026 Rev\. 21/);
  });

  it('refuses a sheet revision that differs from the HTS index or from the app\'s current revision', () => {
    expect(() => readSheetRevision([row('P01', '2026 Rev. 21', '46304')], { ...OK, indexRevision: '2026 Rev. 20' })).toThrow(/index/);
    expect(() => readSheetRevision([row('P01', '2026 Rev. 21', '46304')], { ...OK, currentRevision: '2026 Rev. 20' })).toThrow(/current\.ts/);
  });

  it('refuses a missing or text effective date', () => {
    expect(() => readSheetRevision([row('P01', '2026 Rev. 21', undefined)], OK)).toThrow(/P01 Z/);
    expect(() => readSheetRevision([row('P01', '2026 Rev. 21', '2026-10-09')], OK)).toThrow(/P01 Z/);
  });

  it('refuses an empty set of rows', () => {
    expect(() => readSheetRevision([], OK)).toThrow(/no VERIFIED rows/);
  });
});
