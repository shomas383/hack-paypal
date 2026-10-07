import { describe, expect, it } from 'vitest';
import { invoiceRecipient } from './invoiceRecipient';

describe('invoiceRecipient', () => {
  it('production: always the sandbox buyer, ignoring any email from the browser', () => {
    expect(invoiceRecipient({ requested: 'attacker@example.com', sandboxBuyerEmail: 'buyer@sandbox.test', production: true })).toEqual({
      ok: true,
      email: 'buyer@sandbox.test',
    });
  });

  it('production: refuses when the sandbox buyer email is not configured, even if the browser sent one', () => {
    expect(invoiceRecipient({ requested: 'someone@example.com', production: true })).toEqual({ ok: false, error: expect.stringMatching(/PAYPAL_SANDBOX_BUYER_EMAIL/) });
  });

  it('dev: a passed email is used, trimmed', () => {
    expect(invoiceRecipient({ requested: '  dev@example.com ', sandboxBuyerEmail: 'buyer@sandbox.test', production: false })).toEqual({ ok: true, email: 'dev@example.com' });
  });

  it('dev: falls back to the sandbox buyer; refuses when neither is set', () => {
    expect(invoiceRecipient({ requested: '  ', sandboxBuyerEmail: 'buyer@sandbox.test', production: false })).toEqual({ ok: true, email: 'buyer@sandbox.test' });
    expect(invoiceRecipient({ production: false }).ok).toBe(false);
  });
});
