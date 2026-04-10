/**
 * failure-paths.spec.ts — E2E tests for failure scenarios.
 *
 * Covers:
 *   1. Malfunction during flight — part fails, UI records it, flight log shows event
 *   2. Crew KIA on crash — death recorded, fine applied, crew admin reflects loss
 *   3. Contract deadline expiry — penalty applied, contract removed from active list
 *   4. Loan default / bankruptcy — bankruptcy banner appears on hub
 */

import { test, expect, type Page } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope,
  seedAndLoadSave,
  startTestFlight,
  getGameState,
  getPhysicsSnapshot,
  waitForAltitude,
  buildCrewMember,
  buildContract,
  buildObjective,
  ALL_FACILITIES,
  teleportCraft,
} from './helpers.js';
import {
  midGameFixture,
  MID_PARTS,
} from './fixtures.js';

// ---------------------------------------------------------------------------
// Shared constants
// ---------------------------------------------------------------------------

const BASIC_ROCKET: string[]  = ['probe-core-mk1', 'tank-small', 'engine-spark'];
const CREWED_ROCKET: string[] = ['cmd-mk1', 'tank-small', 'engine-spark'];

// ---------------------------------------------------------------------------
// Local type aliases for game state accessed via page.evaluate()
// ---------------------------------------------------------------------------

/** Shape of the game state as returned by getGameState (loosely typed). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GameState = Record<string, any>;

/**
 * Browser-context window shape for page.evaluate() callbacks.
 * Defined as a local interface (not `declare global`) to avoid conflicting
 * with the narrower Window augmentations in the helper modules.
 */
interface GameWindow {
  __gameState?: GameState;
  __flightState?: Record<string, unknown> | null;
  __flightPs?: {
    malfunctions?: { size: number };
    crashed?: boolean;
    [key: string]: unknown;
  } | null;
}

/** Shape of a malfunction event from the flight event log. */
interface MalfunctionEvent {
  type: string;
  description: string;
  malfunctionType: string;
  partName: string;
  time: number;
  [key: string]: unknown;
}

/** Shape of a contract in game state. */
interface ContractSnapshot {
  id: string;
  title: string;
  [key: string]: unknown;
}

/** Shape of the contracts collection in game state. */
interface ContractsState {
  active: ContractSnapshot[];
  failed: ContractSnapshot[];
  board: ContractSnapshot[];
  completed: ContractSnapshot[];
}

/** Shape of a loan in game state. */
interface LoanSnapshot {
  balance: number;
  interestRate: number;
  totalInterestAccrued: number;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Return to agency from flight — waits for post-flight summary and clicks return.
 */
async function returnToAgencyViaSummary(page: Page): Promise<void> {
  await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 15_000 });
  await page.click('#post-flight-return-btn');
  await page.waitForFunction(
    () => window.__flightState === null || window.__flightState === undefined,
    { timeout: 10_000 },
  );
}

/**
 * Open the hamburger menu and click "Return to Space Agency", handling
 * the various confirmation dialogs.
 */
async function returnToAgency(page: Page): Promise<void> {
  const dropdown = page.locator('#topbar-dropdown');
  if (!(await dropdown.isVisible())) {
    await page.click('#topbar-menu-btn');
    await expect(dropdown).toBeVisible({ timeout: 2_000 });
  }
  await dropdown.getByText('Return to Space Agency').click();

  const orbitReturn = page.locator('[data-testid="orbit-return-btn"]');
  const abortReturn = page.locator('[data-testid="abort-confirm-btn"]');

  const orbitVisible = await orbitReturn.isVisible({ timeout: 2_000 }).catch(() => false);
  if (orbitVisible) {
    await orbitReturn.click();
    await returnToAgencyViaSummary(page);
  } else {
    const abortVisible = await abortReturn.isVisible({ timeout: 2_000 }).catch(() => false);
    if (abortVisible) {
      await abortReturn.click();
    } else {
      await returnToAgencyViaSummary(page);
    }
  }
}

/**
 * Dismiss the return-results overlay if it appears.
 */
