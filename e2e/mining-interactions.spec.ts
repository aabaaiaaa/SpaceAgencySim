/**
 * mining-interactions.spec.ts — E2E tests for mining panel interactions
 * in the Logistics Center.
 *
 * Verifies:
 *   - A mining site with a refinery renders correctly with all modules
 *   - Refinery recipe can be changed via the dropdown selector
 *   - Module connection info is reflected in the UI (or its absence is noted)
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
  });
}

/** Inject a mining site with a refinery, storage, and multiple connected modules. */
async function injectRefinerySite(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const gs = window.__gameState;
    gs.miningSites.push({
      id: 'site-e2e-interactions-1',
      name: 'Refinery Test Base',
      bodyId: 'MOON',
      coordinates: { x: 100, y: 200 },
      controlUnit: { partId: 'base-control-unit-mk1' },
      modules: [
        { id: 'mod-gen-1', partId: 'power-generator-solar-mk1', type: 'POWER_GENERATOR', powerDraw: 0, connections: [] },
        { id: 'mod-drill-1', partId: 'mining-drill-mk1', type: 'MINING_DRILL', powerDraw: 25, connections: ['mod-silo-1'] },
        { id: 'mod-silo-1', partId: 'storage-silo-mk1', type: 'STORAGE_SILO', powerDraw: 2, connections: ['mod-drill-1', 'mod-ref-1'], stored: { WATER_ICE: 500 }, storageCapacityKg: 2000, storageState: 'SOLID' },
        { id: 'mod-ref-1', partId: 'refinery-mk1', type: 'REFINERY', powerDraw: 40, connections: ['mod-silo-1', 'mod-pv-1'], recipeId: 'water-electrolysis' },
        { id: 'mod-pv-1', partId: 'pressure-vessel-mk1', type: 'PRESSURE_VESSEL', powerDraw: 5, connections: ['mod-ref-1'], stored: {}, storageCapacityKg: 1000, storageState: 'GAS' },
      ],
      storage: { WATER_ICE: 500 },
      powerGenerated: 100,
      powerRequired: 72,
      orbitalBuffer: {},
    });
  });
}

/** Navigate to the Logistics Center. Assumes the hub overlay is already visible. */
async function openLogisticsCenter(page: import('@playwright/test').Page) {
  await page.click('[data-building-id="logistics-center"]');
  await page.waitForSelector('#logistics-overlay', { state: 'visible', timeout: 10_000 });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Mining Panel Interactions', () => {

  test('mining tab renders a site with refinery and all modules', async ({ page }) => {
    const envelope = buildLogisticsSave();
    await seedAndLoadSave(page, envelope);
    await injectRefinerySite(page);
    await openLogisticsCenter(page);

    // The site card should render with the site name
    const siteCard = page.locator('.logistics-site-card');
    await expect(siteCard).toBeVisible({ timeout: 10_000 });
    await expect(siteCard).toContainText('Refinery Test Base');

    // The body should appear in the sidebar
    const sidebarItem = page.locator('.logistics-sidebar-item', { hasText: 'MOON' });
    await expect(sidebarItem).toBeVisible();

    // Power budget should be displayed
    await expect(siteCard).toContainText('Power: 100 / 72');

    // Storage should show water ice
    await expect(siteCard).toContainText('Water Ice');
    await expect(siteCard).toContainText('500.0 kg');

    // All 5 modules should be rendered
    const moduleItems = siteCard.locator('.logistics-module-item');
    await expect(moduleItems).toHaveCount(5);

    // Verify module types are displayed
    await expect(siteCard).toContainText('Power Generator');
    await expect(siteCard).toContainText('Mining Drill');
    await expect(siteCard).toContainText('Storage Silo');
    await expect(siteCard).toContainText('Refinery');
    await expect(siteCard).toContainText('Pressure Vessel');
  });

  test('@smoke change refinery recipe via dropdown', async ({ page }) => {
    const envelope = buildLogisticsSave();
    await seedAndLoadSave(page, envelope);
    await injectRefinerySite(page);
    await openLogisticsCenter(page);

    // Wait for the site card to render
    const siteCard = page.locator('.logistics-site-card');
    await expect(siteCard).toBeVisible({ timeout: 10_000 });

    // Find the recipe dropdown for the refinery module
    const recipeSelect = siteCard.locator('.logistics-recipe-select');
    await expect(recipeSelect).toBeVisible();

    // Verify the current recipe is "Water Electrolysis" (matching recipeId: 'water-electrolysis')
    await expect(recipeSelect).toHaveValue('water-electrolysis');

    // Change the recipe to a different option — "Regolith Electrolysis"
    await recipeSelect.selectOption('regolith-electrolysis');

    // After the UI re-renders, the dropdown should reflect the new value
    // The panel re-renders on change, so re-locate the select
    const updatedSelect = page.locator('.logistics-site-card .logistics-recipe-select');
    await expect(updatedSelect).toHaveValue('regolith-electrolysis');

    // Change to "None" to verify clearing the recipe works
    await updatedSelect.selectOption('');

    const clearedSelect = page.locator('.logistics-site-card .logistics-recipe-select');
    await expect(clearedSelect).toHaveValue('');
  });

  test('module list displays module types and part IDs', async ({ page }) => {
    const envelope = buildLogisticsSave();
    await seedAndLoadSave(page, envelope);
    await injectRefinerySite(page);
    await openLogisticsCenter(page);

    // Wait for the site card
    const siteCard = page.locator('.logistics-site-card');
    await expect(siteCard).toBeVisible({ timeout: 10_000 });

    // Each module item should display both the formatted type and the partId.
    // The UI renders: "Type Name (partId)" for non-refinery modules,
    // and "Type Name (partId) — Recipe: [dropdown]" for refinery modules.
    const moduleItems = siteCard.locator('.logistics-module-item');
    await expect(moduleItems).toHaveCount(5);

    // Verify partIds appear in the module list
    await expect(siteCard.locator('.logistics-module-list')).toContainText('power-generator-solar-mk1');
    await expect(siteCard.locator('.logistics-module-list')).toContainText('mining-drill-mk1');
    await expect(siteCard.locator('.logistics-module-list')).toContainText('storage-silo-mk1');
    await expect(siteCard.locator('.logistics-module-list')).toContainText('refinery-mk1');
    await expect(siteCard.locator('.logistics-module-list')).toContainText('pressure-vessel-mk1');

    // The refinery module should show "Recipe:" label
    // Find the module item that contains "Refinery" text
    const refineryItem = moduleItems.filter({ hasText: 'Refinery' }).first();
    await expect(refineryItem).toContainText('Recipe:');

    // Connection information is not currently rendered in the module list UI.
    // The logistics panel displays modules as a flat list without visual
    // connection lines or connection text. This is by design — the pipe
    // connection graph is stored in the data model but the current UI
    // focuses on module status and recipe configuration rather than
    // topology visualization.
  });

});
