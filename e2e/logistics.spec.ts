/**
 * logistics.spec.ts — E2E tests for the Logistics Center SVG map layout.
 *
 * Verifies:
 *   - Dynamic body layout shows only relevant bodies
 *   - Moon positioned as child of Earth
 *   - Hub nodes appear on SVG map with correct visual state
 */

import { test, expect } from '@playwright/test';
import {
  buildSaveEnvelope,
  seedAndLoadSave,
  ALL_FACILITIES,
  buildHub,
  dismissWelcomeModal,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal save envelope with the Logistics Center unlocked. */
function buildLogisticsSave(
  overrides: Parameters<typeof buildSaveEnvelope>[0] = {},
) {
  return buildSaveEnvelope({
    gameMode: 'sandbox',
    tutorialMode: false,
    facilities: ALL_FACILITIES,
    ...overrides,
  });
}

/**
 * Navigate to the Logistics Center and switch to the Route Management tab
 * where the SVG map lives.
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

test.describe('Logistics SVG Map', () => {

  test('@smoke SVG dynamic layout shows active bodies and hides inactive ones', async ({ page }) => {
    const save = buildLogisticsSave();
    await seedAndLoadSave(page, save);
    await dismissWelcomeModal(page);

    // Inject mining sites on Earth, Moon, and Mars via page.evaluate.
    // Ensure arrays exist (save envelope may not include them).
    await page.evaluate(() => {
      const gs = window.__gameState;
      if (!gs.miningSites) gs.miningSites = [];
      if (!gs.provenLegs) gs.provenLegs = [];
      if (!gs.routes) gs.routes = [];
      gs.miningSites.push(
        {
          id: 'site-earth-1', name: 'Earth Mine', bodyId: 'EARTH',
          coordinates: { x: 0, y: 0 }, controlUnit: { partId: 'base-control-unit' },
          modules: [], storage: {}, powerGenerated: 100, powerRequired: 10, orbitalBuffer: {},
        },
        {
          id: 'site-moon-1', name: 'Lunar Mine', bodyId: 'MOON',
          coordinates: { x: 0, y: 0 }, controlUnit: { partId: 'base-control-unit' },
          modules: [], storage: {}, powerGenerated: 100, powerRequired: 10, orbitalBuffer: {},
        },
        {
          id: 'site-mars-1', name: 'Mars Mine', bodyId: 'MARS',
          coordinates: { x: 0, y: 0 }, controlUnit: { partId: 'base-control-unit' },
          modules: [], storage: {}, powerGenerated: 100, powerRequired: 10, orbitalBuffer: {},
        },
      );
    });

    // Open Logistics Center -> Route Management tab
    await openRoutesTab(page);

    // Wait for the SVG to render
    const svg = page.locator('.logistics-route-map');
    await expect(svg).toBeVisible({ timeout: 5_000 });

    // Verify Earth, Moon, Mars circles exist (bodies with mining sites)
    // Body circles have class "body-node body-{id.toLowerCase()}"
    await expect(svg.locator('circle.body-earth')).toBeVisible({ timeout: 5_000 });
    await expect(svg.locator('circle.body-moon')).toBeVisible({ timeout: 5_000 });
    await expect(svg.locator('circle.body-mars')).toBeVisible({ timeout: 5_000 });

    // Verify Moon is positioned near Earth (as child — above Earth, not far away)
    // Moon should be at same x +/- stagger offset, y = 50 (above Earth at y=100)
    const earthCx = await svg.locator('circle.body-earth').getAttribute('cx');
    const moonCx = await svg.locator('circle.body-moon').getAttribute('cx');
    expect(earthCx).not.toBeNull();
    expect(moonCx).not.toBeNull();
    // Moon should be within ~30px horizontally of Earth
    expect(Math.abs(Number(earthCx) - Number(moonCx))).toBeLessThan(30);

    // Moon should be above Earth (lower y value)
    const earthCy = await svg.locator('circle.body-earth').getAttribute('cy');
    const moonCy = await svg.locator('circle.body-moon').getAttribute('cy');
    expect(Number(moonCy)).toBeLessThan(Number(earthCy));

    // Verify Jupiter is NOT shown (no mining site or hub there)
    await expect(svg.locator('circle.body-jupiter')).toHaveCount(0);
  });

  test('hub nodes appear on SVG map with correct labels and opacity', async ({ page }) => {
    // Build hubs: one online Moon hub, one offline Mars hub
    const moonHub = buildHub({
      id: 'moon-outpost',
      name: 'Lunar Base',
      bodyId: 'MOON',
      online: true,
      facilities: { 'crew-hab': { built: true, tier: 1 } },
    });
    const marsHub = buildHub({
      id: 'mars-outpost',
      name: 'Mars Colony',
      bodyId: 'MARS',
      online: false,
      facilities: { 'crew-hab': { built: true, tier: 1 } },
    });

    const save = buildLogisticsSave({
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
        marsHub,
      ],
      activeHubId: 'earth',
    });

    await seedAndLoadSave(page, save);
    await dismissWelcomeModal(page);

    // Inject mining sites so body circles appear for Moon and Mars.
    // Ensure arrays exist (save envelope may not include them).
    await page.evaluate(() => {
      const gs = window.__gameState;
      if (!gs.miningSites) gs.miningSites = [];
      if (!gs.provenLegs) gs.provenLegs = [];
      if (!gs.routes) gs.routes = [];
      gs.miningSites.push(
        {
          id: 'site-moon-hub', name: 'Lunar Mine', bodyId: 'MOON',
          coordinates: { x: 0, y: 0 }, controlUnit: { partId: 'base-control-unit' },
          modules: [], storage: {}, powerGenerated: 100, powerRequired: 10, orbitalBuffer: {},
        },
        {
          id: 'site-mars-hub', name: 'Mars Mine', bodyId: 'MARS',
          coordinates: { x: 0, y: 0 }, controlUnit: { partId: 'base-control-unit' },
          modules: [], storage: {}, powerGenerated: 100, powerRequired: 10, orbitalBuffer: {},
        },
      );
    });

    // Open Logistics Center -> Route Management tab
    await openRoutesTab(page);

    const svg = page.locator('.logistics-route-map');
    await expect(svg).toBeVisible({ timeout: 5_000 });

    // Verify hub nodes exist via data-hub-id attribute
    const moonHubNode = svg.locator('[data-hub-id="moon-outpost"]');
    await expect(moonHubNode).toBeVisible({ timeout: 5_000 });

    const marsHubNode = svg.locator('[data-hub-id="mars-outpost"]');
    await expect(marsHubNode).toBeVisible({ timeout: 5_000 });

    // Verify hub labels (text elements with hub name)
    await expect(svg.locator('text', { hasText: 'Lunar Base' })).toBeVisible({ timeout: 5_000 });
    await expect(svg.locator('text', { hasText: 'Mars Colony' })).toBeVisible({ timeout: 5_000 });

    // Verify online hub at full opacity (opacity="1" or no explicit opacity attribute)
    const moonOpacity = await moonHubNode.getAttribute('opacity');
    expect(moonOpacity === '1' || moonOpacity === null).toBeTruthy();

    // Verify offline hub at reduced opacity (0.4)
    const marsOpacity = await marsHubNode.getAttribute('opacity');
    expect(marsOpacity).toBe('0.4');
  });

});
