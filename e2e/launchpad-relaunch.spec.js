import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  SAVE_KEY, STARTING_MONEY,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
} from './helpers.js';

/**
 * E2E — Launch Pad Relaunch Engine Bug
 *
 * Regression test: launching a rocket from the launch pad should fire the
 * first-stage engine and lift off normally.  After returning to the hub,
 * relaunching the same design should also work.
 *
 * Root cause: _designToAssembly() in launchPad.js reconstructs part positions
 * but does not recreate the connection graph.  The fuel system uses BFS over
 * assembly.connections to find tanks reachable from an engine — with no
 * connections the engine finds zero fuel and flames out on the first tick.
 *
 * Tests run in serial order on a shared page instance.
 *
 * Execution order:
 *   Setup  : Seed save with a rocket design → load → arrive at hub
 *   (1)    : First flight — launch from pad, fire stage 1, verify liftoff
 *   (2)    : Return to hub via menu → abort → post-flight → hub
 *   (3)    : Second flight (regression) — relaunch same rocket, verify engine fires
 */

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENCY_NAME = 'Relaunch Test Agency';

const UNLOCKED_PARTS = ['cmd-mk1', 'tank-small', 'engine-spark'];

// Rocket design: cmd-mk1 + tank-small + engine-spark, engine staged in stage 1.
// Positions use VAB world coordinates (Y increases upward) so snap points
// coincide and _rebuildConnections can infer the connection graph.
//   cmd-mk1 bottom snap  at worldY = 0 − 20  = −20
//   tank-small top snap   at worldY = −40−(−20)= −20  ✓
//   tank-small bottom snap at worldY = −40 − 20 = −60
//   engine-spark top snap at worldY = −75−(−15)= −60  ✓
const SEEDED_DESIGN = {
  id:          'design-relaunch-test',
  name:        'Relaunch Rocket',
  parts: [
    { partId: 'cmd-mk1',      position: { x: 0, y: 0 } },
    { partId: 'tank-small',   position: { x: 0, y: -40 } },
    { partId: 'engine-spark', position: { x: 0, y: -75 } },
  ],
  staging: {
    stages:   [['inst-3']],   // inst-3 = engine-spark (IGNITE)
    unstaged: ['inst-1'],     // inst-1 = cmd-mk1 (EJECT)
  },
  totalMass:   1010,
  totalThrust: 60,
  createdDate: new Date().toISOString(),
  updatedDate: new Date().toISOString(),
};

function relaunchSaveEnvelope() {
  return buildSaveEnvelope({
    saveName:   'Relaunch E2E Test',
    agencyName: AGENCY_NAME,
    missions:   { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
    parts:      UNLOCKED_PARTS,
    rockets:    [SEEDED_DESIGN],
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * From the hub, navigate to the launch pad, click Launch on the rocket card,
 * handle the crew dialog, and wait for the flight scene to be ready.
 */
async function launchFromPad(page) {
  await page.click('[data-building-id="launch-pad"]');
  await page.waitForSelector('#launch-pad-overlay', { state: 'visible', timeout: 10_000 });

  await page.click('.lp-launch-btn');

  // Handle crew dialog (cmd-mk1 has a seat).
  await page.waitForSelector('#lp-crew-overlay', { state: 'visible', timeout: 5_000 });
  await page.click('.lp-crew-confirm-btn');

  // Wait for flight scene.
  await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 15_000 });
  await page.waitForFunction(
    () => typeof window.__flightPs !== 'undefined' && window.__flightPs !== null,
    { timeout: 10_000 },
  );
}

/**
 * Press Space to fire stage 1, then assert the engine is firing and the
 * rocket lifts off.
 */
async function fireStageAndVerifyLiftoff(page) {
  // Confirm rocket is grounded before staging.
  const groundedBefore = await page.evaluate(() => window.__flightPs?.grounded ?? true);
  expect(groundedBefore).toBe(true);

  // Press spacebar to fire Stage 1.
  await page.keyboard.press('Space');

  // Wait for engine to start firing after staging.
  await page.waitForFunction(
    () => (window.__flightPs?.firingEngines?.size ?? 0) > 0,
    { timeout: 5_000 },
  );

  // The engine should still be firing (not flamed out due to missing fuel
  // connections).  This is the core assertion that catches the bug.
  const firingCount = await page.evaluate(
    () => window.__flightPs?.firingEngines?.size ?? 0,
  );
  expect(firingCount).toBeGreaterThan(0);

  // Within 5 seconds the rocket should have lifted off (posY > 5).
  await page.waitForFunction(
    () => (window.__flightPs?.posY ?? 0) > 5,
    { timeout: 5_000 },
  );
}

/**
 * From flight, open the menu → "Return to Space Agency" → handle abort dialog →
 * post-flight summary → return button → hub.
 */
async function returnToHub(page) {
  // Open topbar dropdown.
  const dropdown = page.locator('#topbar-dropdown');
  if (!(await dropdown.isVisible())) {
    await page.click('#topbar-menu-btn');
    await expect(dropdown).toBeVisible({ timeout: 2_000 });
  }
  await dropdown.getByText('Return to Space Agency').click();

  // Abort confirmation dialog (rocket is in flight).
  // Aborting now skips the post-flight summary and returns straight to hub.
  const abortBtn = page.locator('[data-testid="abort-confirm-btn"]');
  const didAbort = await abortBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  if (didAbort) {
    await abortBtn.click();
  } else {
    // Landed/crashed — post-flight summary appears; click through it.
    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 10_000 });
    await page.click('#post-flight-return-btn');
  }

  // Return results overlay may appear — dismiss it.
  try {
    const dismissBtn = page.locator('#return-results-dismiss-btn');
    await dismissBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await dismissBtn.click();
    await page.waitForSelector('#return-results-overlay', { state: 'hidden', timeout: 5_000 }).catch(() => {});
  } catch {
    // No return results overlay — proceed.
  }

  // Back at hub.
  await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Launch Pad — Relaunch Engine Bug', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    // Seed and load save.
    const envelope = relaunchSaveEnvelope();

    await page.addInitScript(({ key, envelope }) => {
      localStorage.setItem(key, JSON.stringify(envelope));
    }, { key: SAVE_KEY, envelope });

    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── (1) First flight — launch from pad, fire engine, verify liftoff ─────

  test('(1) first flight — engine fires and rocket lifts off', async () => {
    test.setTimeout(60_000);
    await launchFromPad(page);
    await fireStageAndVerifyLiftoff(page);
  });

  // ── (2) Return to hub ───────────────────────────────────────────────────

  test('(2) return to hub after first flight', async () => {
    await returnToHub(page);
    await expect(page.locator('#hub-overlay')).toBeVisible();
  });

  // ── (3) Second flight (regression) — engine should fire again ───────────

  test('(3) second flight — engine fires on relaunch (regression)', async () => {
    test.setTimeout(60_000);
    await launchFromPad(page);
    await fireStageAndVerifyLiftoff(page);

    // Extra assertion: rocket is no longer grounded.
    const grounded = await page.evaluate(() => window.__flightPs?.grounded ?? true);
    expect(grounded).toBe(false);
  });
});
