import { test, expect } from '@playwright/test';
import type { Page, Browser } from '@playwright/test';
import {
  VP_W, VP_H,
  STARTING_MONEY,
  ALL_FACILITIES,
  buildSaveEnvelope,
  buildContract,
  buildObjective,
  seedAndLoadSave,
  startTestFlight,
  setMalfunctionMode,
  getMalfunctionMode,
  setTestTimeWarp,
  getTestTimeWarp,
  getGameState,
  getPhysicsSnapshot,
  waitForAltitude,
  waitForObjectiveComplete,
  areAllObjectivesComplete,
} from './helpers.js';
import type { MissionTemplate } from './helpers.js';
import {
  freshStartFixture,
  earlyGameFixture,
  midGameFixture,
  orbitalFixture,
  missionTestFixture,
  contractTestFixture,
  STARTER_PARTS,
  ALL_PARTS,
} from './fixtures.js';

// ---------------------------------------------------------------------------
// Local type aliases for game state accessed via page.evaluate()
// ---------------------------------------------------------------------------

interface FacilitySnapshot {
  built: boolean;
  [key: string]: unknown;
}

interface ObjectiveSnapshot {
  id: string;
  completed: boolean;
  [key: string]: unknown;
}

interface MissionSnapshot {
  id: string;
  objectives: ObjectiveSnapshot[];
  [key: string]: unknown;
}

interface ContractSnapshot {
  id: string;
  objectives: ObjectiveSnapshot[];
  [key: string]: unknown;
}

interface GameStateSnapshot {
  agencyName: string;
  money: number;
  tutorialMode: boolean;
  parts: string[];
  facilities: Record<string, FacilitySnapshot>;
  currentPeriod: number;
  missions: {
    available: MissionSnapshot[];
    accepted: MissionSnapshot[];
    completed: MissionSnapshot[];
  };
  reputation: number;
  flightHistory: unknown[];
  crew: unknown[];
  sciencePoints: number;
  scienceLog: unknown[];
  techTree: {
    researched: string[];
    unlockedInstruments: string[];
  };
  satelliteNetwork: {
    satellites: unknown[];
  };
  loan: {
    balance: number;
    [key: string]: unknown;
  };
  contracts: {
    board: unknown[];
    active: ContractSnapshot[];
    completed: unknown[];
    failed: unknown[];
  };
  [key: string]: unknown;
}


// ==========================================================================
// Suite 1: State injection — verify fixtures load correctly
// ==========================================================================

test.describe('E2E Infrastructure — State Injection', () => {
  test('fresh start fixture loads with correct defaults', async ({ browser }: { browser: Browser }) => {
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    await seedAndLoadSave(page, freshStartFixture());
    const gs = await getGameState(page) as GameStateSnapshot;

    expect(gs).not.toBeNull();
    expect(gs.agencyName).toBe('Test Agency');
    expect(gs.money).toBe(STARTING_MONEY);
    expect(gs.tutorialMode).toBe(false);
    for (const partId of STARTER_PARTS) {
      expect(gs.parts).toContain(partId);
    }
    expect(gs.facilities['launch-pad']?.built).toBe(true);
    expect(gs.facilities['vab']?.built).toBe(true);
    expect(gs.facilities['mission-control']?.built).toBe(true);

    await page.close();
  });

  test('early game fixture loads with missions completed', async ({ browser }: { browser: Browser }) => {
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    await seedAndLoadSave(page, earlyGameFixture());
    const gs = await getGameState(page) as GameStateSnapshot;

    expect(gs.money).toBe(2_200_000);
    expect(gs.currentPeriod).toBe(3);
    expect(gs.missions.completed).toHaveLength(1);
    expect(gs.reputation).toBe(58);
    expect(gs.flightHistory).toHaveLength(1);

    await page.close();
  });

  test('mid game fixture loads with crew and facilities', async ({ browser }: { browser: Browser }) => {
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    await seedAndLoadSave(page, midGameFixture());
    const gs = await getGameState(page) as GameStateSnapshot;

    expect(gs.crew).toHaveLength(3);
    expect(gs.sciencePoints).toBe(45);
    expect(gs.missions.completed).toHaveLength(6);
    expect(gs.facilities['crew-admin']?.built).toBe(true);
    expect(gs.facilities['tracking-station']?.built).toBe(true);
    expect(gs.facilities['rd-lab']?.built).toBe(true);

    await page.close();
  });

  test('orbital fixture loads with satellites and full progression', async ({ browser }: { browser: Browser }) => {
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    await seedAndLoadSave(page, orbitalFixture());
    const gs = await getGameState(page) as GameStateSnapshot;

    expect(gs.crew).toHaveLength(4);
    expect(gs.missions.completed).toHaveLength(14);
    expect(gs.reputation).toBe(90);
    expect(gs.sciencePoints).toBe(120);
    expect(gs.satelliteNetwork.satellites).toHaveLength(1);
    expect(gs.loan.balance).toBe(0);

    await page.close();
  });

  test('custom overrides are applied to fixtures', async ({ browser }: { browser: Browser }) => {
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    await seedAndLoadSave(page, freshStartFixture({
      money: 999_999,
      agencyName: 'Override Agency',
      reputation: 75,
    }));
    const gs = await getGameState(page) as GameStateSnapshot;

    expect(gs.money).toBe(999_999);
    expect(gs.agencyName).toBe('Override Agency');
    expect(gs.reputation).toBe(75);

    await page.close();
  });
});

