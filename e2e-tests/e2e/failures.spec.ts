// What the payer is told when the gateway says no.
//
// The two cases differ in whether the Pay button can come back: a refused Sale leaves the page
// usable, while a page that never got an ephemeral ticket has nothing to retry with and only a
// reload can help.

import { expect, fillCard, fillCustomer, test, useScenario, waitForFields } from './fixtures.ts';

test('says the page could not be prepared when there is no ephemeral ticket', async ({
  page,
  app,
}) => {
  await useScenario('no-ticket');
  await page.goto(app.url('/'));

  await expect(page.locator('#formError')).toHaveText(
    /This page could not be prepared for a payment\. Reload it to try again\./,
  );

  // Terminal: the ticket is what tokenization needs, and this page never got one.
  const pay = page.locator('#pay');
  await expect(pay).toBeDisabled();
  await expect(pay).toHaveText('Reload to try again');

  // The three card containers stay empty, because the SDK is never loaded at all.
  await expect(page.locator('#cardNumber iframe')).toHaveCount(0);
});

test('shows the gateway message when the sale is refused', async ({ page, app }) => {
  await useScenario('sale-error');
  await page.goto(app.url('/'));
  await waitForFields(page);

  await fillCustomer(page);
  await fillCard(page);
  await page.locator('#pay').click();

  await expect(page.locator('#formError')).toContainText(
    'The card number was rejected by the processor.',
  );

  // The card boxes get the error ring, all three at once: there is no per-field validity here.
  await expect(page.locator('#cardNumber')).toHaveClass(/hf-field--error/);
  await expect(page.locator('#cvv')).toHaveClass(/hf-field--error/);

  // Not terminal: the payer can try again.
  await expect(page.locator('#pay')).toBeEnabled();
  await expect(page.locator('#orderStatus')).toBeHidden();
});

test('reports a declined payment in the status panel', async ({ page, app }) => {
  await useScenario('declined');
  await page.goto(app.url('/'));
  await waitForFields(page);

  await fillCustomer(page);
  await fillCard(page);
  await page.locator('#pay').click();

  const status = page.locator('#orderStatus');
  await expect(status.locator('.status__title')).toHaveText('Declined', {
    timeout: 20_000,
  });
  await expect(status).toHaveClass(/status--declined/);
  await expect(status.locator('.status__rows')).toContainText(
    'The issuing bank declined the payment.',
  );
});
