/**
 * route-interactions.spec.ts — E2E tests for route management interactions
 * in the Logistics Center.
 *
 * Verifies:
 *   - Routes appear in the routes table with correct name and resource type
 *   - Status toggle button transitions a route from active to paused
 *   - Expanding a route shows leg details with craft count controls
 */

import { test, expect } from '@playwright/test';
import {
  buildSaveEnvelope,
  seedAndLoadSave,
  ALL_FACILITIES,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal save envelope with the Logistics Center unlocked. */
function buildLogisticsSave() {
  return buildSaveEnvelope({
    gameMode: 'sandbox',
    tutorialMode: false,
    facilities: ALL_FACILITIES,
    money: 10_000_000,
  });
}

/** Inject a mining site, proven leg, and route into the live game state. */
async function injectRouteState(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const gs = (window as any).__gameState;

    gs.miningSites.push({
      id: 'site-e2e-route-1',
      name: 'Lunar Mine Alpha',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnit: { partId: 'base-control-unit-mk1' },
      modules: [],
      storage: {},
      production: {},
      powerGenerated: 100,
      powerRequired: 10,
      orbitalBuffer: { WATER_ICE: 5000 },
    });

    gs.provenLegs.push({
      id: 'proven-leg-e2e-1',
      origin: { bodyId: 'MOON', locationType: 'orbit', altitude: 50 },
      destination: { bodyId: 'EARTH', locationType: 'orbit', altitude: 200 },
      craftDesignId: 'cargo-shuttle',
      cargoCapacityKg: 2000,
      costPerRun: 50000,
      provenFlightId: 'flight-e2e-1',
      dateProven: 1,
    });

    gs.routes.push({
      id: 'route-e2e-1',
      name: 'Lunar Water Export',
      status: 'active',
      resourceType: 'WATER_ICE',
      legs: [{
        id: 'leg-e2e-1',
        origin: { bodyId: 'MOON', locationType: 'orbit', altitude: 50 },
        destination: { bodyId: 'EARTH', locationType: 'orbit', altitude: 200 },
        craftDesignId: 'cargo-shuttle',
        craftCount: 1,
        cargoCapacityKg: 2000,
        costPerRun: 50000,
        provenFlightId: 'flight-e2e-1',
      }],
      throughputPerPeriod: 2000,
      totalCostPerPeriod: 50000,
    });
  });
}

/**
 * Navigate to the Logistics Center and switch to the Route Management tab.
 * Assumes the hub overlay is already visible.
 */
async function openRoutesTab(page: import('@playwright/test').Page) {
  await page.click('[data-building-id="logistics-center"]');
  await page.waitForSelector('#logistics-overlay', { state: 'visible', timeout: 10_000 });

  const routesTab = page.locator('#logistics-overlay .facility-tab', { hasText: 'Route Management' });
  await routesTab.click();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Route Interactions', () => {

  test('route appears in table with correct name and resource type', async ({ page }) => {
    const envelope = buildLogisticsSave();
    await seedAndLoadSave(page, envelope);
    await injectRouteState(page);
    await openRoutesTab(page);

    // The routes table should be visible
    const table = page.locator('.logistics-routes-table');
    await expect(table).toBeVisible({ timeout: 10_000 });

    // Find the row for our route
    const routeRow = page.locator('tr[data-route-id="route-e2e-1"]');
    await expect(routeRow).toBeVisible();

    // Verify route name appears in the row
    await expect(routeRow).toContainText('Lunar Water Export');

    // Verify resource type appears (formatted as "Water Ice")
    await expect(routeRow).toContainText('Water Ice');
  });

  test('@smoke toggle route status from active to paused', async ({ page }) => {
    const envelope = buildLogisticsSave();
    await seedAndLoadSave(page, envelope);
    await injectRouteState(page);
    await openRoutesTab(page);

    // Find the status toggle button for the route
    const routeRow = page.locator('tr[data-route-id="route-e2e-1"]');
    await expect(routeRow).toBeVisible({ timeout: 10_000 });

    const statusBtn = routeRow.locator('.logistics-route-status-btn');
    await expect(statusBtn).toBeVisible();

    // Verify initial state is "Active"
    await expect(statusBtn).toHaveText('Active');
    await expect(statusBtn).toHaveClass(/status-active/);

    // Click to toggle to paused
    await statusBtn.click();

    // After re-render, the button should show "Paused"
    const updatedRow = page.locator('tr[data-route-id="route-e2e-1"]');
    const updatedBtn = updatedRow.locator('.logistics-route-status-btn');
    await expect(updatedBtn).toHaveText('Paused');
    await expect(updatedBtn).toHaveClass(/status-paused/);
  });

  test('expand route to see leg details with craft controls', async ({ page }) => {
    const envelope = buildLogisticsSave();
    await seedAndLoadSave(page, envelope);
    await injectRouteState(page);
    await openRoutesTab(page);

    // Find the expand button for the route
    const routeRow = page.locator('tr[data-route-id="route-e2e-1"]');
    await expect(routeRow).toBeVisible({ timeout: 10_000 });

    const expandBtn = routeRow.locator('.logistics-expand-btn');
    await expect(expandBtn).toBeVisible();

    // Initially no leg rows should be visible
    await expect(page.locator('.logistics-leg-row')).toHaveCount(0);

    // Click to expand
    await expandBtn.click();

    // A leg row should now be visible
    const legRow = page.locator('.logistics-leg-row');
    await expect(legRow).toHaveCount(1);

    // Verify origin -> destination text is present
    // Format: "MOON (orbit, 50km) -> EARTH (orbit, 200km)" with a real arrow
    await expect(legRow).toContainText('MOON (orbit, 50km)');
    await expect(legRow).toContainText('EARTH (orbit, 200km)');

    // Verify craft design ID is shown
    await expect(legRow).toContainText('cargo-shuttle');

    // Verify craft count controls are present
    const craftControls = legRow.locator('.logistics-craft-controls');
    await expect(craftControls).toBeVisible();

    // Verify craft count shows "1"
    const craftCount = craftControls.locator('.logistics-craft-count');
    await expect(craftCount).toHaveText('1');

    // Verify + and - buttons exist
    const craftButtons = craftControls.locator('.logistics-craft-btn');
    await expect(craftButtons).toHaveCount(2);
  });

});
