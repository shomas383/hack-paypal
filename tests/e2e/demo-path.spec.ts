// Demo path (docs/DEMO.md 0:55–1:45, 2:15–2:45) end to end against the PayPal SANDBOX.
// Buyer password: PAYPAL_SANDBOX_BUYER_PASSWORD in .env — never logged; traces/screenshots/video are off (playwright.config.ts).
// Missing password or unmatched PayPal selectors → headed page.pause() so a human finishes the step.
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { CURRENT_RATE_VERSION } from '../../src/domain/rates/current';

// Every seeded listing except red-team fixtures is shown on /listings (the count follows the seed file).
const SEEDED_VISIBLE = (JSON.parse(readFileSync('data/seed/listings.json', 'utf8')) as { listings: { test_fixture?: boolean }[] }).listings.filter((l) => !l.test_fixture).length;

async function manual(popup: Page, why: string): Promise<void> {
  if (popup.isClosed()) return;
  // Selector discovery for the VERIFY item: field ids/names/types only — never values.
  const fields = await popup
    .locator('input, button')
    .evaluateAll((els) => els.map((e) => `${e.tagName.toLowerCase()}#${e.id || '-'}[name=${e.getAttribute('name') ?? '-'}][type=${e.getAttribute('type') ?? '-'}]`))
    .catch(() => [] as string[]);
  console.log(`\n>>> PayPal popup: ${why}. Finish this step by hand in the popup, then press Resume in the Playwright inspector.`);
  console.log(`>>> popup fields seen: ${fields.join(' ') || '(none)'}\n`);
  await popup.pause();
}

const STEP_TIMEOUT = 15_000;
const auto = (step: string) => console.log(`>>> auto login: ${step}`); // step names only — never values

/** One automated step; on failure pause for a human and report false, so nothing is ever finished silently. */
async function step(popup: Page, name: string, action: () => Promise<void>): Promise<boolean> {
  try {
    await action();
    auto(name);
    return true;
  } catch {
    await manual(popup, `could not ${name} automatically — finish the login by hand`);
    return false;
  }
}

/**
 * VERIFY: PayPal sandbox login selectors are undocumented. Each control is matched by id OR by role/name and
 * waited for (not checked once), since the page renders the Next/Log In buttons asynchronously.
 */
async function loginBuyer(popup: Page): Promise<void> {
  const email = process.env.PAYPAL_SANDBOX_BUYER_EMAIL;
  const password = process.env.PAYPAL_SANDBOX_BUYER_PASSWORD;
  if (!email || !password) return manual(popup, 'no buyer credentials in .env — log in as the sandbox Personal buyer');

  const emailField = popup.locator('#email').or(popup.getByRole('textbox', { name: /email/i })).first();
  const nextButton: Locator = popup.locator('#btnNext').or(popup.getByRole('button', { name: /^next$/i })).first();
  const passwordField = popup.locator('#password').or(popup.locator('input[type="password"]')).first();
  // Observed 2026-10-07: two sandbox login variants. (a) email → Next → password → #btnLogin; (b) email + password on one
  // page whose only submit button has no id (field log: input#email[name=login_email], input#password[name=login_password]).
  const loginButton: Locator = popup
    .locator('#btnLogin')
    .or(popup.getByRole('button', { name: /^log ?in$/i }))
    .or(popup.locator('form:has(input[type="password"]) button[type="submit"]'))
    .first();

  if (!(await step(popup, 'fill email', () => emailField.fill(email, { timeout: STEP_TIMEOUT })))) return;
  // Some sandbox variants show the password on the same page; only click Next when it isn't there yet.
  if (!(await passwordField.isVisible().catch(() => false))) {
    if (!(await step(popup, 'click Next', () => nextButton.click({ timeout: STEP_TIMEOUT })))) return;
  }
  if (!(await step(popup, 'fill password', () => passwordField.fill(password, { timeout: STEP_TIMEOUT })))) return;
  await step(popup, 'click Log In', () => loginButton.click({ timeout: STEP_TIMEOUT }));
}

/**
 * Approve on the sandbox review page. Observed 2026-10-07 (headed run, field log): the main call to action is
 * `button#one-time-cta[type=submit]`; the role/name match is a fallback. Still undocumented by PayPal.
 */
async function approveInPopup(popup: Page): Promise<void> {
  const cta = popup
    .locator('#one-time-cta')
    .or(popup.getByRole('button', { name: /complete purchase|continue to review|continue|pay now|agree & pay/i }))
    .first();
  try {
    await cta.click({ timeout: 30_000 });
    auto('click approve');
  } catch {
    await manual(popup, 'approve button not found — click the approve/complete button');
  }
}

test.describe.configure({ mode: 'serial' });

test('listings: every seeded (non-fixture) generic demo listing', async ({ page }) => {
  await page.goto('/listings');
  expect(SEEDED_VISIBLE).toBe(8);
  await expect(page.getByTestId('listings').locator('li')).toHaveCount(SEEDED_VISIBLE);
  await expect(page.getByText('flat $25.00 demo rate', { exact: false })).toBeVisible();
});

test('watch: landed cost shown before PayPal, approve, pay in sandbox, policy-gated capture', async ({ page }) => {
  await page.goto('/listings');
  await page.getByTestId('quote-L-P03').click();
  await expect(page).toHaveURL(/\/checkout\/[0-9a-f-]{36}$/);
  const watchCheckoutUrl = page.url();

  // Breakdown BEFORE any PayPal UI (SPEC §4.3 AC).
  await expect(page.getByTestId('goods')).toHaveText('$300.00');
  await expect(page.getByTestId('shipping')).toHaveText('$25.00');
  await expect(page.getByTestId('duty-line')).toContainText('US import duty (est.)');
  await expect(page.getByTestId('duty')).toHaveText('$37.50');
  await expect(page.getByTestId('hts')).toHaveText('9102.21.70'); // component-reporting line (Ch. 91 Stat. Note 1)
  await expect(page.getByTestId('component-reporting')).toContainText('Stat. Note 1');
  await expect(page.getByTestId('ch99')).toContainText('9903.05.49');
  await expect(page.getByTestId('rate-version')).toHaveText(CURRENT_RATE_VERSION);
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
  // If the human finished login AND approval during a manual pause, PayPal has already closed the popup.
  if (!popup.isClosed()) {
    await expect(popup.getByText('$362.50').first()).toBeVisible({ timeout: 60_000 });
    await approveInPopup(popup);
  }

  // Server: verify order = quote → authorize → decideCapture → capture — on THIS quote's page, not another one.
  expect(page.url()).toBe(watchCheckoutUrl);
  await expect(page.getByTestId('title')).toContainText('automatic diver watch');
  await expect(page.getByTestId('outcome-status')).toHaveText('CAPTURED', { timeout: 120_000 });
  expect(page.url()).toBe(watchCheckoutUrl);
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
