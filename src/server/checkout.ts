// Checkout service: quote → human approval → PayPal order (from the stored quote) → authorize → policy → capture | void,
// plus the DDP invoice. Every PayPal-Request-Id is written to the DB BEFORE its POST and reused on retry (invariant 7).
import { randomUUID } from 'node:crypto';
import { and, eq, sql as dsql } from 'drizzle-orm';
import { fromPayPalValue } from '@/domain/money/format';
import { approvalHash, decideCapture } from '@/domain/policy/decideCapture';
import { buildQuote, type QuoteRecord } from '@/domain/quote/buildQuote';
import { db } from './db/client';
import { approvals, auditLog, invoices, listings, orders, quotes } from './db/schema';
import { serverEnv } from './env';
import { authorizeOrder, captureAuthorization, createInvoice, createOrder, getInvoice, getOrder, sendInvoice, voidAuthorization } from './paypal/api';
import { currentRateTable } from './rates';

export class CheckoutError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type QuoteRow = typeof quotes.$inferSelect;

function toRecord(r: QuoteRow): QuoteRecord {
  if (r.currency !== 'USD') throw new Error(`quote ${r.id}: unexpected currency ${r.currency}`);
  return {
    id: r.id,
    listingId: r.listingId,
    sessionId: r.sessionId,
    title: r.title,
    rateVersion: r.rateVersion,
    rateRowId: r.rateRowId,
    origin: r.origin,
    hts10: r.hts10,
    entryDate: r.entryDate,
    goodsMinor: r.goodsMinor,
    shippingMinor: r.shippingMinor,
    dutyMinor: r.dutyMinor,
    totalMinor: r.totalMinor,
    currency: 'USD',
    lines: r.lines,
    effectiveRatePpm: r.effectiveRatePpm,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
  };
}

async function audit(event: string, entity: string, entityId: string, sessionId: string | null, data: Record<string, unknown> = {}) {
  const safe = JSON.parse(JSON.stringify(data, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))) as Record<string, unknown>;
  await db.insert(auditLog).values({ event, entity, entityId, sessionId, data: safe });
}

export async function listListings() {
  return db.select().from(listings).orderBy(listings.id);
}

export async function createQuote(listingId: string, sessionId: string): Promise<QuoteRecord> {
  const [l] = await db.select().from(listings).where(eq(listings.id, listingId));
  if (!l) throw new CheckoutError(404, `unknown listing ${listingId}`);
  const env = serverEnv();
  const r = buildQuote(
    currentRateTable(),
    {
      id: l.id,
      title: l.title,
      origin: l.origin,
      hts10: l.hts10,
      priceMinor: l.priceMinor,
      shippingMinor: l.shippingMinor,
      ...(l.valueSplit ? { valueSplit: { caseMinor: BigInt(l.valueSplit.case_minor), bandMinor: BigInt(l.valueSplit.band_minor) } } : {}),
      facts: l.facts,
    },
    { id: randomUUID(), sessionId, now: new Date(), ttlSeconds: env.quoteTtlSeconds },
  );
  if (r.kind !== 'OK') throw new CheckoutError(422, `UNSUPPORTED: ${r.reason}`);
  const q = r.quote;
  await db.insert(quotes).values({ ...q, lines: q.lines });
  await audit('quote.created', 'quote', q.id, sessionId, { listingId, totalMinor: q.totalMinor, dutyMinor: q.dutyMinor, rateVersion: q.rateVersion });
  return q;
}

async function quoteForSession(quoteId: string, sessionId: string | undefined): Promise<QuoteRecord> {
  if (!/^[0-9a-f-]{36}$/.test(quoteId)) throw new CheckoutError(404, 'quote not found');
  const [row] = await db.select().from(quotes).where(eq(quotes.id, quoteId));
  if (!row || !sessionId || row.sessionId !== sessionId) throw new CheckoutError(404, 'quote not found');
  return toRecord(row);
}

async function sessionCapturedMinor(sessionId: string): Promise<bigint> {
  const [r] = await db
    .select({ total: dsql<string | null>`coalesce(sum(${quotes.totalMinor}), 0)` })
    .from(orders)
    .innerJoin(quotes, eq(orders.quoteId, quotes.id))
    .where(and(eq(orders.status, 'CAPTURED'), eq(quotes.sessionId, sessionId)));
  return BigInt(r?.total ?? 0);
}

