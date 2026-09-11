// The happy path, the one every example has to pass: fill the form, tokenize through three
// cross-origin iframes, pay, and watch the order reach `approved`.

import { expect, fillCard, fillCustomer, test, useScenario, waitForFields } from './fixtures.ts';

test.beforeEach(async () => {
  await useScenario('approved');
});

test('pays with a card and reaches the approved status', async ({ page, app }) => {
  await page.goto(app.url('/'));

  // The amount the payer confirms comes from the server's config, never from the markup.
  await expect(page.locator('#orderAmount')).toHaveText('$ 12.34');

  await waitForFields(page);
  await expect(page.locator('#pay')).toHaveText('Pay $ 12.34');

  await fillCustomer(page);
  await fillCard(page);

  // The cardholder name follows the first and last name until the payer edits it themselves.
  await expect(page.locator('#cardholderName')).toHaveValue('ANNA WEBER');

  await page.locator('#pay').click();

  const status = page.locator('#orderStatus');
  await expect(status).toBeVisible();
  await expect(status.locator('.status__title')).toHaveText('Approved', {
    timeout: 20_000,
  });
  await expect(status).toHaveClass(/status--approved/);

  // The panel promotes the handful of values a payer or a support agent would quote.
  const rows = status.locator('.status__rows');
  await expect(rows).toContainText('12.34');
  await expect(rows).toContainText('VISA •••• 4448');
  await expect(rows).toContainText('ANNA WEBER');
});

test('the SDK owns the field state classes', async ({ page, app }) => {
  await page.goto(app.url('/'));
  await waitForFields(page);

  const container = page.locator('#cardNumber');

  // :focus-within does not cross an origin boundary, so these arrive as classes the SDK toggles.
  // In the React example the same element is rendered by React, which must not wipe them.
  await page.frameLocator('#cardNumber iframe').locator('#value').click();
  await expect(container).toHaveClass(/hf-field--focus/);

  await page.frameLocator('#cardNumber iframe').locator('#value').fill('4444444444444448');
  await expect(container).toHaveClass(/hf-field--filled/);

  await page.locator('#firstName').click();
  await expect(container).not.toHaveClass(/hf-field--focus/);
  await expect(container).toHaveClass(/hf-field--filled/);
});

test('refuses to submit before the payer details are valid', async ({ page, app }) => {
  await page.goto(app.url('/'));
  await waitForFields(page);
  await fillCard(page);

  // Caught before tokenization on purpose: a Sale the gateway refuses has already spent the
  // ephemeral ticket, and a typo in a name should not cost the payer a restart.
  await page.locator('#pay').click();

  await expect(page.locator('#firstNameHint')).toHaveText('Enter the name on the card.');
  await expect(page.locator('#orderStatus')).toBeHidden();
});
