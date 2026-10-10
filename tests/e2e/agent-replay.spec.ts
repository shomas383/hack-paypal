// /agent against the dev-only replay endpoint (src/agent/__fixtures__/replay-de-compare.ndjson): no model calls, no PayPal.
// The page must render exactly what the tools returned: every quoted row is a listing shown in the search step, the
// proposal is DE (L-P14), and the over-budget JP-B row (L-P03-B) is shown with its "Over by" figure.
import { expect, test } from '@playwright/test';

test('agent replay: quoted rows ⊆ searched rows, DE proposed, JP-B over budget', async ({ page }) => {
  await page.goto('/agent?replay=delay%3D0');
  await page.getByTestId('agent-budget').fill('400.00');
  await page.getByTestId('agent-confirm-budget').click();
  await expect(page.getByTestId('agent-budget-confirmed')).toBeVisible();
  await page.getByTestId('agent-run').click();
  await expect(page.getByTestId('agent-done')).toBeVisible();

  const searched = await page.getByTestId('agent-search').locator('tbody th[scope="row"] > span:first-child').allTextContents();
  expect(searched.sort()).toEqual(['L-P03', 'L-P03-B', 'L-P13', 'L-P14']);

  const quoted = (await page.getByTestId('agent-quotes').locator('tbody tr[data-testid^="agent-quote-"]').evaluateAll((rows) => rows.map((r) => r.getAttribute('data-testid') ?? ''))).map((t) =>
    t.replace(/^agent-quote-/, ''),
  );
  expect(quoted).toEqual(['L-P14', 'L-P03', 'L-P13', 'L-P03-B']); // sorted by delivered total
  for (const id of quoted) expect(searched).toContain(id);

  await expect(page.getByTestId('agent-quote-L-P03-B')).toContainText('Over by 52.50');
  await expect(page.getByTestId('agent-proposal')).toContainText('L-P14');
  await expect(page.getByTestId('agent-proposal')).toContainText('$344.00');
  await expect(page.getByTestId('agent-instruction-notice')).toBeVisible();
});
