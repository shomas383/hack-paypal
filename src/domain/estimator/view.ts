// What GET /api/estimates/<id> returns for each classifier candidate: the estimate (verified first) or why it can't be
// estimated, JSON-safe (integer USD cents, never floats). Pure: computed from the stored input and the committed estimator
// data each time, so an answer or a new data version needs no model call.
import { usd } from '@/domain/money/money';
import type { RateFile } from '@/domain/rates/schema';
import type { EstimatorData } from './data';
import type { HeadingTable } from './headings';
import { DISCLOSURE_TEXT, estimateVerifiedFirst, sourceLabel, type CantReason, type Estimate, type VerifiedFact } from './estimate';
import type { EstimateInputRecord } from './request';
import { separatingLevels } from './explain';

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
      /** Note 20 exclusions in effect that name the line (not applied; they can only lower the duty). */
      exclusions: { ref: string; heading: string; until?: string }[];
      /** A verified row that turned on facts: the questions (official text) and the answers given. */
      answered?: (VerifiedFact & { answer: boolean })[];
    }
  | {
      kind: 'CANT_ESTIMATE';
      reason: CantReason;
      detail: string;
      refs: string[];
      /** UNMODELED_REGIME: the headings named, with their own official text. */
      headings?: { heading: string; text: string }[];
      /** NEEDS_FACTS: the questions a verified rate row turns on; `required` is the answer the row covers. */
      facts?: VerifiedFact[];
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
    exclusions: est.exclusions,
    ...(est.answered ? { answered: est.answered } : {}),
  };
}

/** The stored row as the view needs it (the estimates table's columns). */
export interface EstimateRowIn {
  id: string;
  status: 'ESTIMATING' | 'READY' | 'FAILED';
  input: EstimateInputRecord;
  classification: {
    outcome: 'OK' | 'STOPPED' | 'INVALID_OUTPUT';
    candidates: CandidateIn[];
    separating: { name: string; value_from_listing: string | null }[];
    reasons: string[];
    /** The classifier's run record; `headings` = what the heading call proposed (stored with every classification). */
    meta?: { headings: string[] } | null;
  } | null;
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
  /** READY with no candidate: why the classifier stopped, and (TOO_BROAD) how many lines and where they first differ. */
  stopped: StoppedView | null;
  answeredFacts: Record<string, boolean>;
  estimatorVersion: string;
  rateVersion: string;
  notice: string;
  error?: string;
}

export interface StoppedView {
  reason: 'TOO_BROAD' | 'NO_CANDIDATES' | 'INVALID_OUTPUT';
  /** Official lines under the proposed headings (null when the headings aren't recorded). */
  lines: number | null;
  /** TOO_BROAD: the distinct official texts at the first level where those lines part (verbatim, ":" removed). */
  differAt: string[];
}

const digits = (s: string) => s.replace(/\./g, '');

/** Why a READY classification has no candidate, from its outcome and reasons; lines and levels from the official chains. */
function stoppedView(c: NonNullable<EstimateRowIn['classification']>, chains: Map<string, string[]>): StoppedView | null {
  if (c.candidates.length > 0) return null;
  const reason: StoppedView['reason'] = c.outcome === 'INVALID_OUTPUT' ? 'INVALID_OUTPUT' : c.reasons.includes('TOO_BROAD') ? 'TOO_BROAD' : 'NO_CANDIDATES';
  const heads = c.meta?.headings.map(digits) ?? null;
  const lines = heads ? [...chains].filter(([code]) => heads.some((h) => digits(code).startsWith(h))).map(([, chain]) => chain) : null;
  const differAt = reason === 'TOO_BROAD' && lines ? [...new Set(separatingLevels(lines) ?? [])] : [];
  return { reason, lines: lines ? lines.length : null, differAt };
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
    stopped: row.status === 'READY' && c ? stoppedView(c, data.chains) : null,
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
