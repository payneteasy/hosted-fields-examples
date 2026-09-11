// Everything the harness and the three apps have to agree on.
//
// The credentials are the ones nodejs-express-js/src/settings-stub.js already uses, so the
// emulator, the apps and the checksum vectors in the existing unit tests all stay pinned to the
// same arithmetic. None of them is a real credential.

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** e2e-tests/ */
export const PROJECT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
/** The repository root, one level up. */
export const REPO_ROOT = join(PROJECT_ROOT, '..');
/** Generated files that must never be committed: the RSA key lives here. */
export const TMP_DIR = join(PROJECT_ROOT, '.tmp');

export const ENDPOINT_ID = '1234567';
export const MERCHANT_LOGIN = 'test-merchant';
export const MERCHANT_CONTROL = 'test-merchant-control';

// Deliberately not the 1.00 default: a page that hard-coded the amount would still pass.
export const ORDER_AMOUNT = '12.34';
export const ORDER_CURRENCY = 'USD';

/** Ports start at 4010 so a developer's own 3000-3002 servers can keep running. */
export const EMULATOR_PORT = Number(process.env.E2E_EMULATOR_PORT ?? 4010);

// 127.0.0.1 rather than localhost throughout: the apps listen on the loopback address, and on
// macOS `localhost` can resolve to ::1 first, where nothing would be listening.
export const HOST = '127.0.0.1';
export const EMULATOR_ORIGIN = `http://${HOST}:${EMULATOR_PORT}`;

/** What the apps are given. API_URL must not end in a slash: they append `/api/v4/...`. */
export const API_URL = EMULATOR_ORIGIN;
export const SDK_URL = `${EMULATOR_ORIGIN}/sdk.js`;

/** The sandbox test card the READMEs document. */
export const TEST_CARD = {
  number: '4444444444444448',
  expiry: '12/30',
  cvv: '123',
};
