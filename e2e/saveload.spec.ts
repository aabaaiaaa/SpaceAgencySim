import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

/* Node.js Buffer — declared locally since @types/node is not in e2e tsconfig */
type BufferLike = { toString(enc: string): string };
declare const Buffer: {
  isBuffer(obj: unknown): obj is BufferLike;
  from(data: Uint8Array): BufferLike;
  from(str: string, encoding: string): BufferLike;
  concat(list: BufferLike[]): BufferLike;
};
import {
  VP_W, VP_H,
  SAVE_KEY, STARTING_MONEY,
  buildSaveEnvelope, dismissWelcomeModal,
  dragPartToCanvas,
  seedIdb, seedIdbMulti,
  compressSaveString,
} from './helpers.js';

/**
 * E2E — Save & Load Flow
 *
 * Each test is independent — seeds its own state.
 */

const AGENCY_NAME = 'Test Agency';

function makeEnvelope(overrides: Record<string, unknown> = {}): ReturnType<typeof buildSaveEnvelope> {
  return buildSaveEnvelope({ agencyName: AGENCY_NAME, ...overrides });
}

async function openTopbarSaveDialog(page: Page): Promise<void> {
  await page.click('#topbar-menu-btn');
  await expect(page.locator('#topbar-dropdown')).toBeVisible({ timeout: 5_000 });
  await page.locator('#topbar-dropdown').getByText('Save Game').click();
  await expect(page.locator('#save-modal-backdrop')).toBeVisible({ timeout: 5_000 });
}

/** Start a new game and navigate to VAB. */
async function startNewGameAndGoToVab(page: Page): Promise<void> {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  await page.goto('/');
  await page.waitForSelector('#mm-agency-name-input', { state: 'visible', timeout: 10_000 });
  await page.fill('#mm-agency-name-input', AGENCY_NAME);
  await page.click('#mm-start-btn');
  await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
  await dismissWelcomeModal(page);
  await page.click('[data-building-id="vab"]');
  await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 10_000 });
}

/** Seed a save in slot 0 via IndexedDB and navigate to the load screen. */
async function seedSaveAndGoToLoadScreen(page: Page, envelope: ReturnType<typeof buildSaveEnvelope>): Promise<void> {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  await page.goto('/');
  await seedIdb(page, SAVE_KEY, compressSaveString(JSON.stringify(envelope)));
  await page.goto('/');
  await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });
}