export async function getCheckoutView(quoteId: string, sessionId: string | undefined) {
  const quote = await quoteForSession(quoteId, sessionId);
  const [approval] = await db.select().from(approvals).where(eq(approvals.quoteId, quote.id));
  const [order] = await db.select().from(orders).where(eq(orders.quoteId, quote.id));
  const env = serverEnv();
  const row = currentRateTable().rows.find((r) => r.id === quote.rateRowId);
  return {
    quote,
    approved: Boolean(approval),
    order: order ? { status: order.status, captureId: order.captureId, policy: order.policyDecision } : null,
    rateRow: row ?? null,
    currentRateVersion: currentRateTable().version,
    caps: { perOrderMinor: env.spendCapPerOrderMinor, perSessionMinor: env.spendCapPerSessionMinor },
  };
}

/** The recorded human Approve click (invariant 6). Refuses expired, stale or over-cap quotes up front. */
export async function approveQuote(quoteId: string, sessionId: string) {
  const q = await quoteForSession(quoteId, sessionId);
  const env = serverEnv();
  if (Date.now() >= q.expiresAt.getTime()) throw new CheckoutError(409, 'quote expired — get a new quote');
  if (q.rateVersion !== currentRateTable().version) throw new CheckoutError(409, 'rates changed — get a new quote');
  if (q.totalMinor > env.spendCapPerOrderMinor) throw new CheckoutError(403, 'over the per-order spend cap');
  if ((await sessionCapturedMinor(sessionId)) + q.totalMinor > env.spendCapPerSessionMinor) {
    throw new CheckoutError(403, 'over the per-session spend cap');
  }
  await db
    .insert(approvals)
    .values({ quoteId: q.id, sessionId, amountMinor: q.totalMinor, currency: q.currency, amountHash: approvalHash(q) })
    .onConflictDoNothing({ target: approvals.quoteId });
  await audit('approval.recorded', 'quote', q.id, sessionId, { amountMinor: q.totalMinor });
  return { approved: true };
}

/** Creates (or returns) the PayPal AUTHORIZE order for an approved quote. Amounts come only from the stored quote. */
export async function startPayPalOrder(quoteId: string, sessionId: string): Promise<{ orderId: string }> {
  const q = await quoteForSession(quoteId, sessionId);
  const [approval] = await db.select().from(approvals).where(eq(approvals.quoteId, q.id));
  if (!approval) throw new CheckoutError(403, 'approve the purchase first');
  if (Date.now() >= q.expiresAt.getTime()) throw new CheckoutError(409, 'quote expired — get a new quote');

  let [row] = await db.select().from(orders).where(eq(orders.quoteId, q.id));
  if (row?.paypalOrderId) return { orderId: row.paypalOrderId };
  if (!row) {
    [row] = await db.insert(orders).values({ quoteId: q.id, status: 'CREATING', createRequestId: randomUUID() }).returning();
  }
  const created = await createOrder(q, row!.createRequestId); // same request id on retry → same PayPal order
  await db.update(orders).set({ paypalOrderId: created.id, status: 'CREATED', updatedAt: new Date() }).where(eq(orders.id, row!.id));
  await audit('paypal.order.created', 'order', created.id, sessionId, { quoteId: q.id });
  return { orderId: created.id };
}

async function ensureRequestId(orderRowId: string, column: 'authorizeRequestId' | 'captureRequestId' | 'voidRequestId', current: string | null) {
  if (current) return current;
  const id = randomUUID();
  await db.update(orders).set({ [column]: id, updatedAt: new Date() }).where(eq(orders.id, orderRowId));
  return id;
}

