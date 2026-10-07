// Production wiring for handleWebhook: PayPal postback verification, payment_events storage, audit-only reconciliation.
import { randomUUID } from 'node:crypto';
import { eq, or } from 'drizzle-orm';
import { db } from '../db/client';
import { auditLog, orders, paymentEvents } from '../db/schema';
import { serverEnv } from '../env';
import { PayPalError, paypalRequest } from '../paypal/client';
import { reconcileNote, type StoredEvent, type WebhookDeps } from './handle';

export function webhookDeps(): WebhookDeps {
  return {
    webhookId: serverEnv().paypalWebhookId,

    async verify(req) {
      // Not a money-moving call, but every POST still carries a PayPal-Request-Id (invariant 7); a retry reuses it.
      try {
        const res = await paypalRequest<{ verification_status?: string }>('POST', '/v1/notifications/verify-webhook-signature', {
          body: req,
          requestId: randomUUID(),
        });
        return res.body.verification_status ?? 'UNKNOWN';
      } catch (e) {
        // A 4xx means PayPal rejected the inputs (e.g. forged headers) → treat as not verified (route answers 400).
        if (e instanceof PayPalError && e.status >= 400 && e.status < 500) return `REJECTED_${e.status}`;
        throw e;
      }
    },

    async store(e: StoredEvent) {
      const inserted = await db
        .insert(paymentEvents)
        .values({ eventId: e.eventId, eventType: e.eventType, resourceId: e.resourceId, verification: e.verification, raw: e.raw })
        .onConflictDoNothing({ target: paymentEvents.eventId })
        .returning({ id: paymentEvents.id });
      return inserted.length > 0 ? 'inserted' : 'duplicate';
    },

    async reconcile(e: StoredEvent) {
      const rid = e.resourceId;
      const [order] = rid
        ? await db
            .select({ paypalOrderId: orders.paypalOrderId, status: orders.status })
            .from(orders)
            .where(or(eq(orders.paypalOrderId, rid), eq(orders.authorizationId, rid), eq(orders.captureId, rid)))
        : [];
      const note = reconcileNote(e.eventType, order?.status ?? null);
      await db.update(paymentEvents).set({ reconcile: note }).where(eq(paymentEvents.eventId, e.eventId));
      await db.insert(auditLog).values({
        event: 'paypal.webhook',
        entity: 'order',
        entityId: order?.paypalOrderId ?? rid ?? e.eventId,
        sessionId: null,
        data: { eventId: e.eventId, eventType: e.eventType, resourceId: rid, orderStatus: order?.status ?? null, reconcile: note },
      });
      if (note === 'mismatch') console.warn(`webhook ${e.eventId} ${e.eventType}: order status ${order?.status} does not match`);
    },
  };
}