test.describe('Save & Load Flow', () => {

  test('(1) opening the topbar menu and clicking Save Game shows a slot picker with 5 slots', async ({ page }) => {
    await startNewGameAndGoToVab(page);
    await openTopbarSaveDialog(page);

    const slots = page.locator('.save-slot-card');
    await expect(slots).toHaveCount(5, { timeout: 5_000 });
    for (let i = 0; i < 5; i++) {
      await expect(page.locator(`[data-testid="save-slot-${i}"]`)).toBeVisible({ timeout: 5_000 });
    }
  });

  test('(2) saving to slot 0 succeeds and the modal closes', async ({ page }) => {
    await startNewGameAndGoToVab(page);
    await openTopbarSaveDialog(page);
    await page.click('[data-testid="save-slot-0"]');
    await expect(page.locator('#save-modal-backdrop')).toHaveCount(0, { timeout: 4_000 });
  });

  test('(3) navigating to the app root shows load screen with save, agency name, and stats', async ({ page }) => {
    await seedSaveAndGoToLoadScreen(page, makeEnvelope());

    await expect(page.locator('[data-screen="load"]')).toBeVisible({ timeout: 5_000 });
    const slot0Card = page.locator('.mm-save-card[data-slot="0"]:not(.mm-empty-slot)');
    await expect(slot0Card).toBeVisible({ timeout: 5_000 });
    await expect(slot0Card).toContainText(AGENCY_NAME, { timeout: 5_000 });
    await expect(slot0Card).toContainText('2,000,000', { timeout: 5_000 });

    const missionsStat = slot0Card.locator('.mm-stat').filter({ hasText: /missions done/i });
    await expect(missionsStat).toContainText('0', { timeout: 5_000 });
  });

  test('(4) clicking Load on the saved slot returns to the hub with the correct game state', async ({ page }) => {
    await seedSaveAndGoToLoadScreen(page, makeEnvelope());

    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });

    const agencyName: string | undefined = await page.evaluate(
      () => window.__gameState?.agencyName,
    );
    expect(agencyName).toBe(AGENCY_NAME);

    const money: number | undefined = await page.evaluate(
      () => window.__gameState?.money,
    );
    expect(money).toBe(STARTING_MONEY);
  });

  test('(5) deleting a save slot removes it from the load screen list', async ({ page }) => {
    // Seed TWO saves so deleting one doesn't empty the list.
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await page.goto('/');
    await seedIdbMulti(page, [
      { key: 'spaceAgencySave_0', value: compressSaveString(JSON.stringify(makeEnvelope({ saveName: 'Save A' }))) },
      { key: 'spaceAgencySave_1', value: compressSaveString(JSON.stringify(makeEnvelope({ saveName: 'Save B' }))) },
    ]);
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });

    await expect(page.locator('.mm-save-card:not(.mm-empty-slot)[data-slot="0"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.mm-save-card:not(.mm-empty-slot)[data-slot="1"]')).toBeVisible({ timeout: 5_000 });

    await page.click('[data-action="delete"][data-slot="0"]');
    await page.waitForSelector('#mm-modal-confirm', { state: 'visible', timeout: 5_000 });
    await page.click('#mm-modal-confirm');

    await expect(page.locator('.mm-save-card.mm-empty-slot[data-slot="0"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.mm-save-card:not(.mm-empty-slot)[data-slot="1"]')).toBeVisible({ timeout: 5_000 });
  });

  test('(6) after deleting the only save, navigating to the app root shows the New Game screen', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });
    // Seed IDB after page loads to establish origin.
    await page.goto('/');
    await page.waitForSelector('#mm-newgame-screen', { state: 'visible', timeout: 10_000 });
    await seedIdb(page, SAVE_KEY, compressSaveString(JSON.stringify(makeEnvelope())));

    // Reload to pick up the seeded save.
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });

    await page.click('[data-action="delete"][data-slot="0"]');
    await page.waitForSelector('#mm-modal-confirm', { state: 'visible', timeout: 5_000 });
    await page.click('#mm-modal-confirm');

    // Navigate again — no saves remain, so New Game screen must appear.
    await page.goto('/');
    await page.waitForSelector('#mm-newgame-screen', { state: 'visible', timeout: 10_000 });
    await expect(page.locator('[data-screen="newgame"]')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('#mm-load-screen')).toHaveCount(0, { timeout: 5_000 });
  });

  test('(7) exporting a save produces a binary envelope download with SASV magic bytes', async ({ page }) => {
    await seedSaveAndGoToLoadScreen(page, makeEnvelope());

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.click('[data-action="export"][data-slot="0"]'),
    ]);

    const stream = await download.createReadStream();
    const chunks: BufferLike[] = [];
    for await (const chunk of stream!) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as Uint8Array));
    }
    const rawContent: string = Buffer.concat(chunks).toString('utf-8');
    expect(rawContent.length).toBeGreaterThan(0);

    // Export uses binary envelope format: base64-encoded with SASV magic bytes.
    const decoded: BufferLike = Buffer.from(rawContent, 'base64');
    const header: string = decoded.toString('binary').slice(0, 4);
    expect(header).toBe('SASV');
  });

  test('(8) VAB rocket assembly persists across save/load cycle', async ({ page }) => {
    await startNewGameAndGoToVab(page);

    // Disable auto-zoom.
    await page.evaluate(() => {
      const chk = document.getElementById('vab-chk-autozoom') as HTMLInputElement | null;
      if (chk && chk.checked) { chk.checked = false; chk.dispatchEvent(new Event('change')); }
      const slider = document.getElementById('vab-zoom-slider') as HTMLInputElement | null;
      if (slider) { slider.value = '1'; slider.dispatchEvent(new Event('input')); }
    });

    await page.waitForSelector('.vab-part-card[data-part-id="probe-core-mk1"]', { state: 'visible', timeout: 5_000 });
    await dragPartToCanvas(page, 'probe-core-mk1', 525, 400);
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 1,
      { timeout: 5_000 },
    );

    const sizeBefore: number = await page.evaluate(
      () => window.__vabAssembly?.parts?.size ?? 0,
    );
    expect(sizeBefore).toBeGreaterThanOrEqual(1);

    await openTopbarSaveDialog(page);
    await page.click('[data-testid="save-slot-0"]');
    await expect(page.locator('#save-modal-backdrop')).toHaveCount(0, { timeout: 4_000 });

    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });

    await page.click('[data-building-id="vab"]');
    await page.waitForSelector('#vab-btn-launch', { state: 'visible', timeout: 10_000 });
    await page.waitForFunction(
      () => (window.__vabAssembly?.parts?.size ?? 0) >= 1,
      { timeout: 5_000 },
    );

    const sizeAfter: number = await page.evaluate(
      () => window.__vabAssembly?.parts?.size ?? 0,
    );
    expect(sizeAfter).toBeGreaterThanOrEqual(1);

    const hasProbe: boolean = await page.evaluate(() => {
      for (const p of window.__vabAssembly?.parts?.values() ?? []) {
        if (p.partId === 'probe-core-mk1') return true;
      }
      return false;
    });
    expect(hasProbe).toBe(true);
  });

  test('(9) incompatible save slot is grayed out with "(Incompatible)" text and no Load action in topbar load dialog', async ({ page }) => {
    // Seed slot 0 with a current-version save (so we can load into the game),
    // and slot 1 with an old-version save (to verify incompatibility display).
    const currentEnvelope = makeEnvelope({ saveName: 'Current Save' });
    const oldEnvelope = makeEnvelope({ saveName: 'Old Save', version: 3 });

    await page.setViewportSize({ width: VP_W, height: VP_H });
    await page.goto('/');
    await seedIdbMulti(page, [
      { key: 'spaceAgencySave_0', value: compressSaveString(JSON.stringify(currentEnvelope)) },
      { key: 'spaceAgencySave_1', value: compressSaveString(JSON.stringify(oldEnvelope)) },
    ]);

    // Reload to pick up the seeded saves.
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });
    await page.click('[data-action="load"][data-slot="0"]');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });

    // Open the topbar Load Game dialog.
    await page.click('#topbar-menu-btn');
    await expect(page.locator('#topbar-dropdown')).toBeVisible({ timeout: 5_000 });
    await page.locator('#topbar-dropdown').getByText('Load Game').click();
    await expect(page.locator('#load-modal-backdrop')).toBeVisible({ timeout: 5_000 });

    // Slot 1 should be visible in the load dialog.
    const slot1 = page.locator('[data-testid="load-slot-1"]');
    await expect(slot1).toBeVisible({ timeout: 5_000 });

    // The slot should show the save name with "(Incompatible)" appended.
    await expect(slot1.locator('strong')).toContainText('Old Save', { timeout: 5_000 });
    await expect(slot1.locator('strong')).toContainText('(Incompatible)', { timeout: 5_000 });

    // The slot should have the grayed-out incompatible class.
    await expect(slot1).toHaveClass(/save-slot-incompatible/, { timeout: 5_000 });

    // The action tag should say "Incompatible" instead of "Load".
    const actionTag = slot1.locator('.save-slot-action-tag');
    await expect(actionTag).toHaveText('Incompatible', { timeout: 5_000 });

    // Slot 0 (current version) should NOT be incompatible — sanity check.
    const slot0 = page.locator('[data-testid="load-slot-0"]');
    await expect(slot0).not.toHaveClass(/save-slot-incompatible/, { timeout: 5_000 });
    await expect(slot0.locator('.save-slot-action-tag')).toHaveText('Load', { timeout: 5_000 });
  });

  test('(10) incompatible save version shows warning badge and blocks loading @smoke', async ({ page }) => {
    // Inject a save with version: 1 (incompatible) into slot 0.
    const oldEnvelope = makeEnvelope({ saveName: 'Old Save', version: 1 });

    await page.setViewportSize({ width: VP_W, height: VP_H });
    await page.goto('/');
    await seedIdb(page, 'spaceAgencySave_0', compressSaveString(JSON.stringify(oldEnvelope)));
    await page.goto('/');
    await page.waitForSelector('#mm-load-screen', { state: 'visible', timeout: 10_000 });

    // Verify the version warning badge is visible on slot 0.
    const slot0Card = page.locator('.mm-save-card[data-slot="0"]');
    await expect(slot0Card).toBeVisible({ timeout: 5_000 });
    const warning = slot0Card.locator('[data-testid="version-warning"]');
    await expect(warning).toBeVisible({ timeout: 5_000 });

    // Click Load and verify the game does NOT start.
    await page.click('[data-action="load"][data-slot="0"]');

    // The load screen should remain visible (game did not start).
    await expect(page.locator('#mm-load-screen')).toBeVisible({ timeout: 5_000 });
    // The hub overlay should NOT appear (game did not load).
    await expect(page.locator('#hub-overlay')).toHaveCount(0, { timeout: 3_000 });
  });
});
