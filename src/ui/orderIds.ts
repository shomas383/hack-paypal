// Ids shown on the checkout outcome: the PayPal ORDER id first (what the agent's get_order_status reads), then the
// capture id. Found in the 2026-10-13 production run: with only the capture id shown, buyers asked about capture ids.
export interface OrderIdLine {
  label: string;
  id: string;
  testId: string;
}

export function orderIds(o: { paypalOrderId: string | null; captureId: string | null }): OrderIdLine[] {
  const lines: OrderIdLine[] = [];
  if (o.paypalOrderId) lines.push({ label: 'PayPal order', id: o.paypalOrderId, testId: 'paypal-order-id' });
  if (o.captureId) lines.push({ label: 'Capture', id: o.captureId, testId: 'capture-id' });
  return lines;
}
