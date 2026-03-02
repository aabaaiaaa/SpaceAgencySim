import { test, expect } from '@playwright/test';

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
// Constants
// ---------------------------------------------------------------------------

const VP_W = 1280;
const VP_H = 720;

const TOOLBAR_H     = 52;
const SCALE_BAR_W   = 50;
const PARTS_PANEL_W = 280;

const BUILD_X = SCALE_BAR_W;
const BUILD_W = VP_W - PARTS_PANEL_W - SCALE_BAR_W;   // 950
const BUILD_H = VP_H - TOOLBAR_H;                     // 668

const CENTRE_X        = BUILD_X + BUILD_W / 2;         // 525
const CANVAS_CENTRE_Y = TOOLBAR_H + BUILD_H / 2;       // 386

// ── Drop positions ──────────────────────────────────────────────────────────
//
// Snap geometry (formula: child_centre = parent_snap_Y − child_top_snap.offsetY):
//
//   parachute-mk2 (h=15, bottom snap +7):
//     cmd top snap   = 386 − 20 = 366
//     chute centre   = 366 − 7  = 359
//
//   cmd-mk1 (h=40, top snap −20, bottom snap +20):
//     centre         = 386
//     bottom snap    = 406
//
//   decoupler-stack-tr18 (h=10, top snap −5, bottom snap +5):
//     centre         = 406 − (−5) = 411
//     bottom snap    = 416
//
//   tank-small (h=40, top snap −20, bottom snap +20):
//     centre         = 416 − (−20) = 436
//     bottom snap    = 456
//
//   engine-spark (h=30, top snap −15):
//     centre         = 456 − (−15) = 471

const CMD_DROP_Y      = CANVAS_CENTRE_Y;   // 386
const CHUTE_DROP_Y    = 359;               // above cmd
const DECOUPLE_DROP_Y = 411;              // below cmd
const TANK_DROP_Y     = 436;              // below decoupler
const ENGINE_DROP_Y   = 471;             // below tank

// ── Save / seed config ───────────────────────────────────────────────────────

const SAVE_KEY    = 'spaceAgencySave_0';
const AGENCY_NAME = 'Test Agency';
const STARTING_MONEY = 2_000_000;

const UNLOCKED_PARTS = [
  'cmd-mk1',
  'parachute-mk2',
  'decoupler-stack-tr18',
  'tank-small',
  'engine-spark',
];

const ACCEPTED_FIRST_FLIGHT = {
  id:          'mission-001',
  title:       'First Flight',
  description:
    'Our engineers have assembled a basic sounding rocket. Your task is simple: ' +
    'get it off the pad and reach 100 metres altitude. This is the first step ' +
    'in what will become a legendary space programme.',
  location:    'desert',
  objectives: [{
    id:          'obj-001-1',
    type:        'REACH_ALTITUDE',
    target:      { altitude: 100 },
    completed:   false,
    description: 'Reach 100 m altitude',
  }],
  reward:        15_000,
  unlocksAfter:  [],
  unlockedParts: [],
  status:        'accepted',
};

function buildSaveEnvelope(missionsState) {
  return {
    saveName:  'Landing E2E Test',
    timestamp: new Date().toISOString(),
    state: {
      agencyName:      AGENCY_NAME,
      money:           STARTING_MONEY,
      loan:            { balance: STARTING_MONEY, interestRate: 0.03, totalInterestAccrued: 0 },
      missions:        missionsState,
      crew:            [],
      rockets:         [],
      parts:           UNLOCKED_PARTS,
      flightHistory:   [],
      playTimeSeconds: 0,
      currentFlight:   null,
    },
  };
}

const LANDING_ENVELOPE = buildSaveEnvelope({
  available: [],
  accepted:  [ACCEPTED_FIRST_FLIGHT],
  completed: [],
});

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

test.describe('Flight — Landing', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  // ── Drag helper ───────────────────────────────────────────────────────────

  async function dragPartToCanvas(partId, targetX, targetY) {
    const card    = page.locator(`.vab-part-card[data-part-id="${partId}"]`);
    const cardBox = await card.boundingBox();
    if (!cardBox) throw new Error(`Part card not visible: ${partId}`);

    const startX = cardBox.x + cardBox.width  / 2;
    const startY = cardBox.y + cardBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(targetX, targetY, { steps: 30 });
    await page.mouse.up();
  }

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

    await page.addInitScript(({ key, envelope }) => {
      localStorage.setItem(key, JSON.stringify(envelope));
    }, { key: SAVE_KEY, envelope: LANDING_ENVELOPE });

    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    await page.click('[data-building-id="vab"]');
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.__vabAssembly !== 'undefined',
      { timeout: 15_000 },
    );

    // ── Build rocket ──────────────────────────────────────────────────────
    // Place cmd-mk1 as anchor, then attach parachute above and
    // decoupler → tank → engine below.

    await dragPartToCanvas('cmd-mk1', CENTRE_X, CMD_DROP_Y);
    await page.waitForFunction(() => (window.__vabAssembly?.parts?.size ?? 0) >= 1, { timeout: 5_000 });

    await dragPartToCanvas('parachute-mk2', CENTRE_X, CHUTE_DROP_Y);
    await page.waitForFunction(() => (window.__vabAssembly?.parts?.size ?? 0) >= 2, { timeout: 5_000 });

    await dragPartToCanvas('decoupler-stack-tr18', CENTRE_X, DECOUPLE_DROP_Y);
    await page.waitForFunction(() => (window.__vabAssembly?.parts?.size ?? 0) >= 3, { timeout: 5_000 });

    await dragPartToCanvas('tank-small', CENTRE_X, TANK_DROP_Y);
    await page.waitForFunction(() => (window.__vabAssembly?.parts?.size ?? 0) >= 4, { timeout: 5_000 });

    await dragPartToCanvas('engine-spark', CENTRE_X, ENGINE_DROP_Y);
    await page.waitForFunction(() => (window.__vabAssembly?.parts?.size ?? 0) >= 5, { timeout: 5_000 });

    // ── Verify auto-staging and assign parachute to Stage 2 ────────────────
    // With auto-staging: engine → Stage 1, decoupler → new Stage 2 (auto-created).
    // Parachute stays in unstaged — drag it to Stage 2 alongside the decoupler.

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

    const launchBtn = page.locator('#vab-btn-launch');
    await expect(launchBtn).not.toBeDisabled({ timeout: 5_000 });
    await launchBtn.click();

    await page.waitForSelector('#vab-crew-overlay', { state: 'visible', timeout: 5_000 });
    await page.click('#vab-crew-confirm');

    await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.__flightPs !== 'undefined' && window.__flightPs !== null,
      { timeout: 10_000 },
    );
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
    expect(landingEvent.legsDestroyed).toBe(false);
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
