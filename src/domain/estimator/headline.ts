// The /estimate headline, decided once by code for every view (pure). Its figure or range must cover EVERY shown line, so:
//   - any shown line refused → the refusal, citing what named the most confident refused line, and never a figure (lines
//     that could be estimated are shown below it, labelled);
//   - otherwise any line that only needs answers (a verified row's facts, a case/band split) → ask, no figure;
//   - otherwise (every line estimated) → the min–max of all their duties.
// Production report 2026-10-13: the kettle's 92% and 5% lines were refused but the headline showed the 1% line's $11.25.
import type { CantReason } from './estimate';
import { cantText, refText } from './explain';
import type { CandidateView, StoppedView } from './view';

export type Headline =
  | { kind: 'STOPPED'; reason: StoppedView['reason'] }
  | {
      kind: 'REFUSED';
      /** The most confident refused line: what the headline cites. */
      line: { code: string; confidence: number };
      /** That line is also the most confident shown line. */
      top: boolean;
      reason: CantReason;
      detail: string;
      refs: string[];
      /** Lines that could be estimated, shown below under this label (null when there are none). */
      estimable: { label: string; codes: string[] } | null;
    }
  | { kind: 'ASKING' }
  | { kind: 'FIGURE'; minMinor: number; maxMinor: number };

/** Not refusals: the line's verified row (or the case/band split) only needs answers the seller can give. */
const ASKS: readonly CantReason[] = ['NEEDS_FACTS', 'NEEDS_SPLIT'];

export function headlineOf(candidates: CandidateView[], stopped: StoppedView | null): Headline {
  if (candidates.length === 0) return { kind: 'STOPPED', reason: stopped?.reason ?? 'NO_CANDIDATES' };
  const byConfidence = [...candidates].sort((a, b) => b.confidence - a.confidence);
  const refused = byConfidence.find((c) => c.outcome.kind === 'CANT_ESTIMATE' && !ASKS.includes(c.outcome.reason));
  const estimated = byConfidence.flatMap((c) => (c.outcome.kind === 'ESTIMATE' ? [{ code: c.code, confidence: c.confidence, duty: c.outcome.dutyMinor }] : []));
  if (refused && refused.outcome.kind === 'CANT_ESTIMATE') {
    const lessLikely = estimated.every((e) => e.confidence < refused.confidence);
    return {
      kind: 'REFUSED',
      line: { code: refused.code, confidence: refused.confidence },
      top: refused === byConfidence[0],
      reason: refused.outcome.reason,
      detail: refused.outcome.detail,
      refs: refused.outcome.refs,
      estimable: estimated.length ? { label: lessLikely ? 'Less likely lines that could be estimated' : 'Other lines that could be estimated', codes: estimated.map((e) => e.code) } : null,
    };
  }
  if (estimated.length < candidates.length) return { kind: 'ASKING' };
  const duties = estimated.map((e) => e.duty);
  return { kind: 'FIGURE', minMinor: Math.min(...duties), maxMinor: Math.max(...duties) };
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
