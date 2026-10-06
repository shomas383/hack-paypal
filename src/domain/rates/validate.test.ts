import { describe, expect, it } from 'vitest';
import { additiveRow, capRow, compoundRow, syntheticFile } from './__fixtures__/synthetic';
import { validateRateFile } from './validate';

const clone = <T>(x: T): T => structuredClone(x);
const opts = { requiredRevision: 'TEST Rev. 1' };

describe('validateRateFile', () => {
  it('accepts a well-formed file', () => {
    const r = validateRateFile(syntheticFile, opts);
    expect(r.errors).toEqual([]);
    expect(r.ok).toBe(true);
  });

  it('rejects a row without source_refs', () => {
    const f = clone(syntheticFile);
    f.rows[0]!.source_refs = [];
    expect(validateRateFile(f, opts).ok).toBe(false);
  });

  it('rejects the wrong HTS revision (file or row)', () => {
    expect(validateRateFile(syntheticFile, { requiredRevision: '2026 Rev. 20' }).ok).toBe(false);
    const f = clone(syntheticFile);
    f.rows[1]!.hts_revision = 'TEST Rev. 0';
    const r = validateRateFile(f, opts);
    expect(r.ok).toBe(false);
    expect(r.errors.join('\n')).toMatch(/hts_revision/);
  });

  it('rejects non-integer (float) rates and amounts', () => {
    const f = clone(syntheticFile) as unknown as { rows: { mfn: { rate_ppm: number } }[] };
    f.rows[0]!.mfn.rate_ppm = 0.04;
    expect(validateRateFile(f, opts).ok).toBe(false);
  });

  it('rejects missing verification metadata and unchecked exemptions', () => {
    const f = clone(syntheticFile) as unknown as { rows: Record<string, unknown>[] };
    delete f.rows[0]!.verified_on;
    expect(validateRateFile(f, opts).ok).toBe(false);
    const g = clone(syntheticFile) as unknown as { rows: { exemptions_checked: { done: boolean } }[] };
    g.rows[0]!.exemptions_checked.done = false;
    expect(validateRateFile(g, opts).ok).toBe(false);
  });

  it('rejects unknown keys (typos)', () => {
    const f = clone(syntheticFile) as unknown as { rows: Record<string, unknown>[] };
    f.rows[0]!.rate_pmm = 1;
    expect(validateRateFile(f, opts).ok).toBe(false);
  });

  it('rejects duplicate (origin, hts10) rows and ids that do not match origin-hts10', () => {
    const dup = clone(syntheticFile);
    dup.rows.push(clone(capRow));
    expect(validateRateFile(dup, opts).errors.join('\n')).toMatch(/duplicate/);
    const bad = clone(syntheticFile);
    bad.rows[0]!.id = 'XA-9999.99.9999';
    expect(validateRateFile(bad, opts).errors.join('\n')).toMatch(/id/);
  });

  it('rejects a compound rate without text or components', () => {
    const f = clone(syntheticFile);
    const row = f.rows.find((r) => r.id === compoundRow.id)!;
    if (row.mfn.type !== 'compound') throw new Error('fixture');
    row.mfn.components = [];
    expect(validateRateFile(f, opts).ok).toBe(false);
  });

  it('requires chapter99_at_or_above_cap on combined_cap and a ruling number unless status is none', () => {
    const f = clone(syntheticFile);
    delete f.rows[0]!.additional[0]!.chapter99_at_or_above_cap;
    expect(validateRateFile(f, opts).errors.join('\n')).toMatch(/chapter99_at_or_above_cap/);
    const g = clone(syntheticFile);
    g.rows[0]!.ruling = { number: null, status: 'supports' };
    expect(validateRateFile(g, opts).errors.join('\n')).toMatch(/ruling/);
  });

  it('rejects case/band components outside a compound rate and an effective_to before effective_from', () => {
    const f = clone(syntheticFile);
    f.rows.find((r) => r.id === additiveRow.id)!.effective_to = '2025-12-31';
    expect(validateRateFile(f, opts).errors.join('\n')).toMatch(/effective_to/);
    const g = clone(syntheticFile);
    g.rows.find((r) => r.id === additiveRow.id)!.mfn = {
      type: 'specific',
      text: 'synthetic',
      components: [{ kind: 'ad_valorem', rate_ppm: 10_000, applies_to: 'case' }],
    };
    expect(validateRateFile(g, opts).errors.join('\n')).toMatch(/case\/band/);
  });
});
