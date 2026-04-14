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
  dismissWelcomeModal,
  buildHub,
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
    const gs = window.__gameState;

    gs.miningSites.push({
      id: 'site-e2e-route-1',
      name: 'Lunar Mine Alpha',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      controlUnit: { partId: 'base-control-unit-mk1' },
      modules: [],
      storage: {},
      powerGenerated: 100,
      powerRequired: 10,
      orbitalBuffer: { WATER_ICE: 5000 },
    });

    gs.provenLegs.push({
      id: 'proven-leg-e2e-1',
      origin: { bodyId: 'MOON', locationType: 'orbit', altitude: 50, hubId: null },
      destination: { bodyId: 'EARTH', locationType: 'orbit', altitude: 200, hubId: null },
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
        origin: { bodyId: 'MOON', locationType: 'orbit', altitude: 50, hubId: null },
        destination: { bodyId: 'EARTH', locationType: 'orbit', altitude: 200, hubId: null },
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
  await page.waitForSelector('#logistics-overlay', { state: 'visible', timeout: 5_000 });

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
    await expect(table).toBeVisible({ timeout: 5_000 });

    // Find the row for our route
    const routeRow = page.locator('tr[data-route-id="route-e2e-1"]');
    await expect(routeRow).toBeVisible({ timeout: 5_000 });

    // Verify route name appears in the row
    await expect(routeRow).toContainText('Lunar Water Export', { timeout: 5_000 });

    // Verify resource type appears (formatted as "Water Ice")
    await expect(routeRow).toContainText('Water Ice', { timeout: 5_000 });
  });

  test('@smoke toggle route status from active to paused', async ({ page }) => {
    const envelope = buildLogisticsSave();
    await seedAndLoadSave(page, envelope);
    await injectRouteState(page);
    await openRoutesTab(page);

    // Find the status toggle button for the route
    const routeRow = page.locator('tr[data-route-id="route-e2e-1"]');
    await expect(routeRow).toBeVisible({ timeout: 5_000 });

    const statusBtn = routeRow.locator('.logistics-route-status-btn');
    await expect(statusBtn).toBeVisible({ timeout: 5_000 });

    // Verify initial state is "Active"
    await expect(statusBtn).toHaveText('Active', { timeout: 5_000 });
    await expect(statusBtn).toHaveClass(/status-active/, { timeout: 5_000 });

    // Click to toggle to paused
    await statusBtn.click();

    // After re-render, the button should show "Paused"
    const updatedRow = page.locator('tr[data-route-id="route-e2e-1"]');
    const updatedBtn = updatedRow.locator('.logistics-route-status-btn');
    await expect(updatedBtn).toHaveText('Paused', { timeout: 5_000 });
    await expect(updatedBtn).toHaveClass(/status-paused/, { timeout: 5_000 });
  });

  test('expand route to see leg details with craft controls', async ({ page }) => {
    const envelope = buildLogisticsSave();
    await seedAndLoadSave(page, envelope);
    await injectRouteState(page);
    await openRoutesTab(page);

    // Find the expand button for the route
    const routeRow = page.locator('tr[data-route-id="route-e2e-1"]');
    await expect(routeRow).toBeVisible({ timeout: 5_000 });

    const expandBtn = routeRow.locator('.logistics-expand-btn');
    await expect(expandBtn).toBeVisible({ timeout: 5_000 });

    // Initially no leg rows should be visible
    await expect(page.locator('.logistics-leg-row')).toHaveCount(0, { timeout: 5_000 });

    // Click to expand
    await expandBtn.click();

    // A leg row should now be visible
    const legRow = page.locator('.logistics-leg-row');
    await expect(legRow).toHaveCount(1, { timeout: 5_000 });

    // Verify origin -> destination text is present
    // Format: "MOON (orbit, 50km) -> EARTH (orbit, 200km)" with a real arrow
    await expect(legRow).toContainText('MOON (orbit, 50km)', { timeout: 5_000 });
    await expect(legRow).toContainText('EARTH (orbit, 200km)', { timeout: 5_000 });

    // Verify craft design ID is shown
    await expect(legRow).toContainText('cargo-shuttle', { timeout: 5_000 });

    // Verify craft count controls are present
    const craftControls = legRow.locator('.logistics-craft-controls');
    await expect(craftControls).toBeVisible({ timeout: 5_000 });

    // Verify craft count shows "1"
    const craftCount = craftControls.locator('.logistics-craft-count');
    await expect(craftCount).toHaveText('1', { timeout: 5_000 });

    // Verify + and - buttons exist
    const craftButtons = craftControls.locator('.logistics-craft-btn');
    await expect(craftButtons).toHaveCount(2, { timeout: 5_000 });
  });

  test('craft +/- buttons change count and update throughput', async ({ page }) => {
    const envelope = buildLogisticsSave();
    await seedAndLoadSave(page, envelope);
    await injectRouteState(page);
    await openRoutesTab(page);

    // Expand the route to see leg rows
    const routeRow = page.locator('tr[data-route-id="route-e2e-1"]');
    await expect(routeRow).toBeVisible({ timeout: 5_000 });
    const expandBtn = routeRow.locator('.logistics-expand-btn');
    await expandBtn.click();

    const legRow = page.locator('.logistics-leg-row');
    await expect(legRow).toHaveCount(1, { timeout: 5_000 });

    // Record initial values
    const craftControls = legRow.locator('.logistics-craft-controls');
    const craftCount = craftControls.locator('.logistics-craft-count');
    await expect(craftCount).toHaveText('1', { timeout: 5_000 });

    // Click the + button (second .logistics-craft-btn in craft controls)
    const plusBtn = craftControls.locator('.logistics-craft-btn:last-child');
    await plusBtn.click();

    // Wait for re-render — craft count should now be 2
    await expect(craftCount).toHaveText('2', { timeout: 5_000 });

    // Throughput display should have updated (doubled for 2 craft)
    // With 2 craft, throughput = 2 * 2000 = 4000.0 kg
    await expect(routeRow.locator('td:nth-child(4)')).toContainText('4000', { timeout: 5_000 });

    // Click the - button (first .logistics-craft-btn)
    const minusBtn = craftControls.locator('.logistics-craft-btn:first-child');
    await minusBtn.click();

    // Craft count should go back to 1
    await expect(craftCount).toHaveText('1', { timeout: 5_000 });

    // Verify minimum: - button should be disabled at count 1
    await expect(minusBtn).toBeDisabled({ timeout: 5_000 });
    await expect(craftCount).toHaveText('1', { timeout: 5_000 });
  });

  test('multi-leg route builder creates a 2-leg route chain', async ({ page }) => {
    const envelope = buildLogisticsSave();
    await seedAndLoadSave(page, envelope);

    // Inject mining sites on Earth and Moon plus two proven legs forming a chain:
    // Earth -> Moon (index 0) and Moon -> Mars (index 1)
    await page.evaluate(() => {
      const gs = window.__gameState;

      // Ensure arrays exist (save envelope may not include them)
      if (!gs.miningSites) gs.miningSites = [];
      if (!gs.provenLegs) gs.provenLegs = [];
      if (!gs.routes) gs.routes = [];

      // Mining site on Moon with orbital buffer so resource dropdown populates
      gs.miningSites.push({
        id: 'site-multileg-1',
        name: 'Lunar Mine Multi',
        bodyId: 'MOON',
        coordinates: { x: 0, y: 0 },
        controlUnit: { partId: 'base-control-unit-mk1' },
        modules: [],
        storage: {},
        powerGenerated: 100,
        powerRequired: 10,
        orbitalBuffer: { WATER_ICE: 5000 },
      });

      // Mining site on Mars so Mars appears on the SVG map
      gs.miningSites.push({
        id: 'site-multileg-2',
        name: 'Martian Mine Alpha',
        bodyId: 'MARS',
        coordinates: { x: 0, y: 0 },
        controlUnit: { partId: 'base-control-unit-mk1' },
        modules: [],
        storage: {},
        powerGenerated: 100,
        powerRequired: 10,
        orbitalBuffer: {},
      });

      // Proven leg 0: Earth -> Moon
      gs.provenLegs.push({
        id: 'proven-leg-multileg-1',
        origin: { bodyId: 'EARTH', locationType: 'orbit', altitude: 200, hubId: null },
        destination: { bodyId: 'MOON', locationType: 'orbit', altitude: 50, hubId: null },
        craftDesignId: 'cargo-shuttle',
        cargoCapacityKg: 2000,
        costPerRun: 50000,
        provenFlightId: 'flight-multileg-1',
        dateProven: 1,
      });

      // Proven leg 1: Moon -> Mars
      gs.provenLegs.push({
        id: 'proven-leg-multileg-2',
        origin: { bodyId: 'MOON', locationType: 'orbit', altitude: 50, hubId: null },
        destination: { bodyId: 'MARS', locationType: 'orbit', altitude: 200, hubId: null },
        craftDesignId: 'cargo-freighter',
        cargoCapacityKg: 5000,
        costPerRun: 120000,
        provenFlightId: 'flight-multileg-2',
        dateProven: 2,
      });
    });

    await dismissWelcomeModal(page);
    await openRoutesTab(page);

    // Click "Create Route" button to enter builder mode
    const createBtn = page.locator('.logistics-builder-create-btn');
    await expect(createBtn).toBeVisible({ timeout: 5_000 });
    await createBtn.click();

    // Builder panel should appear
    const builderPanel = page.locator('.logistics-builder-panel');
    await expect(builderPanel).toBeVisible({ timeout: 5_000 });

    // Select a resource type from the dropdown
    const resourceSelect = builderPanel.locator('.logistics-builder-select');
    await resourceSelect.selectOption({ index: 1 }); // First available resource

    // Enter a route name
    const nameInput = builderPanel.locator('.logistics-builder-input');
    await nameInput.fill('Multi-Leg Test Route');

    // Step 1: Click Earth on the SVG map to set origin.
    // Use dispatchEvent for SVG elements since Playwright's normal click can
    // struggle with SVG coordinate mapping in headless mode.
    const earthCircle = page.locator('.logistics-route-map .body-earth');
    await expect(earthCircle).toBeVisible({ timeout: 5_000 });
    await earthCircle.dispatchEvent('click');

    // Wait for re-render — proven leg lines should appear
    await page.waitForFunction(() => {
      const legs = document.querySelectorAll('.logistics-route-map .proven-leg-line');
      return legs.length > 0;
    }, { timeout: 5_000 });

    // Step 2: Click the Earth->Moon proven leg (index 0, outbound from Earth)
    const leg0 = page.locator('#route-leg-proven-0');
    await expect(leg0).toBeVisible({ timeout: 5_000 });
    await leg0.dispatchEvent('click');

    // Wait for the first leg to appear in the builder chain
    await page.waitForFunction(() => {
      const items = document.querySelectorAll('.logistics-builder-leg-item');
      return items.length >= 1;
    }, { timeout: 5_000 });

    // Step 3: Click the Moon->Mars proven leg (index 1, now outbound from Moon)
    const leg1 = page.locator('#route-leg-proven-1');
    await expect(leg1).toBeVisible({ timeout: 5_000 });
    await leg1.dispatchEvent('click');

    // Wait for the second leg to appear in the builder chain
    await page.waitForFunction(() => {
      const items = document.querySelectorAll('.logistics-builder-leg-item');
      return items.length >= 2;
    }, { timeout: 5_000 });

    // Step 4: Click "Create Route" confirm button
    const confirmBtn = builderPanel.locator('.logistics-builder-confirm-btn');
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    // Builder should close
    await expect(builderPanel).not.toBeVisible({ timeout: 5_000 });

    // Verify the new route appears in the routes table
    const routeTable = page.locator('.logistics-routes-table');
    await expect(routeTable).toBeVisible({ timeout: 5_000 });

    // The route name we entered should appear
    await expect(routeTable).toContainText('Multi-Leg Test Route', { timeout: 5_000 });

    // The route should show "2 legs" in the expand button
    const routeRow = routeTable.locator('tbody tr').first();
    const expandBtn = routeRow.locator('.logistics-expand-btn');
    await expect(expandBtn).toContainText('2 legs', { timeout: 5_000 });

    // Expand the route to verify leg details
    await expandBtn.click();

    // Two leg rows should appear
    const legRows = page.locator('.logistics-leg-row');
    await expect(legRows).toHaveCount(2, { timeout: 5_000 });

    // First leg: EARTH -> MOON
    const firstLeg = legRows.nth(0);
    await expect(firstLeg).toContainText('EARTH', { timeout: 5_000 });
    await expect(firstLeg).toContainText('MOON', { timeout: 5_000 });

    // Second leg: MOON -> MARS
    const secondLeg = legRows.nth(1);
    await expect(secondLeg).toContainText('MOON', { timeout: 5_000 });
    await expect(secondLeg).toContainText('MARS', { timeout: 5_000 });
  });

  test('route builder creates a new route from proven leg', async ({ page }) => {
    const envelope = buildLogisticsSave();
    await seedAndLoadSave(page, envelope);

    // Inject only a mining site and a proven leg (no existing route)
    await page.evaluate(() => {
      const gs = window.__gameState;

      gs.miningSites.push({
        id: 'site-builder-1',
        name: 'Lunar Mine Beta',
        bodyId: 'MOON',
        coordinates: { x: 0, y: 0 },
        controlUnit: { partId: 'base-control-unit-mk1' },
        modules: [],
        storage: {},
        powerGenerated: 100,
        powerRequired: 10,
        orbitalBuffer: { WATER_ICE: 5000 },
      });

      gs.provenLegs.push({
        id: 'proven-leg-builder-1',
        origin: { bodyId: 'MOON', locationType: 'orbit', altitude: 50, hubId: null },
        destination: { bodyId: 'EARTH', locationType: 'orbit', altitude: 200, hubId: null },
        craftDesignId: 'cargo-shuttle',
        cargoCapacityKg: 2000,
        costPerRun: 50000,
        provenFlightId: 'flight-builder-1',
        dateProven: 1,
      });
    });

    await openRoutesTab(page);

    // Click "Create Route" button
    const createBtn = page.locator('.logistics-builder-create-btn');
    await expect(createBtn).toBeVisible({ timeout: 5_000 });
    await createBtn.click();

    // Builder panel should appear
    const builderPanel = page.locator('.logistics-builder-panel');
    await expect(builderPanel).toBeVisible({ timeout: 5_000 });

    // Select a resource type
    const resourceSelect = builderPanel.locator('.logistics-builder-select');
    await resourceSelect.selectOption({ index: 1 }); // First available resource

    // Enter a route name
    const nameInput = builderPanel.locator('.logistics-builder-input');
    await nameInput.fill('Test Builder Route');

    // Click the origin body on the SVG map — Moon (where the proven leg starts).
    // Use dispatchEvent for SVG elements since Playwright's normal click can
    // struggle with SVG coordinate mapping in headless mode.
    const moonCircle = page.locator('.logistics-route-map .body-moon');
    await expect(moonCircle).toBeVisible({ timeout: 5_000 });
    await moonCircle.dispatchEvent('click');

    // Wait for re-render after setting the origin body
    await page.waitForFunction(() => {
      const legs = document.querySelectorAll('.logistics-route-map .proven-leg-line');
      return legs.length > 0;
    }, { timeout: 5_000 });

    // Click the highlighted proven leg line
    const provenLegLine = page.locator('.logistics-route-map .proven-leg-line');
    await provenLegLine.dispatchEvent('click');

    // Wait for the leg to appear in the builder chain
    await page.waitForFunction(() => {
      const legsDisplay = document.querySelector('.logistics-builder-legs');
      return legsDisplay && !legsDisplay.textContent?.includes('No legs added');
    }, { timeout: 5_000 });

    // Click "Create Route" confirm button
    const confirmBtn = builderPanel.locator('.logistics-builder-confirm-btn');
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    // Builder should close and a new route should appear in the table
    await expect(builderPanel).not.toBeVisible({ timeout: 5_000 });

    // Verify a route appears in the routes table
    const routeTable = page.locator('.logistics-routes-table');
    await expect(routeTable).toBeVisible({ timeout: 5_000 });

    // The route should contain the name we entered
    await expect(routeTable).toContainText('Test Builder Route', { timeout: 5_000 });
  });

  test('@smoke hub-to-hub route creation shows hub names as endpoints', async ({ page }) => {
    // Build hubs: Earth HQ and a Moon outpost
    const earthHub = buildHub({
      id: 'earth',
      name: 'Earth HQ',
      type: 'surface',
      bodyId: 'EARTH',
      coordinates: { x: 0, y: 0 },
      facilities: { ...ALL_FACILITIES },
      online: true,
    });

    const moonHub = buildHub({
      id: 'moon-outpost',
      name: 'Artemis Base',
      type: 'surface',
      bodyId: 'MOON',
      coordinates: { x: 0, y: 0 },
      facilities: {},
      online: true,
    });

    const envelope = buildSaveEnvelope({
      gameMode: 'sandbox',
      tutorialMode: false,
      money: 10_000_000,
      hubs: [earthHub, moonHub],
      activeHubId: 'earth',
    });

    await seedAndLoadSave(page, envelope);

    // Inject a mining site on Moon (so Moon shows on the SVG map) and a
    // proven leg between Earth and Moon with hubId fields set to the hubs.
    await page.evaluate(() => {
      const gs = window.__gameState;

      if (!gs.miningSites) gs.miningSites = [];
      if (!gs.provenLegs) gs.provenLegs = [];
      if (!gs.routes) gs.routes = [];

      gs.miningSites.push({
        id: 'site-hub-route-1',
        name: 'Lunar Mine Gamma',
        bodyId: 'MOON',
        coordinates: { x: 0, y: 0 },
        controlUnit: { partId: 'base-control-unit-mk1' },
        modules: [],
        storage: {},
        powerGenerated: 100,
        powerRequired: 10,
        orbitalBuffer: { WATER_ICE: 5000 },
      });

      gs.provenLegs.push({
        id: 'proven-leg-hub-1',
        origin: { bodyId: 'EARTH', locationType: 'orbit', altitude: 200, hubId: 'earth' },
        destination: { bodyId: 'MOON', locationType: 'orbit', altitude: 50, hubId: 'moon-outpost' },
        craftDesignId: 'cargo-shuttle',
        cargoCapacityKg: 2000,
        costPerRun: 50000,
        provenFlightId: 'flight-hub-1',
        dateProven: 1,
      });
    });

    await openRoutesTab(page);

    // Click "Create Route" to enter builder mode
    const createBtn = page.locator('.logistics-builder-create-btn');
    await expect(createBtn).toBeVisible({ timeout: 5_000 });
    await createBtn.click();

    // Builder panel should appear
    const builderPanel = page.locator('.logistics-builder-panel');
    await expect(builderPanel).toBeVisible({ timeout: 5_000 });

    // Select a resource type from the dropdown
    const resourceSelect = builderPanel.locator('.logistics-builder-select');
    await resourceSelect.selectOption({ index: 1 });

    // Enter a route name
    const nameInput = builderPanel.locator('.logistics-builder-input');
    await nameInput.fill('Hub-to-Hub Water Run');

    // Click Earth on the SVG map to set origin.
    // With only one hub on Earth (Earth HQ), the builder auto-selects it.
    const earthCircle = page.locator('.logistics-route-map .body-earth');
    await expect(earthCircle).toBeVisible({ timeout: 5_000 });
    await earthCircle.dispatchEvent('click');

    // Wait for proven leg lines to appear (outbound from Earth)
    await page.waitForFunction(() => {
      const legs = document.querySelectorAll('.logistics-route-map .proven-leg-line');
      return legs.length > 0;
    }, { timeout: 5_000 });

    // Click the proven leg (Earth -> Moon, index 0)
    const provenLeg = page.locator('#route-leg-proven-0');
    await expect(provenLeg).toBeVisible({ timeout: 5_000 });
    await provenLeg.dispatchEvent('click');

    // Wait for the leg to appear in the builder chain
    await page.waitForFunction(() => {
      const items = document.querySelectorAll('.logistics-builder-leg-item');
      return items.length >= 1;
    }, { timeout: 5_000 });

    // Click "Create Route" confirm button
    const confirmBtn = builderPanel.locator('.logistics-builder-confirm-btn');
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    // Builder should close
    await expect(builderPanel).not.toBeVisible({ timeout: 5_000 });

    // Verify the route appears in the routes table
    const routeTable = page.locator('.logistics-routes-table');
    await expect(routeTable).toBeVisible({ timeout: 5_000 });
    await expect(routeTable).toContainText('Hub-to-Hub Water Run', { timeout: 5_000 });

    // Expand the route to see leg details with hub names
    const routeRow = routeTable.locator('tbody tr').first();
    const expandBtn = routeRow.locator('.logistics-expand-btn');
    await expect(expandBtn).toBeVisible({ timeout: 5_000 });
    await expandBtn.click();

    // A leg row should appear
    const legRow = page.locator('.logistics-leg-row');
    await expect(legRow).toHaveCount(1, { timeout: 5_000 });

    // formatLocation with hubId set renders: "HubName (BODY, locDetail)"
    // Verify that the leg row shows the Earth hub name and Moon hub name
    // instead of just bare body names.
    await expect(legRow).toContainText('Earth HQ', { timeout: 5_000 });
    await expect(legRow).toContainText('Artemis Base', { timeout: 5_000 });
  });

});
