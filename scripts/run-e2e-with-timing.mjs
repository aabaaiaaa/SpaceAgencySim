#!/usr/bin/env node
/**
 * run-e2e-with-timing.mjs — Run Playwright e2e tests, then always run the
 * timing analyser regardless of pass/fail. The timing report is most useful
 * when tests are slow or failing, so we do NOT short-circuit on non-zero
 * exit. Exits with the Playwright exit code.
 *
 * Any args passed after the script are forwarded to `playwright test`:
 *   npm run test:e2e -- --workers=1 --grep @smoke
 */
import { spawnSync } from 'node:child_process';

// Invoke the Playwright CLI module directly via node to bypass the npm .cmd
// shim — spawnSync can't execute .cmd shims on Windows (EINVAL), and using
// `shell: true` mangles args containing spaces or unicode (e.g. "em —").
const playwrightArgs = process.argv.slice(2);
const { status: playwrightStatus, error: playwrightError } = spawnSync(
  process.execPath,
  ['node_modules/@playwright/test/cli.js', 'test', ...playwrightArgs],
  { stdio: 'inherit' },
);

if (playwrightError) {
  // Spawn itself failed (binary not found, etc.) — skip timing and exit.
  console.error(`Failed to run playwright: ${playwrightError.message}`);
  process.exit(1);
}

// Always run timing, even if tests failed. timing.json is written by the
// JSON reporter on every run, so the script has data to analyse.
spawnSync(process.execPath, ['scripts/e2e-timing.mjs'], { stdio: 'inherit' });

process.exit(playwrightStatus ?? 1);
