// Classification progress for the seller console: three steps derived from the REAL stage the server stored while the
// grounded classifier ran (classifyListingGrounded onStage). Nothing is simulated or time-based except the interrupted
// check (a run still "classifying" long after it started — e.g. the server restarted mid-run).
import type { GroundedStage } from './classifyGrounded';

export const INTERRUPTED_AFTER_MS = 90_000;

export type StepState = 'pending' | 'active' | 'done' | 'failed';
export interface ProgressStep {
  state: StepState;
  label: string;
}
export interface ProgressView {
  state: 'classifying' | 'done' | 'failed' | 'interrupted';
  steps: ProgressStep[];
}

export interface ProgressInput {
  status: string;
  stage: GroundedStage | null;
  createdAt: Date;
  top: { hts10: string; confidence: number } | null;
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function progressView(row: ProgressInput, now: Date): ProgressView {
  const running = row.status === 'CLASSIFYING';
  const interrupted = running && now.getTime() - row.createdAt.getTime() > INTERRUPTED_AFTER_MS;
  const failed = row.status === 'FAILED' || interrupted;
  const s = row.stage;
  const reached = s === null ? 0 : s.stage === 'proposing' ? 1 : s.stage === 'matching' ? 2 : 3; // the step in progress (1-based)
  const active = Math.max(1, reached);

  const headingsDone = s && s.stage !== 'proposing' ? `Proposed ${plural(s.headings.length, 'heading', 'headings')}: ${s.headings.join(', ')}` : null;
  const matchedDone = s && s.stage === 'choosing' ? `Matched ${plural(s.expanded, 'official line', 'official lines')}` : null;

  const step = (n: 1 | 2 | 3, pending: string, activeLabel: string, doneLabel: string | null): ProgressStep => {
    if (n < active) return { state: 'done', label: doneLabel ?? pending };
    if (n > active) return { state: 'pending', label: pending };
    // n === active
    if (failed) return { state: 'failed', label: pending };
    if (running) return { state: 'active', label: activeLabel };
    return { state: 'done', label: doneLabel ?? pending };
  };

  // Finished without reaching "choosing": nothing matched (or the input was too broad) — the run stopped at step 2.
  if (!running && !failed && reached === 2) {
    return {
      state: 'done',
      steps: [
        { state: 'done', label: headingsDone ?? 'Proposed headings' },
        { state: 'failed', label: 'No official Rev 20 lines matched' },
        { state: 'pending', label: 'Choosing a line (not run)' },
      ],
    };
  }

  const chose = row.top ? `Chose ${row.top.hts10} · confidence ${row.top.confidence.toFixed(2)}` : null;
  return {
    state: interrupted ? 'interrupted' : failed ? 'failed' : running ? 'classifying' : 'done',
    steps: [
      step(1, 'Proposing headings', 'Proposing headings…', headingsDone),
      step(2, 'Matching official Rev 20 lines', 'Matching official Rev 20 lines…', matchedDone),
      step(3, 'Choosing a line', 'Choosing a line…', chose),
    ],
  };
}
