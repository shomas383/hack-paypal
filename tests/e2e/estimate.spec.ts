// /estimate against the dev-only fixtures (src/server/estimateFixtures.ts): fixed classifier candidates, everything else
// real (committed estimator data + verified rates). No model calls, no PayPal. Each state is checked with axe (WCAG 2.2 AA)
// at 375 and 1280 px; screenshots go to qa/ (gitignored) for review.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WIDTHS = [375, 1280] as const;

async function check(page: Page, name: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), `axe at ${width}px`).toEqual([]);
    // No horizontal page scroll at either width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal scroll at ${width}px`).toBe(true);
    await page.screenshot({ path: `qa/estimate-${name}-${width}.png`, fullPage: true });
  }
}

async function run(page: Page, fixture: string) {
  await page.goto(`/estimate?fixture=${fixture}`);
  await page.getByTestId('estimate-submit').click();
  await expect(page.getByTestId('estimate-result')).toBeVisible();
}

test('form: origin help text, unsupported origin, validation', async ({ page }) => {
  await page.goto('/estimate');
  await expect(page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'Estimate' })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByText('Country of origin, not where you bought it. A German watch bought in Japan is German-origin.')).toBeVisible();
  await check(page, 'form');

  await page.getByTestId('estimate-submit').click();
  await expect(page.getByText('Describe the product in at least 3 characters.')).toBeVisible();
  await expect(page.getByText('Enter a price like 400.00.')).toBeVisible();

  await page.getByTestId('estimate-origin').selectOption('OTHER');
  await expect(page.getByTestId('estimate-origin-unsupported')).toContainText('Not supported yet');
  await expect(page.getByTestId('estimate-submit')).toBeDisabled();
});

test('range: two candidates (verified row vs automated estimate), the separating fact', async ({ page }) => {
  await run(page, 'jeans');
  await expect(page.getByTestId('estimate-summary')).toContainText('$33.20 to $55.80 on a $200.00 sale');
  await expect(page.getByTestId('estimate-separating')).toContainText('“Of cotton”');
  await expect(page.getByTestId('estimate-separating')).toContainText('“Of synthetic fibers”');
  await expect(page.getByTestId('estimate-separating')).toContainText('What decides it: Fiber content.');
  const cotton = page.getByTestId('estimate-candidate-6203.42.4511');
  await expect(cotton.getByTestId('estimate-source')).toHaveText(/Verified rate row \(2026-rev21-v1\)/);
  await expect(cotton.getByTestId('estimate-duty')).toHaveText('33.20');
  await expect(cotton.getByTestId('estimate-ddp')).toHaveText('258.20');
  const synthetic = page.getByTestId('estimate-candidate-6203.43.9011');
  await expect(synthetic.getByTestId('estimate-source')).toHaveText(/Automated estimate \(2026-rev21-e1\)/);
  await expect(synthetic.getByTestId('estimate-duty')).toHaveText('55.80');
  await expect(page.getByTestId('estimate-notice')).toContainText('Estimate — not a customs ruling.');
  await page.getByText('What this estimate includes and leaves out').click();
  await expect(page.getByTestId('estimate-disclosures')).toContainText('Lower special-program rates may apply');
  await expect(page.getByTestId('estimate-disclosures')).toContainText('Section 232');
  await expect(page.getByTestId('estimate-versions')).toContainText('2026-rev21-e1');
  await expect(page.getByTestId('estimate-same-duty')).toHaveCount(0);
  await expect(cotton.getByTestId('estimate-basis')).toHaveText(['General rate: 16.6% of the price', 'The General rate is already at least Japan’s 12.5% combined rate, so heading 9903.05.48 adds nothing']);
  await expect(page.getByTestId('estimate-disclosures')).not.toContainText('not a customs ruling'); // shown once, below
  await check(page, 'range');
});

test('same duty on every line: guitar', async ({ page }) => {
  await run(page, 'guitar');
  await expect(page.getByTestId('estimate-summary')).toContainText('on a $400.00 sale for every likely HTS line');
  await expect(page.getByTestId('estimate-separating')).toHaveCount(0);
  await expect(page.getByTestId('estimate-same-duty')).toHaveText('The exact line depends on value of the guitar, excluding the case, but the estimate is the same either way.');
  // Plain basis in the table; the engine's exact text in the official-text section.
  const top = page.getByTestId('estimate-candidate-9202.90.4000');
  await expect(top.getByTestId('estimate-basis')).toHaveText(['General rate: 8.7% of the price', 'Japan’s 12.5% combined rate applies (heading 9903.05.49)']);
  await top.getByText('Official text and exact basis').click();
  await expect(top.getByTestId('estimate-official')).toContainText('Computed as: combined cap 12.5% (base or AVE below cap)');
});

test('verified row: the German watch needs the case/band split, then quotes from its verified row', async ({ page }) => {
  await run(page, 'watch-de');
  const watch = page.getByTestId('estimate-candidate-9102.21.70');
  await expect(watch.getByTestId('estimate-cant-reason')).toContainText('watch case and on the strap, band or bracelet');
  await page.getByTestId('estimate-case-value').fill('190.00');
  await expect(page.getByText('Strap, band or bracelet: the rest, 100.00.')).toBeVisible();
  await page.getByTestId('estimate-split-submit').click();
  await expect(watch.getByTestId('estimate-source')).toHaveText(/Verified rate row \(2026-rev21-v1\)/);
  await expect(watch.getByTestId('estimate-duty')).toHaveText('29.00'); // the verified DE row: combined 10% (note 52(k)) on $290.00
  await check(page, 'verified');
});

test('can’t estimate: lines named by unmodeled Chapter 99 provisions, with plain reasons', async ({ page }) => {
  await run(page, 'unsupported');
  await expect(page.getByRole('heading', { name: 'Can’t estimate this product yet' })).toBeVisible();
  await expect(page.getByTestId('estimate-summary')).toHaveCount(0);
  await expect(page.getByTestId('estimate-separating')).toHaveCount(0);
  const reasons = page.getByTestId('estimate-cant-reason');
  await expect(reasons).toHaveCount(2);
  for (const r of await reasons.allTextContents()) expect(r).toMatch(/names this line, and the estimator doesn’t model it yet/);
  await check(page, 'cant');
});

test('rate limited and server error states', async ({ page }) => {
  await page.goto('/estimate');
  await page.getByTestId('estimate-description').fill('Acoustic guitar');
  await page.getByTestId('estimate-price').fill('400.00');

  await page.route('**/api/estimates', (r) => r.fulfill({ status: 429, json: { error: 'too many estimate requests — try again later' } }));
  await page.getByTestId('estimate-submit').click();
  await expect(page.getByTestId('estimate-rate-limited')).toContainText('Too many estimate requests — try again later.');
  await check(page, 'rate-limited');

  await page.unroute('**/api/estimates');
  await page.route('**/api/estimates', (r) => r.fulfill({ status: 500, json: { error: 'internal error' } }));
  await page.getByTestId('estimate-submit').click();
  await expect(page.getByTestId('estimate-error')).toContainText('Something went wrong on our side.');
});
