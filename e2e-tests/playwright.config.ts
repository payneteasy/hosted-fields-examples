import { defineConfig, devices } from '@playwright/test';
import { APPS, appOrigin } from './src/apps.ts';
import { ensureKeypair } from './src/keys.ts';
import { EMULATOR_PORT, HOST, PROJECT_ROOT } from './src/settings.ts';

/* The key has to exist before any server starts, and this module is evaluated before Playwright
   launches anything — which is why it is generated here rather than in globalSetup, whose turn
   comes after the web servers are already up. */
ensureKeypair();

/* Starting all three apps costs a `next build`, so a run that asks for one project should not
   pay for the other two. Playwright has no per-project webServer, but it does hand us the
   command line. */
function selectedProjects(): string[] {
  const names: string[] = [];
  const argv = process.argv;
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === '--project' || arg === '-p') {
      const value = argv[index + 1];
      if (value) names.push(value);
    } else if (arg?.startsWith('--project=')) {
      names.push(arg.slice('--project='.length));
    }
  }
  return names;
}

const wanted = selectedProjects();
const appsToStart = wanted.length > 0 ? APPS.filter((app) => wanted.includes(app.name)) : APPS;

export default defineConfig({
  testDir: './e2e',
  // The emulator holds the pending scenario and the order book in memory, and all three apps
  // share it. Serial is what makes that unambiguous.
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: 0,
  reporter: 'list',
  // A cold `next build` is the slow one; the rest start in a second or two.
  timeout: 60_000,
  expect: { timeout: 15_000 },
  globalSetup: './e2e/global-setup.ts',
  use: { trace: 'on-first-retry' },

  projects: APPS.map((app) => ({
    name: app.name,
    use: { ...devices['Desktop Chrome'], baseURL: appOrigin(app) },
  })),

  webServer: [
    {
      command: 'node src/emulator/main.ts',
      cwd: PROJECT_ROOT,
      url: `http://${HOST}:${EMULATOR_PORT}/__control/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      stdout: 'pipe',
      stderr: 'pipe',
    },
    ...appsToStart.map((app) => ({
      command: app.command,
      cwd: app.cwd,
      // Every setting goes in as a real environment variable, so none of the apps' own .env
      // files are read for these values or written to.
      env: app.env,
      url: `${appOrigin(app)}${app.basePath}/`,
      reuseExistingServer: !process.env.CI,
      // nextjs builds before it starts.
      timeout: app.name === 'nextjs' ? 300_000 : 60_000,
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    })),
  ],
});
