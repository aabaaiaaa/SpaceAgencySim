import { chromium, type FullConfig } from '@playwright/test';
import { freshStartFixture } from './fixtures.js';
import { seedAndLoadSave } from './helpers.js';

/**
 * Warm up the Vite dev server before the first spec runs.
 *
 * Vite compiles modules on-demand per request. The first browser page load
 * pays the cost of compiling every dependency in the game's module graph
 * (PixiJS, game core, flight controller, physics worker) — often 5-15
 * seconds. Subsequent requests hit Vite's in-memory cache and return in
 * milliseconds.
 *
 * By running through the same flow tests do (seed save, load into hub,
 * start a flight), we force Vite to compile every module tests will later
 * touch — including the physics worker (loaded as a separate Vite entry
 * via `new Worker(new URL(...))`) and the PixiJS flight renderer. All
 * tests thereafter see a warm Vite cache and run with consistent timings.
 *
 * `window.__e2eStartFlight` is only exposed after the main-menu callback
 * fires, so we can't trigger a flight from a bare page.goto; we have to
 * seed a save and load into the hub first, same as tests do.
 */
export default async function globalSetup(config: FullConfig): Promise<void> {
  const baseURL =
    config.projects[0]?.use?.baseURL ?? 'http://localhost:5173';

  const browser = await chromium.launch();
  // Pass baseURL so seedAndLoadSave's `page.goto('/')` resolves correctly.
  const context = await browser.newContext({ baseURL });
  const page = await context.newPage();
  try {
    // Seed a fresh save and load into the hub. This compiles the main
    // menu, save/load, and hub renderer modules.
    await seedAndLoadSave(page, freshStartFixture());

    // Start a minimal test flight. This triggers Vite to compile the
    // physics worker, the PixiJS flight renderer, and the flight
    // controller — none of which are imported by the hub.
    await page.evaluate(() => {
      const w = window as {
        __e2eStartFlight?: (parts: string[]) => void;
      };
      w.__e2eStartFlight?.(['probe-core-mk1', 'tank-small', 'engine-spark']);
    });

    // Wait for the flight scene to actually load so the worker is created
    // and the PixiJS renderer is instantiated.
    await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 30_000 });
    await page.waitForFunction(
      () => {
        const w = window as { __flightPs?: unknown };
        return typeof w.__flightPs !== 'undefined' && w.__flightPs !== null;
      },
      undefined,
      { timeout: 10_000 },
    );
  } catch (err) {
    // Warm-up is a best-effort optimisation. If it fails (e.g. because
    // the app changed in a way the helper doesn't understand), don't
    // block the run — tests will still work, just slower on the first
    // few because of cold-start compilation.
    console.warn('[global-setup] Vite warm-up failed:', err);
  } finally {
    await page.close();
    await context.close();
    await browser.close();
  }
}
