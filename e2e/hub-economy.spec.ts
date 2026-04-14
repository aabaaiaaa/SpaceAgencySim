/**
 * hub-economy.spec.ts — E2E tests for hub economy mechanics.
 *
 * Covers:
 *   - TASK-056: Hub maintenance causing offline when money is insufficient
 *   - TASK-057: Tourist revenue credited during period advancement
 *   - TASK-059: Hub reactivation via the management panel
 */

import { test, expect } from '@playwright/test';
import {
  buildSaveEnvelope,
  seedAndLoadSave,
  getGameState,
  buildHub,
  buildCrewMember,
  startTestFlight,
  stageAndLaunch,
  teleportCraft,
  STARTER_FACILITIES,
} from './helpers.js';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const BASIC_ROCKET: string[] = ['probe-core-mk1', 'tank-small', 'engine-spark'];

/** Earth hub object used when providing explicit hubs array. */
const EARTH_HUB = {
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
};

// ---------------------------------------------------------------------------
// Shared helper: complete a quick flight to advance one period
// ---------------------------------------------------------------------------

/**
 * Start a flight, crash immediately, and return to the hub.
 * This advances the period counter by 1 and runs all period-end processing
 * (hub maintenance, tourist revenue, etc.).
 */
async function completeFlightCycle(page: import('@playwright/test').Page): Promise<void> {
  await startTestFlight(page, BASIC_ROCKET);
  await stageAndLaunch(page);

  // Wait for the craft to gain some altitude before crashing
  await page.waitForFunction(
    () => (window.__flightPs?.posY ?? 0) > 50,
    { timeout: 15_000 },
  );

  // Teleport to crash landing
  await teleportCraft(page, { posX: 0, posY: 0, velX: 0, velY: -100, grounded: true, crashed: true });

  // Wait for post-flight summary
  await page.waitForSelector('#post-flight-summary', { state: 'visible', timeout: 15_000 });

  // Return to hub
  await page.click('#post-flight-return-btn');
  await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });

  // Dismiss return-results overlay if it appears
  try {
    const dismissBtn = page.locator('#return-results-dismiss-btn');
    await dismissBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await dismissBtn.click();
  } catch {
    // No overlay — proceed
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Hub Economy', () => {

  // =========================================================================
  // TASK-056: Hub maintenance causing offline
  // =========================================================================

  test('hub goes offline and crew evacuated when maintenance cannot be paid @smoke', async ({ page }) => {
    test.setTimeout(60_000);

    // Moon hub with crew-hab (tier 1) => maintenance = $5,000/period
    const moonHub = buildHub({
      id: 'moon-base',
      name: 'Lunar Outpost',
      bodyId: 'MOON',
      online: true,
      facilities: { 'crew-hab': { built: true, tier: 1 } },
      maintenanceCost: 5_000,
    });

    const moonCrew = buildCrewMember({
      id: 'crew-moon-1',
      name: 'Luna Walker',
      status: 'active',
      salary: 5_000,
      stationedHubId: 'moon-base',
      transitUntil: null,
    });

    const save = buildSaveEnvelope({
      money: 0,
      currentPeriod: 0,
      // Zero loan balance to avoid interest deductions complicating the test
      loan: { balance: 0, interestRate: 0.03, totalInterestAccrued: 0 },
      crew: [moonCrew],
      hubs: [EARTH_HUB, moonHub],
      activeHubId: 'earth',
      parts: BASIC_ROCKET,
    });

    await seedAndLoadSave(page, save);

    // Verify the hub switcher shows the Moon hub as online before the flight
    const switcher = page.locator('#hub-switcher');
    await expect(switcher).toBeVisible({ timeout: 5_000 });
    const moonOptionBefore = switcher.locator('option[value="moon-base"]');
    await expect(moonOptionBefore).toBeVisible({ timeout: 5_000 });
    // Should NOT show [Offline] before flight
    const textBefore = await moonOptionBefore.textContent();
    expect(textBefore).not.toContain('[Offline]');

    // Complete a flight cycle to advance the period.
    // With $0 money, hub maintenance ($5,000) will fail and the hub goes offline.
    await completeFlightCycle(page);

    // After returning to hub, verify the switcher now shows [Offline]
    await expect(switcher).toBeVisible({ timeout: 5_000 });
    const moonOptionAfter = switcher.locator('option[value="moon-base"]');
    await expect(moonOptionAfter).toHaveText(/\[Offline\]/, { timeout: 5_000 });

    // Verify game state: hub is offline and crew evacuated to Earth
    const gs = await getGameState(page);
    expect(gs).not.toBeNull();

    const hub = (gs!.hubs as any[]).find(h => h.id === 'moon-base');
    expect(hub).toBeDefined();
    expect(hub.online).toBe(false);

    const crew = (gs!.crew as any[]).find(c => c.id === 'crew-moon-1');
    expect(crew).toBeDefined();
    expect(crew.stationedHubId).toBe('earth');
  });

  // =========================================================================
  // TASK-057: Tourist revenue in period summary
  // =========================================================================

  test('tourist revenue is credited during period advancement @smoke', async ({ page }) => {
    test.setTimeout(60_000);

    // Moon hub with tourists generating revenue
    const touristRevenue = 5_000; // per tourist per period
    const touristCount = 2;
    const totalTouristRevenue = touristRevenue * touristCount;

    const moonHub = buildHub({
      id: 'moon-base',
      name: 'Lunar Resort',
      bodyId: 'MOON',
      online: true,
      facilities: { 'crew-hab': { built: true, tier: 1 } },
      maintenanceCost: 5_000,
      tourists: [
        {
          id: 'tourist-1',
          name: 'Rich Tourist A',
          revenue: touristRevenue,
          arrivalPeriod: 0,
          departurePeriod: 100, // far future — won't depart
        },
        {
          id: 'tourist-2',
          name: 'Rich Tourist B',
          revenue: touristRevenue,
          arrivalPeriod: 0,
          departurePeriod: 100,
        },
      ],
    });

    const save = buildSaveEnvelope({
      money: 1_000_000,
      currentPeriod: 0,
      loan: { balance: 0, interestRate: 0.03, totalInterestAccrued: 0 },
      crew: [],
      hubs: [EARTH_HUB, moonHub],
      activeHubId: 'earth',
      parts: BASIC_ROCKET,
    });

    await seedAndLoadSave(page, save);

    // Record money before flight
    const gsBefore = await getGameState(page);
    expect(gsBefore).not.toBeNull();
    const moneyBefore = gsBefore!.money as number;
    expect(moneyBefore).toBe(1_000_000);

    // Complete a flight cycle to advance the period
    await completeFlightCycle(page);

    // Read money after period advancement
    const gsAfter = await getGameState(page);
    expect(gsAfter).not.toBeNull();
    const moneyAfter = gsAfter!.money as number;

    // Expected deductions:
    // - Earth facility upkeep: 3 starter facilities * $10,000 = $30,000
    // - Moon hub maintenance: $5,000 (crew-hab tier 1)
    // Expected income:
    // - Tourist revenue: 2 * $5,000 = $10,000
    //
    // The delta should reflect that tourist revenue was credited.
    // money_after = money_before - earth_upkeep - moon_maintenance + tourist_revenue
    // money_after = 1_000_000 - 30_000 - 5_000 + 10_000 = 975_000
    //
    // Use a tolerance range since there may be other minor costs we don't control.
    // The key assertion: money should be higher than it would be WITHOUT tourist revenue.
    const moneyWithoutTourists = moneyBefore - 30_000 - 5_000; // $965,000
    expect(moneyAfter).toBeGreaterThan(moneyWithoutTourists);

    // Verify the exact tourist revenue was credited:
    // delta = moneyAfter - (moneyBefore - operating_costs)
    // We know operating costs include at least $30k Earth upkeep + $5k Moon maintenance.
    // Tourist revenue should account for the difference.
    const moneyWithTourists = moneyWithoutTourists + totalTouristRevenue; // $975,000
    expect(moneyAfter).toBe(moneyWithTourists);

    // Verify tourists are still present (departurePeriod = 100, currentPeriod = 1)
    const moonHubAfter = (gsAfter!.hubs as any[]).find(h => h.id === 'moon-base');
    expect(moonHubAfter).toBeDefined();
    expect(moonHubAfter.tourists).toHaveLength(2);
  });

  // =========================================================================
  // TASK-059: Hub reactivation
  // =========================================================================

  test('offline hub can be reactivated via management panel @smoke', async ({ page }) => {
    // Offline Moon hub with crew-hab at tier 1
    // Reactivation cost = one period's maintenance = $5,000 (crew-hab tier 1)
    const moonHub = buildHub({
      id: 'moon-base',
      name: 'Lunar Outpost',
      bodyId: 'MOON',
      online: false,
      facilities: { 'crew-hab': { built: true, tier: 1 } },
      maintenanceCost: 5_000,
    });

    const startingMoney = 100_000;
    const save = buildSaveEnvelope({
      money: startingMoney,
      currentPeriod: 5,
      loan: { balance: 0, interestRate: 0.03, totalInterestAccrued: 0 },
      crew: [],
      hubs: [EARTH_HUB, moonHub],
      activeHubId: 'moon-base', // Start on the offline hub
    });

    await seedAndLoadSave(page, save);

    // Verify the hub switcher shows the Moon hub as [Offline]
    const switcher = page.locator('#hub-switcher');
    await expect(switcher).toBeVisible({ timeout: 5_000 });
    const moonOption = switcher.locator('option[value="moon-base"]');
    await expect(moonOption).toHaveText(/\[Offline\]/, { timeout: 5_000 });

    // Open the hub management panel via the gear button
    const gearBtn = page.locator('#hub-switcher-gear');
    await expect(gearBtn).toBeVisible({ timeout: 5_000 });
    await gearBtn.click();

    // Wait for the management panel to appear
    await page.waitForSelector('.hub-mgmt-panel', { state: 'visible', timeout: 5_000 });

    // Verify the status badge shows "Offline"
    const statusBadge = page.locator('.hub-mgmt-status--offline');
    await expect(statusBadge).toBeVisible({ timeout: 5_000 });
    await expect(statusBadge).toHaveText('Offline', { timeout: 5_000 });

    // Click the "Reactivate" button
    const reactivateBtn = page.locator('.hub-mgmt-actions button:has-text("Reactivate")');
    await expect(reactivateBtn).toBeVisible({ timeout: 5_000 });
    await reactivateBtn.click();

    // Wait for the confirmation dialog
    await page.waitForSelector('.hub-mgmt-confirm-overlay', { state: 'visible', timeout: 5_000 });
    const confirmBox = page.locator('.hub-mgmt-confirm-box');
    await expect(confirmBox).toBeVisible({ timeout: 5_000 });

    // Click "Confirm" in the dialog
    const confirmBtn = page.locator('.hub-mgmt-confirm-buttons button:has-text("Confirm")');
    await expect(confirmBtn).toBeVisible({ timeout: 5_000 });
    await confirmBtn.click();

    // Wait for the panel to refresh — status should change to "Online"
    const onlineBadge = page.locator('.hub-mgmt-status--online');
    await expect(onlineBadge).toBeVisible({ timeout: 5_000 });
    await expect(onlineBadge).toHaveText('Online', { timeout: 5_000 });

    // Verify game state: hub is online and money was deducted
    const gs = await getGameState(page);
    expect(gs).not.toBeNull();

    const hub = (gs!.hubs as any[]).find(h => h.id === 'moon-base');
    expect(hub).toBeDefined();
    expect(hub.online).toBe(true);

    // Reactivation costs one period's maintenance: crew-hab tier 1 = $5,000
    const expectedMoney = startingMoney - 5_000;
    expect(gs!.money).toBe(expectedMoney);

    // Close the management panel via the close button
    await page.click('.hub-mgmt-close');
    await page.waitForSelector('.hub-mgmt-panel', { state: 'hidden', timeout: 5_000 });
  });

});
