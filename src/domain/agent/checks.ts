// Pure checks for the buyer agent (SPEC §4.4). Budget and caps are enforced HERE, on stored quotes — never by the model.
// "Delivered" is always the stored quote's total (goods + shipping + duty).
import { formatDisplay } from '../money/format';
import { usd } from '../money/money';
import { orderCapMessage, sessionCapMessage } from '../policy/capMessages';
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
    messages.push('The quote is no longer usable — get a new quote.');
  }
  const total = formatDisplay(usd(i.quote.totalMinor));
  if (i.quote.totalMinor > i.budgetMinor) {
    reasons.push('OVER_BUDGET');
    messages.push(`${total} delivered is over the ${formatDisplay(usd(i.budgetMinor))} budget.`);
  }
  if (i.quote.totalMinor > i.caps.perOrderMinor) {
    reasons.push('OVER_ORDER_CAP');
    messages.push(orderCapMessage({ orderMinor: i.quote.totalMinor, capMinor: i.caps.perOrderMinor }));
  }
  if (i.sessionCapturedMinor + i.quote.totalMinor > i.caps.perSessionMinor) {
    reasons.push('OVER_SESSION_CAP');
    messages.push(sessionCapMessage({ alreadyMinor: i.sessionCapturedMinor, capMinor: i.caps.perSessionMinor, orderMinor: i.quote.totalMinor }));
  }
  return reasons.length ? { ok: false, reasons, message: messages.join(' ') } : { ok: true };
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

// Japanese (and Simplified Chinese, since Han text counts as checked): ignore earlier instructions, buy/pay/approve now,
// budget doesn't matter, skip the review, system prompt. Deliberately NOT flagged: ordinary marketplace wording such as
// 即購入OK, コメントなしで購入してください, 24時間以内に決済してください, 動作確認済み (tested).
const CJK_INSTRUCTION_PATTERNS = [
  /(?:以前|前|上記|これまで|今まで)の(?:指示|命令|指令|ルール|プロンプト)(?:を|は)?(?:すべて|全て)?(?:無視|忘れ)/,
  /(?:指示|命令|指令)を?無視/,
  /(?:今すぐ|すぐに|直ちに|ただちに)(?:購入|買|注文|支払|決済|承認)/,
  /承認(?:して|しろ|せよ|しなさい)/,
  /予算(?:は|を)?(?:関係(?:ない|ありません|なし)|気にしな|無視)/,
  /(?:確認|承認|レビュー|審査)(?:を|は)?(?:スキップ|省略|飛ばし)/,
  /システムプロンプト|開発者メッセージ/,
  /(?:忽略|无视|無視)(?:之前|以前|上面|以上|所有)?的?(?:所有)?(?:指令|指示|说明)/,
  /立即(?:购买|付款|批准|支付)/,
  /系统提示/,
];

/** Letters outside the scripts the patterns cover (Latin, Hiragana, Katakana, Han; Common/Inherited = digits, punctuation, symbols, marks). */
const UNCHECKED_SCRIPT = /[^\p{Script=Latin}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Han}\p{Script=Common}\p{Script=Inherited}]/u;

export type SellerTextCheck = 'ok' | 'instructions' | 'unchecked_script';

/**
 * Seller text → ok | instructions | unchecked_script (code only, no model). Normalised first: NFKC (fullwidth → ASCII,
 * halfwidth katakana → katakana) and format characters (zero-width, soft hyphen) removed, so hidden variants match.
 * Text with letters in any other script (e.g. Cyrillic look-alikes, Hangul) can't be checked and is withheld (fail closed).
 */
export function sellerTextCheck(text: string): SellerTextCheck {
  const t = text.normalize('NFKC').replace(/\p{Cf}/gu, '');
  if (INSTRUCTION_PATTERNS.some((p) => p.test(t)) || CJK_INSTRUCTION_PATTERNS.some((p) => p.test(t))) return 'instructions';
  return UNCHECKED_SCRIPT.test(t) ? 'unchecked_script' : 'ok';
}

/** Display-only flag: seller text that reads like instructions to an agent. It never changes what the agent may do. */
export function looksLikeInstructions(text: string): boolean {
  return sellerTextCheck(text) === 'instructions';
}
