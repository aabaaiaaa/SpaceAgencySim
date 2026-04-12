/**
 * hubs-establishment.spec.ts — E2E tests for hub establishment.
 *
 * Verifies:
 *   - A new hub appears in the switcher when multiple hubs exist
 *   - Under-construction status is shown for hubs that are not yet online
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

test.describe('Hub Establishment', () => {

  test('new hub appears in switcher', async ({ page }) => {
    const moonHub = buildHub({
      id: 'moon-outpost',
      name: 'Moon Surface Outpost',
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
    await expect(switcher).toBeVisible({ timeout: 5_000 });

    // Should have 2 options — Earth and Moon
    const options = switcher.locator('option');
    await expect(options).toHaveCount(2, { timeout: 5_000 });

    // First option should be Earth
    const earthOption = options.nth(0);
    await expect(earthOption).toHaveText(/Earth HQ/, { timeout: 5_000 });
    await expect(earthOption).toHaveAttribute('value', 'earth', { timeout: 5_000 });

    // Second option should be the Moon outpost
    const moonOption = options.nth(1);
    await expect(moonOption).toHaveText(/Moon Surface Outpost/, { timeout: 5_000 });
    await expect(moonOption).toHaveText(/MOON/, { timeout: 5_000 });
    await expect(moonOption).toHaveAttribute('value', 'moon-outpost', { timeout: 5_000 });
  });

  test('under-construction status shown', async ({ page }) => {
    const constructingHub = buildHub({
      id: 'mars-colony',
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
        constructingHub,
      ],
      activeHubId: 'earth',
    });

    await seedAndLoadSave(page, save);

    // Switcher should be visible
    const switcher = page.locator('#hub-switcher');
    await expect(switcher).toBeVisible({ timeout: 5_000 });

    // The under-construction hub option should show [Building] text
    const marsOption = switcher.locator('option').nth(1);
    await expect(marsOption).toHaveText(/\[Building\]/, { timeout: 5_000 });
    await expect(marsOption).toHaveText(/Mars Colony/, { timeout: 5_000 });
  });
});
