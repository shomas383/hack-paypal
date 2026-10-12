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
  // The P11 knife at L-P11's price and shipping: its verified row turns on two facts, asked as questions; with the answers
  // the row covers it quotes the same figure as checkout.
  knife: {
    request: { title: "Japanese gyuto chef's knife, stainless steel blade, natural wood handle", origin: 'JP', sellingPriceMinor: 14000, shippingMinor: 2500 },
    candidates: [{ code: '8211.92.9030', confidence: 0.86 }],
    separating: [],
  },
  // Lines the estimator refuses (no verified row): a steel kettle, named by note 16(c)(vii) and heading 9903.82.03.
  unsupported: {
    request: { title: 'Stainless steel stovetop kettle, 1.5 L', origin: 'JP', sellingPriceMinor: 9000, shippingMinor: 1500 },
    candidates: [
      { code: '7323.93.0015', confidence: 0.78 },
      { code: '7323.93.0045', confidence: 0.15 },
    ],
    separating: [],
  },
  // A line named by its own footnote and heading (9903.41.10).
  shoes: {
    request: { title: "Men's leather oxford shoes, leather soles", origin: 'JP', sellingPriceMinor: 22000, shippingMinor: 2000 },
    candidates: [{ code: '6403.59.6060', confidence: 0.8 }],
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
