// Not implemented yet: the checkout outcome shows only the capture id (today's behaviour).
export interface OrderIdLine {
  label: string;
  id: string;
  testId: string;
}

export function orderIds(o: { paypalOrderId: string | null; captureId: string | null }): OrderIdLine[] {
  return o.captureId ? [{ label: 'Capture', id: o.captureId, testId: 'capture-id' }] : [];
}
