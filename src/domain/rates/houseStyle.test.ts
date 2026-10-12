// House style for generated rate data (the current version): refs, notes and regime notes cite note and heading numbers
// only — never a program name. Every string the importer writes is checked; `evidence` is the Verify sheet's column W
// copied verbatim (shown on no page and to no agent), left as the sheet has it until the next sheet edit — the rows whose
// W still names a program are pinned so the exception can't grow.
import { describe, expect, it } from 'vitest';
import { loadGolden, loadVerifiedRates } from './__fixtures__/verified';

const PROGRAM = /Section 232|\b301\b|IEEPA|CSMS/i;

function strings(v: unknown, path: string, out: { path: string; text: string }[]): void {
  if (typeof v === 'string') out.push({ path, text: v });
  else if (Array.isArray(v)) v.forEach((x, i) => strings(x, `${path}[${i}]`, out));
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) strings(x, path ? `${path}.${k}` : k, out);
}

describe('house style: generated rates text names no program', () => {
  const rates = loadVerifiedRates();
  const all: { path: string; text: string }[] = [];
  strings(rates, '', all);

  it('no generated string (refs, notes, regime notes, sources) contains Section 232, 301, IEEPA or CSMS', () => {
    const hits = all.filter((s) => !/\.evidence$/.test(s.path) && PROGRAM.test(s.text));
    expect(hits).toEqual([]);
  });

  it('sheet column W (evidence, verbatim) still names one in exactly these rows — fix at the next sheet edit', () => {
    const rows = rates.rows.filter((r) => PROGRAM.test(r.evidence)).map((r) => r.listings.join('+'));
    expect(rows).toEqual(['P05', 'P09', 'P13', 'P14']);
  });

  it('the golden cases carry no program name either', () => {
    const g: { path: string; text: string }[] = [];
    strings(loadGolden(), '', g);
    expect(g.filter((s) => PROGRAM.test(s.text))).toEqual([]);
  });
});
