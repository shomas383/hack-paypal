// Dev-only /estimate fixtures (?fixture=…): a request and the classifier candidates it would get, fixed, so the page can be
// shown and tested without a model call. Everything else is real: the view is computed by estimateViewOf from the
// committed estimator data and the verified rates, and answers are applied exactly as the API applies them.
import { applyAnswers, toInputRecord, type EstimateAnswersT, type EstimateRequestT } from '@/domain/estimator/request';
import { estimateViewOf, type EstimateView } from '@/domain/estimator/view';
import { loadEstimator } from './estimator';
import { currentHtsIndex } from './hts';
import { currentRateTable } from './rates';

interface Fixture {
  request: EstimateRequestT;
  candidates: { code: string; confidence: number }[];
  separating: { name: string; value_from_listing: string | null }[];
}

export const ESTIMATE_FIXTURES: Record<string, Fixture> = {
  // Three guitar lines; under Japan's combined 12.5% cap they all come to the same duty.
  guitar: {
    request: { title: 'Acoustic guitar, spruce top, rosewood back and sides', origin: 'JP', sellingPriceMinor: 40000, shippingMinor: 6000 },
    candidates: [
      { code: '9202.90.4000', confidence: 0.64 },
      { code: '9202.90.2000', confidence: 0.22 },
    ],
    separating: [{ name: 'Value of the guitar, excluding the case', value_from_listing: null }],
  },
  // Cotton denim (a verified row) vs synthetic fibers: a real range.
  jeans: {
    request: { title: "Men's jeans, straight leg, 14 oz denim", details: 'Fabric content not stated by the maker.', origin: 'JP', sellingPriceMinor: 20000, shippingMinor: 2500 },
    candidates: [
      { code: '6203.42.4511', confidence: 0.71 },
      { code: '6203.43.9011', confidence: 0.2 },
    ],
    separating: [{ name: 'Fiber content', value_from_listing: null }],
  },
  // The German watch: needs the case/band split, then quotes from its verified row.
  'watch-de': {
    request: { title: 'Automatic diver watch, stainless steel case and bracelet, 21 jewels', origin: 'DE', sellingPriceMinor: 29000, shippingMinor: 2500 },
    candidates: [{ code: '9102.21.70', confidence: 0.9 }],
    separating: [],
  },
  // Lines the estimator refuses: a steel knife (note 16, Section 232) and men's leather shoes (9903.41.10).
  unsupported: {
    request: { title: "Gyuto chef's knife, stainless steel blade, wooden handle", origin: 'JP', sellingPriceMinor: 14000, shippingMinor: 2000 },
    candidates: [
      { code: '8211.92.9030', confidence: 0.82 },
      { code: '6403.59.6060', confidence: 0.1 },
    ],
    separating: [],
  },
};

export function fixtureView(name: string, answers: EstimateAnswersT = {}, now = new Date()): EstimateView | null {
  const f = ESTIMATE_FIXTURES[name];
  if (!f) return null;
  const chains = currentHtsIndex().chains;
  const base = toInputRecord(f.request, now);
  const input = applyAnswers(base, answers, now);
  if ('error' in input) throw new Error(input.error);
  const { data } = loadEstimator();
  return estimateViewOf(
    {
      id: `fixture-${name}`,
      status: 'READY',
      input,
      classification: { outcome: 'OK', candidates: f.candidates.map((c) => ({ ...c, chain: chains.get(c.code) ?? [] })), separating: f.separating, reasons: [] },
      cachedFrom: null,
      error: null,
    },
    data,
    currentRateTable(),
    now.toISOString().slice(0, 10),
  );
}
