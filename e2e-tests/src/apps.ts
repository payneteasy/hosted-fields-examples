// The applications under test: how to start each one, and what to tell it.
//
// Every setting goes in as a process environment variable. Every example lets the real
// environment win over its `.env` file, so a developer's own `.env` is neither read for these
// values nor written to — the harness leaves the working tree alone.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { PRIVATE_KEY_PATH } from './keys.ts';
import {
  API_URL,
  ENDPOINT_ID,
  HOST,
  MERCHANT_CONTROL,
  MERCHANT_LOGIN,
  ORDER_AMOUNT,
  ORDER_CURRENCY,
  REPO_ROOT,
  SDK_URL,
  TMP_DIR,
} from './settings.ts';

/** The Go example is compiled here rather than into its own directory, which carries committed
 *  binaries of its own that nothing here should overwrite. */
const GO_BINARY_OUT = join(TMP_DIR, 'hosted-fields-example-go');

export interface AppUnderTest {
  /** Playwright project name, and the directory the app lives in. */
  name: string;
  port: number;
  /** Left at each app's own default: overriding it would mean rebuilding nextjs. */
  basePath: string;
  cwd: string;
  command: string;
  env: Record<string, string>;
}

/**
 * Go is often installed outside PATH — on this machine it is ~/opt/go/bin/go. A missing
 * toolchain is a hard failure rather than a skip: a green run has to mean every app really
 * passed.
 */
export function goBinary(): string {
  const candidates = [process.env.GO_BIN, join(homedir(), 'opt', 'go', 'bin', 'go')].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  // Falls back to PATH; if it is not there either the webServer start fails with ENOENT.
  return 'go';
}

function gatewayEnv(port: number): Record<string, string> {
  return {
    PORT: String(port),
    LISTEN_ADDR: HOST,
    PUBLIC_URL: `http://${HOST}:${port}`,
    API_URL,
    SDK_URL,
    ENDPOINT_ID,
    MERCHANT_LOGIN,
    MERCHANT_CONTROL,
    PRIVATE_KEY_PATH,
    ORDER_AMOUNT,
    ORDER_CURRENCY,
  };
}

export const APPS: AppUnderTest[] = [
  {
    name: 'go-js',
    port: 4011,
    basePath: '/hosted-fields-examples-go',
    cwd: join(REPO_ROOT, 'go-js'),
    // Built and then exec'd rather than `go run .`: `go run` spawns the compiled binary as a
    // grandchild that survives Playwright's shutdown and keeps holding the port. Running it from
    // .tmp also means loadConfig(".env") finds no file there, so go-js/.env cannot leak into a
    // test run even by accident.
    command:
      `${JSON.stringify(goBinary())} build -o ${JSON.stringify(GO_BINARY_OUT)} . ` +
      `&& cd ${JSON.stringify(TMP_DIR)} && exec ${JSON.stringify(GO_BINARY_OUT)}`,
    env: gatewayEnv(4011),
  },
  {
    name: 'nodejs-express-js',
    port: 4012,
    basePath: '/hosted-fields-examples-nodejs-express-js',
    cwd: join(REPO_ROOT, 'nodejs-express-js'),
    // Not `npm start`: that is `node --env-file=.env`, which fails outright when there is no
    // .env. The settings are already in the environment.
    command: 'node src/server.js',
    env: gatewayEnv(4012),
  },
  {
    name: 'php-js',
    port: 4014,
    basePath: '/hosted-fields-examples-php',
    cwd: join(REPO_ROOT, 'php-js'),
    // The port goes on the command line, not in the environment: PHP does not own the socket,
    // `php -S` is told where to listen. PORT and LISTEN_ADDR still travel in env below, where
    // the app ignores them.
    command: `php -S ${HOST}:4014 router.php`,
    // BASE_PATH is pinned here, and it is the only app that needs it. The Go binary is run from
    // .tmp so its `.env` is out of reach; a PHP app has to run from its own directory, which
    // puts php-js/.env back in reach. The real environment wins over that file for everything
    // gatewayEnv passes, and this closes the one gap: a local BASE_PATH would move the app out
    // from under the readiness probe.
    env: { ...gatewayEnv(4014), BASE_PATH: '/hosted-fields-examples-php' },
  },
  {
    name: 'nextjs',
    port: 4013,
    basePath: '/hosted-fields-examples-nextjs',
    cwd: join(REPO_ROOT, 'nextjs'),
    // basePath is baked in at build time, so the build has to happen with the same settings.
    command: 'yarn build && yarn start',
    // HOSTNAME rather than LISTEN_ADDR: Next reads the interface from the shell under that name.
    env: { ...gatewayEnv(4013), HOSTNAME: HOST },
  },
];

export function appOrigin(app: AppUnderTest): string {
  return `http://${HOST}:${app.port}`;
}

export function appUrl(app: AppUnderTest, path: string): string {
  return `${appOrigin(app)}${app.basePath}${path}`;
}
