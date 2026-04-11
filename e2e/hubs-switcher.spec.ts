/**
 * hubs-switcher.spec.ts — E2E tests for the hub switcher dropdown.
 *
 * Verifies:
 *   - Switcher is visible when multiple hubs exist, with correct options
 *   - Switcher is hidden when only one hub exists
 *   - [Building] status indicator shown for under-construction hubs
 */

import { test, expect } from '@playwright/test';
import {
  buildSaveEnvelope,
  seedAndLoadSave,
  buildHub,
  STARTER_FACILITIES,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Hub Switcher', () => {

  test('switcher visible, lists all hubs, Earth first', async ({ page }) => {
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
          facilities: { ...STARTER_FACILITIES },
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
    });

    await seedAndLoadSave(page, save);

    // Switcher should be visible (more than one hub)
    const switcher = page.locator('#hub-switcher');
    await expect(switcher).toBeVisible();

    // Should have 2 options
    const options = switcher.locator('option');
    await expect(options).toHaveCount(2);

    // First option should be Earth
    const firstOption = options.nth(0);
    await expect(firstOption).toHaveText(/Earth HQ/);
    await expect(firstOption).toHaveAttribute('value', 'earth');

    // Second option should be Moon
    const secondOption = options.nth(1);
    await expect(secondOption).toHaveText(/Lunar Outpost/);
    await expect(secondOption).toHaveText(/MOON/);
  });

  test('switcher hidden when only one hub', async ({ page }) => {
    const save = buildSaveEnvelope({
      activeHubId: 'earth',
    });

    await seedAndLoadSave(page, save);

    // Switcher wrapper should be hidden (only one hub)
    const wrapper = page.locator('#hub-switcher-wrapper');
    await expect(wrapper).toBeHidden();
  });

  test('shows [Building] status for under-construction hub', async ({ page }) => {
    const buildingHub = buildHub({
      id: 'mars-base',
      name: 'Mars Colony',
      bodyId: 'MARS',
      online: false,
      constructionQueue: [{
        facilityId: 'crew-hab',
        resourcesRequired: [{ resourceId: 'IRON_ORE', amount: 500 }],
        resourcesDelivered: [{ resourceId: 'IRON_ORE', amount: 100 }],
        moneyCost: 200000,
        startedPeriod: 0,
      }],
    });

    const save = buildSaveEnvelope({
      hubs: [
        {
          id: 'earth',
          name: 'Earth HQ',
          type: 'surface' as const,
          bodyId: 'EARTH',
          coordinates: { x: 0, y: 0 },
          facilities: { ...STARTER_FACILITIES },
          tourists: [],
          partInventory: [],
          constructionQueue: [],
          maintenanceCost: 0,
          established: 0,
          online: true,
        },
        buildingHub,
      ],
      activeHubId: 'earth',
    });

    await seedAndLoadSave(page, save);

    const switcher = page.locator('#hub-switcher');
    const marsOption = switcher.locator('option').nth(1);
    await expect(marsOption).toHaveText(/\[Building\]/);
  });

  test('switching to non-Earth hub changes displayed facilities', async ({ page }) => {
    // Moon hub has crew-hab built (a surface hub facility), but should NOT
    // show Earth-only facilities like mission-control.
    const moonHub = buildHub({
      id: 'moon-base',
      name: 'Lunar Outpost',
      bodyId: 'MOON',
      type: 'surface',
      online: true,
      facilities: {
        'crew-hab': { built: true, tier: 1 },
        'launch-pad': { built: true, tier: 1 },
        'vab': { built: true, tier: 1 },
      },
    });

    const save = buildSaveEnvelope({
      hubs: [
        {
          id: 'earth',
          name: 'Earth HQ',
          type: 'surface' as const,
          bodyId: 'EARTH',
          coordinates: { x: 0, y: 0 },
          facilities: { ...STARTER_FACILITIES },
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
    });

    await seedAndLoadSave(page, save);

    // Verify Earth facilities are shown (mission-control is an Earth-only facility).
    await expect(page.locator('[data-building-id="mission-control"]')).toBeVisible();
    await expect(page.locator('[data-building-id="launch-pad"]')).toBeVisible();
    await expect(page.locator('[data-building-id="vab"]')).toBeVisible();

    // Switch to the Moon hub.
    const switcher = page.locator('#hub-switcher');
    await switcher.selectOption('moon-base');

    // Wait for the hub UI to re-render.
    await page.waitForTimeout(500);

    // Moon hub should show surface-hub facilities that are built.
    await expect(page.locator('[data-building-id="launch-pad"]')).toBeVisible();
    await expect(page.locator('[data-building-id="vab"]')).toBeVisible();

    // Earth-only facilities must NOT be visible on the Moon hub.
    await expect(page.locator('[data-building-id="mission-control"]')).toHaveCount(0);
    await expect(page.locator('[data-building-id="crew-admin"]')).toHaveCount(0);
    await expect(page.locator('[data-building-id="tracking-station"]')).toHaveCount(0);
    await expect(page.locator('[data-building-id="rd-lab"]')).toHaveCount(0);
    await expect(page.locator('[data-building-id="satellite-ops"]')).toHaveCount(0);
    await expect(page.locator('[data-building-id="library"]')).toHaveCount(0);

    // Collect all visible building IDs to confirm only appropriate ones are shown.
    const buildingIds = await page.locator('[data-building-id]').evaluateAll(
      (els: Element[]) => els.map(el => (el as HTMLElement).dataset.buildingId)
    );
    // Should only contain surface hub facilities that the Moon hub has built.
    expect(buildingIds).not.toContain('mission-control');
    expect(buildingIds).not.toContain('crew-admin');
    expect(buildingIds).toContain('launch-pad');
    expect(buildingIds).toContain('vab');
  });
});
