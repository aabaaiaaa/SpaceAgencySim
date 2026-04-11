/**
 * hubs-map.spec.ts — E2E tests for hub markers on the map.
 *
 * Verifies:
 *   - Hub markers data is present when multiple hubs exist in state
 *   - Tracking station renders and shows hub information
 *   - Canvas is visible for PixiJS hub marker rendering
 */

import { test, expect } from '@playwright/test';
import {
  buildSaveEnvelope,
  seedAndLoadSave,
  buildHub,
  ALL_FACILITIES,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Hub markers on map @smoke', () => {

  test('hub markers data present when multiple hubs exist', async ({ page }) => {
    const moonHub = buildHub({
      id: 'moon-base',
      name: 'Lunar Outpost',
      bodyId: 'MOON',
      online: true,
      facilities: { 'crew-hab': { built: true, tier: 1 } },
    });

    const save = buildSaveEnvelope({
      hubs: [
        {
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
        },
        moonHub,
      ],
      activeHubId: 'earth',
      facilities: ALL_FACILITIES,
    });

    await seedAndLoadSave(page, save);

    // Verify hubs are loaded in game state.
    const hubCount = await page.evaluate(() => {
      const gs = window.__gameState;
      return gs?.hubs?.length ?? 0;
    });
    expect(hubCount).toBe(2);

    // Verify the specific hubs are present with correct data.
    const hubData = await page.evaluate(() => {
      const gs = window.__gameState;
      if (!gs?.hubs) return null;
      return gs.hubs.map(h => ({
        id: h.id,
        name: h.name,
        bodyId: h.bodyId,
        online: h.online,
      }));
    });

    expect(hubData).not.toBeNull();
    expect(hubData).toHaveLength(2);
    expect(hubData![0]).toMatchObject({ id: 'earth', name: 'Earth HQ', bodyId: 'EARTH', online: true });
    expect(hubData![1]).toMatchObject({ id: 'moon-base', name: 'Lunar Outpost', bodyId: 'MOON', online: true });

    // Verify the PixiJS canvas is present and visible (hub markers are drawn here).
    const canvas = page.locator('canvas');
    await expect(canvas).toBeVisible();
  });

  test('tracking station accessible with multiple hubs', async ({ page }) => {
    const moonHub = buildHub({
      id: 'moon-base',
      name: 'Lunar Outpost',
      bodyId: 'MOON',
      online: true,
      facilities: { 'crew-hab': { built: true, tier: 1 } },
    });

    const save = buildSaveEnvelope({
      hubs: [
        {
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
        },
        moonHub,
      ],
      activeHubId: 'earth',
      facilities: ALL_FACILITIES,
    });

    await seedAndLoadSave(page, save);

    // Click on Tracking Station building to open the tracking station overlay.
    const trackingStation = page.locator('[data-building-id="tracking-station"]');
    await expect(trackingStation).toBeVisible({ timeout: 10_000 });
    await trackingStation.click();

    // Wait for the tracking station overlay to appear.
    const tsOverlay = page.locator('#ts-overlay');
    await expect(tsOverlay).toBeVisible({ timeout: 10_000 });

    // Verify tracking station header shows tier information.
    const tsTitle = page.locator('#ts-title');
    await expect(tsTitle).toBeVisible();
    await expect(tsTitle).toContainText('Tracking Station');

    // Verify the back button works (returns to hub).
    const backBtn = page.locator('#ts-back-btn');
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    // Should be back at the hub overlay.
    const hubOverlay = page.locator('#hub-overlay');
    await expect(hubOverlay).toBeVisible({ timeout: 10_000 });
  });
});
