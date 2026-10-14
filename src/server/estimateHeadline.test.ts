// The headline is decided by the LIKELY lines (confidence ≥ LIKELY_CONFIDENCE, committed data): any likely line refused →
// the refusal; any likely line needing answers → the questions; else a figure or range covering every likely line. Less
// likely lines never produce or block the headline; refused ones are disclosed in one line under it.
// Production reports: 2026-10-13 the kettle (Japan, $90) showed the 1% line's $11.25 next to refused 92% and 5% lines;
// after 148fad3 the knife (Japan, $140) showed "Can't estimate" because of a 7% plastic-handle line, so its verified row's
// $43.54 could never reach the headline.
import { describe, expect, it } from 'vitest';
import { headlineTitle, LIKELY_CONFIDENCE, refusalText, unlikelyOtherText, unlikelyRefusedText, type Headline } from '@/domain/estimator/headline';
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
const JEANS: EstimateRequestT = { title: "Men's jeans, straight leg, 14 oz cotton denim.", origin: 'JP', sellingPriceMinor: 20000 };

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

it('the threshold is one named constant: 10%', () => {
  expect(LIKELY_CONFIDENCE).toBe(0.1);
});

describe('(1) the knife (production, after 148fad3): 88% needs answers, 7% + 3% refused → the questions, then $43.54', () => {
  const before = fixtureView('knife', {}, NOW)!;
  const after = fixtureView('knife', { facts: { steel_weight_share_ge_15pct: true, steel_us_melted_poured_ge_85pct: false } }, NOW)!;

  it('reproduces the production lines', () => {
    expect(before.candidates.map((c) => [c.code, c.confidence])).toEqual([
      ['8211.92.9030', 0.88],
      ['8211.92.2000', 0.07],
      ['8211.92.9060', 0.03],
    ]);
    expect(kinds(before)).toEqual(['NEEDS_FACTS', 'UNMODELED_REGIME', 'UNMODELED_REGIME']);
  });

  it('before the answers: the headline asks; the less likely refusals are disclosed, not the headline', () => {
    expect(before.headline).toEqual({ kind: 'ASKING', unlikelyRefused: { codes: ['8211.92.2000', '8211.92.9060'], confidence: 0.1 } });
    expect(headlineTitle(before.headline!)).toBe('Answer the questions below to estimate the duty');
    expect(unlikelyRefusedText(before.headline!)).toBe('2 less likely lines (10% combined) can’t be estimated: 8211.92.2000, 8211.92.9060.');
  });

  it('after Yes / No: the verified row’s $43.54 is the headline figure, with the same disclosure', () => {
    expect(kinds(after)[0]).toBe(4354);
    expect(after.headline).toEqual({ kind: 'FIGURE', minMinor: 4354, maxMinor: 4354, unlikelyRefused: { codes: ['8211.92.2000', '8211.92.9060'], confidence: 0.1 }, unlikelyOther: null });
    expect(headlineTitle(after.headline!)).toBe('US import duty (est.)');
  });
});

describe('(2) the kettle (production 2026-10-13): refused 92% → still the refusal', () => {
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

  it('the estimated 1% line is listed below as less likely; the 5% refusal is disclosed in one line', () => {
    const h = refused(v.headline);
    expect(h.estimable).toEqual({ label: 'Less likely lines that could be estimated', codes: ['8516.79.0000'] });
    expect(unlikelyRefusedText(h)).toBe('1 less likely line (5%) can’t be estimated: 7323.93.0045.');
  });
});

