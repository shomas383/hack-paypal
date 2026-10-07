// Capture policy gate (invariants 5, 6). Deterministic and pure: the ONLY way to obtain a CaptureGrant, and the
// PayPal capture call accepts nothing else. The LLM never reaches this code path.
import { createHash } from 'node:crypto';

export interface PolicyQuote {
  id: string;
  totalMinor: bigint;
  currency: 'USD';
  rateVersion: string;
  expiresAt: Date;
}

export interface PolicyInput {
  quote: PolicyQuote;
  /** The recorded human approval row for this quote, if any. */
  approval: { quoteId: string; amountMinor: bigint; currency: string; amountHash: string } | null;
  /** From PayPal's authorize response. */
  authorization: { status: string; amountMinor: bigint; currency: string };
  now: Date;
  currentRateVersion: string;
  caps: { perOrderMinor: bigint; perSessionMinor: bigint };
  /** Sum already captured in this human session. */
  sessionCapturedMinor: bigint;
}

export type PolicyReason =
  | 'NO_APPROVAL'
  | 'APPROVAL_MISMATCH'
  | 'AUTH_NOT_CREATED'
  | 'AUTH_AMOUNT_MISMATCH'
  | 'OVER_ORDER_CAP'
  | 'OVER_SESSION_CAP'
  | 'RATE_VERSION_STALE'
  | 'QUOTE_EXPIRED';

declare const grantBrand: unique symbol;
/** Proof that decideCapture approved capturing exactly this amount. Not constructible elsewhere. */
export type CaptureGrant = {
  readonly quoteId: string;
  readonly amountMinor: bigint;
  readonly currency: 'USD';
  readonly [grantBrand]: true;
};

export type CaptureDecision =
  | { decision: 'CAPTURE'; reasons: []; grant: CaptureGrant }
  | { decision: 'VOID'; reasons: PolicyReason[] };

/** Binds an approval to the exact quote it was given for. */
export function approvalHash(q: Pick<PolicyQuote, 'id' | 'totalMinor' | 'currency' | 'rateVersion'>): string {
  return createHash('sha256').update(`${q.id}|${q.totalMinor}|${q.currency}|${q.rateVersion}`).digest('hex');
}

export function decideCapture(input: PolicyInput): CaptureDecision {
  const { quote, approval, authorization, caps } = input;
  const reasons: PolicyReason[] = [];

  if (!approval) {
    reasons.push('NO_APPROVAL');
  } else if (
    approval.quoteId !== quote.id ||
    approval.amountMinor !== quote.totalMinor ||
    approval.currency !== quote.currency ||
    approval.amountHash !== approvalHash(quote)
  ) {
    reasons.push('APPROVAL_MISMATCH');
  }

  if (authorization.status !== 'CREATED') reasons.push('AUTH_NOT_CREATED');
  if (authorization.amountMinor !== quote.totalMinor || authorization.currency !== quote.currency) {
    reasons.push('AUTH_AMOUNT_MISMATCH');
  }
  if (quote.totalMinor > caps.perOrderMinor) reasons.push('OVER_ORDER_CAP');
  if (input.sessionCapturedMinor + quote.totalMinor > caps.perSessionMinor) reasons.push('OVER_SESSION_CAP');
  if (quote.rateVersion !== input.currentRateVersion) reasons.push('RATE_VERSION_STALE');
  if (input.now.getTime() >= quote.expiresAt.getTime()) reasons.push('QUOTE_EXPIRED');

  if (reasons.length > 0) return { decision: 'VOID', reasons };
  const grant = { quoteId: quote.id, amountMinor: quote.totalMinor, currency: quote.currency } as CaptureGrant;
  return { decision: 'CAPTURE', reasons: [], grant };
}
