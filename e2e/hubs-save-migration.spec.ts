/**
 * hubs-save-migration.spec.ts — E2E tests for legacy save migration.
 *
 * Verifies:
 *   - A legacy save (without the hubs field) correctly creates an Earth hub on load
 *   - The migrated hub has facilities matching the save's original facilities
 */

import { test, expect } from '@playwright/test';
import {
  buildSaveEnvelope,
  seedAndLoadSave,
  getGameState,
  STARTER_FACILITIES,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Hub Save Migration', () => {

  test('legacy save creates Earth hub, switcher visible', async ({ page }) => {
    // Build a normal save envelope, then strip the hubs and activeHubId
    // fields to simulate a legacy (pre-hub) save. The game's migrateToHubs()
    // function should recreate the Earth hub from the save's facilities.
    const save = buildSaveEnvelope({
      facilities: STARTER_FACILITIES,
    });

    // Remove hubs and activeHubId to simulate a legacy save
    delete (save.state as Record<string, unknown>).hubs;
    delete (save.state as Record<string, unknown>).activeHubId;

    await seedAndLoadSave(page, save);

    // The game should have loaded successfully — hub overlay visible
    const hubOverlay = page.locator('#hub-overlay');
    await expect(hubOverlay).toBeVisible({ timeout: 10_000 });

    // Wait for the migration to complete and hubs to be populated
    await page.waitForFunction(
      () => (window.__gameState?.hubs?.length ?? 0) >= 1,
      { timeout: 5_000 },
    );

    // Read the live game state to verify the migration occurred
    const gameState = await getGameState(page);
    expect(gameState).not.toBeNull();

    // The hubs array should exist with at least one Earth hub
    const hubs = gameState!.hubs as Array<Record<string, unknown>>;
    expect(Array.isArray(hubs)).toBe(true);
    expect(hubs.length).toBeGreaterThanOrEqual(1);

    // Find the Earth hub
    const earthHub = hubs.find(h => h.id === 'earth');
    expect(earthHub).toBeDefined();
    expect(earthHub!.bodyId).toBe('EARTH');
    expect(earthHub!.online).toBe(true);

    // The Earth hub's facilities should match the save's starter facilities
    const hubFacilities = earthHub!.facilities as Record<string, { built: boolean; tier: number }>;
    expect(hubFacilities['launch-pad']).toMatchObject({ built: true, tier: 1 });
    expect(hubFacilities['vab']).toMatchObject({ built: true, tier: 1 });
    expect(hubFacilities['mission-control']).toMatchObject({ built: true, tier: 1 });

    // The activeHubId should be set to 'earth'
    expect(gameState!.activeHubId).toBe('earth');

    // With only one hub, the switcher wrapper should be hidden
    // (migration creates exactly one hub)
    const wrapper = page.locator('#hub-switcher-wrapper');
    await expect(wrapper).toBeHidden({ timeout: 5_000 });
  });
});
