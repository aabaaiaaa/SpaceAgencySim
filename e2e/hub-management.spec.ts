/**
 * hub-management.spec.ts — E2E tests for the hub management panel.
 *
 * Verifies:
 *   - Panel displays correct info for Earth hub (name, body, type, status,
 *     facilities, crew, maintenance)
 *   - Hub rename updates the switcher dropdown
 *   - Duplicate name rejection with error message
 */

import { test, expect } from '@playwright/test';
import {
  buildSaveEnvelope,
  seedAndLoadSave,
  getGameState,
  buildHub,
  buildCrewMember,
  ALL_FACILITIES,
  dismissWelcomeModal,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Earth hub definition with all facilities, reusable across tests. */
function earthHub() {
  return {
    id: 'earth',
    name: 'Earth HQ',
    type: 'surface' as const,
    bodyId: 'EARTH',
    coordinates: { x: 0, y: 0 },
    facilities: { ...ALL_FACILITIES },
    tourists: [],
    partInventory: [],
    constructionQueue: [],
    maintenanceCost: 0,
    established: 0,
    online: true,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Hub Management Panel', () => {

  test('@smoke Earth hub panel display and rename', async ({ page }) => {
    const crew1 = buildCrewMember({ id: 'crew-1', name: 'Alice', stationedHubId: 'earth' });
    const crew2 = buildCrewMember({ id: 'crew-2', name: 'Bob', stationedHubId: 'earth' });

    const moonHub = buildHub({
      id: 'moon-base',
      name: 'Lunar Outpost',
      bodyId: 'MOON',
      online: true,
      facilities: { 'crew-hab': { built: true, tier: 1 } },
      maintenanceCost: 10_000,
    });

    const save = buildSaveEnvelope({
      hubs: [earthHub(), moonHub],
      activeHubId: 'earth',
      crew: [crew1, crew2],
    });

    await seedAndLoadSave(page, save);
    await dismissWelcomeModal(page);

    // Hub switcher should be visible (2 hubs)
    const switcher = page.locator('#hub-switcher');
    await expect(switcher).toBeVisible({ timeout: 5_000 });

    // Open the management panel via the gear button.
    // The gear button sits behind the top bar (z-index layering), so we use
    // evaluate to dispatch the click directly instead of Playwright's native
    // click which checks for pointer-event interception.
    await page.waitForSelector('#hub-switcher-gear', { state: 'attached', timeout: 5_000 });
    await page.evaluate(() => {
      document.getElementById('hub-switcher-gear')!.click();
    });

    // Wait for the panel backdrop to appear
    const backdrop = page.locator('#hub-mgmt-backdrop');
    await expect(backdrop).toBeVisible({ timeout: 5_000 });

    // -- Name input shows "Earth HQ" --
    const nameInput = page.locator('.hub-mgmt-name-input');
    await expect(nameInput).toBeVisible({ timeout: 5_000 });
    await expect(nameInput).toHaveValue('Earth HQ', { timeout: 5_000 });

    // -- Info grid: Body = "Earth" --
    const infoValues = page.locator('.hub-mgmt-info-value');
    await expect(infoValues.filter({ hasText: 'Earth' }).first()).toBeVisible({ timeout: 5_000 });

    // -- Info grid: Type = "Surface" --
    await expect(infoValues.filter({ hasText: 'Surface' }).first()).toBeVisible({ timeout: 5_000 });

    // -- Status = "Online" with the correct class --
    const statusBadge = page.locator('.hub-mgmt-status');
    await expect(statusBadge).toBeVisible({ timeout: 5_000 });
    await expect(statusBadge).toHaveText('Online', { timeout: 5_000 });
    await expect(statusBadge).toHaveClass(/hub-mgmt-status--online/, { timeout: 5_000 });

    // -- Facilities list shows 9 items (ALL_FACILITIES has 9 keys) --
    const facilityItems = page.locator('.hub-mgmt-facility-item');
    await expect(facilityItems).toHaveCount(9, { timeout: 5_000 });

    // -- Crew count --
    const populationSection = page.locator('.hub-mgmt-population').first();
    await expect(populationSection).toContainText('Crew: 2', { timeout: 5_000 });

    // -- Crew names shown (count < 10) --
    const crewNames = page.locator('.hub-mgmt-crew-names');
    await expect(crewNames).toBeVisible({ timeout: 5_000 });
    await expect(crewNames).toContainText('Alice', { timeout: 5_000 });
    await expect(crewNames).toContainText('Bob', { timeout: 5_000 });

    // -- Maintenance = "$0" (Earth hub has 0 maintenance) --
    const economyValues = page.locator('.hub-mgmt-economy-value');
    await expect(economyValues.filter({ hasText: '$0' }).first()).toBeVisible({ timeout: 5_000 });

    // -- Rename to "Mission HQ" --
    await nameInput.clear();
    await nameInput.fill('Mission HQ');
    // Trigger blur to commit the rename (press Enter which triggers blur)
    await nameInput.press('Enter');

    // Verify no error message
    const nameError = page.locator('.hub-mgmt-name-error');
    await expect(nameError).toHaveText('', { timeout: 5_000 });

    // Close the panel
    const closeBtn = page.locator('.hub-mgmt-close');
    await closeBtn.click();
    await expect(backdrop).toBeHidden({ timeout: 5_000 });

    // Verify the hub switcher dropdown updated to show the new name
    const earthOption = switcher.locator('option[value="earth"]');
    await expect(earthOption).toContainText('Mission HQ', { timeout: 5_000 });

    // Verify game state was updated
    const state = await getGameState(page);
    const hubs = state?.hubs as Array<{ id: string; name: string }>;
    const earthState = hubs.find(h => h.id === 'earth');
    expect(earthState?.name).toBe('Mission HQ');
  });

  test('duplicate name rejection', async ({ page }) => {
    const moonHub = buildHub({
      id: 'moon-base',
      name: 'Lunar Outpost',
      bodyId: 'MOON',
      online: true,
      facilities: { 'crew-hab': { built: true, tier: 1 } },
    });

    const save = buildSaveEnvelope({
      hubs: [earthHub(), moonHub],
      activeHubId: 'earth',
    });

    await seedAndLoadSave(page, save);
    await dismissWelcomeModal(page);

    // Open the management panel (gear button behind topbar z-index, use evaluate)
    await page.waitForSelector('#hub-switcher-gear', { state: 'attached', timeout: 5_000 });
    await page.evaluate(() => {
      document.getElementById('hub-switcher-gear')!.click();
    });

    const backdrop = page.locator('#hub-mgmt-backdrop');
    await expect(backdrop).toBeVisible({ timeout: 5_000 });

    // Try renaming Earth hub to the Moon hub's name (case-insensitive)
    const nameInput = page.locator('.hub-mgmt-name-input');
    await expect(nameInput).toHaveValue('Earth HQ', { timeout: 5_000 });

    await nameInput.clear();
    await nameInput.fill('lunar outpost');
    await nameInput.press('Enter');

    // Verify the error message is shown
    const nameError = page.locator('.hub-mgmt-name-error');
    await expect(nameError).not.toHaveText('', { timeout: 5_000 });
    await expect(nameError).toBeVisible({ timeout: 5_000 });

    // Verify the input was reverted to the original name
    await expect(nameInput).toHaveValue('Earth HQ', { timeout: 5_000 });

    // Verify game state was NOT changed
    const state = await getGameState(page);
    const hubs = state?.hubs as Array<{ id: string; name: string }>;
    const earthState = hubs.find(h => h.id === 'earth');
    expect(earthState?.name).toBe('Earth HQ');
  });

  test('hub abandonment removes hub from switcher', async ({ page }) => {
    // Build an offline moon hub (must be offline for abandon to be available)
    const moonHub = buildHub({
      id: 'moon-base',
      name: 'Lunar Outpost',
      bodyId: 'MOON',
      online: false,
      facilities: { 'crew-hab': { built: true, tier: 1 } },
      maintenanceCost: 10_000,
    });

    const save = buildSaveEnvelope({
      hubs: [earthHub(), moonHub],
      activeHubId: 'earth',
    });

    await seedAndLoadSave(page, save);
    await dismissWelcomeModal(page);

    // Switch to moon hub in the switcher
    const switcher = page.locator('#hub-switcher');
    await expect(switcher).toBeVisible({ timeout: 5_000 });
    await switcher.selectOption('moon-base');

    // Open management panel (gear button behind z-index, use evaluate)
    await page.waitForSelector('#hub-switcher-gear', { state: 'attached', timeout: 5_000 });
    await page.evaluate(() => {
      document.getElementById('hub-switcher-gear')!.click();
    });

    const backdrop = page.locator('#hub-mgmt-backdrop');
    await expect(backdrop).toBeVisible({ timeout: 5_000 });

    // Verify we are viewing the offline moon hub
    const statusBadge = page.locator('.hub-mgmt-status');
    await expect(statusBadge).toHaveText('Offline', { timeout: 5_000 });

    // Click the Abandon button (only visible for offline non-Earth hubs)
    const abandonBtn = page.locator('.hub-mgmt-actions .btn-danger');
    await expect(abandonBtn).toBeVisible({ timeout: 5_000 });
    await abandonBtn.click();

    // Confirm dialog should appear
    const confirmOverlay = page.locator('.hub-mgmt-confirm-overlay');
    await expect(confirmOverlay).toBeVisible({ timeout: 5_000 });

    // Verify the confirm dialog title
    const confirmTitle = page.locator('.hub-mgmt-confirm-title');
    await expect(confirmTitle).toHaveText('Abandon Hub?', { timeout: 5_000 });

    // Click the Abandon confirm button
    const confirmBtn = confirmOverlay.locator('.btn-danger');
    await confirmBtn.click();

    // Panel should close after abandonment
    await expect(backdrop).toBeHidden({ timeout: 5_000 });

    // Verify the hub is removed from the switcher dropdown
    const moonOption = switcher.locator('option[value="moon-base"]');
    await expect(moonOption).toHaveCount(0, { timeout: 5_000 });

    // Verify only the Earth hub option remains
    const options = switcher.locator('option');
    await expect(options).toHaveCount(1, { timeout: 5_000 });

    // Verify the active hub switched back to Earth
    await expect(switcher).toHaveValue('earth', { timeout: 5_000 });

    // Verify game state: hub removed and activeHubId is Earth
    const state = await getGameState(page);
    const hubs = state?.hubs as Array<{ id: string; name: string }>;
    expect(hubs).toHaveLength(1);
    expect(hubs[0].id).toBe('earth');
    expect(state?.activeHubId).toBe('earth');
  });

});
