// The public read-only seller console (/seller/demo, SELLER_PUBLIC_VIEW=1 via playwright.config.ts webServer.env): the
// review queue and the ledger render, an opened row shows no form, radio or action, and every state passes axe (WCAG 2.2
// AA) at 375 and 1280 px. One fixture classification (no model call) is inserted in the local DB and removed afterwards.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import postgres from 'postgres';

const WIDTHS = [375, 1280] as const;
const FIXTURE_ID = '0e2e0000-0000-4000-8000-000000000001';
const FIXTURE_TITLE = 'E2E fixture: automatic diver watch (read-only view)';

/** The top navigation shows Seller on every page; it is the current section on /seller and /seller/demo only. */
async function sellerNav(page: Page, current: boolean) {
  const link = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Seller' });
  await expect(link).toHaveAttribute('href', '/seller');
  if (current) await expect(link).toHaveAttribute('aria-current', 'page');
  else await expect(link).not.toHaveAttribute('aria-current', 'page');
}

async function axe(page: Page, name: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(r.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), `axe ${name} at ${width}px`).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal scroll at ${width}px`).toBe(true);
    await page.screenshot({ path: `qa/seller-demo-${name}-${width}.png`, fullPage: true });
  }
}

async function withDb<T>(fn: (sql: postgres.Sql) => Promise<T>): Promise<T> {
  const sql = postgres(process.env.DATABASE_URL!, { max: 1, connect_timeout: 5 });
  try {
    return await fn(sql);
  } finally {
    await sql.end();
  }
}

test.beforeAll(async () => {
  await withDb(async (sql) => {
    await sql`delete from classifications where id = ${FIXTURE_ID}`;
    await sql`insert into classifications (id, session_id, input, model, needs_review, reasons, status, kind, grounded)
      values (${FIXTURE_ID}, 'e2e-fixture', ${sql.json({ title: FIXTURE_TITLE, origin: 'JP', priceMinor: 30000, shippingMinor: 2500 })}, 'fixture', true,
        ${sql.json(['LOW_CONFIDENCE'])}, 'PENDING_REVIEW', 'grounded', null)`;
  });
});

test.afterAll(async () => {
  await withDb((sql) => sql`delete from classifications where id = ${FIXTURE_ID}`);
});

test('/seller/demo: queue, read-only panel and ledger; axe clean', async ({ page, request }) => {
  const probe = await request.get('/api/seller/public/queue');
  expect(probe.status(), 'the dev server runs without SELLER_PUBLIC_VIEW=1: stop it and rerun (playwright.config.ts starts it with the flag)').toBe(200);

  await page.goto('/seller/demo');
  await expect(page.getByRole('heading', { name: 'Seller console (read-only demo)' })).toBeVisible();
  await expect(page.getByTestId('read-only-note')).toContainText('Read-only.');
  await expect(page.getByTestId('tab-classify')).toHaveCount(0);
  await sellerNav(page, true);
  await expect(page.getByTestId('queue-grid').getByText(FIXTURE_TITLE)).toBeVisible();
  await axe(page, 'queue');

  await page.goto(`/seller/demo?tab=review&row=${FIXTURE_ID}`);
  const panel = page.getByTestId('review-panel');
  await expect(panel.getByRole('heading', { name: FIXTURE_TITLE })).toBeVisible();
  await expect(page.locator('main form')).toHaveCount(0);
  await expect(page.locator('main input[type=radio]')).toHaveCount(0);
  await expect(page.locator('main dialog')).toHaveCount(0);
  for (const name of [/accept/i, /publish/i, /override/i, /undo/i, /save answers/i]) await expect(panel.getByRole('button', { name })).toHaveCount(0);
  await panel.getByText(/^Audit trail/).click();
  await expect(panel).not.toContainText('seller session');
  await axe(page, 'panel');

  await page.getByTestId('tab-orders').click();
  await expect(page.getByTestId('ledger-grid')).toBeVisible();
  await expect(page.getByTestId('ledger-export')).toBeVisible();
  await expect(page.getByText(/\d+ orders? · captured duty/)).toBeVisible();
  await axe(page, 'ledger');
});

test('/seller sign-in links to the read-only demo while SELLER_PUBLIC_VIEW is on', async ({ page, request }) => {
  const seller = await request.get('/seller');
  test.skip(seller.status() === 404, 'the seller console is off locally (no SELLER_CONSOLE_PASSCODE), so there is no sign-in page');
  await page.context().clearCookies();
  await page.goto('/seller');
  await sellerNav(page, true);
  const link = page.getByTestId('seller-demo-link');
  await expect(link).toHaveText('No passcode? See the read-only demo →');
  await axe(page, 'sign-in');
  await link.click();
  await expect(page).toHaveURL(/\/seller\/demo$/);
  await expect(page.getByRole('heading', { name: 'Seller console (read-only demo)' })).toBeVisible();
  await sellerNav(page, true);
});

test('the Seller nav link is on every buyer page, not current there, and opens /seller', async ({ page }) => {
  for (const path of ['/', '/listings', '/agent', '/estimate']) {
    await page.goto(path);
    await sellerNav(page, false);
  }
  await page.goto('/listings');
  await axe(page, 'listings-nav');
  await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Seller' }).click();
  await expect(page).toHaveURL(/\/seller$/);
  await sellerNav(page, true);
});
