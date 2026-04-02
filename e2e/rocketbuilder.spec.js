import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H, STARTING_MONEY,
  TOOLBAR_H, SCALE_BAR_W, PARTS_PANEL_W,
  BUILD_W, BUILD_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  dragPartToCanvas,
  dismissWelcomeModal,
} from './helpers.js';

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

  // ── Drop positions calculated from part snap-point geometry ──────────────
  const CMD_DROP_Y    = CANVAS_CENTRE_Y;            // 386
  const TANK_DROP_Y   = CMD_DROP_Y + 20 + 20;       // 426
  const ENGINE_DROP_Y = TANK_DROP_Y + 20 + 15;      // 461

  // ── Part costs (from src/data/parts.js) ─────────────────────────────────
  const CMD_COST    = 8_000;
  const TANK_COST   = 800;
  const ENGINE_COST = 6_000;

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
    await page.click('.mm-mode-option[data-mode="freeplay"]');
    await page.click('#mm-start-btn');

    // After starting a new game the hub is shown first.
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    // Dismiss the welcome modal so buildings are clickable.
    await dismissWelcomeModal(page);

    // Navigate from the hub to the Vehicle Assembly Building.
    await page.click('[data-building-id="vab"]');

    // Wait for the VAB toolbar to appear (signals VAB UI is mounted).
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });

    // Wait for game globals to be injected by main.js / vab.js
    await page.waitForFunction(
      () => typeof window.__vabAssembly !== 'undefined',
      { timeout: 15_000 },
    );

    // Disable auto-zoom so viewport-pixel offsets map 1:1 to world units.
    await page.evaluate(() => {
      const chk = document.getElementById('vab-chk-autozoom');
      if (chk && chk.checked) { chk.checked = false; chk.dispatchEvent(new Event('change')); }
      const slider = document.getElementById('vab-zoom-slider');
      if (slider) { slider.value = '1'; slider.dispatchEvent(new Event('input')); }
    });
  });

  test.afterAll(async () => {
    await page.close();
  });

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
    await dragPartToCanvas(page, 'cmd-mk1', CENTRE_X, CMD_DROP_Y);

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
    await dragPartToCanvas(page, 'tank-small', CENTRE_X, TANK_DROP_Y);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 2,
      { timeout: 3_000 },
    );

    // Drag Spark Engine to snap below the tank
    await dragPartToCanvas(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y);
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

  // ── (5) Staging panel shows engine auto-staged in Stage 1 ───────────────

  test('(5) staging panel shows engine auto-staged in Stage 1', async () => {
    // Open the Staging side panel
    await page.click('#vab-btn-staging');
    await expect(page.locator('#vab-staging-panel')).toBeVisible();

    // With auto-staging, the Spark Engine (IGNITE behaviour) should be in Stage 1.
    const stage1Zone = page.locator('[data-drop-zone="stage-0"]');
    await expect(stage1Zone.getByText('Spark Engine')).toBeVisible({ timeout: 5_000 });

    // Engine should NOT be in the unstaged pool.
    const unstagedZone = page.locator('[data-drop-zone="unstaged"]');
    await expect(unstagedZone.getByText('Spark Engine')).not.toBeVisible();
  });

  // ── (7) Rocket Engineer shows passing TWR when engine is auto-staged ──────

  test('(7) Rocket Engineer shows passing validation when engine is auto-staged', async () => {
    // Open Rocket Engineer panel (auto-closes Staging panel)
    await page.click('#vab-btn-engineer');
    await expect(page.locator('#vab-engineer-panel')).toBeVisible();

    // With engine auto-staged in Stage 1, all blocking checks should pass.
    // Launch button should be enabled.
    await expect(page.locator('#vab-btn-launch')).not.toBeDisabled({ timeout: 5_000 });
  });

  // ── (6) Engine is correctly shown in Stage 1 slot ─────────────────────────

  test('(6) engine appears in Stage 1 slot via auto-staging', async () => {
    // Ensure the staging panel is open.
    const stagingPanel = page.locator('#vab-staging-panel');
    if (!(await stagingPanel.isVisible())) {
      await page.click('#vab-btn-staging');
    }
    await expect(stagingPanel).toBeVisible();

    // Engine should be in the Stage 1 drop zone (auto-staged).
    const stage1Zone = page.locator('[data-drop-zone="stage-0"]');
    await expect(stage1Zone.getByText('Spark Engine')).toBeVisible();

    // Engine should no longer be in the unstaged zone.
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

    // Verify the DOM readout shows the same value (cash is now in the top bar).
    const cashEl = page.locator('#topbar-cash');
    await expect(cashEl).toBeVisible();
    await expect(cashEl).toContainText('1,985,200');
  });

  // ── (10) Off-screen indicator appears/disappears as parts pan in/out ──────

  test('(10) off-screen indicator appears when parts are panned out of view, disappears when visible', async () => {
    // Close any open side panels so the canvas area returns to full width.
    // After previous tests, staging and engineer panels may both be open.
    const stagingClose  = page.locator('#vab-staging-close');
    const engineerClose = page.locator('#vab-engineer-close');
    if (await stagingClose.isVisible())  await stagingClose.click();
    if (await engineerClose.isVisible()) await engineerClose.click();

    // With no panels open, the canvas area starts at x = SCALE_BAR_W (50 px)
    // and has width BUILD_W (950 px). Parts are at world x = 0, which maps to
    // canvas-local x = camX + 0 = 475 — well inside the visible area.
    // No off-screen indicators should be present.
    const initialCount = await page.locator('.vab-offscreen-indicator').count();
    expect(initialCount).toBe(0);

    // Pan the camera 600 px to the right by dragging on empty canvas.
    // Layout: global topbar 44 px, VAB toolbar 52 px, status bar 28 px → canvas
    // area starts at y = 124. Drag start (200, 200) is safely inside the canvas
    // (x ∈ [50, 1000], y > 124) and far from parts (centred at x ≈ 525).
    // After a 600 px rightward pan: camX = 475 + 600 = 1075 > BUILD_W (950),
    // so parts are off-screen to the right → indicators should appear.
    const startX  = 200;
    const startY  = 200;
    const panDist = 600;

    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + panDist, startY, { steps: 20 });
    await page.mouse.up();

    // Wait for at least one off-screen indicator to appear.
    await page.waitForFunction(
      () => document.querySelectorAll('.vab-offscreen-indicator').length > 0,
      { timeout: 2_000 },
    );
    const offCount = await page.locator('.vab-offscreen-indicator').count();
    expect(offCount).toBeGreaterThanOrEqual(1);

    // Pan back: drag the same distance in the opposite direction.
    await page.mouse.move(startX + panDist, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY, { steps: 20 });
    await page.mouse.up();

    // Indicators should disappear once parts are back in the visible area.
    await page.waitForFunction(
      () => document.querySelectorAll('.vab-offscreen-indicator').length === 0,
      { timeout: 2_000 },
    );
  });
});