// ==========================================================================
// Suite 2: Programmatic flight launch + malfunction mode control
// ==========================================================================

test.describe('E2E Infrastructure — Test Flight & Malfunction Mode', () => {

  /** Helper: create a page, seed, load, and start a test flight. */
  async function setupFlight(browser: Browser): Promise<Page> {
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = freshStartFixture({ parts: ALL_PARTS });
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, ['probe-core-mk1', 'tank-small', 'engine-spark']);
    return page;
  }

  test('(1) flight scene is active with physics state exposed', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await setupFlight(browser);

    const ps = await getPhysicsSnapshot(page);
    expect(ps).not.toBeNull();
    expect(ps!.posY).toBeGreaterThanOrEqual(0);
    expect(ps!.grounded).toBe(true);

    await page.close();
  });

  test('(2) malfunction mode controls are exposed during flight', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await setupFlight(browser);

    const hasSetFn: boolean = await page.evaluate(() => typeof window.__setMalfunctionMode === 'function');
    const hasGetFn: boolean = await page.evaluate(() => typeof window.__getMalfunctionMode === 'function');
    expect(hasSetFn).toBe(true);
    expect(hasGetFn).toBe(true);

    await page.close();
  });

  test('(3) default malfunction mode is "off" (test determinism)', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await setupFlight(browser);

    const mode: string = await getMalfunctionMode(page);
    expect(mode).toBe('off');

    await page.close();
  });

  test('(4) can set malfunction mode to "normal"', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await setupFlight(browser);

    await setMalfunctionMode(page, 'normal');
    const mode: string = await getMalfunctionMode(page);
    expect(mode).toBe('normal');

    await page.close();
  });

  test('(5) can set malfunction mode to "forced"', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await setupFlight(browser);

    await setMalfunctionMode(page, 'forced');
    const mode: string = await getMalfunctionMode(page);
    expect(mode).toBe('forced');

    await page.close();
  });

  test('(6) can reset malfunction mode back to "off"', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await setupFlight(browser);

    // Set to normal first, then reset to off
    await setMalfunctionMode(page, 'normal');
    await setMalfunctionMode(page, 'off');
    const mode: string = await getMalfunctionMode(page);
    expect(mode).toBe('off');

    await page.close();
  });
});

// ==========================================================================
// Suite 3: Mission test fixture + objective verification
// ==========================================================================

