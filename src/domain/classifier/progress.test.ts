import { describe, expect, it } from 'vitest';
import { INTERRUPTED_AFTER_MS, progressView } from './progress';

const t0 = new Date('2026-10-10T05:00:00Z');
const at = (ms: number) => new Date(t0.getTime() + ms);

describe('progressView: three real steps from the stored stage (nothing simulated)', () => {
  it('queued (no stage yet): step 1 active', () => {
    const v = progressView({ status: 'CLASSIFYING', stage: null, createdAt: t0, top: null }, at(1_000));
    expect(v.state).toBe('classifying');
    expect(v.steps.map((s) => [s.state, s.label])).toEqual([
      ['active', 'Proposing headings…'],
      ['pending', 'Matching official Rev 20 lines'],
      ['pending', 'Choosing a line'],
    ]);
  });

  it('matching: step 1 done with the real headings, step 2 active', () => {
    const v = progressView({ status: 'CLASSIFYING', stage: { stage: 'matching', headings: ['9102.21', '9102.29'] }, createdAt: t0, top: null }, at(4_000));
    expect(v.steps.map((s) => [s.state, s.label])).toEqual([
      ['done', 'Proposed 2 headings: 9102.21, 9102.29'],
      ['active', 'Matching official Rev 20 lines…'],
      ['pending', 'Choosing a line'],
    ]);
  });

  it('choosing: the number of official lines matched', () => {
    const v = progressView({ status: 'CLASSIFYING', stage: { stage: 'choosing', headings: ['9102.21'], expanded: 6 }, createdAt: t0, top: null }, at(5_000));
    expect(v.steps.map((s) => s.label)).toEqual(['Proposed 1 heading: 9102.21', 'Matched 6 official lines', 'Choosing a line…']);
    expect(v.steps.map((s) => s.state)).toEqual(['done', 'done', 'active']);
  });

  it('done: the chosen line and its confidence', () => {
    const v = progressView({ status: 'AUTO_ACCEPTED', stage: { stage: 'choosing', headings: ['9102.21'], expanded: 6 }, createdAt: t0, top: { hts10: '9102.21.70', confidence: 0.92 } }, at(9_000));
    expect(v.state).toBe('done');
    expect(v.steps.at(-1)).toEqual({ state: 'done', label: 'Chose 9102.21.70 · confidence 0.92' });
  });

  it('stopped before choosing (no official lines matched): step 2 failed, step 3 not run', () => {
    const v = progressView({ status: 'PENDING_REVIEW', stage: { stage: 'matching', headings: ['9999.99'] }, createdAt: t0, top: null }, at(6_000));
    expect(v.state).toBe('done');
    expect(v.steps.map((s) => [s.state, s.label])).toEqual([
      ['done', 'Proposed 1 heading: 9999.99'],
      ['failed', 'No official Rev 20 lines matched'],
      ['pending', 'Choosing a line (not run)'],
    ]);
  });

  it('failed: the active step is marked failed', () => {
    const v = progressView({ status: 'FAILED', stage: { stage: 'choosing', headings: ['9102.21'], expanded: 6 }, createdAt: t0, top: null }, at(9_000));
    expect(v.state).toBe('failed');
    expect(v.steps.map((s) => s.state)).toEqual(['done', 'done', 'failed']);
  });

  it(`still CLASSIFYING after ${INTERRUPTED_AFTER_MS / 1000} s → interrupted`, () => {
    const v = progressView({ status: 'CLASSIFYING', stage: { stage: 'proposing' }, createdAt: t0, top: null }, at(INTERRUPTED_AFTER_MS + 1));
    expect(v.state).toBe('interrupted');
    expect(v.steps[0]!.state).toBe('failed');
  });
});
