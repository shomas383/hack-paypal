// Drizzle schema (SPEC §5). Money is integer minor units in bigint columns (invariant 1); currency is USD.
// `quotes` is immutable: the repository only inserts/reads and a DB trigger (migration 0001) rejects UPDATE/DELETE.
import { bigint, bigserial, boolean, char, index, integer, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';
import type { GroundedChoice } from '@/domain/classifier/grounded';
import type { GroundedMeta, GroundedStage } from '@/domain/classifier/classifyGrounded';
import type { HtsLine } from '@/domain/classifier/hts';
import type { ClassificationInput, ClassificationStatus } from '@/domain/classifier/publish';

/** What a grounded classification stores (choice, the official candidate lines it chose from, run meta). */
export interface GroundedResult {
  outcome: 'OK' | 'STOPPED' | 'INVALID_OUTPUT';
  choice: GroundedChoice | null;
  candidates: HtsLine[];
  meta: GroundedMeta;
}
import type { ClassifierOutputT } from '@/domain/classifier/schema';
import type { StoredLine } from '@/domain/quote/buildQuote';

const money = (name: string) => bigint(name, { mode: 'bigint' });
const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

export const listings = pgTable('listings', {
  id: text('id').primaryKey(),
  sheetRef: text('sheet_ref').notNull(),
  title: text('title').notNull(),
  origin: char('origin', { length: 2 }).notNull(),
  hts10: text('hts10').notNull(),
  priceMinor: money('price_minor').notNull(),
  shippingMinor: money('shipping_minor').notNull(),
  currency: text('currency').notNull().default('USD'),
  valueSplit: jsonb('value_split').$type<{ case_minor: number; band_minor: number } | null>(),
  facts: jsonb('facts').$type<Record<string, boolean>>().notNull().default({}),
  /** Seller-written text. UNTRUSTED: passed to the buyer agent only as marked third-party data. */
  description: text('description'),
  /** Red-team fixtures (e.g. L-T-INJ): hidden on /listings, visible to the agent's search. */
  testFixture: boolean('test_fixture').notNull().default(false),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/**
 * A purchase the buyer agent PROPOSES (SPEC §4.4). Not an approval: the human still clicks Approve on the checkout
 * (approvals table) and pays in PayPal. Budget and caps were checked in code on the stored quote when it was created.
 */
export const purchaseProposals = pgTable('purchase_proposals', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: text('session_id').notNull(),
  quoteId: uuid('quote_id').notNull().references(() => quotes.id),
  budgetMinor: money('budget_minor').notNull(),
  totalMinor: money('total_minor').notNull(),
  status: text('status').notNull(), // PENDING
  reasoning: text('reasoning').notNull(),
  createdAt: ts('created_at').notNull().defaultNow(),
});

export const quotes = pgTable('quotes', {
  id: uuid('id').primaryKey(),
  listingId: text('listing_id').notNull().references(() => listings.id),
  sessionId: text('session_id').notNull(),
  title: text('title').notNull(),
  rateVersion: text('rate_version').notNull(),
  rateRowId: text('rate_row_id').notNull(),
  origin: char('origin', { length: 2 }).notNull(),
  hts10: text('hts10').notNull(),
  entryDate: text('entry_date').notNull(),
  goodsMinor: money('goods_minor').notNull(),
  shippingMinor: money('shipping_minor').notNull(),
  dutyMinor: money('duty_minor').notNull(),
  totalMinor: money('total_minor').notNull(),
  currency: text('currency').notNull(),
  lines: jsonb('lines').$type<StoredLine[]>().notNull(),
  effectiveRatePpm: integer('effective_rate_ppm').notNull(),
  createdAt: ts('created_at').notNull(),
  expiresAt: ts('expires_at').notNull(),
});

export const approvals = pgTable('approvals', {
  id: uuid('id').primaryKey().defaultRandom(),
  quoteId: uuid('quote_id').notNull().unique().references(() => quotes.id),
  sessionId: text('session_id').notNull(),
  amountMinor: money('amount_minor').notNull(),
  currency: text('currency').notNull(),
  amountHash: text('amount_hash').notNull(),
  approvedAt: ts('approved_at').notNull().defaultNow(),
});

export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  quoteId: uuid('quote_id').notNull().unique().references(() => quotes.id),
  paypalOrderId: text('paypal_order_id').unique(),
  status: text('status').notNull(), // CREATING|CREATED|AUTHORIZED|CAPTURED|VOIDED|FAILED
  authorizationId: text('authorization_id'),
  captureId: text('capture_id'),
  // PayPal-Request-Ids are stored BEFORE each POST and reused on retry (invariant 7).
  createRequestId: uuid('create_request_id').notNull(),
  authorizeRequestId: uuid('authorize_request_id'),
  captureRequestId: uuid('capture_request_id'),
  voidRequestId: uuid('void_request_id'),
  policyDecision: jsonb('policy_decision').$type<{ decision: string; reasons: string[] }>(),
  createdAt: ts('created_at').notNull().defaultNow(),
  updatedAt: ts('updated_at').notNull().defaultNow(),
});

