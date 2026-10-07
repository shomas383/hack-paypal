// PayPal webhook receiver logic (SPEC §5 payment_events). Verified by postback, stored idempotently by event id, then
// reconciled against our orders for the record. Webhooks NEVER move money or change a capture decision.
// Verification fields per Webhooks v1 schema.json (docs/PAYPAL.md § Webhooks; proven in spike (c), 2026-10-05).

export interface VerifyRequest {
  auth_algo: string;
  cert_url: string;
  transmission_id: string;
  transmission_sig: string;
  transmission_time: string;
  webhook_id: string;
  webhook_event: unknown;
}

export interface StoredEvent {
  eventId: string;
  eventType: string;
  /** VERIFY: `resource.id` (order / authorization / capture id) — confirm on real deliveries to the Render URL. */
  resourceId: string | null;
  verification: string;
  raw: Record<string, unknown>;
}

export interface WebhookDeps {
  webhookId: string | undefined;
  /** POST /v1/notifications/verify-webhook-signature → verification_status. */
  verify(req: VerifyRequest): Promise<string>;
  /** Insert unless the event id is already stored. */
  store(e: StoredEvent): Promise<'inserted' | 'duplicate'>;
  reconcile(e: StoredEvent): Promise<void>;
}

export interface WebhookResult {
  status: number;
  body: Record<string, unknown>;
}

const SIGNATURE_HEADERS = {
  auth_algo: 'paypal-auth-algo',
  cert_url: 'paypal-cert-url',
  transmission_id: 'paypal-transmission-id',
  transmission_sig: 'paypal-transmission-sig',
  transmission_time: 'paypal-transmission-time',
} as const;

export async function handleWebhook(raw: string, header: (name: string) => string | null, deps: WebhookDeps): Promise<WebhookResult> {
  if (!deps.webhookId) return { status: 503, body: { error: 'webhook not configured' } };

  let event: Record<string, unknown>;
  try {
    event = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { status: 400, body: { error: 'invalid JSON' } };
  }
  const eventId = event.id;
  const eventType = event.event_type;
  if (typeof eventId !== 'string' || typeof eventType !== 'string') return { status: 400, body: { error: 'not a webhook event' } };

  const sig: Partial<Record<keyof typeof SIGNATURE_HEADERS, string>> = {};
  for (const [field, name] of Object.entries(SIGNATURE_HEADERS) as [keyof typeof SIGNATURE_HEADERS, string][]) {
    const v = header(name);
    if (!v) return { status: 400, body: { error: `missing ${name}` } };
    sig[field] = v;
  }

  const verification = await deps.verify({ ...(sig as Record<keyof typeof SIGNATURE_HEADERS, string>), webhook_id: deps.webhookId, webhook_event: event });
  if (verification !== 'SUCCESS') return { status: 400, body: { error: 'signature verification failed' } };

  const resource = event.resource as { id?: unknown } | undefined;
  const stored: StoredEvent = {
    eventId,
    eventType,
    resourceId: typeof resource?.id === 'string' ? resource.id : null,
    verification,
    raw: event,
  };
  if ((await deps.store(stored)) === 'duplicate') return { status: 200, body: { received: true, duplicate: true } };
  await deps.reconcile(stored);
  return { status: 200, body: { received: true } };
}

/** The final order status an event implies, if any. */
export function expectedOrderStatus(eventType: string): 'CAPTURED' | 'VOIDED' | null {
  if (eventType === 'PAYMENT.CAPTURE.COMPLETED') return 'CAPTURED';
  if (eventType === 'PAYMENT.AUTHORIZATION.VOIDED') return 'VOIDED';
  return null;
}

export function reconcileNote(eventType: string, orderStatus: string | null): 'match' | 'mismatch' | 'unknown_order' | 'info' {
  const expected = expectedOrderStatus(eventType);
  if (!expected) return 'info';
  if (orderStatus === null) return 'unknown_order';
  return orderStatus === expected ? 'match' : 'mismatch';
}
