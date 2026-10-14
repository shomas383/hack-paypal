// The headline must never show a figure while a shown line is refused, and its figure or range covers every shown line
// (committed data). Production report 2026-10-13: "Stainless steel stovetop kettle, 1.5 L" (Japan, $90) showed
// "$11.25 on a $90.00 sale" — the 1% electric-appliance line — while the 92% and 5% lines were refused (heading 9903.82.03,
// note 16(c)(vii)).
import { describe, expect, it } from 'vitest';
import { headlineTitle, refusalText, type Headline } from '@/domain/estimator/headline';
import { toInputRecord, type EstimateRequestT } from '@/domain/estimator/request';
import { estimateViewOf, type EstimateView } from '@/domain/estimator/view';
import { loadVerifiedRates } from '@/domain/rates/__fixtures__/verified';
import { fixtureView } from './estimateFixtures';
import { loadEstimator } from './estimator';
import { currentHtsIndex } from './hts';

const { data } = loadEstimator();
const chains = currentHtsIndex().chains;
const NOW = new Date('2026-10-13T12:00:00Z');
const KETTLE: EstimateRequestT = { title: 'Stainless steel stovetop kettle, 1.5 L', origin: 'JP', sellingPriceMinor: 9000 };

function view(request: EstimateRequestT, candidates: { code: string; confidence: number }[]): EstimateView {
  return estimateViewOf(
    {
      id: 'e1',
      status: 'READY',
      input: toInputRecord(request, NOW),
      classification: { outcome: 'OK', candidates: candidates.map((c) => ({ ...c, chain: chains.get(c.code)! })), separating: [], reasons: [] },
      cachedFrom: null,
      error: null,
    },
    data,
    loadVerifiedRates(),
    '2026-10-13',
  );
}
const kinds = (v: EstimateView) => v.candidates.map((c) => (c.outcome.kind === 'ESTIMATE' ? c.outcome.dutyMinor : c.outcome.reason));
const refused = (h: Headline | null) => {
  expect(h?.kind).toBe('REFUSED');
  return h as Extract<Headline, { kind: 'REFUSED' }>;
};

describe('(1) the kettle (production 2026-10-13): refused 92% + refused 5% + estimated 1% → the headline is the refusal', () => {
  const v = fixtureView('unsupported', {}, NOW)!;

  it('reproduces the production lines: two refusals and an $11.25 estimate on the 1% line', () => {
    expect(v.candidates.map((c) => [c.code, c.confidence])).toEqual([
      ['7323.93.0015', 0.92],
      ['7323.93.0045', 0.05],
      ['8516.79.0000', 0.01],
    ]);
    expect(kinds(v)).toEqual(['UNMODELED_REGIME', 'UNMODELED_REGIME', 1125]);
  });

  it('headline: refusal, citing the heading and note that named the top refused line; no figure', () => {
    const h = refused(v.headline);
    expect(h.line).toEqual({ code: '7323.93.0015', confidence: 0.92 });
    expect(headlineTitle(h)).toBe('Can’t estimate this product yet');
    const text = refusalText(h);
    expect(text).toBe('The most likely line, 7323.93.0015 (confidence 92%), is named by heading 9903.82.03 and U.S. note 16(c)(vii) to subchapter III, which the estimator doesn’t model yet.');
    expect(text).not.toContain('$');
    expect(JSON.stringify(h)).not.toContain('1125'); // no amount anywhere in the headline
  });

  it('the estimated line is shown below as a less likely line, with its confidence', () => {
    const h = refused(v.headline);
    expect(h.estimable).toEqual({ label: 'Less likely lines that could be estimated', codes: ['8516.79.0000'] });
  });
});

