// Who receives a DDP invoice. In production (the public Render deploy) it is ALWAYS the sandbox buyer account, so a
// visitor cannot make our PayPal account email an invoice to an arbitrary address. Local dev may pass one.
export type RecipientResult = { ok: true; email: string } | { ok: false; error: string };

export function invoiceRecipient(input: { requested?: string; sandboxBuyerEmail?: string; production: boolean }): RecipientResult {
  const fallback = input.sandboxBuyerEmail?.trim();
  if (input.production) {
    return fallback ? { ok: true, email: fallback } : { ok: false, error: 'no invoice recipient: PAYPAL_SANDBOX_BUYER_EMAIL is not set' };
  }
  const email = input.requested?.trim() || fallback;
  return email ? { ok: true, email } : { ok: false, error: 'no recipient email (set PAYPAL_SANDBOX_BUYER_EMAIL or pass one)' };
}