test.describe('E2E Infrastructure — Objective Verification', () => {

  const TEST_MISSION: MissionTemplate = {
    id:          'test-mission-infra',
    title:       'Infrastructure Test Mission',
    description: 'Reach 50 m altitude.',
    location:    'desert',
    objectives: [{
      id:          'obj-infra-1',
      type:        'REACH_ALTITUDE',
      target:      { altitude: 50 },
      completed:   false,
      description: 'Reach 50 m altitude',
    }],
    reward:        10_000,
    unlocksAfter:  [],
    unlockedParts: [],
  };

  /** Helper: create a page, seed mission fixture, load, and start flight. */
  async function setupMissionFlight(browser: Browser): Promise<Page> {
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    // @ts-expect-error — MissionTemplate is structurally compatible with MissionFixtureInput
    const envelope = missionTestFixture(TEST_MISSION);
    await seedAndLoadSave(page, envelope);

    // Verify mission was injected
    const gs = await getGameState(page) as GameStateSnapshot;
    expect(gs.missions.accepted).toHaveLength(1);
    expect(gs.missions.accepted[0].id).toBe('test-mission-infra');

    // Start flight programmatically with malfunctions off
    await startTestFlight(page, ['probe-core-mk1', 'tank-small', 'engine-spark']);
    return page;
  }

  test('(1) objective starts incomplete before staging', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await setupMissionFlight(browser);

    const complete: boolean = await areAllObjectivesComplete(page, 'test-mission-infra');
    expect(complete).toBe(false);

    await page.close();
  });

  test('(2) malfunctions are disabled for determinism', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await setupMissionFlight(browser);

    const mode: string = await getMalfunctionMode(page);
    expect(mode).toBe('off');

    await page.close();
  });

  test('(3) stage rocket and wait for altitude objective', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await setupMissionFlight(browser);

    await page.keyboard.press('Space');

    // Wait for the rocket to reach 50 m
    await waitForAltitude(page, 50, 15_000);

    const ps = await getPhysicsSnapshot(page);
    expect(ps).not.toBeNull();
    expect(ps!.posY).toBeGreaterThanOrEqual(50);

    await page.close();
  });

  test('(4) REACH_ALTITUDE objective completes automatically', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await setupMissionFlight(browser);

    // Stage the rocket and fly to trigger the objective
    await page.keyboard.press('Space');
    await waitForAltitude(page, 50, 15_000);

    await waitForObjectiveComplete(page, 'test-mission-infra', 'obj-infra-1', 10_000);

    const complete: boolean = await areAllObjectivesComplete(page, 'test-mission-infra');
    expect(complete).toBe(true);

    await page.close();
  });
});

// ==========================================================================
// Suite 4: Contract test fixture with objective factories
// ==========================================================================

test.describe('E2E Infrastructure — Contract Fixture', () => {
  test('contract test fixture injects active contract correctly', async ({ browser }: { browser: Browser }) => {
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const contract: ReturnType<typeof buildContract> = buildContract({
      id:    'contract-infra-test',
      title: 'Infrastructure Test Contract',
      objectives: [
        buildObjective({
          id:     'cobj-1',
          type:   'REACH_ALTITUDE',
          target: { altitude: 200 },
        }),
        buildObjective({
          id:     'cobj-2',
          type:   'REACH_SPEED',
          target: { speed: 100 },
        }),
      ],
      reward: 75_000,
    });

    const envelope = contractTestFixture(contract);
    await seedAndLoadSave(page, envelope);

    const gs = await getGameState(page) as GameStateSnapshot;
    expect(gs.contracts.active).toHaveLength(1);
    expect(gs.contracts.active[0].id).toBe('contract-infra-test');
    expect(gs.contracts.active[0].objectives).toHaveLength(2);
    expect(gs.contracts.active[0].objectives[0].completed).toBe(false);
    expect(gs.contracts.active[0].objectives[1].completed).toBe(false);

    await page.close();
  });
});

// ==========================================================================
// Suite 5: buildSaveEnvelope covers all state fields
// ==========================================================================