describe('(2) estimated top line + refused lower line → also the refusal', () => {
  const v = view(KETTLE, [
    { code: '8516.79.0000', confidence: 0.6 },
    { code: '7323.93.0015', confidence: 0.3 },
  ]);

  it('the 60% line estimates, the 30% line is refused', () => {
    expect(kinds(v)).toEqual([1125, 'UNMODELED_REGIME']);
  });

  it('headline: refusal citing the refused line (not the most likely line overall); no figure', () => {
    const h = refused(v.headline);
    expect(h.line).toEqual({ code: '7323.93.0015', confidence: 0.3 });
    expect(refusalText(h)).toBe('Line 7323.93.0015 (confidence 30%) is named by heading 9903.82.03 and U.S. note 16(c)(vii) to subchapter III, which the estimator doesn’t model yet.');
    expect(h.estimable).toEqual({ label: 'Other lines that could be estimated', codes: ['8516.79.0000'] });
  });
});

describe('(3) every shown line estimated → the figure, unchanged', () => {
  it('jeans, cotton (DEMO scene 4a): $33.20 on every line', () => {
    const v = view({ title: "Men's jeans, straight leg, 14 oz cotton denim.", origin: 'JP', sellingPriceMinor: 20000 }, [
      { code: '6203.42.4511', confidence: 0.7 },
      { code: '6203.42.4518', confidence: 0.2 },
      { code: '6203.42.4503', confidence: 0.1 },
    ]);
    expect(v.headline).toEqual({ kind: 'FIGURE', minMinor: 3320, maxMinor: 3320 });
    expect(headlineTitle(v.headline!)).toBe('US import duty (est.)');
  });

  it('jeans, fabric not stated: the range covers both lines ($33.20 to $55.80)', () => {
    const v = fixtureView('jeans', {}, NOW)!;
    expect(kinds(v)).toEqual([3320, 5580]);
    expect(v.headline).toEqual({ kind: 'FIGURE', minMinor: 3320, maxMinor: 5580 });
    expect(headlineTitle(v.headline!)).toBe('US import duty (est.), depending on the HTS line');
  });
});

describe('other states', () => {
  it('a line that only needs answers (knife) asks; no figure', () => {
    const v = fixtureView('knife', {}, NOW)!;
    expect(v.headline).toEqual({ kind: 'ASKING' });
    expect(headlineTitle(v.headline!)).toBe('Answer the questions below to estimate the duty');
  });

  it('a line that needs answers next to an estimated line: still asks — a figure would not cover the asking line', () => {
    const v = view({ title: "Japanese gyuto chef's knife, stainless steel blade", origin: 'JP', sellingPriceMinor: 14000 }, [
      { code: '8211.92.9030', confidence: 0.8 },
      { code: '8516.79.0000', confidence: 0.1 },
    ]);
    expect(kinds(v)).toEqual(['NEEDS_FACTS', expect.any(Number)]);
    expect(v.headline).toEqual({ kind: 'ASKING' });
  });

  it('a refusal next to a line that needs answers: the refusal wins', () => {
    const v = view(KETTLE, [
      { code: '8211.92.9030', confidence: 0.5 },
      { code: '7323.93.0015', confidence: 0.4 },
    ]);
    expect(refused(v.headline).line.code).toBe('7323.93.0015');
    expect(refused(v.headline).estimable).toBeNull();
  });

  it('a footnote refusal (shoes) cites the heading from the line’s own footnote', () => {
    const v = fixtureView('shoes', {}, NOW)!;
    expect(refusalText(refused(v.headline))).toBe('The most likely line, 6403.59.6060 (confidence 80%), is named by heading 9903.41.10 (cited in the line’s own footnote), which the estimator doesn’t model yet.');
  });

  it('a stopped classification has a stopped headline; a row that is not READY has none', () => {
    expect(fixtureView('jeans-broad', {}, NOW)!.headline).toEqual({ kind: 'STOPPED', reason: 'TOO_BROAD' });
    expect(headlineTitle({ kind: 'STOPPED', reason: 'TOO_BROAD' })).toBe('Too many possible HTS lines');
    const v = estimateViewOf({ id: 'e2', status: 'ESTIMATING', input: toInputRecord(KETTLE, NOW), classification: null, cachedFrom: null, error: null }, data, loadVerifiedRates(), '2026-10-13');
    expect(v.headline).toBeNull();
  });
});
