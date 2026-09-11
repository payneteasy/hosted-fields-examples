// A hand-edited /result URL must not get a page.
//
// The browser carries the signed parameters but cannot forge them: it never sees
// MERCHANT_CONTROL. In nextjs the 403 comes from src/middleware.ts, because a React page cannot
// set a status code without an experimental flag.

import { expect, test } from './fixtures.ts';

const FORGED = new URLSearchParams({
  status: 'approved',
  orderid: '1234567',
  merchant_order: 'hf-not-mine',
  // Right length, wrong value: a sha1 that was never computed with the shared secret.
  control: 'f'.repeat(40),
});

test('answers a forged result query with 403', async ({ request, app }) => {
  const response = await request.get(`${app.url('/result')}?${FORGED}`, {
    maxRedirects: 0,
  });
  expect(response.status()).toBe(403);
});

test('answers a forged callback with 403', async ({ request, app }) => {
  const response = await request.post(app.url('/result/callback'), {
    form: Object.fromEntries(FORGED),
    maxRedirects: 0,
  });
  expect(response.status()).toBe(403);
});

test('serves /result with no query at all', async ({ page, app }) => {
  // No query is not a forgery: it is somebody who opened the page directly, and the page says
  // there is nothing to show rather than refusing them.
  await page.goto(app.url('/result'));
  await expect(page.locator('#orderStatus')).toContainText('Nothing to show');
});
