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

/**
 * Which mode this run is in.
 *
 * `native` starts every app itself, one per port, and needs a toolchain for each — that is what
 * `npm test` does. `docker` runs the same specs against docker-compose.yml instead, so the only
 * thing that has to be installed is Docker; `npm run test:docker` sets this.
 */
export const TARGET = process.env.E2E_TARGET === 'docker' ? 'docker' : 'native';

/**
 * The port nginx answers on in the docker mode. Not a knob: docker-compose.e2e.yml spells it too,
 * as the published port, as nginx's own `listen` and as the port in every app's PUBLIC_URL, and
 * all four have to be the one number. The emulator recomputes the URL an app signed rather than
 * reading the request's Host, so an address that differs inside the stack and out verifies
 * nowhere. Change it here and in that file together.
 */
export const NGINX_PORT = 4020;
/** Where all twelve apps answer in the docker mode — one origin, twelve prefixes. */
export const NGINX_ORIGIN = `http://${HOST}:${NGINX_PORT}`;

/**
 * The interface the emulator binds. It stays 127.0.0.1 natively; in the docker mode the emulator
 * runs in a container, where a published port only reaches a server bound to 0.0.0.0. What it
 * *advertises* is EMULATOR_ORIGIN either way — the apps sign that string and the emulator
 * recomputes it, so it may not vary with where the socket happens to be.
 */
export const EMULATOR_BIND = process.env.E2E_EMULATOR_HOST ?? HOST;

/** What the apps are given. API_URL must not end in a slash: they append `/api/v4/...`. */
export const API_URL = EMULATOR_ORIGIN;
export const SDK_URL = `${EMULATOR_ORIGIN}/sdk.js`;

/** The sandbox test card the READMEs document. */
export const TEST_CARD = {
  number: '4444444444444448',
  expiry: '12/30',
  cvv: '123',
};