/** After the buyer approves in PayPal: verify → authorize → decideCapture → capture or void. */
export async function completePayPalOrder(paypalOrderId: string, sessionId: string | undefined) {
  const [row] = await db.select().from(orders).where(eq(orders.paypalOrderId, paypalOrderId));
  if (!row) throw new CheckoutError(404, 'order not found');
  const q = await quoteForSession(row.quoteId, sessionId);
  if (row.status === 'CAPTURED' || row.status === 'VOIDED') {
    return { status: row.status, captureId: row.captureId, policy: row.policyDecision };
  }
  if (row.status !== 'CREATED') throw new CheckoutError(409, `order is ${row.status}; needs manual review`);

  // Verify PayPal's view of the order matches the stored quote before moving money.
  const pp = await getOrder(paypalOrderId);
  const pu = pp.purchase_units[0];
  const ppTotal = pu && pu.amount.currency_code === 'USD' ? fromPayPalValue(pu.amount.value, 'USD').amountMinor : null;
  if (pp.status !== 'APPROVED' || pu?.custom_id !== q.id || ppTotal !== q.totalMinor) {
    await db.update(orders).set({ status: 'FAILED', updatedAt: new Date() }).where(eq(orders.id, row.id));
    await audit('paypal.order.mismatch', 'order', paypalOrderId, sessionId ?? null, { status: pp.status, customId: pu?.custom_id, ppTotal });
    throw new CheckoutError(409, 'PayPal order does not match the approved quote');
  }

  const authReq = await ensureRequestId(row.id, 'authorizeRequestId', row.authorizeRequestId);
  const auth = await authorizeOrder(paypalOrderId, authReq);
  await db.update(orders).set({ status: 'AUTHORIZED', authorizationId: auth.id, updatedAt: new Date() }).where(eq(orders.id, row.id));
  await audit('paypal.authorized', 'order', paypalOrderId, sessionId ?? null, { authorizationId: auth.id, amountMinor: auth.amountMinor });

  const env = serverEnv();
  const [approval] = await db.select().from(approvals).where(eq(approvals.quoteId, q.id));
  const decision = decideCapture({
    quote: { id: q.id, totalMinor: q.totalMinor, currency: q.currency, rateVersion: q.rateVersion, expiresAt: q.expiresAt },
    approval: approval ? { quoteId: approval.quoteId, amountMinor: approval.amountMinor, currency: approval.currency, amountHash: approval.amountHash } : null,
    authorization: { status: auth.status, amountMinor: auth.amountMinor, currency: auth.currency },
    now: new Date(),
    currentRateVersion: currentRateTable().version,
    caps: { perOrderMinor: env.spendCapPerOrderMinor, perSessionMinor: env.spendCapPerSessionMinor },
    sessionCapturedMinor: await sessionCapturedMinor(q.sessionId),
  });
  const policy = { decision: decision.decision, reasons: [...decision.reasons] };
  await db.update(orders).set({ policyDecision: policy, updatedAt: new Date() }).where(eq(orders.id, row.id));
  await audit('policy.decided', 'order', paypalOrderId, sessionId ?? null, policy);

  if (decision.decision === 'CAPTURE') {
    const capReq = await ensureRequestId(row.id, 'captureRequestId', row.captureRequestId);
    const cap = await captureAuthorization(auth.id, decision.grant, capReq);
    await db.update(orders).set({ status: 'CAPTURED', captureId: cap.id, updatedAt: new Date() }).where(eq(orders.id, row.id));
    await audit('paypal.captured', 'order', paypalOrderId, sessionId ?? null, { captureId: cap.id, status: cap.status });
    return { status: 'CAPTURED', captureId: cap.id, policy };
  }
  const voidReq = await ensureRequestId(row.id, 'voidRequestId', row.voidRequestId);
  await voidAuthorization(auth.id, voidReq);
  await db.update(orders).set({ status: 'VOIDED', updatedAt: new Date() }).where(eq(orders.id, row.id));
  await audit('paypal.voided', 'order', paypalOrderId, sessionId ?? null, policy);
  return { status: 'VOIDED', captureId: null, policy };
}

/** DDP path: invoice from the stored quote, duty as a labelled custom amount (SPEC §4.6). */
export async function sendDdpInvoice(quoteId: string, sessionId: string, email?: string) {
  const q = await quoteForSession(quoteId, sessionId);
  const recipient = email?.trim() || serverEnv().sandboxBuyerEmail;
  if (!recipient) throw new CheckoutError(400, 'no recipient email (set PAYPAL_SANDBOX_BUYER_EMAIL or pass one)');
  const [inv] = await db.insert(invoices).values({ quoteId: q.id, status: 'CREATING', recipientEmail: recipient, createRequestId: randomUUID() }).returning();
  const invoiceId = await createInvoice(q, recipient, inv!.createRequestId);
  const sendReq = randomUUID();
  await db.update(invoices).set({ paypalInvoiceId: invoiceId, status: 'DRAFT', sendRequestId: sendReq }).where(eq(invoices.id, inv!.id));
  await sendInvoice(invoiceId, sendReq);
  const got = await getInvoice(invoiceId);
  await db.update(invoices).set({ status: got.status }).where(eq(invoices.id, inv!.id));
  await audit('invoice.sent', 'invoice', invoiceId, sessionId, { quoteId: q.id, status: got.status, total: got.amount?.value });
  return {
    invoiceId,
    status: got.status,
    total: got.amount?.value ?? null,
    dutyLabel: got.amount?.breakdown?.custom?.label ?? null,
    dutyAmount: got.amount?.breakdown?.custom?.amount?.value ?? null,
    recipientViewUrl: got.detail?.metadata?.recipient_view_url ?? null,
  };
}
