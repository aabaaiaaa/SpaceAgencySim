/**
 * hub-deployment.spec.ts -- E2E tests for Outpost Core deployment during flight.
 *
 * Verifies that deploying an Outpost Core while landed on the Moon creates
 * a new hub with the correct properties (name, body, type, status).
 */

import { test, expect, type Page } from '@playwright/test';
import {
  buildSaveEnvelope,
  seedAndLoadSave,
  getGameState,
  startTestFlight,
  teleportCraft,
  dismissWelcomeModal,
  ALL_FACILITIES,
  buildHub,
  VP_W,
  VP_H,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Parts list for a flight carrying an Outpost Core. */
const OUTPOST_FLIGHT_PARTS = [
  'probe-core-mk1',
  'outpost_core',
  'tank-small',
  'engine-spark',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Seed a save with all facilities and plenty of money, then load it.
 */
async function seedForOutpostFlight(page: Page): Promise<void> {
  await page.setViewportSize({ width: VP_W, height: VP_H });
  const save = buildSaveEnvelope({
    money: 5_000_000,
    facilities: ALL_FACILITIES,
    currentPeriod: 5,
    parts: OUTPOST_FLIGHT_PARTS,
  });
  await seedAndLoadSave(page, save);
  await dismissWelcomeModal(page);
}

/**
 * Start a flight on the Moon, teleport to landed state, and wait for
 * the physics worker to confirm the landed state.
 */
async function startAndLandOnMoon(page: Page): Promise<void> {
  await startTestFlight(page, OUTPOST_FLIGHT_PARTS, { bodyId: 'MOON' });

  await teleportCraft(page, {
    posY: 0,
    velX: 0,
    velY: 0,
    grounded: true,
    landed: true,
    bodyId: 'MOON',
  });

  // Wait for landed state to persist through the worker round-trip.
  await page.waitForFunction(
    () => window.__flightPs?.landed === true,
    { timeout: 5_000 },
  );
}

/**
 * Deploy an outpost core by calling the core function via Vite dynamic import.
 *
 * The UI wiring for outpost deployment (dialog/prompt) is not yet connected
 * to the flight context menu. This helper calls `deployOutpostCore()` directly
 * in the browser context through Vite's dynamic import, simulating what the
 * UI would trigger once the deployment flow is fully wired.
 */
async function deployOutpostViaCore(
  page: Page,
  bodyId: string,
  inOrbit: boolean,
): Promise<{ hubId: string | null; hubName: string | null }> {
  return page.evaluate(async ({ body, orbit }) => {
    // @ts-expect-error Vite dynamic import -- browser only
    const hubsMod = await import('/src/core/hubs.ts');
    const gs = window.__gameState;
    const fs = window.__flightState;
    if (!gs || !fs) return { hubId: null, hubName: null };

    const flight = {
      bodyId: body,
      altitude: fs.altitude ?? 0,
      inOrbit: orbit,
      landed: !orbit,
    };

    const hub = hubsMod.deployOutpostCore(gs, flight);
    if (!hub) return { hubId: null, hubName: null };
    return { hubId: hub.id as string, hubName: hub.name as string };
  }, { body: bodyId, orbit: inOrbit });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Hub Deployment', () => {

  test('outpost core deployment on Moon creates hub with correct properties @smoke', async ({ page }) => {
    test.setTimeout(60_000);

    // 1. Seed save and load.
    await seedForOutpostFlight(page);

    // Verify initial state: only Earth hub exists.
    const initialState = await getGameState(page);
    expect(initialState).not.toBeNull();
    const initialHubs = (initialState as Record<string, unknown>).hubs as unknown[];
    expect(initialHubs).toHaveLength(1);

    // 2. Start flight on Moon and land.
    await startAndLandOnMoon(page);

    // 3. Deploy outpost core (calls core function via dynamic import).
    const deployment = await deployOutpostViaCore(page, 'MOON', false);
    expect(deployment.hubId).not.toBeNull();
    expect(deployment.hubName).not.toBeNull();

    // 4. Verify the hub name ends with " Outpost" (surface hub naming convention).
    expect(deployment.hubName!).toMatch(/ Outpost$/);

    // 5. Verify game state now has 2 hubs with correct properties.
    const postDeployState = await getGameState(page);
    expect(postDeployState).not.toBeNull();
    const postDeployHubs = (postDeployState as Record<string, unknown>).hubs as Array<Record<string, unknown>>;
    expect(postDeployHubs).toHaveLength(2);

    // The new hub should be on the Moon and be a surface type.
    const moonHub = postDeployHubs.find(h => h.bodyId === 'MOON');
    expect(moonHub).toBeDefined();
    expect(moonHub!.type).toBe('surface');
    expect(moonHub!.online).toBe(false); // New hubs start offline (under construction).
    expect((moonHub!.name as string)).toMatch(/ Outpost$/);

    // Verify the hub has a construction queue (Crew Hab is queued).
    const queue = moonHub!.constructionQueue as unknown[];
    expect(queue.length).toBeGreaterThan(0);
  });

  test('deployed hub appears in switcher with correct status', async ({ page }) => {
    test.setTimeout(60_000);

    // Seed a save that simulates a post-deployment state: Earth HQ + Moon outpost.
    // This verifies the hub switcher correctly displays a deployed outpost.
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const moonHub = buildHub({
      id: 'moon-outpost-deployed',
      name: 'Artemis Outpost',
      bodyId: 'MOON',
      online: false,
      constructionQueue: [{
        facilityId: 'crew-hab',
        resourcesRequired: [{ resourceId: 'IRON_ORE', amount: 500 }],
        resourcesDelivered: [{ resourceId: 'IRON_ORE', amount: 0 }],
        moneyCost: 200_000,
        startedPeriod: 5,
      }],
    });

    const save = buildSaveEnvelope({
      money: 5_000_000,
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
      ],
      activeHubId: 'earth',
    });

    await seedAndLoadSave(page, save);
    await dismissWelcomeModal(page);

    // Hub switcher should be visible (more than one hub).
    const switcher = page.locator('#hub-switcher');
    await expect(switcher).toBeVisible({ timeout: 5_000 });

    // Should have 2 options -- Earth and Moon.
    const options = switcher.locator('option');
    await expect(options).toHaveCount(2, { timeout: 5_000 });

    // Verify Earth hub option is present.
    const earthOption = options.filter({ hasText: /Earth HQ/ });
    await expect(earthOption).toHaveCount(1, { timeout: 5_000 });

    // Verify Moon outpost option is present with body and name.
    const moonOption = options.filter({ hasText: /MOON/ });
    await expect(moonOption).toHaveCount(1, { timeout: 5_000 });
    await expect(moonOption).toHaveText(/Artemis Outpost/, { timeout: 5_000 });

    // The Moon hub is offline with pending construction, should show [Building].
    await expect(moonOption).toHaveText(/\[Building\]/, { timeout: 5_000 });
  });

  test('outpost deployment deducts monetary cost', async ({ page }) => {
    test.setTimeout(60_000);

    await seedForOutpostFlight(page);

    // Record initial money.
    const initialState = await getGameState(page);
    const initialMoney = (initialState as Record<string, unknown>).money as number;
    expect(initialMoney).toBe(5_000_000);

    // Start flight on Moon and land.
    await startAndLandOnMoon(page);

    // Deploy outpost.
    const deployment = await deployOutpostViaCore(page, 'MOON', false);
    expect(deployment.hubId).not.toBeNull();

    // Verify money was deducted (Crew Hab cost is 200,000).
    const postState = await getGameState(page);
    const postMoney = (postState as Record<string, unknown>).money as number;
    expect(postMoney).toBe(initialMoney - 200_000);
  });

  test('outpost deployment fails with insufficient funds', async ({ page }) => {
    test.setTimeout(60_000);

    // Seed with very low money.
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const save = buildSaveEnvelope({
      money: 100,
      facilities: ALL_FACILITIES,
      currentPeriod: 5,
      parts: OUTPOST_FLIGHT_PARTS,
    });
    await seedAndLoadSave(page, save);
    await dismissWelcomeModal(page);

    await startAndLandOnMoon(page);

    // Attempt deployment -- should fail.
    const deployment = await deployOutpostViaCore(page, 'MOON', false);
    expect(deployment.hubId).toBeNull();

    // Verify only Earth hub exists (no new hub created).
    const state = await getGameState(page);
    const hubs = (state as Record<string, unknown>).hubs as unknown[];
    expect(hubs).toHaveLength(1);
  });

  test('hub name auto-suggestion uses space history catalog', async ({ page }) => {
    test.setTimeout(60_000);

    // Seed save with only Earth hub (no off-world hubs).
    await seedForOutpostFlight(page);

    // Land on Moon.
    await startAndLandOnMoon(page);

    // Deploy outpost.
    const deployment = await deployOutpostViaCore(page, 'MOON', false);
    expect(deployment.hubId).not.toBeNull();
    expect(deployment.hubName).not.toBeNull();

    // Name should end with " Outpost" (surface hub).
    expect(deployment.hubName!).toMatch(/ Outpost$/);

    // Name should NOT be the fallback "Hub-1" pattern.
    expect(deployment.hubName!).not.toMatch(/^Hub-\d+/);

    // The base name (before " Outpost") should be a non-empty string.
    const baseName = deployment.hubName!.replace(/ Outpost$/, '');
    expect(baseName.length).toBeGreaterThan(0);

    // Verify in game state too.
    const state = await getGameState(page);
    const hubs = (state as Record<string, unknown>).hubs as Array<Record<string, unknown>>;
    const moonHub = hubs.find(h => h.bodyId === 'MOON');
    expect(moonHub).toBeDefined();
    expect(moonHub!.name).toBe(deployment.hubName);
  });

});
