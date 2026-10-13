// What get_order_status passes on from a PayPal order: an ALLOW-LIST built field by field — id, intent, status, the quote
// reference (custom_id), amount, its breakdown, and the authorization / capture statuses. Payer, payee, shipping, payment
// ids and links never reach the model or the browser stream. The toolkit's get_order returns JSON.stringify(order), or
// JSON.stringify({ error }) on failure; anything unreadable becomes a fixed error (PayPal's text is not passed on).
import { z } from 'zod';

export const ORDER_UNREADABLE = 'PayPal order could not be read';

const Code = z.string().regex(/^[A-Z0-9_-]{1,40}$/i);
const Money = z.object({ currency_code: z.string().regex(/^[A-Z]{3}$/), value: z.string().regex(/^\d{1,12}(\.\d{1,2})?$/) });
const Statuses = z.array(z.object({ status: z.string().regex(/^[A-Z_]{1,30}$/) })).optional();

const Order = z.object({
  id: Code,
  intent: z.string().regex(/^[A-Z_]{1,20}$/),
  status: z.string().regex(/^[A-Z_]{1,30}$/),
  purchase_units: z
    .array(
      z.object({
        custom_id: z.string().regex(/^[A-Za-z0-9_-]{1,127}$/).optional(),
        amount: Money.extend({ breakdown: z.object({ item_total: Money.optional(), shipping: Money.optional(), tax_total: Money.optional() }).optional() }),
        payments: z.object({ authorizations: Statuses, captures: Statuses }).optional(),
      }),
    )
    .min(1),
});

type Amount = { currency_code: string; value: string };

export interface OrderView {
  id: string;
  intent: string;
  status: string;
  custom_id: string | null;
  amount: Amount;
  breakdown: { item_total: Amount | null; shipping: Amount | null; tax_total: Amount | null };
  authorization_statuses: string[];
  capture_statuses: string[];
}

const amount = (m: Amount | undefined): Amount | null => (m ? { currency_code: m.currency_code, value: m.value } : null);

export function orderView(raw: unknown): { order: OrderView } | { error: string } {
  let data: unknown = raw;
  if (typeof raw === 'string') {
    try {
      data = JSON.parse(raw);
    } catch {
      return { error: ORDER_UNREADABLE };
    }
  }
  const parsed = Order.safeParse(data);
  if (!parsed.success) return { error: ORDER_UNREADABLE };
  const o = parsed.data;
  const pu = o.purchase_units[0]!;
  const b = pu.amount.breakdown;
  return {
    order: {
      id: o.id,
      intent: o.intent,
      status: o.status,
      custom_id: pu.custom_id ?? null,
      amount: { currency_code: pu.amount.currency_code, value: pu.amount.value },
      breakdown: { item_total: amount(b?.item_total), shipping: amount(b?.shipping), tax_total: amount(b?.tax_total) },
      authorization_statuses: (pu.payments?.authorizations ?? []).map((a) => a.status),
      capture_statuses: (pu.payments?.captures ?? []).map((c) => c.status),
    },
  };
}
