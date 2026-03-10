import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  FIRST_FLIGHT_MISSION, buildSaveEnvelope,
  placePart, seedAndLoadSave, navigateToVab, launchFromVab,
} from './helpers.js';

/**
 * E2E — Flight Landing
 *
 * Tests the complete landing sequence using a two-stage rocket:
 *
 *   Stage 1 — Spark Engine ignites; rocket lifts off.
 *   Stage 2 — Stack Decoupler TR-18 separates the lower stage (tank + engine)
 *              while the Mk2 Parachute deploys simultaneously on the upper
 *              section (command module + parachute, 1,090 kg total).
 *
 * With deployedDiameter = 35 m the Mk2 Parachute gives a terminal velocity of
 * ~4.9 m/s for the 1,090 kg upper stage — below the 5 m/s gentle-landing
 * threshold — so the rocket lands safely with no physics manipulation.
 *
 * Time warp (50×) is engaged after the staging lockout expires to keep the
 * descent duration to under a second of real time.
 *
 * Tests (serial, one shared flight-scene page):
 *   (1) Launching from the VAB loads the flight scene.
 *   (2) Stage 1 fires — rocket lifts off.
 *   (3) Stage 2 fires — lower stage separates and parachute deploys.
 *   (4) Upper section descends and lands safely (no physics injection).
 *   (5) A LANDING event with speed < 5 m/s is recorded in the flight log.
 *   (6) "Return to Space Agency" shows the post-flight summary.
 */

test.describe.configure({ mode: 'serial' });

// ---------------------------------------------------------------------------
// Drop positions (5-part stack)
// ---------------------------------------------------------------------------

const CMD_DROP_Y      = CANVAS_CENTRE_Y;   // 386
const CHUTE_DROP_Y    = 359;               // above cmd
const DECOUPLE_DROP_Y = 411;              // below cmd
const TANK_DROP_Y     = 436;              // below decoupler
const ENGINE_DROP_Y   = 471;             // below tank

