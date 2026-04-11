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
});
