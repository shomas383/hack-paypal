import { describe, expect, it, vi } from 'vitest';
import { expectedOrderStatus, handleWebhook, reconcileNote, type WebhookDeps } from './handle';

const HEADERS: Record<string, string> = {
  'paypal-auth-algo': 'SHA256withRSA',
  'paypal-cert-url': 'https://api.sandbox.paypal.com/v1/notifications/certs/CERT-1',
  'paypal-transmission-id': 't-1',
  'paypal-transmission-sig': 'sig',
  'paypal-transmission-time': '2026-10-07T00:00:00Z',
};
const header = (h: Record<string, string>) => (name: string) => h[name] ?? null;
const event = { id: 'WH-1', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: 'CAP-1' } };
const raw = JSON.stringify(event);

function deps(over: Partial<WebhookDeps> = {}): WebhookDeps {
  return {
    webhookId: 'WEBHOOK-1',
    verify: vi.fn(async () => 'SUCCESS'),
    store: vi.fn(async () => 'inserted' as const),
    reconcile: vi.fn(async () => undefined),
    ...over,
  };
}

describe('handleWebhook', () => {
  it('verifies via postback with the five PAYPAL-* headers, our webhook id and the event, then stores and reconciles', async () => {
    const d = deps();
    const r = await handleWebhook(raw, header(HEADERS), d);
    expect(r.status).toBe(200);
    expect(d.verify).toHaveBeenCalledWith({
      auth_algo: 'SHA256withRSA',
      cert_url: HEADERS['paypal-cert-url'],
      transmission_id: 't-1',
      transmission_sig: 'sig',
      transmission_time: '2026-10-07T00:00:00Z',
      webhook_id: 'WEBHOOK-1',
      webhook_event: event,
    });
    expect(d.store).toHaveBeenCalledWith(expect.objectContaining({ eventId: 'WH-1', eventType: 'PAYMENT.CAPTURE.COMPLETED', resourceId: 'CAP-1', verification: 'SUCCESS' }));
    expect(d.reconcile).toHaveBeenCalledTimes(1);
  });

  it('rejects a failed verification with 400 and stores nothing', async () => {
    const d = deps({ verify: vi.fn(async () => 'FAILURE') });
    expect((await handleWebhook(raw, header(HEADERS), d)).status).toBe(400);
    expect(d.store).not.toHaveBeenCalled();
    expect(d.reconcile).not.toHaveBeenCalled();
  });

  it('rejects missing signature headers without calling PayPal', async () => {
    const { 'paypal-transmission-sig': _drop, ...partial } = HEADERS;
    void _drop;
    const d = deps();
    expect((await handleWebhook(raw, header(partial), d)).status).toBe(400);
    expect(d.verify).not.toHaveBeenCalled();
    expect(d.store).not.toHaveBeenCalled();
  });

  it('is idempotent by event id: a duplicate delivery is acknowledged and not reconciled again', async () => {
    const d = deps({ store: vi.fn(async () => 'duplicate' as const) });
    const r = await handleWebhook(raw, header(HEADERS), d);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ duplicate: true });
    expect(d.reconcile).not.toHaveBeenCalled();
  });

  it('returns 503 when PAYPAL_WEBHOOK_ID is not configured, before verifying anything', async () => {
    const d = deps({ webhookId: undefined });
    expect((await handleWebhook(raw, header(HEADERS), d)).status).toBe(503);
    expect(d.verify).not.toHaveBeenCalled();
  });

  it('rejects a body that is not an event (no id / event_type) with 400', async () => {
    const d = deps();
    expect((await handleWebhook('not json', header(HEADERS), d)).status).toBe(400);
    expect((await handleWebhook(JSON.stringify({ id: 'x' }), header(HEADERS), d)).status).toBe(400);
    expect(d.verify).not.toHaveBeenCalled();
  });
});

describe('reconciliation (records only — never moves money)', () => {
  it('maps the events that imply a final order status', () => {
    expect(expectedOrderStatus('PAYMENT.CAPTURE.COMPLETED')).toBe('CAPTURED');
    expect(expectedOrderStatus('PAYMENT.AUTHORIZATION.VOIDED')).toBe('VOIDED');
    expect(expectedOrderStatus('CHECKOUT.ORDER.APPROVED')).toBeNull();
  });

  it('notes match / mismatch / unknown order', () => {
    expect(reconcileNote('PAYMENT.CAPTURE.COMPLETED', 'CAPTURED')).toBe('match');
    expect(reconcileNote('PAYMENT.CAPTURE.COMPLETED', 'VOIDED')).toBe('mismatch');
    expect(reconcileNote('PAYMENT.CAPTURE.COMPLETED', null)).toBe('unknown_order');
    expect(reconcileNote('CHECKOUT.ORDER.APPROVED', 'CREATED')).toBe('info');
  });
});
