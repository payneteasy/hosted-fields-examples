// The 3DS return, which is signed twice over the same checksum.
//
// The status poll answers with `redirect-to`, the page sends the payer to the issuer, and the
// issuer POSTs status / orderid / merchant_order / control back to /result/callback. The app
// verifies the checksum, redirects with 303 to /result carrying the same four values, and
// /result verifies them again before it serves anything.

import { expect, fillCard, fillCustomer, test, useScenario, waitForFields } from './fixtures.ts';

test.beforeEach(async () => {
  await useScenario('threeds');
});

test('survives a 3DS challenge and comes back approved', async ({ page, app }) => {
  await page.goto(app.url('/'));
  await waitForFields(page);

  await fillCustomer(page);
  await fillCard(page);
  await page.locator('#pay').click();

  // The issuer's page, on the gateway origin.
  await expect(page.locator('#acsApprove')).toBeVisible({ timeout: 20_000 });
  await page.locator('#acsApprove').click();

  // Back on the merchant, through the signed callback and its 303.
  await page.waitForURL(`${app.url('/result')}?*`, { timeout: 20_000 });

  const query = new URL(page.url()).searchParams;
  expect(query.get('status')).toBe('approved');
  expect(query.get('orderid')).toBeTruthy();
  expect(query.get('control')).toMatch(/^[0-9a-f]{40}$/);

  await expect(page.locator('#orderRef')).toContainText('Order hf-');

  const status = page.locator('#orderStatus');
  await expect(status.locator('.status__title')).toHaveText('Approved', {
    timeout: 20_000,
  });
  await expect(status).toHaveClass(/status--approved/);
});
