import { describe, expect, it } from 'vitest';
import { buildHtsIndex, type ExportRow } from '../hts/buildIndex';
import { checkValueSplit, needsValueSplit, nextStatus, undoTarget, validateOverride } from './actions';
import { lookupOf } from './hts';
import type { RateRow } from '../rates/schema';

const row = (htsno: string, indent: number, description: string): ExportRow => ({ htsno, indent: String(indent), description, units: [], footnotes: [] });
const idx = lookupOf(
  buildHtsIndex([row('6203', 0, 'Trousers:'), row('6203.42', 1, 'Of cotton:'), row('6203.42.45.06', 2, 'Corduroy'), row('6203.42.45.11', 2, 'Blue denim')], { hts_revision: '2026 Rev. 20', source: { url: 'u', exportedOn: 'd' } }),
);
const expanded = ['6203.42.4506', '6203.42.4511'];

describe('nextStatus (recorded seller actions)', () => {
  it('accept: pending review or auto-accepted → ACCEPTED', () => {
    expect(nextStatus('PENDING_REVIEW', 'accept')).toEqual({ ok: true, status: 'ACCEPTED' });
    expect(nextStatus('AUTO_ACCEPTED', 'accept')).toEqual({ ok: true, status: 'ACCEPTED' });
  });

  it('override: any unpublished, settled-or-pending status → OVERRIDDEN', () => {
    for (const s of ['PENDING_REVIEW', 'AUTO_ACCEPTED', 'ACCEPTED', 'OVERRIDDEN'] as const) expect(nextStatus(s, 'override')).toEqual({ ok: true, status: 'OVERRIDDEN' });
  });

  it('publish only from a settled code; nothing after PUBLISHED; nothing while classifying or failed', () => {
    expect(nextStatus('ACCEPTED', 'publish')).toEqual({ ok: true, status: 'PUBLISHED' });
    expect(nextStatus('PENDING_REVIEW', 'publish')).toMatchObject({ ok: false });
    for (const a of ['accept', 'override', 'publish'] as const) {
      expect(nextStatus('PUBLISHED', a)).toMatchObject({ ok: false });
      expect(nextStatus('CLASSIFYING', a)).toMatchObject({ ok: false });
      expect(nextStatus('FAILED', a)).toMatchObject({ ok: false });
    }
  });
});

describe('undoTarget (undo restores the recorded "from" state, never across a publish)', () => {
  const action = { action: 'accept' as const, fromStatus: 'PENDING_REVIEW' as const, toStatus: 'ACCEPTED' as const, fromHts10: null, toHts10: '6203.42.4511', undone: false };
  it('restores from-status and from-code when the row is still in the action’s result state', () => {
    expect(undoTarget(action, { status: 'ACCEPTED', hts10: '6203.42.4511' })).toEqual({ ok: true, status: 'PENDING_REVIEW', hts10: null });
  });
  it('refuses when already undone, when a later action changed the row, or after publish', () => {
    expect(undoTarget({ ...action, undone: true }, { status: 'ACCEPTED', hts10: '6203.42.4511' })).toMatchObject({ ok: false });
    expect(undoTarget(action, { status: 'OVERRIDDEN', hts10: '6203.42.4506' })).toMatchObject({ ok: false });
    expect(undoTarget({ ...action, action: 'publish', toStatus: 'PUBLISHED' }, { status: 'PUBLISHED', hts10: '6203.42.4511' })).toMatchObject({ ok: false });
  });
});

describe('validateOverride (only codes from this run’s expanded Rev 20 list, with a reason)', () => {
  it('accepts an expanded, valid code with a reason', () => {
    expect(validateOverride({ hts10: '6203.42.4506', reason: 'Corduroy, per the seller' }, expanded, idx)).toEqual([]);
  });
  it('refuses a code outside the expanded list, an invalid code, or no reason', () => {
    expect(validateOverride({ hts10: '6203.43.4010', reason: 'x y z' }, expanded, idx)).toContain('Choose a code from the official lines this classification matched.');
    expect(validateOverride({ hts10: '6203.42.4511', reason: '  ' }, expanded, idx)).toEqual(['Give a reason for the override.']);
  });
});

const watchRow = { mfn: { type: 'compound', text: '$1.53 each + 4.2% case + 9.8% band', components: [{ kind: 'specific', amount_usd_micros: 1_530_000, per: 'each' }, { kind: 'ad_valorem', rate_ppm: 42_000, applies_to: 'case' }, { kind: 'ad_valorem', rate_ppm: 98_000, applies_to: 'band' }] } } as unknown as RateRow;
const denimRow = { mfn: { type: 'ad_valorem', rate_ppm: 166_000 } } as unknown as RateRow;

describe('value split at publish (compound case/band rows only)', () => {
  it('needed only for a row whose MFN has case/band components', () => {
    expect(needsValueSplit(watchRow)).toBe(true);
    expect(needsValueSplit(denimRow)).toBe(false);
    expect(needsValueSplit(undefined)).toBe(false);
  });
  it('case + band must equal the price, both positive integers', () => {
    expect(checkValueSplit({ caseMinor: 25_000, bandMinor: 5_000 }, 30_000)).toEqual([]);
    expect(checkValueSplit({ caseMinor: 25_000, bandMinor: 4_000 }, 30_000)).toEqual(['Case and band values must add up to the price ($300.00).']);
    expect(checkValueSplit({ caseMinor: 0, bandMinor: 30_000 }, 30_000)).toEqual(['Enter a case value and a band value above $0.00.']);
  });
});
