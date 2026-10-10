// Seller review actions (SPEC §4.1, docs/design/wireframes.md §3). Pure rules; the server records each action with who
// (seller session), when and why, and applies it only through these checks.
import { usd } from '../money/money';
import { formatDisplay } from '../money/format';
import type { RateRow } from '../rates/schema';
import { validateHts10, type HtsLookup } from './hts';
import { canPublish, type ClassificationStatus } from './publish';

export type ReviewAction = 'accept' | 'override' | 'publish';

export function nextStatus(current: ClassificationStatus, action: ReviewAction): { ok: true; status: ClassificationStatus } | { ok: false; error: string } {
  if (current === 'CLASSIFYING') return { ok: false, error: 'The classification is still running.' };
  if (current === 'FAILED') return { ok: false, error: 'The classification failed; run it again.' };
  if (current === 'PUBLISHED') return { ok: false, error: 'Already published.' };
  if (action === 'accept') return current === 'PENDING_REVIEW' || current === 'AUTO_ACCEPTED' ? { ok: true, status: 'ACCEPTED' } : { ok: false, error: `Can't accept a ${current} classification.` };
  if (action === 'override') return { ok: true, status: 'OVERRIDDEN' };
  return canPublish(current) ? { ok: true, status: 'PUBLISHED' } : { ok: false, error: 'Accept or override the code before publishing.' };
}

export interface RecordedAction {
  action: ReviewAction;
  fromStatus: ClassificationStatus;
  toStatus: ClassificationStatus;
  fromHts10: string | null;
  toHts10: string | null;
  undone: boolean;
}

/** Undo restores the recorded "from" state, only if nothing changed the row since, and never a publish. */
export function undoTarget(a: RecordedAction, current: { status: ClassificationStatus; hts10: string | null }): { ok: true; status: ClassificationStatus; hts10: string | null } | { ok: false; error: string } {
  if (a.undone) return { ok: false, error: 'Already undone.' };
  if (a.action === 'publish' || current.status === 'PUBLISHED') return { ok: false, error: "A published listing can't be undone." };
  if (current.status !== a.toStatus || current.hts10 !== a.toHts10) return { ok: false, error: 'The classification changed since; undo the later action first.' };
  return { ok: true, status: a.fromStatus, hts10: a.fromHts10 };
}

export function validateOverride(input: { hts10: string; reason: string }, expanded: readonly string[], idx: HtsLookup): string[] {
  const errors: string[] = [];
  if (!expanded.includes(input.hts10) || !validateHts10(input.hts10, idx).ok) errors.push('Choose a code from the official lines this classification matched.');
  if (input.reason.trim().length < 3) errors.push('Give a reason for the override.');
  return errors;
}

/** A compound MFN with case / band components (watches) needs the case and band values to quote. */
export function needsValueSplit(row: RateRow | undefined): boolean {
  return row?.mfn.type === 'compound' && row.mfn.components.some((c) => c.kind === 'ad_valorem' && c.applies_to !== 'full_value');
}

export function checkValueSplit(split: { caseMinor: number; bandMinor: number }, priceMinor: number): string[] {
  if (!Number.isInteger(split.caseMinor) || !Number.isInteger(split.bandMinor) || split.caseMinor <= 0 || split.bandMinor <= 0) return ['Enter a case value and a band value above $0.00.'];
  if (split.caseMinor + split.bandMinor !== priceMinor) return [`Case and band values must add up to the price (${formatDisplay(usd(BigInt(priceMinor)))}).`];
  return [];
}
