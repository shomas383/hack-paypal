// /estimate against the dev-only fixtures (src/server/estimateFixtures.ts): fixed classifier candidates, everything else
// real (committed estimator data + verified rates). No model calls, no PayPal. Each state is checked with axe (WCAG 2.2 AA)
// at 375 and 1280 px; screenshots go to qa/ (gitignored) for review.
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';

const WIDTHS = [375, 1280] as const;

async function check(page: Page, name: string) {
  // House style: estimate text cites note and heading numbers, never program names (open every disclosure first).
  const closed = page.locator('details:not([open]) > summary');
  while ((await closed.count()) > 0) await closed.first().click();
  expect(await page.locator('main').innerText(), 'no program names on the page').not.toMatch(/Section 232|\b301\b|IEEPA/i);
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
    const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`), `axe at ${width}px`).toEqual([]);
    // No horizontal page scroll at either width.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `no horizontal scroll at ${width}px`).toBe(true);
  }
  // Screenshots with the disclosures closed again (as a visitor first sees the page).
  const open = page.locator('details[open] > summary');
  while ((await open.count()) > 0) await open.last().click(); // innermost first: a closed parent hides its children
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 900 });
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
  await expect(cotton.getByTestId('estimate-source')).toHaveText(/Verified rate row \(2026-rev21-v2\)/);
  await expect(cotton.getByTestId('estimate-duty')).toHaveText('33.20');
  await expect(cotton.getByTestId('estimate-ddp')).toHaveText('258.20');
  const synthetic = page.getByTestId('estimate-candidate-6203.43.9011');
  await expect(synthetic.getByTestId('estimate-source')).toHaveText(/Automated estimate \(2026-rev21-e4\)/);
  await expect(synthetic.getByTestId('estimate-duty')).toHaveText('55.80');
  await expect(page.getByTestId('estimate-notice')).toContainText('Estimate — not a customs ruling.');
  await page.getByText('What the estimator includes and leaves out').click();
  await expect(page.getByTestId('estimate-disclosures')).toContainText('Lower special-program rates may apply');
  await expect(page.getByTestId('estimate-disclosures')).toContainText('Chapter 99 duties the estimator doesn’t model');
  await expect(page.getByTestId('estimate-versions')).toContainText('2026-rev21-e4');
  await expect(page.getByTestId('estimate-same-duty')).toHaveCount(0);
  await expect(page.getByTestId('estimate-other-lines')).toHaveCount(0);
  await expect(cotton.getByTestId('estimate-basis')).toHaveText(['General rate: 16.6% of the price', 'The General rate is already at least Japan’s 12.5% combined rate, so heading 9903.05.48 adds nothing']);
  await expect(page.getByTestId('estimate-disclosures')).not.toContainText('not a customs ruling'); // shown once, below
  await check(page, 'range');
});

test('same duty on every line (guitar): one combined sentence, the top line in full, the others collapsed', async ({ page }) => {
  await run(page, 'guitar');
  await expect(page.getByTestId('estimate-summary')).toContainText('on a $400.00 sale for every likely HTS line');
  await expect(page.getByTestId('estimate-separating')).toHaveCount(0);
  await expect(page.getByTestId('estimate-reason')).toHaveCount(0);
  await expect(page.getByTestId('estimate-same-duty')).toHaveText('The exact line depends on “Valued not over $100 each, excluding the value of the case” vs “Other”, but the estimate is $50.00 either way.');
  // Plain basis in the table; the engine's exact text in the official-text section.
  const top = page.getByTestId('estimate-candidate-9202.90.4000');
  await expect(top.getByTestId('estimate-basis')).toHaveText(['General rate: 8.7% of the price', 'Japan’s 12.5% combined rate applies (heading 9903.05.49)']);
  await top.getByText('Official text and exact basis').click();
  await expect(top.getByTestId('estimate-official')).toContainText('Computed as: combined cap 12.5% (base or AVE below cap)');
  const others = page.getByTestId('estimate-other-lines');
  await expect(others).toContainText('Other likely lines (same duty): 9202.90.2000');
  await expect(page.getByTestId('estimate-candidate-9202.90.2000')).toBeHidden();
  await others.locator(':scope > summary').click();
  await expect(page.getByTestId('estimate-candidate-9202.90.2000').getByTestId('estimate-duty')).toHaveText('50.00');
  await others.locator(':scope > summary').click();
  await check(page, 'guitar');
});

test('verified row: the German watch needs the case/band split, then quotes from its verified row', async ({ page }) => {
  await run(page, 'watch-de');
  const watch = page.getByTestId('estimate-candidate-9102.21.70');
  await expect(watch.getByTestId('estimate-cant-reason')).toContainText('watch case and on the strap, band or bracelet');
  await page.getByTestId('estimate-case-value').fill('190.00');
  await expect(page.getByText('Strap, band or bracelet: the rest, 100.00.')).toBeVisible();
  await page.getByTestId('estimate-split-submit').click();
  await expect(watch.getByTestId('estimate-source')).toHaveText(/Verified rate row \(2026-rev21-v2\)/);
  await expect(watch.getByTestId('estimate-duty')).toHaveText('29.00'); // the verified DE row: combined 10% (note 52(k)) on $290.00
  await check(page, 'verified');
});

test('knife (P11): the estimate asks the verified row’s two facts, then quotes the same figure as checkout for L-P11', async ({ page }) => {
  // Checkout: the stored quote for L-P11 (the listing records both facts).
  const res = await page.request.post('/api/quotes', { data: { listingId: 'L-P11' } });
  expect(res.ok()).toBe(true);
  const { quoteId } = (await res.json()) as { quoteId: string };
  await page.goto(`/checkout/${quoteId}`);
  const checkoutDuty = (await page.getByTestId('duty').innerText()).trim();
  const checkoutTotal = (await page.getByTestId('total').innerText()).trim();
  expect([checkoutDuty, checkoutTotal]).toEqual(['$43.54', '$208.54']);

  await run(page, 'knife');
  await expect(page.getByRole('heading', { name: 'Answer the questions below to estimate the duty' })).toBeVisible();
  const knife = page.getByTestId('estimate-candidate-8211.92.9030');
  await expect(knife.getByTestId('estimate-needs-facts')).toHaveText(/2 questions to answer/);
  await expect(knife.getByTestId('estimate-cant-reason')).toHaveText('A verified rate row covers this line, but its duty depends on the answers below.');
  const weight = knife.getByTestId('estimate-fact-steel_weight_share_ge_15pct');
  await expect(weight.locator('legend')).toHaveText('Does the steel in it weigh at least 15 percent of the whole article’s weight?');
  await expect(weight.locator('blockquote').first()).toHaveText('…only apply where the weight of the applicable metal is at least 15 percent of the weight of the imported article.');
  await expect(weight.locator('figcaption').first()).toHaveText('U.S. note 16(c) to subchapter III');
  await expect(knife.getByTestId('estimate-fact-steel_us_melted_poured_ge_85pct').locator('blockquote')).toHaveText(
    '…at least 85 percent of the steel content of the article must be composed of steel that was melted and poured in the United States.',
  );
  await expect(knife).not.toContainText('steel_weight_share'); // never the sheet's fact name
  await expect(knife.getByTestId('estimate-if-answered')).toContainText(`the duty is ${checkoutDuty} (delivered ${checkoutTotal})`);
  await check(page, 'knife');

  await knife.getByTestId('estimate-fact-steel_weight_share_ge_15pct').getByLabel('Yes').click();
  await expect(knife.getByTestId('estimate-fact-steel_weight_share_ge_15pct')).toHaveCount(0); // answered; one left
  await expect(knife.getByTestId('estimate-needs-facts')).toHaveText(/One question to answer/);
  await knife.getByTestId('estimate-fact-steel_us_melted_poured_ge_85pct').getByLabel('No').click();
  await expect(knife.getByTestId('estimate-source')).toHaveText(/Verified rate row \(2026-rev21-v2\)/);
  await expect(knife.getByTestId('estimate-duty')).toHaveText(checkoutDuty.replace('$', ''));
  await expect(knife.getByTestId('estimate-ddp')).toHaveText(checkoutTotal.replace('$', ''));
  await expect(knife.getByTestId('estimate-basis')).toHaveText(['General rate: 0.4¢ each + 6.1%', 'Heading 9903.82.09 adds 25% of the price', 'Heading 9903.05.90 applies: no additional duty']);
  await check(page, 'knife-answered');

  // An answer the verified row doesn't cover: refused, citing the note and the headings it ties the line to.
  await knife.getByRole('button', { name: 'Change answers' }).click();
  await expect(knife.getByTestId('estimate-needs-facts')).toHaveText(/2 questions to answer/);
  await knife.getByTestId('estimate-fact-steel_weight_share_ge_15pct').getByLabel('Yes').click();
  await expect(knife.getByTestId('estimate-needs-facts')).toHaveText(/One question to answer/);
  await knife.getByTestId('estimate-fact-steel_us_melted_poured_ge_85pct').getByLabel('Yes').click();
  await expect(knife.getByTestId('estimate-cant-reason')).toHaveText(
    'U.S. note 16(c)(vii) to subchapter III names this line and ties it to headings 9903.82.03, 9903.82.06 and 9903.82.09, and the estimator doesn’t model them yet.',
  );
});

test('can’t estimate: refusals cite the note and headings, with the official text one click away', async ({ page }) => {
  // Production report 2026-10-13: the 92% and 5% lines are refused and the 1% line estimates $11.25. The headline is the
  // refusal, never that figure; the line that could be estimated is shown below, labelled, with its confidence.
  await run(page, 'unsupported');
  await expect(page.getByRole('heading', { name: 'Can’t estimate this product yet' })).toBeVisible();
  await expect(page.getByTestId('estimate-refusal')).toHaveText(
    'The most likely line, 7323.93.0015 (confidence 92%), is named by heading 9903.82.03 and U.S. note 16(c)(vii) to subchapter III, which the estimator doesn’t model yet.',
  );
  await expect(page.getByTestId('estimate-summary')).toHaveCount(0);
  await expect(page.getByTestId('estimate-separating')).toHaveCount(0);
  const estimable = page.getByTestId('estimate-estimable');
  await expect(estimable.getByRole('heading', { name: 'Less likely lines that could be estimated' })).toBeVisible();
  const appliance = estimable.getByTestId('estimate-candidate-8516.79.0000');
  await expect(appliance).toContainText('Confidence 1%');
  await expect(appliance.getByTestId('estimate-duty')).toHaveText('11.25');
  await expect(estimable.locator('[data-testid^="estimate-candidate-"]')).toHaveCount(1);
  // nothing above the estimable section shows a figure
  const headlineArea = await page.getByTestId('estimate-result').evaluate((el) => {
    const stop = el.querySelector('[data-testid="estimate-candidate-7323.93.0015"]');
    let text = '';
    for (const node of Array.from(el.children)) {
      if (node.contains(stop)) break;
      text += node.textContent ?? '';
    }
    return text;
  });
  expect(headlineArea).not.toContain('$');
  await expect(page.getByTestId('estimate-disclosures').locator('summary')).toHaveText('What the estimator includes and leaves out');
  const reasons = page.getByTestId('estimate-cant-reason');
  await expect(reasons).toHaveCount(2);
  for (const r of await reasons.allTextContents())
    expect(r).toBe(
      'Heading 9903.82.03 (“…articles where the weight of the applicable metal is less than 15 percent of the weight of the imported article”) names this line. U.S. note 16(c)(vii) to subchapter III also names this line and ties it to headings 9903.82.03, 9903.82.06 and 9903.82.09. The estimator doesn’t model them yet.',
    );
  await page.getByTestId('estimate-cant-official').first().locator('summary').click();
  await expect(page.getByTestId('estimate-cant-official').first()).toContainText('Heading 9903.82.09');
  await page.getByTestId('estimate-cant-official').first().locator('summary').click();
  await check(page, 'cant');

  await run(page, 'shoes');
  await expect(page.getByTestId('estimate-cant-reason')).toHaveText(
    'The line’s own footnote cites heading 9903.41.10 (“Footwear with outer soles of leather and uppers wholly or in part of leather…”), and the estimator doesn’t model it yet.',
  );
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

test('too broad (production report, jeans without fabric): the stopped reason names where the lines differ; no empty candidate', async ({ page }) => {
  await run(page, 'jeans-broad');
  await expect(page.getByRole('heading', { name: 'Too many possible HTS lines' })).toBeVisible();
  await expect(page.getByTestId('estimate-stopped')).toHaveText(
    'The description fits 120 official lines, more than the estimator compares at once. They differ at “Of cotton”, “Of synthetic fibers” or “Of other textile materials”: add which applies and try again.',
  );
  await expect(page.getByTestId('estimate-result').locator('ol')).toHaveCount(0);
  await expect(page.getByTestId('estimate-disclosures').locator('summary')).toHaveText('What the estimator includes and leaves out');
  await expect(page.getByTestId('estimate-result').locator('[data-testid^="estimate-candidate-"]')).toHaveCount(0);
  await check(page, 'too-broad');
});
