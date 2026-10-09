// Pure checks for the buyer agent (SPEC §4.4). Budget and caps are enforced HERE, on stored quotes — never by the model.
// "Delivered" is always the stored quote's total (goods + shipping + duty).
import { formatDisplay } from '../money/format';
import { usd } from '../money/money';
import { quoteUsable } from '../quote/quoteUsable';

const toMinor = (whole: string, cents?: string) => Number(whole.replace(/,/g, '')) * 100 + Number((cents ?? '').padEnd(2, '0') || '0');

/** Pre-fills the budget field from a phrase like "under $400 delivered". The buyer confirms it; the model never sets it. */
export function parseDeliveredBudget(text: string): number | null {
  const m = /\b(?:under|below|less than|up to|max(?:imum)?|at most|within|no more than)\s*\$\s?(\d{1,3}(?:,\d{3})+|\d{1,7})(?:\.(\d{1,2}))?\b/i.exec(text);
  return m ? toMinor(m[1]!, m[2]) : null;
}

/** The buyer-confirmed budget field → positive integer minor units (max $1,000,000), or null when invalid. */
export function parseBudgetField(input: string): number | null {
  const m = /^\$?\s*(\d{1,7})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!m) return null;
  const minor = toMinor(m[1]!, m[2]);
  return minor > 0 && minor <= 100_000_000 ? minor : null;
}

export type ProposalRefusal = 'NOT_YOUR_QUOTE' | 'NO_BUDGET' | 'QUOTE_EXPIRED' | 'RATE_VERSION_STALE' | 'OVER_BUDGET' | 'OVER_ORDER_CAP' | 'OVER_SESSION_CAP';

export interface ProposalInput {
  quote: { sessionId: string; totalMinor: bigint; rateVersion: string; expiresAt: Date };
  sessionId: string;
  budgetMinor: bigint | null;
  caps: { perOrderMinor: bigint; perSessionMinor: bigint };
  sessionCapturedMinor: bigint;
  now: Date;
  currentRateVersion: string;
}

export type ProposalCheck = { ok: true } | { ok: false; reasons: ProposalRefusal[]; message: string };

export function checkProposal(i: ProposalInput): ProposalCheck {
  if (i.quote.sessionId !== i.sessionId) return { ok: false, reasons: ['NOT_YOUR_QUOTE'], message: 'that quote does not belong to this session' };
  if (i.budgetMinor === null) return { ok: false, reasons: ['NO_BUDGET'], message: 'no confirmed budget — the buyer must confirm one first' };
  const reasons: ProposalRefusal[] = [];
  const messages: string[] = [];
  const u = quoteUsable(i.quote, i.now, i.currentRateVersion);
  if (!u.ok) {
    for (const r of u.reasons) reasons.push(r);
    messages.push('the quote is no longer usable — get a new quote');
  }
  const total = formatDisplay(usd(i.quote.totalMinor));
  if (i.quote.totalMinor > i.budgetMinor) {
    reasons.push('OVER_BUDGET');
    messages.push(`${total} delivered is over the ${formatDisplay(usd(i.budgetMinor))} budget`);
  }
  if (i.quote.totalMinor > i.caps.perOrderMinor) {
    reasons.push('OVER_ORDER_CAP');
    messages.push(`${total} is over the per-order spend cap`);
  }
  if (i.sessionCapturedMinor + i.quote.totalMinor > i.caps.perSessionMinor) {
    reasons.push('OVER_SESSION_CAP');
    messages.push('this would exceed the per-session spend cap');
  }
  return reasons.length ? { ok: false, reasons, message: messages.join('; ') } : { ok: true };
}

const INSTRUCTION_PATTERNS = [
  /\bignore\s+(?:all\s+|any\s+|the\s+)?(?:previous|prior|above|earlier)\s+(?:instructions|prompts?|rules)/i,
  /\bdisregard\s+(?:the\s+|all\s+|any\s+)?(?:system|previous|prior|above)?\s*(?:prompt|instructions|rules)/i,
  /\b(?:approve|authori[sz]e|capture|pay)\s+(?:this|it|the order|immediately|now)\b/i,
  /\b(?:buy|purchase|order)\s+(?:this|it)\s+(?:now|immediately)\b/i,
  /\bbudget\s+(?:doesn['’]t|does not|don['’]t)\s+matter\b/i,
  /\bskip\s+(?:the\s+)?(?:approval|confirmation|review)\b/i,
  /\byou\s+(?:must|should|are required to)\s+(?:approve|buy|purchase|pay|order)\b/i,
  /\b(?:system prompt|developer message|as an ai)\b/i,
];

/** Display-only flag: seller text that reads like instructions to an agent. It never changes what the agent may do. */
export function looksLikeInstructions(text: string): boolean {
  return INSTRUCTION_PATTERNS.some((p) => p.test(text));
}
