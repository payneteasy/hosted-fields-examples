// The one fixture the suite needs: which application this project is pointing at, and a handle
// on the emulator's scenario control.
//
// The three examples serve a byte-identical frontend, so every spec here is written once and run
// once per project. `app` is what tells a spec which one it is talking to.

import { test as base, expect, type Page } from '@playwright/test';
import { APPS, type AppUnderTest, appOrigin, appUrl } from '../src/apps.ts';
import type { Scenario } from '../src/emulator/scenarios.ts';
import { EMULATOR_ORIGIN, TEST_CARD } from '../src/settings.ts';

export interface AppHandle extends AppUnderTest {
  /** An absolute URL under this app's base path. */
  url(path: string): string;
}

/** Pins what the gateway will do to the next payment. Call it before loading the page. */
export async function useScenario(scenario: Scenario): Promise<void> {
  const response = await fetch(`${EMULATOR_ORIGIN}/__control/scenario`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenario }),
  });
  if (!response.ok) {
    throw new Error(`could not select the ${scenario} scenario: ${response.status}`);
  }
}

export const test = base.extend<{ app: AppHandle }>({
  app: async ({ baseURL }, use, testInfo) => {
    const app = APPS.find((candidate) => candidate.name === testInfo.project.name);
    if (!app) {
      throw new Error(`no application definition for project ${testInfo.project.name}`);
    }
    // The project's baseURL and the app definition are written in two places; if they ever
    // disagree the specs would quietly test the wrong server.
    if (baseURL !== appOrigin(app)) {
      throw new Error(`project ${app.name} has baseURL ${baseURL}, expected ${appOrigin(app)}`);
    }
    await use({ ...app, url: (path: string) => appUrl(app, path) });
  },
});

export { expect };

/** Fills the merchant's own inputs. These are same-origin and ordinary. */
export async function fillCustomer(page: Page): Promise<void> {
  await page.locator('#firstName').fill('Anna');
  await page.locator('#lastName').fill('Weber');
  await page.locator('#email').fill('anna.weber@example.com');
}

/**
 * Fills the three card fields, each of which is a cross-origin iframe the merchant page cannot
 * reach into — so Playwright goes through the frame, exactly as a payer's keyboard would.
 */
export async function fillCard(page: Page): Promise<void> {
  await cardField(page, '#cardNumber').fill(TEST_CARD.number);
  await cardField(page, '#expiryDate').fill(TEST_CARD.expiry);
  await cardField(page, '#cvv').fill(TEST_CARD.cvv);
}

function cardField(page: Page, container: string) {
  return page.frameLocator(`${container} iframe`).locator('#value');
}

/**
 * The Pay button is disabled until the SDK's onReady fires, which is the single most likely way
 * for this suite to hang. Waiting on it explicitly turns that into a legible failure.
 */
export async function waitForFields(page: Page): Promise<void> {
  await expect(
    page.locator('#pay'),
    'the Pay button never enabled: the SDK shim did not call onReady',
  ).toBeEnabled({ timeout: 20_000 });
}
