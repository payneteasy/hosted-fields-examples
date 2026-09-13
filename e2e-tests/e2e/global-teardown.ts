// Takes the docker stack down, whatever happened to the run.
//
// Playwright stops a webServer by signalling it, and `docker compose up` does stop the stack on
// SIGTERM — but a run killed hard, or one whose webServer never became ready, would leave twelve
// containers and two published ports behind. This is the belt to that braces, and it is cheap:
// `down` on a stack that is already gone succeeds and says nothing.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { COMPOSE_ARGS, COMPOSE_DOWN } from '../src/compose.ts';
import { REPO_ROOT } from '../src/settings.ts';

const run = promisify(execFile);

export default async function globalTeardown(): Promise<void> {
  try {
    await run('docker', [...COMPOSE_ARGS, 'down', '--remove-orphans'], { cwd: REPO_ROOT });
  } catch (error) {
    // Never fail a run over the cleanup — say what was left and what to type.
    console.error('[teardown] `%s` failed: %s', COMPOSE_DOWN, error);
  }
}
