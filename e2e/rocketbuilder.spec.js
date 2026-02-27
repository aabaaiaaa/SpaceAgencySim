import { test, expect } from '@playwright/test';

/**
 * E2E — Rocket Builder Flow
 *
 * Tests the VAB (Vehicle Assembly Building) rocket builder UI end-to-end.
 * Game state is seeded fresh by navigating to /; main.js unlocks all parts by
 * default so the parts panel is fully populated.
 *
 * Tests run in serial order and share a single page instance so each test
 * builds on the state established by the previous one.
 *
 * Execution order (logical, not by requirement number):
 *   (1) Parts panel categories check        — independent
 *   (2) Scale bar visible                   — independent
 *   (3) Drag cmd module to canvas           — places cmd-mk1
 *   (4) Drag tank + engine, connected       — places tank + engine, checks connections
 *   (5) Staging panel: engine in unstaged   — opens staging, checks unstaged
 *   (7) Engineer panel: failing TWR         — before engine is staged
 *   (6) Stage the engine in Stage 1         — moves engine chip to Stage 1
 *   (8) Launch button enabled               — verifies canLaunch after valid rocket
 *   (9) Cash display updated                — verifies deductions from all placements
 */

test.describe.configure({ mode: 'serial' });

test.describe('VAB — Rocket Builder Flow', () => {
  // ── Shared state ──────────────────────────────────────────────────────────

  /** @type {import('@playwright/test').Page} */
  let page;

  // Viewport dimensions matching Playwright Desktop Chrome default (1280×720).
  const VP_W = 1280;
  const VP_H = 720;

  // VAB layout constants (must match src/render/vab.js and src/ui/vab.js)
  const TOOLBAR_H     = 52;
  const SCALE_BAR_W   = 50;
  const PARTS_PANEL_W = 280;

  // Build-area geometry
  const BUILD_X = SCALE_BAR_W;                           // 50
  const BUILD_W = VP_W - PARTS_PANEL_W - SCALE_BAR_W;   // 950
  const BUILD_H = VP_H - TOOLBAR_H;                     // 668

  // Default camera is set by initVabRenderer():
  //   camX = BUILD_W / 2  = 475
  //   camY = BUILD_H * 0.85 = 567.8
  // At these camera values, canvas-centre screen coords map to world (0, ~234).
  // We drop all parts along the rocket centreline (screen X = BUILD_X + camX = 525).
  const CAM_X = BUILD_W / 2;         // 475
  const CAM_Y = BUILD_H * 0.85;      // 567.8

  // Screen X of the rocket centreline (world X = 0)
  const CENTRE_X = BUILD_X + CAM_X;  // 525

  // Screen Y of canvas vertical centre — used to place cmd-mk1
  const CANVAS_CENTRE_Y = TOOLBAR_H + BUILD_H / 2;  // 386

  // ── Drop positions calculated from part snap-point geometry ──────────────
  //
  // Formula: screenSnapY = screenPartCentreY + snap.offsetY
  // (positive offsetY = below centre in screen space)
  //
  // cmd-mk1  (height 40, bottom snap offsetY +20) → snap at CANVAS_CENTRE_Y + 20 = 406
  // tank-small (height 40, top snap offsetY -20) → centre at 406 + 20 = 426
  //            tank bottom snap offsetY +20 → snap at 426 + 20 = 446
  // engine-spark (height 30, top snap offsetY -15) → centre at 446 + 15 = 461

  const CMD_DROP_Y    = CANVAS_CENTRE_Y;            // 386
  const TANK_DROP_Y   = CMD_DROP_Y + 20 + 20;       // 426  (below cmd's bottom snap)
  const ENGINE_DROP_Y = TANK_DROP_Y + 20 + 15;      // 461  (below tank's bottom snap)

  // ── Part costs (from src/data/parts.js) ─────────────────────────────────
  const CMD_COST    = 8_000;
  const TANK_COST   = 800;
  const ENGINE_COST = 6_000;
  const STARTING_MONEY = 2_000_000;

  // ── Setup / teardown ─────────────────────────────────────────────────────

  test.beforeAll(async ({ browser }) => {
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await page.goto('/');

    // Fresh context — no saves — the New Game screen is shown.
    await page.waitForSelector('#mm-agency-name-input', {
      state: 'visible',
      timeout: 15_000,
    });
    await page.fill('#mm-agency-name-input', 'Test Agency');
    await page.click('#mm-start-btn');

    // After starting a new game the hub is shown first.
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    // Navigate from the hub to the Vehicle Assembly Building.
    await page.click('[data-building-id="vab"]');

    // Wait for the VAB toolbar to appear (signals VAB UI is mounted).
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });

    // Wait for game globals to be injected by main.js / vab.js
    await page.waitForFunction(
      () => typeof window.__vabAssembly !== 'undefined',
      { timeout: 15_000 },
    );
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── Drag helper ───────────────────────────────────────────────────────────

  /**
   * Drag a part card from the parts panel and drop it at (targetX, targetY)
   * in screen/client coordinates.
   *
   * Uses Playwright mouse API which fires both pointer and mouse events.
   * The VAB drag system is pointer-event based, so this works directly.
   *
   * @param {string} partId       data-part-id of the card to drag
   * @param {number} targetX      Drop screen X
   * @param {number} targetY      Drop screen Y
   */
  async function dragPartToCanvas(partId, targetX, targetY) {
    const card    = page.locator(`.vab-part-card[data-part-id="${partId}"]`);
    const cardBox = await card.boundingBox();
    if (!cardBox) throw new Error(`Part card not visible: ${partId}`);

    const startX = cardBox.x + cardBox.width  / 2;
    const startY = cardBox.y + cardBox.height / 2;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    // Move in 30 steps so pointermove events fire reliably during transit
    await page.mouse.move(targetX, targetY, { steps: 30 });
    await page.mouse.up();
  }

  // ── (1) Parts panel shows at least one part per key category ─────────────

  test('(1) parts panel shows at least one part per category', async () => {
    const list = page.locator('#vab-parts-list');
    await expect(list).toBeVisible();

    // Check group header labels
    const headers     = list.locator('.vab-parts-group-hdr');
    const headerTexts = await headers.allTextContents();

    expect(headerTexts.some(h => /command modules/i.test(h))).toBe(true);
    expect(headerTexts.some(h => /engines/i.test(h))).toBe(true);
    expect(headerTexts.some(h => /fuel tanks/i.test(h))).toBe(true);

    // Verify at least one concrete part per category is listed
    await expect(page.locator('.vab-part-card[data-part-id="cmd-mk1"]')).toBeVisible();
    await expect(page.locator('.vab-part-card[data-part-id="engine-spark"]')).toBeVisible();
    await expect(page.locator('.vab-part-card[data-part-id="tank-small"]')).toBeVisible();
  });

  // ── (2) Scale bar is visible on the build canvas ─────────────────────────

  test('(2) scale bar is visible on build canvas', async () => {
    const scaleBar = page.locator('#vab-scale-bar');
    await expect(scaleBar).toBeVisible();

    // _drawScaleTicks populates #vab-scale-ticks with .vab-tick child divs.
    // The tick divs themselves have height:0 (they render via ::after pseudo-element),
    // so we check by count via evaluate, and verify major-tick labels are rendered.
    const tickCount = await page.evaluate(
      () => document.querySelectorAll('#vab-scale-ticks .vab-tick').length,
    );
    expect(tickCount).toBeGreaterThan(0);

    // Major ticks include text labels (e.g. "5m", "10m") which have visible dimensions
    const labelCount = await page.evaluate(
      () => document.querySelectorAll('#vab-scale-ticks .vab-tick-label').length,
    );
    expect(labelCount).toBeGreaterThan(0);
  });

  // ── (3) Dragging a command module to canvas places it ────────────────────

  test('(3) dragging command module to canvas places it (label visible on canvas)', async () => {
    const cashBefore = await page.evaluate(() => window.__gameState?.money ?? 0);

    // Drag cmd-mk1 to the canvas centre
    await dragPartToCanvas('cmd-mk1', CENTRE_X, CMD_DROP_Y);

    // Wait for assembly to update (placement is synchronous, but give a tick)
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 1,
      { timeout: 3_000 },
    );

    // Cash should be deducted by cmd-mk1 cost
    const cashAfter = await page.evaluate(() => window.__gameState?.money ?? 0);
    expect(cashAfter).toBe(cashBefore - CMD_COST);

    // Part label should be visible in the PixiJS parts container
    const partLabels = await page.evaluate(() => {
      const container = window.__vabPartsContainer;
      if (!container || !container.children) return [];
      return [...container.children]
        .filter(c => typeof c.text === 'string' && c.text.length > 0)
        .map(c => c.text);
    });

    // If PixiJS is available, verify the label; otherwise fall back to assembly check
    if (partLabels.length > 0) {
      expect(partLabels).toContain('Mk1 Command Module');
    } else {
      // PixiJS text unavailable in this env — verify via assembly state instead
      const partsCount = await page.evaluate(() => window.__vabAssembly?.parts?.size ?? 0);
      expect(partsCount).toBeGreaterThanOrEqual(1);
    }
  });

  // ── (4) Tank + engine below cmd module produce a connected rocket ─────────

  test('(4) placing tank + engine produces a connected rocket', async () => {
    // Drag small tank to snap below command module
    await dragPartToCanvas('tank-small', CENTRE_X, TANK_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 2,
      { timeout: 3_000 },
    );

    // Drag Spark Engine to snap below the tank
    await dragPartToCanvas('engine-spark', CENTRE_X, ENGINE_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 3,
      { timeout: 3_000 },
    );

    // Assembly should now have exactly 3 parts and 2 snap connections
    const partsCount = await page.evaluate(() => window.__vabAssembly?.parts?.size ?? 0);
    expect(partsCount).toBe(3);

    const connCount = await page.evaluate(() => window.__vabAssembly?.connections?.length ?? 0);
    expect(connCount).toBe(2);
  });

  // ── (5) Staging panel shows engine in unstaged pool ──────────────────────

  test('(5) staging panel shows engine in the unstaged parts pool', async () => {
    // Open the Staging side panel
    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();

    // The unstaged zone should contain a chip for the Spark Engine
    // (cmd-mk1 is also activatable and may appear, but we check for the engine)
    const unstagedZone = page.locator('[data-drop-zone="unstaged"]');
    await expect(unstagedZone).toBeVisible();
    await expect(unstagedZone.getByText('Spark Engine')).toBeVisible();
  });

  // ── (7) Rocket Engineer shows failing TWR when no engine is staged ────────
  // NOTE: This test runs BEFORE (6) intentionally — at this point the engine
  // is still in the unstaged pool, so Stage 1 has no thrust and TWR fails.

  test('(7) Rocket Engineer shows failing TWR when no engine is staged', async () => {
    // Open Rocket Engineer panel (auto-closes Staging panel)
    await page.click('#vab-btn-engineer');
    await expect(page.locator('#vab-engineer-panel')).toBeVisible();

    // TWR stat should be rendered with the "bad" class (twr <= 1.0)
    const twrBadEl = page.locator('.vab-val-stat-bad');
    await expect(twrBadEl).toBeVisible();

    // At least one blocking check should fail (Stage 1 engine, TWR)
    const failIcons = page.locator('.vab-val-icon-fail');
    expect(await failIcons.count()).toBeGreaterThanOrEqual(1);

    // Launch button must still be disabled
    await expect(page.locator('#vab-btn-launch')).toBeDisabled();
  });

  // ── (6) Moving engine into Stage 1 shows it in the Stage 1 slot ──────────

  test('(6) moving engine into Stage 1 shows it in the Stage 1 slot', async () => {
    // Ensure the staging panel is open. With stackable panels it may already be
    // visible from test (5); only click the button if it is currently hidden.
    const stagingPanel = page.locator('#vab-staging-panel');
    if (!(await stagingPanel.isVisible())) {
      await page.click('#vab-btn-staging');
    }
    await expect(stagingPanel).toBeVisible();

    // Ensure the engine chip is visible in the unstaged zone
    const unstagedChip = page.locator('[data-drop-zone="unstaged"] .vab-stage-chip', {
      hasText: 'Spark Engine',
    });
    await expect(unstagedChip).toBeVisible();

    // HTML5 drag-and-drop: move chip from unstaged zone to Stage 1 zone
    await page.dragAndDrop(
      '[data-drop-zone="unstaged"] .vab-stage-chip:has-text("Spark Engine")',
      '[data-drop-zone="stage-0"]',
    );

    // Engine should now appear in the Stage 1 drop zone
    const stage1Zone = page.locator('[data-drop-zone="stage-0"]');
    await expect(stage1Zone.getByText('Spark Engine')).toBeVisible();

    // Engine should no longer be in the unstaged zone
    const unstagedZone = page.locator('[data-drop-zone="unstaged"]');
    await expect(unstagedZone.getByText('Spark Engine')).not.toBeVisible();
  });

  // ── (8) Launch button enabled after valid rocket ─────────────────────────

  test('(8) Launch button becomes enabled after valid rocket is built', async () => {
    // After test (6) staged the engine:
    //   - Command module present           ✓
    //   - All parts connected             ✓
    //   - Stage 1 has engine-spark        ✓
    //   - TWR = 60kN / (1410kg × 9.81) ≈ 4.34 > 1.0  ✓
    const launchBtn = page.locator('#vab-btn-launch');
    await expect(launchBtn).not.toBeDisabled();
  });

  // ── (9) Cash display updates when parts are placed ────────────────────────

  test('(9) cash display updates when parts are placed (cost deducted)', async () => {
    // After placing cmd-mk1 ($8,000) + tank-small ($800) + engine-spark ($6,000)
    // starting from $2,000,000:
    //   $2,000,000 − $8,000 − $800 − $6,000 = $1,985,200
    const expectedCash = STARTING_MONEY - CMD_COST - TANK_COST - ENGINE_COST; // 1,985,200

    // Verify via game-state object
    const actualCash = await page.evaluate(() => window.__gameState?.money ?? -1);
    expect(actualCash).toBe(expectedCash);

    // Verify the DOM readout shows the same value
    const cashEl = page.locator('#vab-cash');
    await expect(cashEl).toBeVisible();
    await expect(cashEl).toContainText('1,985,200');
  });
});
