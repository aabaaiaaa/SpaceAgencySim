/**
 * hubs-vab-offworld.spec.ts — E2E tests for VAB behaviour at off-world hubs.
 *
 * Verifies:
 *   - Part costs show import tax markup when the active hub is off-world
 *   - The import tax label text appears with the correct multiplier
 */

import { test, expect } from '@playwright/test';
import {
  buildSaveEnvelope,
  seedAndLoadSave,
  buildHub,
  STARTER_FACILITIES,
  navigateToVab,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('VAB at off-world hub', () => {

  test('@smoke parts show import tax at off-world hub', async ({ page }) => {
    const moonHub = buildHub({
      id: 'moon-base',
      name: 'Lunar Outpost',
      bodyId: 'MOON',
      online: true,
      facilities: {
        'crew-hab': { built: true, tier: 1 },
        'vab': { built: true, tier: 1 },
        'launch-pad': { built: true, tier: 1 },
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
      activeHubId: 'moon-base',
      // Starter parts that are always available
      parts: [
        'probe-core-mk1', 'tank-small', 'engine-spark',
        'parachute-mk1', 'cmd-mk1',
      ],
    });

    await seedAndLoadSave(page, save);

    // Navigate to VAB
    await navigateToVab(page);

    // Wait for parts panel to render
    await page.waitForSelector('.vab-part-card', { timeout: 5000 });

    // Check for import tax text — Moon has 1.2x multiplier
    const importTaxSpan = page.locator('.vab-part-import-tax');
    await expect(importTaxSpan.first()).toBeVisible({ timeout: 5000 });
    await expect(importTaxSpan.first()).toContainText('1.2x import');

    // Verify the data-import-tax attribute is set
    const taxAttr = await importTaxSpan.first().getAttribute('data-import-tax');
    expect(taxAttr).toBe('1.2');
  });

  test('parts do NOT show import tax at Earth hub', async ({ page }) => {
    const save = buildSaveEnvelope({
      activeHubId: 'earth',
      parts: [
        'probe-core-mk1', 'tank-small', 'engine-spark',
        'parachute-mk1', 'cmd-mk1',
      ],
    });

    await seedAndLoadSave(page, save);
    await navigateToVab(page);
    await page.waitForSelector('.vab-part-card', { timeout: 5000 });

    // No import tax labels should be present
    const importTaxSpan = page.locator('.vab-part-import-tax');
    await expect(importTaxSpan).toHaveCount(0);
  });
});
