// Demo path (docs/DEMO.md 0:55–1:45, 2:15–2:45) end to end against the PayPal SANDBOX.
// Buyer password: PAYPAL_SANDBOX_BUYER_PASSWORD in .env — never logged; traces/screenshots/video are off (playwright.config.ts).
// Missing password or unmatched PayPal selectors → headed page.pause() so a human finishes the step.
import { expect, test, type Page } from '@playwright/test';

async function manual(popup: Page, why: string): Promise<void> {
  console.log(`\n>>> PayPal popup: ${why}. Finish this step by hand in the popup, then press Resume in the Playwright inspector.\n`);
  await popup.pause();
}

/** VERIFY: PayPal sandbox login selectors (#email/#btnNext/#password/#btnLogin) are undocumented; fallback is manual. */
async function loginBuyer(popup: Page): Promise<void> {
  const email = process.env.PAYPAL_SANDBOX_BUYER_EMAIL;
  const password = process.env.PAYPAL_SANDBOX_BUYER_PASSWORD;
  if (!email || !password) return manual(popup, 'no buyer credentials in .env — log in as the sandbox Personal buyer');
  try {
    await popup.locator('#email').fill(email, { timeout: 20_000 });
    const next = popup.locator('#btnNext');
    if (await next.isVisible().catch(() => false)) await next.click();
    await popup.locator('#password').fill(password, { timeout: 20_000 });
    await popup.locator('#btnLogin').click();
  } catch {
    await manual(popup, 'login selectors did not match — log in as the sandbox Personal buyer');
  }
}

/** VERIFY: approve button label in the sandbox review page. */
async function approveInPopup(popup: Page): Promise<void> {
  try {
    await popup.getByRole('button', { name: /complete purchase|continue to review|continue|pay now|agree & pay/i }).first().click({ timeout: 30_000 });
  } catch {
    await manual(popup, 'approve button not found — click the approve/complete button');
  }
}

test.describe.configure({ mode: 'serial' });

test('listings: five generic demo listings', async ({ page }) => {
  await page.goto('/listings');
  await expect(page.getByTestId('listings').locator('li')).toHaveCount(5);
  await expect(page.getByText('flat $25.00 demo rate', { exact: false })).toBeVisible();
});

test('watch: landed cost shown before PayPal, approve, pay in sandbox, policy-gated capture', async ({ page }) => {
  await page.goto('/listings');
  await page.getByTestId('quote-L-P03').click();
  await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);

  // Breakdown BEFORE any PayPal UI (SPEC §4.3 AC).
  await expect(page.getByTestId('goods')).toHaveText('$300.00');
  await expect(page.getByTestId('shipping')).toHaveText('$25.00');
  await expect(page.getByTestId('duty-line')).toContainText('US import duty (est.)');
  await expect(page.getByTestId('duty')).toHaveText('$37.50');
  await expect(page.getByTestId('hts')).toHaveText('9102.21.7000');
  await expect(page.getByTestId('ch99')).toContainText('9903.05.49');
  await expect(page.getByTestId('rate-version')).toHaveText('2026-rev20-v1');
  await expect(page.getByTestId('disclaimer')).toContainText('Not a customs ruling');
  await expect(page.getByTestId('total')).toHaveText('$362.50');
  await expect(page.getByTestId('paypal-button-container')).toHaveCount(0);

  // Human approval (recorded), spend cap visible.
  await expect(page.getByTestId('spend-cap')).toContainText('$400.00');
  await page.getByTestId('approve').click();
  const container = page.getByTestId('paypal-button-container');
  await expect(container).toBeVisible();
  const dutyBeforeButton = await page.evaluate(() => {
    const duty = document.querySelector('[data-testid="duty-line"]');
    const btn = document.querySelector('[data-testid="paypal-button-container"]');
    return Boolean(duty && btn && duty.compareDocumentPosition(btn) & Node.DOCUMENT_POSITION_FOLLOWING);
  });
  expect(dutyBeforeButton).toBe(true);

  // PayPal sandbox popup.
  const [popup] = await Promise.all([page.waitForEvent('popup'), container.locator('paypal-button').click()]);
  await popup.waitForLoadState();
  await loginBuyer(popup);
  await expect(popup.getByText('$362.50').first()).toBeVisible({ timeout: 60_000 });
  await approveInPopup(popup);

  // Server: verify order = quote → authorize → decideCapture → capture.
  await expect(page.getByTestId('outcome-status')).toHaveText('CAPTURED', { timeout: 120_000 });
  await expect(page.getByTestId('capture-id')).not.toBeEmpty();
  await expect(page.getByTestId('outcome')).toContainText('all checks passed');
});

test('guards: no PayPal order without approval; unknown order → 404', async ({ page }) => {
  await page.goto('/listings'); // establishes the session cookie on first quote
  const quote = await page.request.post('/api/quotes', { data: { listingId: 'L-P11' } });
  expect(quote.ok()).toBe(true);
  const { quoteId } = (await quote.json()) as { quoteId: string };
  const order = await page.request.post(`/api/quotes/${quoteId}/paypal-order`);
  expect(order.status()).toBe(403);
  const unknown = await page.request.post('/api/orders/NO-SUCH-ORDER/complete');
  expect(unknown.status()).toBe(404);
});

test('DDP invoice: duty itemized as "US import duty (est.) – HTS …"', async ({ page }) => {
  await page.goto('/listings');
  await page.getByTestId('quote-L-P03').click();
  await page.getByTestId('send-invoice').click();
  await expect(page.getByTestId('invoice-status')).toHaveText(/SENT|UNPAID/, { timeout: 60_000 });
  await expect(page.getByTestId('invoice-duty')).toHaveText('US import duty (est.) – HTS 9102.21.70: $37.50');
});
