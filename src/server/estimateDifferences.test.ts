// The "Not certain which line applies" note names only where the SHOWN lines' official descriptions part (code, committed
// data). Production report 2026-10-12: "Men's jeans, straight leg, 14 oz cotton denim." (Japan, $200) listed the model's
// "recreational performance outerwear" and gender, which separate none of the three lines shown.
import { describe, expect, it } from 'vitest';
import { lineDifferences, sameDutyText } from '@/domain/estimator/explain';
import { toInputRecord } from '@/domain/estimator/request';
import { estimateViewOf } from '@/domain/estimator/view';
import { loadVerifiedRates } from '@/domain/rates/__fixtures__/verified';
import { loadEstimator } from './estimator';
import { currentHtsIndex } from './hts';

const { data } = loadEstimator();
const chains = currentHtsIndex().chains;
const NOW = new Date('2026-10-12T12:00:00Z');

describe('(i) jeans, Japan, $200: the note names the shown lines\' official differences only', () => {
  const input = toInputRecord({ title: "Men's jeans, straight leg, 14 oz cotton denim.", origin: 'JP', sellingPriceMinor: 20000 }, NOW);
  const candidates = [
    { code: '6203.42.4511', confidence: 0.7 },
    { code: '6203.42.4518', confidence: 0.2 },
    { code: '6203.42.4503', confidence: 0.1 },
  ].map((c) => ({ ...c, chain: chains.get(c.code)! }));
  // the model's separating attributes as stored in production
  const separating = [
    { name: 'denim color (blue denim vs other)', value_from_listing: null },
    { name: 'compact yarn content', value_from_listing: null },
    { name: 'recreational performance outerwear', value_from_listing: null },
    { name: 'gender', value_from_listing: 'Men' },
  ];
  const view = estimateViewOf(
    { id: 'e1', status: 'READY', input, classification: { outcome: 'OK', candidates, separating, reasons: ['LOW_CONFIDENCE'] }, cachedFrom: null, error: null },
    data,
    loadVerifiedRates(),
    '2026-10-12',
  );

  it('every shown line is $33.20; the note names "Blue denim" vs "Other" and the compact yarns level, nothing else', () => {
    const duties = view.candidates.map((c) => (c.outcome.kind === 'ESTIMATE' ? c.outcome.dutyMinor : null));
    expect(duties).toEqual([3320, 3320, 3320]);
    const d = lineDifferences(view.candidates.map((c) => ({ chain: c.chain, dutyMinor: c.outcome.kind === 'ESTIMATE' ? c.outcome.dutyMinor : null })), view.separating);
    const note = sameDutyText(d, '$33.20', true);
    expect(note).toMatch(/“Blue denim” vs “Other”/);
    expect(note).toMatch(/“Containing compact yarns[^”]*” vs “Other”/);
    expect(note).not.toMatch(/recreational performance outerwear/i);
    expect(note).not.toMatch(/gender|\bmen\b/i);
    expect(note).toMatch(/but the estimate is \$33\.20 either way\.$/);
  });
});
