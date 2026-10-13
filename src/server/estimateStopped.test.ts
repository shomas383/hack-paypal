// When the classifier stops before choosing a line (TOO_BROAD / NO_CANDIDATES / INVALID_OUTPUT), the estimate says which,
// and for TOO_BROAD names where the official lines it would have compared part (from the official chains, by code).
// Committed data (CI). The jeans case is the production report of 2026-10-12: no fabric stated → 6203.42/.43/.49 = 120 lines.
import { describe, expect, it } from 'vitest';
import { stoppedText } from '@/domain/estimator/explain';
import { toInputRecord } from '@/domain/estimator/request';
import { estimateViewOf, type EstimateRowIn } from '@/domain/estimator/view';
import { loadVerifiedRates } from '@/domain/rates/__fixtures__/verified';
import { loadEstimator } from './estimator';

const { data } = loadEstimator();
const NOW = new Date('2026-10-12T12:00:00Z');
const input = toInputRecord({ title: "Men's jeans, straight leg, 14 oz denim", details: 'Fabric content not stated by the maker.', origin: 'JP', sellingPriceMinor: 20000 }, NOW);
const row = (classification: EstimateRowIn['classification']): EstimateRowIn => ({ id: 'e1', status: 'READY', input, classification, cachedFrom: null, error: null });
const view = (c: EstimateRowIn['classification']) => estimateViewOf(row(c), data, loadVerifiedRates(), '2026-10-12');

describe('a classification that stopped before choosing a line', () => {
  it('TOO_BROAD: the lines under the proposed headings are counted and their first official difference is named', () => {
    const v = view({ outcome: 'STOPPED', candidates: [], separating: [], reasons: ['TOO_BROAD'], meta: { headings: ['6203.42', '6203.43', '6203.49'] } });
    expect(v.candidates).toEqual([]);
    expect(v.stopped).toEqual({ reason: 'TOO_BROAD', lines: 120, differAt: ['Of cotton', 'Of synthetic fibers', 'Of other textile materials'] });
    expect(stoppedText(v.stopped!)).toBe(
      'The description fits 120 official lines, more than the estimator compares at once. They differ at “Of cotton”, “Of synthetic fibers” or “Of other textile materials”: add which applies and try again.',
    );
  });

  it('TOO_BROAD without the proposed headings: a general hint; NO_CANDIDATES and INVALID_OUTPUT have their own text', () => {
    const broad = view({ outcome: 'STOPPED', candidates: [], separating: [], reasons: ['TOO_BROAD'] });
    expect(broad.stopped).toEqual({ reason: 'TOO_BROAD', lines: null, differAt: [] });
    expect(stoppedText(broad.stopped!)).toBe('The description fits too many official lines to compare. Add what it’s made of, what it’s used for, or the maker’s model name, and try again.');
    const none = view({ outcome: 'STOPPED', candidates: [], separating: [], reasons: ['NO_CANDIDATES'], meta: { headings: ['9999.99'] } });
    expect(none.stopped).toEqual({ reason: 'NO_CANDIDATES', lines: 0, differAt: [] });
    expect(stoppedText(none.stopped!)).toBe('No official HTS line matched this description. Add what it’s made of, what it’s used for, or the maker’s model name, and try again.');
    const invalid = view({ outcome: 'INVALID_OUTPUT', candidates: [], separating: [], reasons: ['INVALID_OUTPUT'] });
    expect(invalid.stopped?.reason).toBe('INVALID_OUTPUT');
    expect(stoppedText(invalid.stopped!)).toBe('The classifier’s answer couldn’t be checked against the official schedule. Try again in a moment.');
  });

  it('a classification with candidates has no stopped state', () => {
    expect(view({ outcome: 'OK', candidates: [{ code: '6203.42.4511', chain: [], confidence: 0.7 }], separating: [], reasons: [] }).stopped).toBeNull();
  });
});
