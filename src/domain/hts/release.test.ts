import { describe, expect, it } from 'vitest';
import { parseReleaseName, verifyExportMeta } from './release';

const SHA = 'bea73f235732215a4bfab973be7495c16c450c65b78e40f58324031ebf092a09';
const rel = (name: string) => ({ name, description: `2026 HTS Revision ${name.slice(-2)}`, title: 'Revision 21 (2026)' });
const meta = (over: Record<string, unknown> = {}) => ({
  file: 'hts-export-2026-10-10.json',
  url: 'https://hts.usitc.gov/reststop/exportList?from=0101&to=9999&format=JSON&styles=false',
  downloadedAt: '2026-10-11T03:41:30.115Z',
  sha256: SHA,
  currentRelease: rel('2026HTSRev21'),
  currentReleaseAfter: rel('2026HTSRev21'),
  ...over,
});

describe('parseReleaseName — the hts.usitc.gov release name (reststop/currentRelease "name")', () => {
  it('maps 2026HTSRev21 to the revision label and file slug', () => {
    expect(parseReleaseName('2026HTSRev21')).toEqual({ name: '2026HTSRev21', year: 2026, rev: 21, label: '2026 Rev. 21', slug: '2026-rev21' });
    // The label format equals the committed one for Rev 20 (the rate table's hts_revision).
    expect(parseReleaseName('2026HTSRev20').label).toBe('2026 Rev. 20');
    expect(parseReleaseName('2026HTSRev20').slug).toBe('2026-rev20');
  });

  it('refuses anything else (no guessing a revision)', () => {
    for (const n of ['', '2026HTSRev', '2026 HTS Rev 21', '2026HTSRev21a', 'HTSRev21', '26HTSRev21', '2026HTSBasic', '2026htsrev21'])
      expect(() => parseReleaseName(n), n).toThrow(/release name/);
  });
});

describe('verifyExportMeta — the sidecar written next to a downloaded export', () => {
  it('returns the release when the file hash matches and the release did not change during the download', () => {
    expect(verifyExportMeta(meta(), SHA).release.label).toBe('2026 Rev. 21');
    expect(verifyExportMeta(meta(), SHA).meta.downloadedAt).toBe('2026-10-11T03:41:30.115Z');
  });

  it('refuses a hash mismatch (the sidecar describes another file)', () => {
    expect(() => verifyExportMeta(meta(), SHA.replace(/^b/, 'c'))).toThrow(/sha256/);
  });

  it('refuses when currentRelease changed between the readings before and after the download', () => {
    expect(() => verifyExportMeta(meta({ currentReleaseAfter: rel('2026HTSRev22') }), SHA)).toThrow(/changed during the download/);
  });

  it('requires both readings, a well-formed name, and no unknown keys', () => {
    const noAfter: Record<string, unknown> = meta();
    delete noAfter.currentReleaseAfter;
    expect(() => verifyExportMeta(noAfter, SHA)).toThrow();
    expect(() => verifyExportMeta(meta({ currentRelease: rel('Rev21'), currentReleaseAfter: rel('Rev21') }), SHA)).toThrow(/release name/);
    expect(() => verifyExportMeta(meta({ hts_revision: '2026 Rev. 20' }), SHA)).toThrow(); // a revision can't be asserted by hand
    expect(() => verifyExportMeta(meta({ sha256: 'abc' }), SHA)).toThrow();
    expect(() => verifyExportMeta(null, SHA)).toThrow();
  });
});