export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  // One PayPal invoice per quote: Invoicing create is not idempotent (spike f), so the DB enforces it.
  quoteId: uuid('quote_id').notNull().unique().references(() => quotes.id),
  paypalInvoiceId: text('paypal_invoice_id'),
  status: text('status').notNull(),
  recipientEmail: text('recipient_email').notNull(),
  createRequestId: uuid('create_request_id').notNull(),
  sendRequestId: uuid('send_request_id'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** PayPal webhook deliveries, verified by postback, idempotent by event id. Reconciliation only — never moves money. */
export const paymentEvents = pgTable('payment_events', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  eventId: text('event_id').notNull().unique(),
  eventType: text('event_type').notNull(),
  resourceId: text('resource_id'),
  verification: text('verification').notNull(),
  reconcile: text('reconcile'),
  raw: jsonb('raw').$type<Record<string, unknown>>().notNull(),
  receivedAt: ts('received_at').notNull().defaultNow(),
});

/**
 * LLM classifications (SPEC §4.1). Never quotable by themselves: a row becomes a `listings` row only via the recorded
 * Publish action (publishClassification), and only from AUTO_ACCEPTED / ACCEPTED / OVERRIDDEN. No amounts from the model.
 */
export const classifications = pgTable('classifications', {
  id: uuid('id').primaryKey(),
  sessionId: text('session_id').notNull(),
  input: jsonb('input').$type<ClassificationInput>().notNull(),
  model: text('model').notNull(),
  result: jsonb('result').$type<ClassifierOutputT | null>(),
  error: text('error'),
  needsReview: boolean('needs_review').notNull(),
  reasons: jsonb('reasons').$type<string[]>().notNull(),
  status: text('status').$type<ClassificationStatus>().notNull(),
  /** 'b1' (single call, SPEC §4.1 B1) or 'grounded' (B2 on the Rev 20 index; the seller console). */
  kind: text('kind').$type<'b1' | 'grounded'>().notNull().default('b1'),
  /** Grounded runs: the latest REAL stage reported by classifyListingGrounded (polled by the console). */
  stage: jsonb('stage').$type<GroundedStage | null>(),
  /** Grounded runs: the verified choice, the expanded official lines (with chains) and run meta. No amounts. */
  grounded: jsonb('grounded').$type<GroundedResult | null>(),
  /** The classifier_calls reservation for this run (closed as OK / ERROR; an interrupted run is closed as ERROR). */
  callId: bigint('call_id', { mode: 'bigint' }),
  hts10: text('hts10'),
  listingId: text('listing_id').references(() => listings.id),
  reviewedBy: text('reviewed_by'),
  reviewedAt: ts('reviewed_at'),
  reviewReason: text('review_reason'),
  publishedBy: text('published_by'),
  publishedAt: ts('published_at'),
  createdAt: ts('created_at').notNull().defaultNow(),
});

/** One row per classifier call attempt, written BEFORE the LLM call; counted for the per-session/IP/day budget. */
export const classifierCalls = pgTable(
  'classifier_calls',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    at: ts('at').notNull().defaultNow(),
    /** 'classifier' (SPEC §4.1) or 'agent' (one row per buyer-agent run, SPEC §4.4); each kind has its own limits. */
    kind: text('kind').notNull().default('classifier'),
    sessionId: text('session_id').notNull(),
    ip: text('ip').notNull(),
    outcome: text('outcome').notNull(), // RESERVED | OK | ERROR | REFUSED_DAILY | REFUSED_SESSION | REFUSED_IP
  },
  (t) => [index('classifier_calls_at_idx').on(t.at)],
);

/** Seller console sessions (shared passcode; no accounts). The cookie holds the random id; expiry is checked server-side. */
export const sellerSessions = pgTable('seller_sessions', {
  id: uuid('id').primaryKey(),
  createdAt: ts('created_at').notNull().defaultNow(),
  expiresAt: ts('expires_at').notNull(),
});

/** Every seller passcode attempt (no passcode text stored); failures per IP in the window gate further attempts. */
export const sellerLoginAttempts = pgTable(
  'seller_login_attempts',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    at: ts('at').notNull().defaultNow(),
    ip: text('ip').notNull(),
    ok: boolean('ok').notNull(),
  },
  (t) => [index('seller_login_attempts_ip_at_idx').on(t.ip, t.at)],
);

export const auditLog = pgTable('audit_log', {
  id: bigserial('id', { mode: 'bigint' }).primaryKey(),
  at: ts('at').notNull().defaultNow(),
  sessionId: text('session_id'),
  event: text('event').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id').notNull(),
  data: jsonb('data').$type<Record<string, unknown>>().notNull().default({}),
});
