// Not implemented yet: passes the toolkit's get_order result through unchanged (today's behaviour).
export const ORDER_UNREADABLE = 'PayPal order could not be read';

export function orderView(raw: unknown): unknown {
  return { order: raw };
}
