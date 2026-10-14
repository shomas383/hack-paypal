// The /estimate headline, decided once by code for every view (pure). The LIKELY lines (confidence ≥ LIKELY_CONFIDENCE)
// decide it:
//   - any likely line refused → the refusal, citing what named the most confident refused line, and never a figure (lines
//     that could be estimated are shown below it, labelled);
//   - otherwise any likely line that only needs answers (a verified row's facts, a case/band split) → ask, no figure;
//   - otherwise → the min–max of every likely line's duty.
// Less likely lines never produce or block the headline; refused ones, and estimated ones whose duty is outside the
// figure, are disclosed in one line each under it.
// Production reports: 2026-10-13 the kettle's 92% and 5% lines were refused but the headline showed the 1% line's $11.25;
// after the fix the knife's 7% plastic-handle line made the headline "Can't estimate" next to an 88% verified row.
import { formatUsd } from '@/lib/money';
import { usd } from '@/domain/money/money';
import type { CantReason } from './estimate';
import { cantText, refText } from './explain';
import type { CandidateView, StoppedView } from './view';

/** Lines at or above this classifier confidence are "likely" and decide the headline. */
export const LIKELY_CONFIDENCE = 0.1;

/** Less likely lines that can't be estimated (disclosed under the headline); `confidence` is their sum. */
export type UnlikelyRefused = { codes: string[]; confidence: number } | null;

export type Headline =
  | { kind: 'STOPPED'; reason: StoppedView['reason'] }
  | {
      kind: 'REFUSED';
      /** The most confident refused likely line: what the headline cites. */
      line: { code: string; confidence: number };
      /** That line is also the most confident shown line. */
      top: boolean;
      reason: CantReason;
      detail: string;
      refs: string[];
      /** Lines that could be estimated, shown below under this label (null when there are none). */
      estimable: { label: string; codes: string[] } | null;
      unlikelyRefused: UnlikelyRefused;
    }
  | { kind: 'ASKING'; unlikelyRefused: UnlikelyRefused }
  | { kind: 'FIGURE'; minMinor: number; maxMinor: number; unlikelyRefused: UnlikelyRefused; unlikelyOther: UnlikelyOther };

/** Less likely estimated lines whose duty is outside the headline's figure or range (disclosed under it). */
export type UnlikelyOther = { codes: string[]; confidence: number; minMinor: number; maxMinor: number } | null;

/** Not refusals: the line's verified row (or the case/band split) only needs answers the seller can give. */
const ASKS: readonly CantReason[] = ['NEEDS_FACTS', 'NEEDS_SPLIT'];
const isRefused = (c: CandidateView) => c.outcome.kind === 'CANT_ESTIMATE' && !ASKS.includes(c.outcome.reason);

export function headlineOf(candidates: CandidateView[], stopped: StoppedView | null): Headline {
  if (candidates.length === 0) return { kind: 'STOPPED', reason: stopped?.reason ?? 'NO_CANDIDATES' };
  const byConfidence = [...candidates].sort((a, b) => b.confidence - a.confidence);
  // the most confident line always counts, so a headline exists even when no line reaches the threshold
  const likely = byConfidence.filter((c, i) => i === 0 || c.confidence >= LIKELY_CONFIDENCE);
  const unlikely = byConfidence.filter((c) => !likely.includes(c) && isRefused(c));
  const unlikelyRefused: UnlikelyRefused = unlikely.length ? { codes: unlikely.map((c) => c.code), confidence: unlikely.reduce((a, c) => a + c.confidence, 0) } : null;
  const refused = likely.find(isRefused);
  if (refused && refused.outcome.kind === 'CANT_ESTIMATE') {
    const estimated = byConfidence.filter((c) => c.outcome.kind === 'ESTIMATE');
    const lessLikely = estimated.every((e) => e.confidence < refused.confidence);
    return {
      kind: 'REFUSED',
      line: { code: refused.code, confidence: refused.confidence },
      top: refused === byConfidence[0],
      reason: refused.outcome.reason,
      detail: refused.outcome.detail,
      refs: refused.outcome.refs,
      estimable: estimated.length ? { label: lessLikely ? 'Less likely lines that could be estimated' : 'Other lines that could be estimated', codes: estimated.map((e) => e.code) } : null,
      unlikelyRefused,
    };
  }
  const duties = likely.flatMap((c) => (c.outcome.kind === 'ESTIMATE' ? [c.outcome.dutyMinor] : []));
  if (duties.length < likely.length) return { kind: 'ASKING', unlikelyRefused };
  const [minMinor, maxMinor] = [Math.min(...duties), Math.max(...duties)];
  const other = byConfidence.flatMap((c) =>
    !likely.includes(c) && c.outcome.kind === 'ESTIMATE' && (c.outcome.dutyMinor < minMinor || c.outcome.dutyMinor > maxMinor) ? [{ code: c.code, confidence: c.confidence, duty: c.outcome.dutyMinor }] : [],
  );
  const unlikelyOther: UnlikelyOther = other.length
    ? { codes: other.map((o) => o.code), confidence: other.reduce((a, o) => a + o.confidence, 0), minMinor: Math.min(...other.map((o) => o.duty)), maxMinor: Math.max(...other.map((o) => o.duty)) }
    : null;
  return { kind: 'FIGURE', minMinor, maxMinor, unlikelyRefused, unlikelyOther };
}

