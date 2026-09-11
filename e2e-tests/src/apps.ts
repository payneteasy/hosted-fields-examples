// The applications under test: how to start each one, and what to tell it.
//
// Every setting goes in as a process environment variable. Every example lets the real
// environment win over its `.env` file, so a developer's own `.env` is neither read for these
// values nor written to — the harness leaves the working tree alone.

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
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

/** The Rust example's target directory, for the same reason — and cargo would otherwise leave a
 *  multi-gigabyte target/ inside the app. --target-dir puts it here instead. */
const RUST_TARGET_DIR = join(TMP_DIR, 'rust-axum-target');
const RUST_BINARY_OUT = join(RUST_TARGET_DIR, 'release', 'hosted-fields-example-rust');

/** The Flask example's virtualenv, here for the same reason: the suite must leave every app
 *  directory exactly as it found it. */
const PYTHON_VENV = join(TMP_DIR, 'python-flask-venv');

/** And the Ruby example's gems. BUNDLE_PATH points bundler here as an environment variable,
 *  rather than `bundle config set path`, which would write a .bundle/config into the app. */
const RUBY_GEMS = join(TMP_DIR, 'ruby-sinatra-gems');

export interface AppUnderTest {
  /** Playwright project name, and the directory the app lives in. */
  name: string;
  port: number;
  /** Left at each app's own default: overriding it would mean rebuilding nextjs. */
  basePath: string;
  cwd: string;
  command: string;
  env: Record<string, string>;
  /** How long to wait for the readiness probe. Omitted means the 60s default; an app that builds
   *  or installs before it listens needs more. */
  startTimeout?: number;
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

/**
 * macOS ships an end-of-life Ruby 2.6 as /usr/bin/ruby, which Sinatra 4 will not run on, so a
 * modern one usually lives outside PATH — on this machine at ~/opt/ruby, beside go and node.
 */
export function rubyBinary(): string {
  const candidates = [process.env.RUBY_BIN, join(homedir(), 'opt', 'ruby', 'bin', 'ruby')].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  // Falls back to PATH, where it may well be the 2.6 that cannot run this app.
  return 'ruby';
}

/**
 * The JDK `./mvnw` builds and `java -jar` runs with. A JDK from a version manager is often in
 * JAVA_HOME but not on PATH, or the other way round, so this names one and puts it first on both —
 * which is what makes the whole command line agree on a single JDK.
 *
 * An empty result is not a failure: mvnw then looks for java on PATH itself, and says so clearly
 * when there is none.
 */
export function javaEnv(): Record<string, string> {
  const candidates = [
    process.env.JAVA_HOME,
    join(homedir(), '.sdkman', 'candidates', 'java', 'current'),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (existsSync(join(candidate, 'bin', 'java'))) {
      return {
        JAVA_HOME: candidate,
        PATH: `${join(candidate, 'bin')}${delimiter}${process.env.PATH ?? ''}`,
      };
    }
  }
  return {};
}

/**
 * cargo installed by rustup lives in ~/.cargo/bin, which is on PATH only once a shell has sourced
 * ~/.cargo/env — and Playwright's webServer does not. Naming it, and putting its directory first
 * on PATH, is also what lets cargo find the rustc shim beside it.
 */
export function cargoBinary(): string {
  const candidates = [process.env.CARGO_BIN, join(homedir(), '.cargo', 'bin', 'cargo')].filter(
    (candidate): candidate is string => Boolean(candidate),
  );
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  // Falls back to PATH; if it is not there either the webServer start fails with ENOENT.
  return 'cargo';
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
    name: 'python-flask-js',
    port: 4015,
    basePath: '/hosted-fields-examples-python',
    cwd: join(REPO_ROOT, 'python-flask-js'),
    // The virtualenv is built in .tmp/, never in the app directory: this suite leaves the working
    // tree alone. Both steps are near-instant once it is warm, and `python3` only has to exist
    // for long enough to create it — everything after that runs out of the venv.
    command:
      `python3 -m venv ${JSON.stringify(PYTHON_VENV)} && ` +
      `${JSON.stringify(join(PYTHON_VENV, 'bin', 'pip'))} install -q -r requirements.txt && ` +
      `exec ${JSON.stringify(join(PYTHON_VENV, 'bin', 'python'))} app.py`,
    // BASE_PATH is pinned for the same reason as php-js: the app has to run from its own
    // directory, so python-flask-js/.env is in reach. The environment wins over that file for
    // everything gatewayEnv passes, and this closes the one gap it leaves.
    env: { ...gatewayEnv(4015), BASE_PATH: '/hosted-fields-examples-python' },
    // A cold `pip install cryptography` is slower than any server start
    startTimeout: 180_000,
  },
  {
    name: 'ruby-sinatra-js',
    port: 4016,
    basePath: '/hosted-fields-examples-ruby',
    cwd: join(REPO_ROOT, 'ruby-sinatra-js'),
    // The gems go to .tmp/, like the Flask virtualenv and the Go binary, so the app directory is
    // untouched.
    command: 'bundle install --quiet && exec bundle exec ruby app.rb',
    env: {
      ...gatewayEnv(4016),
      // BASE_PATH is pinned for the same reason as the PHP and Flask entries: the app runs from
      // its own directory, so ruby-sinatra-js/.env is in reach.
      BASE_PATH: '/hosted-fields-examples-ruby',
      // BUNDLE_PATH rather than `bundle config set path`, which would write a .bundle/config
      // into the app directory.
      BUNDLE_PATH: RUBY_GEMS,
      // `bundle` and `bundle exec ruby` both resolve `ruby` through PATH, and on macOS that is
      // the end-of-life 2.6 that Sinatra 4 refuses to run on — bundler says so and exits 1.
      // Naming the located ruby first is what makes the whole command line agree on one.
      PATH: `${dirname(rubyBinary())}${delimiter}${process.env.PATH ?? ''}`,
    },
    // The first run compiles puma's native extension
    startTimeout: 180_000,
  },
  {
    name: 'java-springboot-js',
    port: 4017,
    basePath: '/hosted-fields-examples-java',
    cwd: join(REPO_ROOT, 'java-springboot-js'),
    // The build output goes to the app's own target/, not to .tmp/ like the Go binary and the
    // Flask virtualenv: it is git-ignored, so the working tree is still left as it was found, and
    // Maven's own cache is ~/.m2, outside the repository either way. Tests are skipped here —
    // `./mvnw verify` is what runs them, and this step only has to produce the jar.
    command:
      './mvnw -q -B -DskipTests package && exec java -jar target/hosted-fields-example-java.jar',
    env: {
      ...gatewayEnv(4017),
      // BASE_PATH is pinned for the same reason as the PHP, Flask and Sinatra entries: the app
      // runs from its own directory, so java-springboot-js/.env is in reach.
      BASE_PATH: '/hosted-fields-examples-java',
      ...javaEnv(),
    },
    // A cold run downloads Maven itself and then Spring Boot; a warm one is a few seconds
    startTimeout: 600_000,
  },
  {
    name: 'rust-axum-js',
    port: 4018,
    basePath: '/hosted-fields-examples-rust',
    cwd: join(REPO_ROOT, 'rust-axum-js'),
    // Built into .tmp/ and then exec'd from there, the way the Go example is: --target-dir keeps
    // cargo's output out of the app directory, and running the binary from .tmp means it finds no
    // .env there — so rust-axum-js/.env cannot leak into a test run, and BASE_PATH needs no pin.
    command:
      `${JSON.stringify(cargoBinary())} build --release --target-dir ${JSON.stringify(RUST_TARGET_DIR)} ` +
      `&& cd ${JSON.stringify(TMP_DIR)} && exec ${JSON.stringify(RUST_BINARY_OUT)}`,
    env: {
      ...gatewayEnv(4018),
      PATH: `${dirname(cargoBinary())}${delimiter}${process.env.PATH ?? ''}`,
    },
    // A cold build compiles axum, tokio and rustls from source; a warm one is a few seconds
    startTimeout: 600_000,
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
    // It builds before it listens
    startTimeout: 300_000,
  },
];

export function appOrigin(app: AppUnderTest): string {
  return `http://${HOST}:${app.port}`;
}

export function appUrl(app: AppUnderTest, path: string): string {
  return `${appOrigin(app)}${app.basePath}${path}`;
}
