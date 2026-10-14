// The public read-only seller view (SPEC §4.5, SELLER_PUBLIC_VIEW=1): what anyone may see of the review queue, one
// classification and the orders ledger. Allowlist projections: each key is copied by name (never spread), so a field
// added to the server rows later stays private until it is listed here. The audit trail drops "by" (the seller session).
import type { ProgressView } from '../classifier/progress';
import type { ClassificationStatus } from '../classifier/publish';
import type { SellerQuestions } from '../classifier/questions';

export interface PublicQueueRow {
  id: string;
  title: string;
  origin: string | null;
  topCode: string | null;
  hts10: string | null;
  confidence: number | null;
  reasons: string[];
  status: ClassificationStatus | string;
  answered: number;
  questions: number;
  updatedAt: string;
}

export interface PublicLedgerRow {
  orderId: string;
  date: string;
  listingId: string;
  title: string;
  /** Integer USD minor units as strings (bigint-safe JSON). */
  goodsMinor: string;
  shippingMinor: string;
  dutyMinor: string;
  totalMinor: string;
  hts10: string;
  ch99: string[];
  rateVersion: string;
  status: string;
  paypalOrderId: string | null;
}

export interface PublicAction {
  id: string;
  action: string;
  fromStatus: string;
  toStatus: string;
  fromHts10: string | null;
  toHts10: string | null;
  reason: string | null;
  at: string;
  undone: boolean;
}

export interface PublicDetail {
  id: string;
  status: ClassificationStatus | string;
  progress: ProgressView;
  input: { title: string; description?: string | undefined; origin: string | null };
  error: string | null;
  reasons: string[];
  threshold: number;
  top: { hts10: string; confidence: number; rationale: string; evidence: string[]; chain: string[]; componentReporting: boolean } | null;
  others: { hts10: string; confidence: number; chain: string[] }[];
  separatingAttributes: { name: string; value_from_listing: string | null }[];
  hts10: string | null;
  priceMinor: string;
  shippingMinor: string;
  listingId: string | null;
  questions: SellerQuestions;
  answers: Record<string, string>;
  exclusionsApply: boolean | null;
  statements: { question: string; answer: string; at: string }[];
  actions: PublicAction[];
  expanded: { code: string; chain: string[] }[];
  suggested: string | null;
  publish: { code: string | null; needsSplit: boolean; verifiedRate: boolean };
  quote: { quotable: true; dutyMinor: string; deliveredMinor: string } | { quotable: false; reason: string } | null;
}

export function toPublicQueueRow(r: PublicQueueRow): PublicQueueRow {
  return { id: r.id, title: r.title, origin: r.origin, topCode: r.topCode, hts10: r.hts10, confidence: r.confidence, reasons: r.reasons, status: r.status, answered: r.answered, questions: r.questions, updatedAt: r.updatedAt };
}

export function toPublicLedgerRow(r: PublicLedgerRow): PublicLedgerRow {
  return {
    orderId: r.orderId,
    date: r.date,
    listingId: r.listingId,
    title: r.title,
    goodsMinor: r.goodsMinor,
    shippingMinor: r.shippingMinor,
    dutyMinor: r.dutyMinor,
    totalMinor: r.totalMinor,
    hts10: r.hts10,
    ch99: r.ch99,
    rateVersion: r.rateVersion,
    status: r.status,
    paypalOrderId: r.paypalOrderId,
  };
}

const toPublicAction = (a: PublicAction): PublicAction => ({ id: a.id, action: a.action, fromStatus: a.fromStatus, toStatus: a.toStatus, fromHts10: a.fromHts10, toHts10: a.toHts10, reason: a.reason, at: a.at, undone: a.undone });

export function toPublicDetail(d: PublicDetail): PublicDetail {
  return {
    id: d.id,
    status: d.status,
    progress: d.progress,
    input: { title: d.input.title, description: d.input.description, origin: d.input.origin },
    error: d.error,
    reasons: d.reasons,
    threshold: d.threshold,
    top: d.top,
    others: d.others,
    separatingAttributes: d.separatingAttributes,
    hts10: d.hts10,
    priceMinor: d.priceMinor,
    shippingMinor: d.shippingMinor,
    listingId: d.listingId,
    questions: d.questions,
    answers: d.answers,
    exclusionsApply: d.exclusionsApply,
    statements: d.statements,
    actions: d.actions.map(toPublicAction),
    expanded: d.expanded,
    suggested: d.suggested,
    publish: d.publish,
    quote: d.quote,
  };
}

/** Keys that must never appear in a public payload (sessions, network and buyer details). */
export const FORBIDDEN_KEYS = ['by', 'sellerSession', 'sessionId', 'ip', 'email', 'email_address', 'payer', 'callId', 'passcode'] as const;
const FORBIDDEN = new Set<string>(FORBIDDEN_KEYS);

/** Dotted paths of every forbidden key at any depth (empty = clean). */
export function forbiddenPaths(value: unknown, path: string[] = []): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => forbiddenPaths(v, [...path, String(i)]));
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => [...(FORBIDDEN.has(k) ? [[...path, k].join('.')] : []), ...forbiddenPaths(v, [...path, k])]);
}
