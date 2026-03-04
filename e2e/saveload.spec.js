import { test, expect } from '@playwright/test';
import { STARTING_MONEY, dragPartToCanvas } from './helpers.js';

/**
 * E2E — Save & Load Flow
 *
 * Tests the full save/load cycle: saving from the topbar hamburger menu
 * "Save Game" slot picker, verifying the load screen, loading a save back,
 * deleting saves, and exporting.
 *
 * Tests run in serial order on a shared page instance so each test builds on
 * the state established by the previous one.
 *
 * Execution order:
 *   Setup  : New Game → enter agency name → reach VAB
 *   (1)    : Topbar Menu → Save Game shows slot picker with 5 slots
 *   (2)    : Save to slot 0 → modal closes
 *   (3)    : Navigate to '/' → load screen lists the save with agency name & stats
 *   (7)    : Export save → file download is valid JSON containing a money field
 *   (4)    : Click Load → back at hub with correct game state
 *   (5)    : Save slot 1, navigate to '/', delete slot 0 → removed from list
 *   (6)    : Delete slot 1 → navigate to '/' → New Game screen shown
 *   (8)    : VAB rocket assembly persists across save/load cycle
 */

test.describe.configure({ mode: 'serial' });

test.describe('Save & Load Flow', () => {
  /** @type {import('@playwright/test').Page} */
  let page;

  const AGENCY_NAME    = 'Test Agency';

  // ── Setup ──────────────────────────────────────────────────────────────────

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60_000);
    page = await browser.newPage();
    await page.goto('/');

    // Fresh context — no saves — New Game screen is shown.
    await page.waitForSelector('#mm-agency-name-input', {
      state: 'visible',
      timeout: 15_000,
    });
    await page.fill('#mm-agency-name-input', AGENCY_NAME);
    await page.click('#mm-start-btn');

    // After starting a new game the hub is shown first.
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    // Navigate from the hub to the Vehicle Assembly Building.
    await page.click('[data-building-id="vab"]');

    // Wait for the VAB to load.
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.__gameState !== 'undefined',
      { timeout: 15_000 },
    );
  });

  test.afterAll(async () => {
    await page.close();
  });

  // ── Helper: open the topbar Save Game slot picker ────────────────────────

  async function openTopbarSaveDialog() {
    await page.click('[data-testid="topbar-menu-btn"]');
    await expect(page.locator('#topbar-dropdown')).toBeVisible();
    await page.locator('#topbar-dropdown button').filter({ hasText: 'Save Game' }).click();
    await expect(page.locator('#save-modal-backdrop')).toBeVisible();
  }

  // ── (1) Topbar Menu → Save Game shows a slot picker with 5 slots ────────

  test('(1) opening the topbar menu and clicking Save Game shows a slot picker with 5 slots', async () => {
    await openTopbarSaveDialog();

    // Exactly 5 slot cards must be rendered.
    const slots = page.locator('.save-slot-card');
    await expect(slots).toHaveCount(5);

    // Each slot index 0–4 should have a corresponding card.
    for (let i = 0; i < 5; i++) {
      await expect(page.locator(`[data-testid="save-slot-${i}"]`)).toBeVisible();
    }
  });

  // ── (2) Saving to slot 0 succeeds and the modal closes ────────────────────

  test('(2) saving to slot 0 succeeds and the modal closes', async () => {
    // Modal is still open from test (1).
    await expect(page.locator('#save-modal-backdrop')).toBeVisible();

    // Click slot 0 — the topbar save is immediate (no name input or confirm).
    await page.click('[data-testid="save-slot-0"]');

    // The modal should close after saving.
    await expect(page.locator('#save-modal-backdrop')).toHaveCount(0, { timeout: 4_000 });
  });

  // ── (3) Navigating to app root shows load screen with the save ─────────────

  test('(3) navigating to the app root shows load screen with save, agency name, and stats', async () => {
    await page.goto('/');

    // The main-menu overlay should display the load screen (save exists).
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });
    await expect(page.locator('[data-screen="load"]')).toBeVisible();

    // The save card for slot 0 should be present and populated.
    const slot0Card = page.locator('.mm-save-card[data-slot="0"]:not(.mm-empty-slot)');
    await expect(slot0Card).toBeVisible();

    // Save name should be the agency name (topbar uses agency name automatically).
    await expect(slot0Card).toContainText(AGENCY_NAME);

    // Cash — $2,000,000 (displayed as "2,000,000" somewhere in the card).
    await expect(slot0Card).toContainText('2,000,000');

    // Missions completed should be 0.
    const missionsStat = slot0Card.locator('.mm-stat').filter({ hasText: /missions done/i });
    await expect(missionsStat).toContainText('0');
  });

  // ── (7) Exporting a save produces a file download that is valid JSON ────────
  // (Placed here so a save already exists in slot 0 and we are on the load screen.)

  test('(7) exporting a save produces a file download that is valid JSON containing a money field', async () => {
    // Should be on the load screen from test (3).
    await expect(page.locator('#mm-load-screen')).toBeVisible();

    // Intercept the download before clicking.
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-action="export"][data-slot="0"]'),
    ]);

    // Read the downloaded file as text.
    const stream  = await download.createReadStream();
    const chunks  = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const rawJson = Buffer.concat(chunks).toString('utf-8');

    // The content must be valid JSON.
    let parsed;
    expect(() => { parsed = JSON.parse(rawJson); }).not.toThrow();

    // The envelope must contain a state object with a numeric money field.
    expect(parsed).toHaveProperty('state');
    expect(parsed.state).toHaveProperty('money');
    expect(typeof parsed.state.money).toBe('number');
  });

  // ── (4) Clicking Load returns to the hub with the correct game state ────────

  test('(4) clicking Load on the saved slot returns to the hub with the correct game state', async () => {
    // Should still be on the load screen from test (3) / (7).
    await expect(page.locator('#mm-load-screen')).toBeVisible();

    // Click Load on slot 0.
    await page.click('[data-action="load"][data-slot="0"]');

    // Loading a game returns to the hub first (not directly to VAB).
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
    await page.waitForFunction(
      () => typeof window.__gameState !== 'undefined',
      { timeout: 15_000 },
    );

    // Agency name must match.
    const agencyName = await page.evaluate(() => window.__gameState?.agencyName);
    expect(agencyName).toBe(AGENCY_NAME);

    // Money must match starting balance ($2,000,000).
    const money = await page.evaluate(() => window.__gameState?.money);
    expect(money).toBe(STARTING_MONEY);

    // Navigate to the VAB so test (5) can use the save controls there.
    await page.click('[data-building-id="vab"]');
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });
  });

  // ── (5) Deleting a save slot removes it from the load screen list ───────────

  test('(5) deleting a save slot removes it from the load screen list', async () => {
    // We are back at the VAB after test (4).  First save a second slot so that
    // deleting slot 0 does not empty the list entirely (which would switch
    // directly to the New Game screen, skipping the load-screen assertion).
    await openTopbarSaveDialog();

    // Click slot 1 to save immediately.
    await page.click('[data-testid="save-slot-1"]');
    await expect(page.locator('#save-modal-backdrop')).toHaveCount(0, { timeout: 4_000 });

    // Navigate to the root — load screen should list both slot 0 and slot 1.
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });
    await expect(page.locator('.mm-save-card:not(.mm-empty-slot)[data-slot="0"]')).toBeVisible();
    await expect(page.locator('.mm-save-card:not(.mm-empty-slot)[data-slot="1"]')).toBeVisible();

    // Delete slot 0.
    await page.click('[data-action="delete"][data-slot="0"]');

    // Confirm the deletion in the modal.
    await page.waitForSelector('#mm-modal-confirm', { state: 'visible', timeout: 5_000 });
    await page.click('#mm-modal-confirm');

    // Slot 0 should now show as an empty slot; slot 1 must remain populated.
    await expect(page.locator('.mm-save-card.mm-empty-slot[data-slot="0"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.mm-save-card:not(.mm-empty-slot)[data-slot="1"]')).toBeVisible();
  });

  // ── (6) After deleting the only save, app root shows the New Game screen ───

  test('(6) after deleting the only save, navigating to the app root shows the New Game screen', async () => {
    // Currently on the load screen with slot 1 as the only remaining save.
    await expect(page.locator('#mm-load-screen')).toBeVisible();

    // Delete slot 1 (the last save).
    await page.click('[data-action="delete"][data-slot="1"]');
    await page.waitForSelector('#mm-modal-confirm', { state: 'visible', timeout: 5_000 });
    await page.click('#mm-modal-confirm');

    // Navigate to the root — no saves remain so the New Game screen must appear.
    await page.goto('/');
    await page.waitForSelector('#mm-newgame-screen', { state: 'visible', timeout: 15_000 });
    await expect(page.locator('[data-screen="newgame"]')).toBeVisible();

    // The load screen must not be present.
    await expect(page.locator('#mm-load-screen')).toHaveCount(0);
  });

  // ── (8) VAB rocket assembly persists across save/load cycle ───────────────

  test('(8) VAB rocket assembly persists across save/load cycle', async () => {
    // We are on the New Game screen after test (6) deleted all saves.
    await expect(page.locator('#mm-newgame-screen')).toBeVisible();

    // Start a new game.
    await page.fill('#mm-agency-name-input', 'Persist Test');
    await page.click('#mm-start-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    // Navigate to the VAB.
    await page.click('[data-building-id="vab"]');
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });

    // ── Place a part onto the canvas ──────────────────────────────────────
    await dragPartToCanvas(page, 'cmd-mk1', 525, 400);

    // Wait for the part to be registered.
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 1,
      { timeout: 5_000 },
    );

    // Verify part is placed.
    const sizeBefore = await page.evaluate(() => window.__vabAssembly.parts.size);
    expect(sizeBefore).toBeGreaterThanOrEqual(1);

    // ── Save the game from the topbar menu ──────────────────────────────
    await openTopbarSaveDialog();

    // Click slot 0 to save immediately.
    await page.click('[data-testid="save-slot-0"]');
    await expect(page.locator('#save-modal-backdrop')).toHaveCount(0, { timeout: 4_000 });

    // ── Full page reload to clear in-memory state ─────────────────────────
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 15_000 });

    // ── Load the save ─────────────────────────────────────────────────────
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });

    // ── Navigate to the VAB ───────────────────────────────────────────────
    await page.click('[data-building-id="vab"]');
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 15_000 });

    // Wait for the assembly to be restored.
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 1,
      { timeout: 5_000 },
    );

    // ── Verify the part survived the save/load cycle ──────────────────────
    const sizeAfter = await page.evaluate(() => window.__vabAssembly.parts.size);
    expect(sizeAfter).toBeGreaterThanOrEqual(1);

    // Verify the correct part type was restored.
    const hasCmd = await page.evaluate(() => {
      for (const p of window.__vabAssembly.parts.values()) {
        if (p.partId === 'cmd-mk1') return true;
      }
      return false;
    });
    expect(hasCmd).toBe(true);
  });
});