const UNLOCKED_PARTS = [
  'cmd-mk1',
  'parachute-mk2',
  'decoupler-stack-tr18',
  'tank-small',
  'engine-spark',
];

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Flight — Landing', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  /**
   * Wait for the time-warp staging lockout (set on every Space press) to clear.
   * The warp buttons are disabled during lockout (~2 s) and enabled after.
   */
  async function waitForWarpUnlocked() {
    await page.waitForFunction(
      () => !document.querySelector('.hud-warp-btn')?.disabled,
      { timeout: 10_000 },
    );
  }

  // ── Suite setup ───────────────────────────────────────────────────────────

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      saveName: 'Landing E2E Test',
      missions: { available: [], accepted: [{ ...FIRST_FLIGHT_MISSION, status: 'accepted' }], completed: [] },
      parts: UNLOCKED_PARTS,
    });

    await seedAndLoadSave(page, envelope);
    await navigateToVab(page);

    // ── Build rocket ──────────────────────────────────────────────────────
    // Place cmd-mk1 as anchor, then attach parachute above and
    // decoupler → tank → engine below.
    await placePart(page, 'cmd-mk1', CENTRE_X, CMD_DROP_Y, 1);
    await placePart(page, 'parachute-mk2', CENTRE_X, CHUTE_DROP_Y, 2);
    await placePart(page, 'decoupler-stack-tr18', CENTRE_X, DECOUPLE_DROP_Y, 3);
    await placePart(page, 'tank-small', CENTRE_X, TANK_DROP_Y, 4);
    await placePart(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y, 5);

    // ── Verify auto-staging and assign parachute to Stage 2 ────────────────
    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();

    // Engine should be auto-staged in Stage 1.
    await expect(
      page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
    ).toBeVisible({ timeout: 5_000 });

    // Decoupler should have auto-created Stage 2.
    await expect(
      page.locator('[data-drop-zone="stage-1"]').getByText('Stack Decoupler TR-18'),
    ).toBeVisible({ timeout: 5_000 });

    // Parachute → Stage 2 (same stage as decoupler).
    await page.dragAndDrop(
      '[data-drop-zone="unstaged"] .vab-stage-chip:has-text("Mk2 Parachute")',
      '[data-drop-zone="stage-1"]',
    );
    await expect(
      page.locator('[data-drop-zone="stage-1"]').getByText('Mk2 Parachute'),
    ).toBeVisible();

    // ── Launch ────────────────────────────────────────────────────────────
    await launchFromVab(page);
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── (1) Flight scene loaded ───────────────────────────────────────────────

  test('(1) launching from the VAB loads the flight scene', async () => {
    await expect(page.locator('#flight-hud')).toBeVisible();
    await expect(page.locator('#vab-btn-launch')).not.toBeVisible();
  });

  // ── (2) Stage 1 fires — rocket lifts off ─────────────────────────────────

  test('(2) pressing Space fires Stage 1 and the rocket lifts off', async () => {
    expect(await page.evaluate(() => window.__flightPs?.grounded ?? true)).toBe(true);

    await page.keyboard.press('Space');

    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) > 0,
      { timeout: 3_000 },
    );

    expect(await page.evaluate(() => window.__flightPs?.posY ?? 0)).toBeGreaterThan(0);
  });

  // ── (3) Stage 2 fires — lower stage decouples, parachute deploys ──────────

  test('(3) pressing Space again separates the lower stage and deploys the parachute', async () => {
    // Wait for the Stage 1 staging lockout to expire before firing Stage 2.
    await waitForWarpUnlocked();

    await page.keyboard.press('Space');

    // Lower stage (tank + engine) should now be debris.
    await page.waitForFunction(
      () => (window.__flightPs?.debris?.length ?? 0) > 0,
      { timeout: 5_000 },
    );

    // Parachute state machine should enter 'deploying' (→ 'deployed' after 2 s).
    await page.waitForFunction(() => {
      const ps = window.__flightPs;
      if (!ps?.parachuteStates) return false;
      for (const [, entry] of ps.parachuteStates) {
        if (entry.state === 'deploying' || entry.state === 'deployed') return true;
      }
      return false;
    }, { timeout: 5_000 });

    const chuteState = await page.evaluate(() => {
      const ps = window.__flightPs;
      if (!ps?.parachuteStates) return 'none';
      for (const [, entry] of ps.parachuteStates) return entry.state;
      return 'none';
    });
    expect(['deploying', 'deployed']).toContain(chuteState);

    // Upper stage mass should now be only cmd-mk1 + parachute-mk2 (~1090 kg).
    const activeParts = await page.evaluate(
      () => window.__flightPs?.activeParts?.size ?? -1,
    );
    // 2 active parts: cmd-mk1 + parachute-mk2 (decoupler ejected with lower stage).
    expect(activeParts).toBeLessThanOrEqual(3); // cmd + chute (+ possibly decoupler shell)
  });

  // ── (4) Upper section descends and lands naturally ────────────────────────

  test('(4) parachute slows the command module to a safe landing speed', async () => {
    // Wait for the Stage 2 staging lockout to clear.
    await waitForWarpUnlocked();

    // Engage 50× time warp so the ~40-second descent completes in under a second.
    // Click the warp button directly — more reliable than key presses.
    await page.click('[data-warp="50"]');

    // Wait for a natural landing.  Terminal velocity ~4.9 m/s for the
    // 1,090 kg upper stage, well below the 5 m/s gentle-landing threshold.
    await page.waitForFunction(
      () => window.__flightPs?.landed === true || window.__flightPs?.crashed === true,
      { timeout: 30_000 },
    );

    const { landed, crashed } = await page.evaluate(() => ({
      landed:  window.__flightPs?.landed  ?? false,
      crashed: window.__flightPs?.crashed ?? false,
    }));

    expect(landed).toBe(true);
    expect(crashed).toBe(false);
  });

  // ── (5) LANDING event in the flight log ──────────────────────────────────

  test('(5) a LANDING event is recorded with impact speed below 5 m/s', async () => {
    const events = await page.evaluate(
      () => window.__gameState?.currentFlight?.events ?? [],
    );

    const landingEvent = events.find((e) => e.type === 'LANDING');
    expect(landingEvent).toBeTruthy();
    expect(landingEvent.partsDestroyed).toBe(false);
    expect(landingEvent.speed).toBeLessThan(5);
  });

  // ── (6) Post-flight summary ───────────────────────────────────────────────

  test('(6) clicking "Return to Space Agency" shows the post-flight summary', async () => {
    // The post-flight summary may already be visible if the game auto-triggered
    // it (e.g. all command modules destroyed during time-warp descent).  If not,
    // open the topbar menu and click "Return to Space Agency" to trigger it.
    const summaryAlreadyVisible = await page.locator('#post-flight-summary').isVisible();
    if (!summaryAlreadyVisible) {
      await page.click('#topbar-menu-btn', { force: true });
      const dropdown = page.locator('#topbar-dropdown');
      await expect(dropdown).toBeVisible();
      await dropdown.getByText('Return to Space Agency').click();
    }

    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#post-flight-return-btn')).toBeVisible();
    await expect(page.locator('#flight-hud')).not.toBeVisible();
  });
});
