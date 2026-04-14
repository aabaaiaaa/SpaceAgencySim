/**
 * mining.spec.ts — E2E tests for the basic mining / Logistics Center UI flow.
 *
 * Verifies:
 *   - Logistics Center is visible in the hub (sandbox mode unlocks all)
 *   - Opening the Logistics Center shows the mining sites panel
 *   - Empty state message when no mining sites exist
 *   - Route management tab is accessible
 *   - Injecting a mining site into gameState renders it in the panel
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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Mining — Logistics Center', () => {

  test.beforeEach(async ({ page }) => {
    const envelope = buildLogisticsSave();
    await seedAndLoadSave(page, envelope);
  });

  test('Logistics Center building is visible in the hub', async ({ page }) => {
    const building = page.locator('[data-building-id="logistics-center"]');
    await expect(building).toBeVisible({ timeout: 5_000 });
  });

  test('opening Logistics Center shows mining sites panel with empty state', async ({ page }) => {
    // Click the Logistics Center building
    await page.click('[data-building-id="logistics-center"]');
    await page.waitForSelector('#logistics-overlay', { state: 'visible', timeout: 5_000 });

    // The overlay should be visible
    await expect(page.locator('#logistics-overlay')).toBeVisible({ timeout: 5_000 });

    // The Mining Sites tab should be active by default — verify empty state message
    const emptyMsg = page.locator('#logistics-overlay .empty-msg');
    await expect(emptyMsg).toBeVisible({ timeout: 5_000 });
    await expect(emptyMsg).toContainText('No mining sites established', { timeout: 5_000 });
  });

  test('Route Management tab is accessible and shows empty state', async ({ page }) => {
    await page.click('[data-building-id="logistics-center"]');
    await page.waitForSelector('#logistics-overlay', { state: 'visible', timeout: 5_000 });

    // Click the Route Management tab
    const routesTab = page.locator('#logistics-overlay .facility-tab', { hasText: 'Route Management' });
    await expect(routesTab).toBeVisible({ timeout: 5_000 });
    await routesTab.click();

    // Should show the routes empty state message
    const emptyMsg = page.locator('#logistics-overlay .empty-msg', { hasText: 'No routes created' });
    await expect(emptyMsg).toBeVisible({ timeout: 5_000 });
  });

  test('@smoke injecting a mining site into gameState renders it in the panel', async ({ page }) => {
    // Open the Logistics Center
    await page.click('[data-building-id="logistics-center"]');
    await page.waitForSelector('#logistics-overlay', { state: 'visible', timeout: 5_000 });

    // Verify empty state first
    await expect(page.locator('#logistics-overlay .empty-msg')).toBeVisible({ timeout: 5_000 });

    // Navigate back to hub to re-enter with injected state
    await page.click('#logistics-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 5_000 });

    // Inject a mining site into the game state
    await page.evaluate(() => {
      const gs = window.__gameState;
      gs.miningSites.push({
        id: 'site-e2e-1',
        name: 'Tranquility Base Alpha',
        bodyId: 'MOON',
        coordinates: { x: 100, y: 200 },
        controlUnit: { partId: 'base-control-unit' },
        modules: [
          {
            id: 'mod-bcu-1',
            partId: 'base-control-unit',
            type: 'BASE_CONTROL_UNIT',
            powerDraw: 10,
            connections: ['mod-drill-1'],
          },
          {
            id: 'mod-drill-1',
            partId: 'mining-drill',
            type: 'MINING_DRILL',
            powerDraw: 25,
            connections: ['mod-bcu-1'],
          },
          {
            id: 'mod-gen-1',
            partId: 'power-generator-solar',
            type: 'POWER_GENERATOR',
            powerDraw: 0,
            connections: [],
          },
        ],
        storage: { WATER_ICE: 150.5 },
        powerGenerated: 100,
        powerRequired: 35,
        orbitalBuffer: {},
      });
    });

    // Re-open the Logistics Center
    await page.click('[data-building-id="logistics-center"]');
    await page.waitForSelector('#logistics-overlay', { state: 'visible', timeout: 5_000 });

    // The empty message should be gone
    await expect(page.locator('#logistics-overlay .empty-msg')).not.toBeVisible({ timeout: 5_000 });

    // The site card should render with the site name
    const siteCard = page.locator('.logistics-site-card');
    await expect(siteCard).toBeVisible({ timeout: 5_000 });
    await expect(siteCard).toContainText('Tranquility Base Alpha', { timeout: 5_000 });

    // The body ID should appear in the sidebar
    const sidebarItem = page.locator('.logistics-sidebar-item', { hasText: 'MOON' });
    await expect(sidebarItem).toBeVisible({ timeout: 5_000 });

    // Power budget should be displayed
    await expect(siteCard).toContainText('Power: 100 / 35', { timeout: 5_000 });

    // Storage should show water ice
    await expect(siteCard).toContainText('Water Ice', { timeout: 5_000 });
    await expect(siteCard).toContainText('150.5 kg', { timeout: 5_000 });

    // Module list should show the three modules
    const moduleItems = page.locator('.logistics-module-item');
    await expect(moduleItems).toHaveCount(3, { timeout: 5_000 });
  });

  test('Mk2 storage module appears in mining site and is distinguishable from Mk1', async ({ page }) => {
    // Open logistics center first (via beforeEach the save is already loaded)
    await page.click('[data-building-id="logistics-center"]');
    await page.waitForSelector('#logistics-overlay', { state: 'visible', timeout: 5_000 });

    // Go back to hub to inject state
    await page.click('#logistics-back-btn');
    await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 5_000 });

    // Inject mining site with both Mk1 and Mk2 storage silos
    await page.evaluate(() => {
      const gs = window.__gameState;
      gs.miningSites.push({
        id: 'site-mk2-test',
        name: 'Mk2 Storage Test Base',
        bodyId: 'MOON',
        coordinates: { x: 0, y: 0 },
        controlUnit: { partId: 'base-control-unit' },
        modules: [
          { id: 'mod-bcu-1', partId: 'base-control-unit', type: 'BASE_CONTROL_UNIT', powerDraw: 10, connections: [] },
          { id: 'mod-gen-1', partId: 'power-generator-solar', type: 'POWER_GENERATOR', powerDraw: 0, connections: [] },
          { id: 'mod-silo-mk1', partId: 'storage-silo-mk1', type: 'STORAGE_SILO', powerDraw: 2, connections: [], stored: { WATER_ICE: 100 }, storageCapacityKg: 2000, storageState: 'SOLID' },
          { id: 'mod-silo-mk2', partId: 'storage-silo-mk2', type: 'STORAGE_SILO', powerDraw: 3, connections: [], stored: { IRON_ORE: 200 }, storageCapacityKg: 5000, storageState: 'SOLID' },
        ],
        storage: { WATER_ICE: 100, IRON_ORE: 200 },
        powerGenerated: 100,
        powerRequired: 15,
        orbitalBuffer: {},
      });
    });

    // Re-open logistics center
    await page.click('[data-building-id="logistics-center"]');
    await page.waitForSelector('#logistics-overlay', { state: 'visible', timeout: 5_000 });

    // Verify site card renders
    const siteCard = page.locator('.logistics-site-card');
    await expect(siteCard).toBeVisible({ timeout: 5_000 });
    await expect(siteCard).toContainText('Mk2 Storage Test Base', { timeout: 5_000 });

    // Should have 4 modules total
    const moduleItems = siteCard.locator('.logistics-module-item');
    await expect(moduleItems).toHaveCount(4, { timeout: 5_000 });

    // Verify both Mk1 and Mk2 storage silos are shown with distinguishable partIds
    await expect(siteCard).toContainText('storage-silo-mk1', { timeout: 5_000 });
    await expect(siteCard).toContainText('storage-silo-mk2', { timeout: 5_000 });
  });
});
