// What GET /api/estimates/<id> returns for each classifier candidate: the estimate (verified first) or why it can't be
// estimated, JSON-safe (integer USD cents, never floats). Pure: computed from the stored input and the committed estimator
// data each time, so an answer or a new data version needs no model call.
import { usd } from '@/domain/money/money';
import type { RateFile } from '@/domain/rates/schema';
import type { EstimatorData } from './data';
import type { HeadingTable } from './headings';
import { DISCLOSURE_TEXT, estimateVerifiedFirst, sourceLabel, type CantReason, type Estimate } from './estimate';
import type { EstimateInputRecord } from './request';

export interface CandidateIn {
  code: string;
  chain: string[];
  confidence: number;
}

export interface LineView {
  label: string;
  chapter99?: string;
  amountMinor: number;
  /** The engine's exact basis text ("combined cap 12.5% (base or AVE below cap)"). */
  basis: string;
  /** Chapter 99 lines: the heading's official text (unnumbered parent rows + its own description), from the export. */
  officialText?: string;
}

export type OutcomeView =
  | {
      kind: 'ESTIMATE';
      source: 'verified' | 'automated';
      sourceLabel: string;
      dutyMinor: number;
      /** Selling price + shipping + duty: what a DDP buyer pays. */
      ddpTotalMinor: number;
      effectiveRatePpm: number;
      lines: LineView[];
      /** Unanswered conditional exemptions: the duty if the answer is yes. */
      ifYes: { fact: string; question: string; heading: string; dutyMinor: number; ddpTotalMinor: number }[];
      disclosures: string[];
    }
  | {
      kind: 'CANT_ESTIMATE';
      reason: CantReason;
      detail: string;
      refs: string[];
      /** UNMODELED_REGIME: the headings named, with their own official text. */
      headings?: { heading: string; text: string }[];
      /** NEEDS_FACTS: the questions a verified rate row turns on; `required` is the answer the row covers. */
      facts?: { fact: string; required: boolean; ref: string }[];
      /** NEEDS_FACTS: the verified row's figure with the answers it covers. */
      ifAnswered?: { sourceLabel: string; dutyMinor: number; ddpTotalMinor: number };
    };

export interface CandidateView extends CandidateIn {
  outcome: OutcomeView;
}

const cents = (m: { amountMinor: bigint }) => Number(m.amountMinor);

function outcome(e: ReturnType<typeof estimateVerifiedFirst>, priceAndShipping: number, headings: HeadingTable): OutcomeView {
  if (e.kind === 'CANT_ESTIMATE')
    return {
      kind: 'CANT_ESTIMATE',
      reason: e.reason,
      detail: e.detail,
      refs: e.refs,
      ...(e.headings?.length ? { headings: e.headings } : {}),
      ...(e.facts?.length ? { facts: e.facts } : {}),
      ...(e.ifAnswered
        ? { ifAnswered: { sourceLabel: sourceLabel({ kind: 'verified', rateVersion: e.ifAnswered.rateVersion }), dutyMinor: cents(e.ifAnswered.totalDuty), ddpTotalMinor: priceAndShipping + cents(e.ifAnswered.totalDuty) } }
        : {}),
    };
  const est: Estimate = e;
  const duty = cents(est.result.totalDuty);
  return {
    kind: 'ESTIMATE',
    source: est.source.kind,
    sourceLabel: sourceLabel(est.source),
    dutyMinor: duty,
    ddpTotalMinor: priceAndShipping + duty,
    effectiveRatePpm: est.result.effectiveRatePpm,
    lines: est.result.lines.map((l) => {
      const official = l.chapter99 ? headings[l.chapter99]?.chain : undefined;
      return { label: l.kind === 'MFN' ? 'General rate' : l.kind, ...(l.chapter99 ? { chapter99: l.chapter99 } : {}), amountMinor: cents(l.amount), basis: l.basis, ...(official ? { officialText: official } : {}) };
    }),
    ifYes: est.ifYes.map((y) => ({ fact: y.question.fact, question: y.question.text, heading: y.question.heading, dutyMinor: cents(y.result.totalDuty), ddpTotalMinor: priceAndShipping + cents(y.result.totalDuty) })),
    disclosures: est.disclosures.map((d) => DISCLOSURE_TEXT[d]),
  };
}

