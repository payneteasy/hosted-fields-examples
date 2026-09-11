// The one docker compose command line, so the config, the teardown and the README cannot drift.

import type { AppUnderTest } from './apps.ts';

/** Its own project name, so an e2e run and a demo stack started from the same directory do not
 *  tear each other down — the project name is what `docker compose down` scopes itself to. */
export const COMPOSE_PROJECT = 'hosted-fields-examples-e2e';

/** Run from the repository root: both files are there, and so are the ten build contexts. */
export const COMPOSE_ARGS = [
  'compose',
  '-p',
  COMPOSE_PROJECT,
  '-f',
  'docker-compose.yml',
  '-f',
  'docker-compose.e2e.yml',
];

/** What to call the mode in an error message. */
export const COMPOSE_COMMAND = `docker ${COMPOSE_ARGS.join(' ')}`;

/**
 * Brings up nginx, the emulator and the apps this run asked for. Naming services rather than
 * bringing everything up is what keeps a one-app run from building the other eight; compose adds
 * nginx itself through depends_on, and the emulator is named because nothing depends on it.
 */
export function composeUp(apps: AppUnderTest[]): string {
  const services = ['emulator', ...apps.map((app) => app.service)];
  return `${COMPOSE_COMMAND} up --build ${services.join(' ')}`;
}

/** Takes the stack down. The volumes are left: the only one is the php-fpm socket. */
export const COMPOSE_DOWN = `${COMPOSE_COMMAND} down --remove-orphans`;
