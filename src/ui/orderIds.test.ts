import { describe, expect, it } from 'vitest';
import { orderIds } from './orderIds';

// The checkout success line. 2026-10-13: it showed only the capture id, so the buyer asked the agent about capture ids
// (correctly refused); get_order_status needs the PayPal ORDER id.
describe('orderIds: ids on the checkout outcome', () => {
  it('shows the PayPal order id first, then the capture id', () => {
    expect(orderIds({ paypalOrderId: '1VC48838C5454262A', captureId: '2YW00000000000000' })).toEqual([
      { label: 'PayPal order', id: '1VC48838C5454262A', testId: 'paypal-order-id' },
      { label: 'Capture', id: '2YW00000000000000', testId: 'capture-id' },
    ]);
  });

  it('a voided order (no capture) still shows its PayPal order id', () => {
    expect(orderIds({ paypalOrderId: '1VC48838C5454262A', captureId: null })).toEqual([{ label: 'PayPal order', id: '1VC48838C5454262A', testId: 'paypal-order-id' }]);
  });

  it('nothing known → nothing shown', () => {
    expect(orderIds({ paypalOrderId: null, captureId: null })).toEqual([]);
  });
});