test.describe('E2E Infrastructure — Full State Coverage', () => {
  test('buildSaveEnvelope includes all GameState fields', async ({ browser }: { browser: Browser }) => {
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope = buildSaveEnvelope({
      money:            5_000_000,
      currentPeriod:    15,
      reputation:       80,
      sciencePoints:    50,
      scienceLog:       [{ instrumentId: 'thermometer-mk1', biomeId: 'lower-atmosphere', count: 2 }],
      techTree:         { researched: ['basic-rocketry'], unlockedInstruments: ['thermometer-mk1'] },
      satelliteNetwork: { satellites: [{ id: 'sat-1', name: 'TestSat', partId: 'satellite-mk1', bodyId: 'EARTH', bandId: 'LEO', health: 100, autoMaintain: false, deployedPeriod: 5 }] },
      facilities:       ALL_FACILITIES,
      tutorialMode:     false,
      contracts:        { board: [], active: [], completed: [{ id: 'c-done', title: 'Done' }], failed: [] },
    });

    await seedAndLoadSave(page, envelope);
    const gs = await getGameState(page) as GameStateSnapshot;

    expect(gs.money).toBe(5_000_000);
    expect(gs.currentPeriod).toBe(15);
    expect(gs.reputation).toBe(80);
    expect(gs.sciencePoints).toBe(50);
    expect(gs.scienceLog).toHaveLength(1);
    expect(gs.techTree.researched).toContain('basic-rocketry');
    expect(gs.techTree.unlockedInstruments).toContain('thermometer-mk1');
    expect(gs.satelliteNetwork.satellites).toHaveLength(1);
    expect(gs.facilities['crew-admin']?.built).toBe(true);
    expect(gs.tutorialMode).toBe(false);
    expect(gs.contracts.completed).toHaveLength(1);

    await page.close();
  });
});

// ==========================================================================
// Suite 6: Programmatic time warp API
// ==========================================================================

test.describe('E2E Infrastructure — Time Warp API', () => {

  /** Helper: create a page, seed, load, and start a test flight. */
  async function setupFlight(browser: Browser): Promise<Page> {
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });
    const envelope = freshStartFixture({ parts: ALL_PARTS });
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, ['probe-core-mk1', 'tank-small', 'engine-spark']);
    return page;
  }

  test('(1) time warp API is exposed during flight', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await setupFlight(browser);

    const hasSet: boolean = await page.evaluate(() => typeof window.__testSetTimeWarp === 'function');
    const hasGet: boolean = await page.evaluate(() => typeof window.__testGetTimeWarp === 'function');
    expect(hasSet).toBe(true);
    expect(hasGet).toBe(true);

    await page.close();
  });

  test('(2) default time warp is 1x', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await setupFlight(browser);

    const warp: number = await getTestTimeWarp(page);
    expect(warp).toBe(1);

    await page.close();
  });

  test('(3) can set time warp to 100x and simulation time advances faster than real time', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await setupFlight(browser);

    // Record starting simulation time
    const startSimTime: number = await page.evaluate(() => {
      const fs = window.__flightState;
      return fs ? fs.timeElapsed : 0;
    });

    // Set time warp to 100x
    await setTestTimeWarp(page, 100);
    const warp: number = await getTestTimeWarp(page);
    expect(warp).toBe(100);

    // Stage the rocket so it's flying (physics advances timeElapsed only when not idle-landed)
    await page.keyboard.press('Space');

    // Wait a short real-time period for physics to advance
    const realStartMs: number = Date.now();
    await page.waitForFunction(
      (startTime: number) => {
        const fs = window.__flightState;
        // Wait until at least 5 sim-seconds have elapsed beyond our start
        return fs != null && (fs.timeElapsed - startTime) >= 5;
      },
      startSimTime,
      { timeout: 10_000 },
    );
    const realElapsedMs: number = Date.now() - realStartMs;

    // Read final simulation time
    const endSimTime: number = await page.evaluate(() => {
      const fs = window.__flightState;
      return fs ? fs.timeElapsed : 0;
    });

    const simElapsed: number = endSimTime - startSimTime;

    // Simulation time should have advanced much faster than real time.
    // With 100x warp, 5 sim-seconds should take ~50ms real time (plus overhead).
    // We just verify that sim time advanced at least 10x faster than real time.
    const realElapsedSec: number = realElapsedMs / 1000;
    expect(simElapsed).toBeGreaterThan(realElapsedSec * 10);

    await page.close();
  });

  test('(4) can reset time warp back to 1x', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await setupFlight(browser);

    // Set to a different warp first, then reset
    await setTestTimeWarp(page, 50);
    await setTestTimeWarp(page, 1);
    const warp: number = await getTestTimeWarp(page);
    expect(warp).toBe(1);

    await page.close();
  });
});
