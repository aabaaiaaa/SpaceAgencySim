/**
 * hubs-vab-launch-body.spec.ts — Active hub determines launch body.
 *
 * Regression test: when the player's active hub is on a non-Earth body
 * (e.g. a Moon base), launching a craft from that hub's VAB must spawn the
 * craft on that body — not default back to Earth.
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  VP_W, VP_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  buildSaveEnvelope, buildHub, STARTER_FACILITIES,
  seedAndLoadSave, navigateToVab, placePart, launchFromVab,
} from './helpers.js';

const CMD_DROP_Y    = CANVAS_CENTRE_Y;
const TANK_M_DROP_Y = CMD_DROP_Y    + 20 + 30;
const ENGINE_DROP_Y = TANK_M_DROP_Y + 30 + 15;

const PARTS = ['cmd-mk1', 'tank-medium', 'engine-spark'];

async function buildMinimalRocket(page: Page): Promise<void> {
  await placePart(page, 'cmd-mk1',     CENTRE_X, CMD_DROP_Y,    1);
  await placePart(page, 'tank-medium', CENTRE_X, TANK_M_DROP_Y, 2);
  await placePart(page, 'engine-spark', CENTRE_X, ENGINE_DROP_Y, 3);

  await page.click('#vab-btn-staging');
  await expect(page.locator('#vab-staging-panel')).toBeVisible({ timeout: 5_000 });
  await expect(
    page.locator('[data-drop-zone="stage-0"]').getByText('Spark Engine'),
  ).toBeVisible({ timeout: 5_000 });
}

test.describe('VAB launch — active-hub body', () => {

  test('@smoke launching from a Moon base spawns the craft on the Moon, not Earth', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const moonBase = buildHub({
      id: 'moon-base',
      name: 'Lunar Outpost',
      bodyId: 'MOON',
      online: true,
      facilities: {
        'crew-hab':   { built: true, tier: 1 },
        'vab':        { built: true, tier: 1 },
        'launch-pad': { built: true, tier: 1 },
      },
    });

    const save = buildSaveEnvelope({
      saveName: 'Moon Launch Test',
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
        moonBase,
      ],
      activeHubId: 'moon-base',
      parts: PARTS,
    });

    await seedAndLoadSave(page, save);

    // Sanity: confirm the active hub really is the Moon base.
    const activeHubBody = await page.evaluate(() => {
      const s = window.__gameState!;
      return s.hubs.find((h) => h.id === s.activeHubId)?.bodyId;
    });
    expect(activeHubBody).toBe('MOON');

    await navigateToVab(page);
    await buildMinimalRocket(page);
    await launchFromVab(page);

    // After launch the live FlightState should report MOON as the body.
    const flightBody = await page.evaluate(() => window.__flightState?.bodyId ?? null);
    expect(flightBody).toBe('MOON');

    // currentFlight on the GameState (what the rest of the game reads) too.
    const currentFlightBody = await page.evaluate(() => window.__gameState?.currentFlight?.bodyId ?? null);
    expect(currentFlightBody).toBe('MOON');

    // launchHubId should also point to the Moon base so flight-return knows
    // where to send the player back.
    const launchHubId = await page.evaluate(() => window.__gameState?.currentFlight?.launchHubId ?? null);
    expect(launchHubId).toBe('moon-base');
  });

  test('launching from Earth HQ still spawns on Earth', async ({ page }) => {
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const save = buildSaveEnvelope({
      saveName: 'Earth Launch Baseline',
      activeHubId: 'earth',
      parts: PARTS,
    });

    await seedAndLoadSave(page, save);
    await navigateToVab(page);
    await buildMinimalRocket(page);
    await launchFromVab(page);

    const flightBody = await page.evaluate(() => window.__flightState?.bodyId ?? null);
    expect(flightBody).toBe('EARTH');
  });
});