async function dismissReturnResults(page: Page): Promise<void> {
  try {
    const dismissBtn = page.locator('#return-results-dismiss-btn');
    await dismissBtn.waitFor({ state: 'visible', timeout: 5_000 });
    await dismissBtn.click();
  } catch { /* No overlay */ }
}

// ═══════════════════════════════════════════════════════════════════════════
// 1. MALFUNCTION DURING FLIGHT
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Malfunction during flight', () => {
  test.describe.configure({ mode: 'serial' });
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = midGameFixture({ money: 5_000_000 });
    await seedAndLoadSave(page, envelope);
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) forced malfunction triggers on biome transition, event logged, and flight can still complete', async () => {
    // Start flight with forced malfunctions — every part will malfunction on biome check.
    await startTestFlight(page, BASIC_ROCKET, { malfunctionMode: 'forced' });

    // Fire engine and ascend past 100m (biome boundary: Lower Atmosphere).
    await page.keyboard.press('Space');
    await page.keyboard.press('z');
    await waitForAltitude(page, 150, 20_000);

    // Wait for at least one malfunction to appear on the physics state.
    await page.waitForFunction(
      () => ((window as unknown as GameWindow).__flightPs?.malfunctions?.size ?? 0) > 0,
      { timeout: 10_000 },
    );

    // Verify a PART_MALFUNCTION event was logged in the flight state.
    const malfEvent = await page.evaluate((): MalfunctionEvent | null => {
      const w = window as unknown as GameWindow;
      const events = (w.__gameState?.currentFlight?.events ?? []) as MalfunctionEvent[];
      return events.find((e: MalfunctionEvent) => e.type === 'PART_MALFUNCTION') ?? null;
    });
    expect(malfEvent).not.toBeNull();
    expect(malfEvent!.type).toBe('PART_MALFUNCTION');
    expect(malfEvent!.description).toBeTruthy();
    expect(malfEvent!.malfunctionType).toBeTruthy();

    // The flight is still active — player can still fly (not crashed).
    const ps = await getPhysicsSnapshot(page);
    expect(ps).not.toBeNull();
    expect(ps!.crashed).toBe(false);

    // Return to agency — flight can complete despite malfunction.
    await returnToAgency(page);
    await dismissReturnResults(page);

    // Back at hub.
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 10_000 });
  });

  test('(2) malfunction event has correct structure with part name and type', async () => {
    // Start another flight with forced malfunctions.
    await startTestFlight(page, BASIC_ROCKET, { malfunctionMode: 'forced' });

    await page.keyboard.press('Space');
    await page.keyboard.press('z');
    await waitForAltitude(page, 150, 20_000);

    // Wait for malfunctions.
    await page.waitForFunction(
      () => ((window as unknown as GameWindow).__flightPs?.malfunctions?.size ?? 0) > 0,
      { timeout: 10_000 },
    );

    // Verify the malfunction event structure includes partName and time.
    const events = await page.evaluate((): MalfunctionEvent[] => {
      const w = window as unknown as GameWindow;
      const evts = (w.__gameState?.currentFlight?.events ?? []) as MalfunctionEvent[];
      return evts.filter((e: MalfunctionEvent) => e.type === 'PART_MALFUNCTION');
    });
    expect(events.length).toBeGreaterThan(0);

    // Each malfunction event should have the required fields.
    for (const evt of events) {
      expect(evt.partName).toBeTruthy();
      expect(evt.malfunctionType).toBeTruthy();
      expect(typeof evt.time).toBe('number');
      expect(evt.description).toBeTruthy();
    }

    // Return to agency.
    await returnToAgency(page);
    await dismissReturnResults(page);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. CREW KIA ON CRASH
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Crew KIA on crash', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) crewed rocket crash shows Crew KIA in summary and applies death fine', async () => {
    // Seed save with one crew member.
    const crewMember = buildCrewMember({
      id: 'crew-kia-test',
      name: 'Jeb Testman',
      status: 'active',
      skills: { piloting: 50, engineering: 50, science: 50 },
    });
    const startingMoney: number = 5_000_000;
    const envelope = buildSaveEnvelope({
      saveName: 'KIA Test',
      money: startingMoney,
      parts: MID_PARTS,
      tutorialMode: false,
      facilities: { ...ALL_FACILITIES },
      crew: [crewMember],
    });
    await seedAndLoadSave(page, envelope);

    // Start a crewed flight. Use cmd-mk1 so crew is aboard.
    await startTestFlight(page, CREWED_ROCKET, {
      crewIds: ['crew-kia-test'],
      malfunctionMode: 'off',
    });

    // Fire engine briefly to get airborne.
    await page.keyboard.press('Space');
    await page.keyboard.press('z');
    await waitForAltitude(page, 200, 20_000);

    // Cut engine and teleport to moderate altitude with fast downward velocity
    // to guarantee a crash on impact.
    await page.keyboard.press('Space'); // cut throttle
    await teleportCraft(page, {
      posX: 0,
      posY: 500,
      velX: 0,
      velY: -200,
      grounded: false,
      landed: false,
      crashed: false,
      throttle: 0,
    });

    // Wait for the craft to crash.
    await page.waitForFunction(
      () => (window as unknown as GameWindow).__flightPs?.crashed === true,
      { timeout: 30_000 },
    );

    // The post-flight summary should appear automatically on crash.
    await expect(page.locator('#post-flight-summary')).toBeVisible({ timeout: 15_000 });

    // Verify the heading says "Rocket Destroyed".
    const heading: string | null = await page.locator('#post-flight-summary h1').textContent();
    expect(heading).toContain('Rocket Destroyed');

    // Verify the "Crew KIA" section appears in the summary with crew name and fine.
    const summaryText: string | null = await page.locator('#post-flight-summary').textContent();
    expect(summaryText).toContain('Crew KIA');
    expect(summaryText).toContain('Jeb Testman');
    expect(summaryText).toContain('500,000');

    // Record money before clicking return (flight return applies the fine).
    const _moneyBeforeReturn: number | null = await page.evaluate((): number | null => {
      const w = window as unknown as GameWindow;
      return (w.__gameState?.money as number) ?? null;
    });

    // Click "Return to Space Agency" to process the flight return.
    await page.click('#post-flight-return-btn');
    await page.waitForFunction(
      () => window.__flightState === null || window.__flightState === undefined,
      { timeout: 10_000 },
    );
    await dismissReturnResults(page);

    // Wait for hub to appear.
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 10_000 });

    // Verify the death fine was deducted — money should be less than starting.
    const gs = await getGameState(page);
    expect((gs as GameState).money).toBeLessThan(startingMoney);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. CONTRACT DEADLINE EXPIRY
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Contract deadline expiry', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) expired contract is moved to failed and reputation penalty applied', async () => {
    // Create a contract with a deadline that has already passed.
    // currentPeriod will be 10; set deadlinePeriod to 9 so it expires on period advance.
    const contract = buildContract({
      id: 'contract-expire-test',
      title: 'Doomed Contract',
      description: 'This contract will expire.',
      reward: 100_000,
      penaltyFee: 25_000,
      reputationReward: 10,
      reputationPenalty: 5,
      deadlinePeriod: 9,       // Already past currentPeriod (10)
      acceptedPeriod: 5,
      objectives: [
        buildObjective({ id: 'obj-expire-1', type: 'REACH_ALTITUDE', target: { altitude: 50000 }, completed: false }),
      ],
    });

    const startingReputation: number = 72;
    const envelope = buildSaveEnvelope({
      saveName: 'Contract Expiry Test',
      money: 5_000_000,
      parts: MID_PARTS,
      currentPeriod: 10,
      tutorialMode: false,
      facilities: { ...ALL_FACILITIES },
      contracts: {
        board: [],
        active: [contract],
        completed: [],
        failed: [],
      },
      reputation: startingReputation,
    });
    await seedAndLoadSave(page, envelope);

    // Verify the contract is in active list before flight.
    const gsBefore = await getGameState(page) as GameState;
    expect((gsBefore.contracts as ContractsState).active.length).toBe(1);
    expect((gsBefore.contracts as ContractsState).active[0].id).toBe('contract-expire-test');
    expect((gsBefore.contracts as ContractsState).failed.length).toBe(0);

    // Do a quick flight to trigger period advancement (which runs expiry checks).
    await startTestFlight(page, BASIC_ROCKET, { malfunctionMode: 'off' });

    // Return immediately via hamburger menu.
    await returnToAgency(page);
    await dismissReturnResults(page);

    // Wait for hub.
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 10_000 });

    // Check state: contract should be in failed, not in active.
    const gsAfter = await getGameState(page) as GameState;
    const stillActive: ContractSnapshot | undefined = (gsAfter.contracts as ContractsState).active.find(
      (c: ContractSnapshot) => c.id === 'contract-expire-test',
    );
    expect(stillActive).toBeUndefined();

    const failed: ContractSnapshot | undefined = (gsAfter.contracts as ContractsState).failed.find(
      (c: ContractSnapshot) => c.id === 'contract-expire-test',
    );
    expect(failed).toBeTruthy();
    expect(failed!.id).toBe('contract-expire-test');

    // Reputation should have decreased (CONTRACT_REP_LOSS_FAIL = 5).
    expect(gsAfter.reputation as number).toBeLessThan(startingReputation);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. LOAN DEFAULT / BANKRUPTCY