/** The stored row as the view needs it (the estimates table's columns). */
export interface EstimateRowIn {
  id: string;
  status: 'ESTIMATING' | 'READY' | 'FAILED';
  input: EstimateInputRecord;
  classification: { outcome: 'OK' | 'STOPPED' | 'INVALID_OUTPUT'; candidates: CandidateIn[]; separating: { name: string; value_from_listing: string | null }[]; reasons: string[] } | null;
  cachedFrom: string | null;
  error: string | null;
}

export interface EstimateView {
  id: string;
  status: 'ESTIMATING' | 'READY' | 'FAILED';
  product: { title: string; details?: string };
  origin: string;
  sellingPriceMinor: number;
  shippingMinor: number;
  quantity: number;
  /** Reused the classification of an identical description within 24 h (no model call). */
  cached: boolean;
  /** READY: why no candidate (classifier stopped / invalid) or the routing reasons; empty when fine. */
  reasons: string[];
  separating: { name: string; value_from_listing: string | null }[];
  candidates: CandidateView[];
  answeredFacts: Record<string, boolean>;
  estimatorVersion: string;
  rateVersion: string;
  notice: string;
  error?: string;
}

/** The whole estimate as the page and the API show it. Candidates are computed only for a READY row. */
export function estimateViewOf(row: EstimateRowIn, data: EstimatorData, verified: RateFile, entryDate: string): EstimateView {
  const p = row.input.pricing;
  const c = row.classification;
  return {
    id: row.id,
    status: row.status,
    product: row.input.product,
    origin: row.input.facts.origin.value ?? '',
    sellingPriceMinor: p.sellingPriceMinor,
    shippingMinor: p.shippingMinor ?? 0,
    quantity: p.quantity,
    cached: row.cachedFrom !== null,
    reasons: c ? (c.outcome === 'OK' ? c.reasons : [c.outcome, ...c.reasons]) : [],
    separating: c?.separating ?? [],
    candidates: row.status === 'READY' && c ? estimateCandidates(c.candidates, row.input, data, verified, entryDate) : [],
    answeredFacts: Object.fromEntries(Object.entries(row.input.facts.attributes).flatMap(([k, f]) => (f.value === null ? [] : [[k, f.value]]))),
    estimatorVersion: data.version,
    rateVersion: verified.version,
    notice: DISCLOSURE_TEXT.NOT_A_RULING,
    ...(row.error ? { error: row.error } : {}),
  };
}

export function estimateCandidates(candidates: CandidateIn[], input: EstimateInputRecord, data: EstimatorData, verified: RateFile, entryDate: string): CandidateView[] {
  const p = input.pricing;
  const facts = Object.fromEntries(Object.entries(input.facts.attributes).flatMap(([k, f]) => (f.value === null ? [] : [[k, f.value]])));
  return candidates.map((c) => ({
    ...c,
    outcome: outcome(
      estimateVerifiedFirst(
        {
          code: c.code,
          origin: input.facts.origin.value ?? '',
          entryDate,
          customsValue: usd(p.sellingPriceMinor),
          quantity: p.quantity,
          ...(p.valueSplit ? { valueSplit: { case: usd(p.valueSplit.caseMinor), band: usd(p.valueSplit.bandMinor) } } : {}),
          ...(Object.keys(facts).length ? { facts } : {}),
        },
        data,
        verified,
      ),
      p.sellingPriceMinor + (p.shippingMinor ?? 0),
      data.headings,
    ),
  }));
}