describe('(3) every likely line estimated → the figure', () => {
  it('jeans, cotton (DEMO scene 4a): $33.20 on every line', () => {
    const v = view(JEANS, [
      { code: '6203.42.4511', confidence: 0.7 },
      { code: '6203.42.4518', confidence: 0.2 },
      { code: '6203.42.4503', confidence: 0.1 },
    ]);
    expect(v.headline).toEqual({ kind: 'FIGURE', minMinor: 3320, maxMinor: 3320, unlikelyRefused: null, unlikelyOther: null });
    expect(headlineTitle(v.headline!)).toBe('US import duty (est.)');
    expect(unlikelyRefusedText(v.headline!)).toBeNull();
  });

  it('jeans, fabric not stated: the range covers both likely lines ($33.20 to $55.80)', () => {
    const v = fixtureView('jeans', {}, NOW)!;
    expect(kinds(v)).toEqual([3320, 5580]);
    expect(v.headline).toEqual({ kind: 'FIGURE', minMinor: 3320, maxMinor: 5580, unlikelyRefused: null, unlikelyOther: null });
    expect(headlineTitle(v.headline!)).toBe('US import duty (est.), depending on the HTS line');
  });

  it('90% at $33.20 + 5% at $55.80: the less likely line doesn’t widen the figure; it gets a disclosure line', () => {
    const v = view(JEANS, [
      { code: '6203.42.4511', confidence: 0.9 },
      { code: '6203.43.9011', confidence: 0.05 },
    ]);
    expect(kinds(v)).toEqual([3320, 5580]);
    expect(v.headline).toEqual({ kind: 'FIGURE', minMinor: 3320, maxMinor: 3320, unlikelyRefused: null, unlikelyOther: { codes: ['6203.43.9011'], confidence: 0.05, minMinor: 5580, maxMinor: 5580 } });
    expect(unlikelyOtherText(v.headline!)).toBe('1 less likely line (5%) would be $55.80: 6203.43.9011.');
  });

  it('less likely lines at the headline’s duty: no line', () => {
    const v = view(JEANS, [
      { code: '6203.42.4511', confidence: 0.9 },
      { code: '6203.42.4518', confidence: 0.05 },
    ]);
    expect(kinds(v)).toEqual([3320, 3320]);
    expect(v.headline).toMatchObject({ kind: 'FIGURE', unlikelyOther: null });
    expect(unlikelyOtherText(v.headline!)).toBeNull();
  });

  it('several less likely lines with other duties: plural, combined %, their range', () => {
    const v = view(JEANS, [
      { code: '6203.42.4511', confidence: 0.85 },
      { code: '6203.43.9011', confidence: 0.06 },
      { code: '6203.42.4518', confidence: 0.05 },
      { code: '8516.79.0000', confidence: 0.04 },
    ]);
    const other = kinds(v)[3] as number;
    expect(kinds(v)).toEqual([3320, 5580, 3320, other]);
    expect(other).not.toBe(3320);
    const [lo, hi] = [Math.min(other, 5580), Math.max(other, 5580)];
    const usd = (c: number) => `$${(c / 100).toFixed(2)}`;
    expect(unlikelyOtherText(v.headline!)).toBe(`2 less likely lines (10% combined) would be ${usd(lo)} to ${usd(hi)}: 6203.43.9011, 8516.79.0000.`);
  });

  it('a range headline only discloses less likely lines outside it', () => {
    const v = view(JEANS, [
      { code: '6203.42.4511', confidence: 0.6 },
      { code: '6203.43.9011', confidence: 0.35 },
      { code: '6203.42.4518', confidence: 0.05 },
    ]);
    expect(v.headline).toMatchObject({ kind: 'FIGURE', minMinor: 3320, maxMinor: 5580, unlikelyOther: null });
  });
});

describe('(4) a likely refused line at 12% next to an 85% estimated line → the refusal', () => {
  const v = view(KETTLE, [
    { code: '8516.79.0000', confidence: 0.85 },
    { code: '7323.93.0015', confidence: 0.12 },
  ]);

  it('the 85% line estimates, the 12% line is refused', () => {
    expect(kinds(v)).toEqual([1125, 'UNMODELED_REGIME']);
  });

  it('headline: refusal citing the refused line (not the most likely line overall); no figure', () => {
    const h = refused(v.headline);
    expect(h.line).toEqual({ code: '7323.93.0015', confidence: 0.12 });
    expect(refusalText(h)).toBe('Line 7323.93.0015 (confidence 12%) is named by heading 9903.82.03 and U.S. note 16(c)(vii) to subchapter III, which the estimator doesn’t model yet.');
    expect(h.estimable).toEqual({ label: 'Other lines that could be estimated', codes: ['8516.79.0000'] });
    expect(h.unlikelyRefused).toBeNull();
  });
});

describe('other states', () => {
  it('a likely line needing answers next to a likely estimated line: asks — a figure would not cover it', () => {
    const v = view({ title: "Japanese gyuto chef's knife, stainless steel blade", origin: 'JP', sellingPriceMinor: 14000 }, [
      { code: '8211.92.9030', confidence: 0.8 },
      { code: '8516.79.0000', confidence: 0.1 },
    ]);
    expect(kinds(v)).toEqual(['NEEDS_FACTS', expect.any(Number)]);
    expect(v.headline).toEqual({ kind: 'ASKING', unlikelyRefused: null });
  });

  it('a likely refusal next to a likely line needing answers: the refusal wins', () => {
    const v = view(KETTLE, [
      { code: '8211.92.9030', confidence: 0.5 },
      { code: '7323.93.0015', confidence: 0.4 },
    ]);
    expect(refused(v.headline).line.code).toBe('7323.93.0015');
    expect(refused(v.headline).estimable).toBeNull();
  });

  it('no line reaches 10%: the most confident line still decides the headline', () => {
    const v = view(KETTLE, [
      { code: '7323.93.0015', confidence: 0.08 },
      { code: '8516.79.0000', confidence: 0.06 },
    ]);
    expect(refused(v.headline).line.code).toBe('7323.93.0015');
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
