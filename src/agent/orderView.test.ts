import { describe, expect, it } from 'vitest';
import { ORDER_FIXTURE_JSON } from './fakeDeps';
import { ORDER_UNREADABLE, orderView } from './orderView';

// The toolkit's get_order returns JSON.stringify(order) (errors as JSON.stringify({ error: { message, type } })).
const PRIVATE = ['Fixture Buyer', 'Fixture', 'Buyer', 'fixture-buyer@example.com', 'fixture-merchant@example.com', 'PAYERIDFIXTURE', 'MERCHANTIDFIXTURE', '1 Fixture St', 'Fixtureville', '90000', 'payer', 'payee', 'payment_source', 'shipping_address', 'links', 'http', '@', 'AUTHFIXTURE0001', 'CAPTUREFIXTURE01'];
const money = (value: string) => ({ currency_code: 'USD', value });

describe('orderView — get_order_status passes on an allow-list only', () => {
  it('keeps exactly the allow-listed fields of a captured order', () => {
    const r = orderView(ORDER_FIXTURE_JSON) as { order: Record<string, unknown> };
    expect(Object.keys(r)).toEqual(['order']);
    expect(Object.keys(r.order).sort()).toEqual(['amount', 'authorization_statuses', 'breakdown', 'capture_statuses', 'custom_id', 'id', 'intent', 'status']);
    expect(r.order).toEqual({
      id: '5O190127TN364715T',
      intent: 'AUTHORIZE',
      status: 'COMPLETED',
      custom_id: '0b4c6a52-6f0e-4d3e-9a51-6a3a8b2f0c11',
      amount: money('362.50'),
      breakdown: { item_total: money('300.00'), shipping: money('25.00'), tax_total: money('37.50') },
      authorization_statuses: ['CAPTURED'],
      capture_statuses: ['COMPLETED'],
    });
  });

  it('no payer, payee, shipping address, id of a payment or link reaches the output', () => {
    const out = JSON.stringify(orderView(ORDER_FIXTURE_JSON));
    for (const s of PRIVATE) expect(out, s).not.toContain(s);
  });

  it('accepts a parsed object as well as the toolkit string', () => {
    expect(orderView(JSON.parse(ORDER_FIXTURE_JSON))).toEqual(orderView(ORDER_FIXTURE_JSON));
  });

  it('missing breakdown parts and payments are null / empty, never copied from elsewhere', () => {
    const o = JSON.parse(ORDER_FIXTURE_JSON);
    delete o.purchase_units[0].amount.breakdown.shipping;
    delete o.purchase_units[0].payments;
    const r = orderView(o) as { order: { breakdown: Record<string, unknown>; authorization_statuses: string[]; capture_statuses: string[] } };
    expect(r.order.breakdown).toEqual({ item_total: money('300.00'), shipping: null, tax_total: money('37.50') });
    expect(r.order.authorization_statuses).toEqual([]);
    expect(r.order.capture_statuses).toEqual([]);
  });

  it('a toolkit error, unparseable text or an order without id / status → a fixed error (no PayPal text passed on)', () => {
    const noId = JSON.parse(ORDER_FIXTURE_JSON);
    delete noId.id;
    const noStatus = JSON.parse(ORDER_FIXTURE_JSON);
    delete noStatus.status;
    const badAmount = JSON.parse(ORDER_FIXTURE_JSON);
    badAmount.purchase_units[0].amount.value = 'Fixture Buyer';
    for (const raw of [JSON.stringify({ error: { message: 'RESOURCE_NOT_FOUND fixture-buyer@example.com', type: 'paypal_error' } }), 'not json', '', null, undefined, 42, noId, noStatus, badAmount]) {
      expect(orderView(raw)).toEqual({ error: ORDER_UNREADABLE });
    }
  });
});