const STOPPED_TITLE = { TOO_BROAD: 'Too many possible HTS lines', NO_CANDIDATES: 'No HTS line matched', INVALID_OUTPUT: 'Couldn’t classify this description' } as const;

export function headlineTitle(h: Headline): string {
  switch (h.kind) {
    case 'STOPPED':
      return STOPPED_TITLE[h.reason];
    case 'REFUSED':
      return 'Can’t estimate this product yet';
    case 'ASKING':
      return 'Answer the questions below to estimate the duty';
    case 'FIGURE':
      return h.minMinor === h.maxMinor ? 'US import duty (est.)' : 'US import duty (est.), depending on the HTS line';
  }
}

const andList = (xs: string[]) => (xs.length <= 1 ? (xs[0] ?? '') : `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}`);

/** The refusal under the headline: which line, and the headings and notes that named it (or why it can't be estimated). */
export function refusalText(h: Extract<Headline, { kind: 'REFUSED' }>): string {
  const pct = Math.round(h.line.confidence * 100);
  const subject = h.top ? `The most likely line, ${h.line.code} (confidence ${pct}%),` : `Line ${h.line.code} (confidence ${pct}%)`;
  const footnoted = h.refs.filter((r) => r.startsWith('footnote ')).map((r) => `heading ${r.slice('footnote '.length)} (cited in the line’s own footnote)`);
  const own = h.refs.filter((r) => r.startsWith('heading ') && !footnoted.some((f) => f.startsWith(r)));
  const notes = h.refs.filter((r) => r.startsWith('note ')).map(refText);
  const named = [...own, ...footnoted, ...notes];
  if (named.length) return `${subject} is named by ${andList(named)}, which the estimator doesn’t model yet.`;
  return `${subject} can’t be estimated. ${cantText(h.reason, h.detail, h.refs)}`;
}

/** One line under the headline for refused less likely lines; null when there are none. */
export function unlikelyRefusedText(h: Headline): string | null {
  const u = h.kind === 'STOPPED' ? null : h.unlikelyRefused;
  if (!u) return null;
  const pct = Math.round(u.confidence * 100);
  return u.codes.length === 1
    ? `1 less likely line (${pct}%) can’t be estimated: ${u.codes[0]}.`
    : `${u.codes.length} less likely lines (${pct}% combined) can’t be estimated: ${u.codes.join(', ')}.`;
}

/** One line under a figure for less likely lines at another duty; null when there are none (or no figure). */
export function unlikelyOtherText(h: Headline): string | null {
  const u = h.kind === 'FIGURE' ? h.unlikelyOther : null;
  if (!u) return null;
  const pct = Math.round(u.confidence * 100);
  const duty = u.minMinor === u.maxMinor ? formatUsd(usd(u.minMinor)) : `${formatUsd(usd(u.minMinor))} to ${formatUsd(usd(u.maxMinor))}`;
  return u.codes.length === 1
    ? `1 less likely line (${pct}%) would be ${duty}: ${u.codes[0]}.`
    : `${u.codes.length} less likely lines (${pct}% combined) would be ${duty}: ${u.codes.join(', ')}.`;
}