// ═══════════════════════════════════════════════════════════════════════════

test.describe('Loan default / bankruptcy', () => {
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120_000);
    page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
  });

  test.afterAll(async () => { await page.close(); });

  test('(1) bankruptcy banner appears when funds are insufficient for cheapest rocket', async () => {
    // Set up a save where the player is bankrupt:
    //   - Very low cash (almost nothing)
    //   - Loan at max balance (no borrowing capacity left)
    //   - Parts unlocked so getMinimumRocketCost returns a real cost
    //
    // probe-core-mk1 (~$1000) + engine-spark (~$1000) + tank-small (~$500) ≈ $2500+
    // With $100 cash and maxed-out loan, purchasing power < min rocket cost.
    const envelope = buildSaveEnvelope({
      saveName: 'Bankruptcy Test',
      money: 100,
      loan: { balance: 10_000_000, interestRate: 0.03, totalInterestAccrued: 500_000 },
      parts: MID_PARTS,
      currentPeriod: 20,
      tutorialMode: false,
      facilities: { ...ALL_FACILITIES },
      reputation: 30,
    });
    await seedAndLoadSave(page, envelope);

    // Do a flight to trigger period advancement and bankruptcy check.
    await startTestFlight(page, BASIC_ROCKET, { malfunctionMode: 'off' });
    await returnToAgency(page);

    // The return-results overlay should indicate bankruptcy.
    // Check if the return-results overlay has a bankruptcy section.
    const returnOverlay = page.locator('#return-results-overlay');
    const returnOverlayVisible: boolean = await returnOverlay.isVisible({ timeout: 5_000 }).catch(() => false);
    if (returnOverlayVisible) {
      const returnText: string | null = await returnOverlay.textContent();
      expect(returnText).toContain('Bankrupt');
      await page.click('#return-results-dismiss-btn');
    }

    // Wait for hub.
    await expect(page.locator('#hub-overlay')).toBeVisible({ timeout: 10_000 });

    // The bankruptcy banner should appear on the hub.
    const banner = page.locator('#bankruptcy-banner');
    await expect(banner).toBeVisible({ timeout: 5_000 });

    // The banner should contain appropriate warning text.
    const bannerText: string | null = await banner.textContent();
    expect(bannerText).toContain('Bankrupt');
    expect(bannerText).toContain('cheapest rocket');

    // Verify the game state confirms bankruptcy.
    const gs = await getGameState(page) as GameState;
    // Money should be very low (may have gone negative from interest/costs).
    expect(gs.money as number).toBeLessThan(1_000);
    // Loan balance should be at or near max.
    expect((gs.loan as LoanSnapshot).balance).toBeGreaterThanOrEqual(9_000_000);
  });
});
