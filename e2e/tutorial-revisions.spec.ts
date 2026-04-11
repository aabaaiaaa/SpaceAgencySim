/**
 * E2E — Tutorial Revisions (TASK-062)
 *
 * Tests covering the revised tutorial mission chain:
 *   - Missions 1 and 4 completable with starter parts only
 *   - Unlock chain progression (missions unlocking after prerequisites)
 *   - Facility tutorial awards (Crew Admin, R&D Lab, Tracking Station, Satellite Ops)
 *   - Facility tutorial flights (M018, M019, M021, M022)
 *   - Instrument-in-module system (M008, M010)
 *   - Orbital gameplay systems (M014-M017)
 *
 * All tests are independent and run in parallel (4 workers).
 */

import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  VP_W, VP_H,
  FacilityId,
  STARTER_FACILITIES,
  ALL_FACILITIES,
  buildSaveEnvelope,
  buildCrewMember,
  seedAndLoadSave,
  startTestFlight,
  waitForAltitude,
  teleportCraft,
  pressStage,
  pressThrottleUp,
} from './helpers.js';
import type { FacilityState, CrewMember, SaveEnvelope } from './helpers.js';

// ---------------------------------------------------------------------------
// Tutorial-mode starter parts (minimum available at game start)
// ---------------------------------------------------------------------------

const TUTORIAL_STARTERS: string[] = ['probe-core-mk1', 'tank-small', 'engine-spark'];

// ---------------------------------------------------------------------------
// Compact mission data (objectives, rewards, dependencies)
// ---------------------------------------------------------------------------

interface MissionObjectiveData {
  id: string;
  type: string;
  target: Record<string, number | string>;
}

interface MissionData {
  title: string;
  objectives: MissionObjectiveData[];
  reward: number;
  unlocksAfter: string[];
  unlockedParts: string[];
  requiredParts?: string[];
  awardsFacilityOnAccept?: string;
}

const MD: Record<string, MissionData> = {
  'mission-001': {
    title: 'First Flight',
    objectives: [{ id: 'obj-001-1', type: 'REACH_ALTITUDE', target: { altitude: 100 } }],
    reward: 25_000, unlocksAfter: [], unlockedParts: [],
  },
  'mission-004': {
    title: 'Speed Demon',
    objectives: [{ id: 'obj-004-1', type: 'REACH_SPEED', target: { speed: 150 } }],
    reward: 30_000, unlocksAfter: ['mission-001'], unlockedParts: [],
  },
  'mission-005': {
    title: 'Safe Return I',
    objectives: [{ id: 'obj-005-1', type: 'SAFE_LANDING', target: { maxLandingSpeed: 10 } }],
    reward: 35_000, unlocksAfter: ['mission-004'],
    unlockedParts: ['parachute-mk2', 'science-module-mk1', 'thermometer-mk1'],
  },
  'mission-006': {
    title: 'Controlled Descent',
    objectives: [
      { id: 'obj-006-1', type: 'ACTIVATE_PART', target: { partType: 'ENGINE' } },
      { id: 'obj-006-2', type: 'SAFE_LANDING', target: { maxLandingSpeed: 5 } },
    ],
    reward: 40_000, unlocksAfter: ['mission-004'], unlockedParts: ['landing-legs-small'],
  },
  'mission-007': {
    title: 'Leg Day',
    objectives: [
      { id: 'obj-007-1', type: 'ACTIVATE_PART', target: { partType: 'LANDING_LEGS' } },
      { id: 'obj-007-2', type: 'SAFE_LANDING', target: { maxLandingSpeed: 10 } },
    ],
    reward: 40_000, unlocksAfter: ['mission-006'], unlockedParts: ['landing-legs-large'],
  },
  'mission-008': {
    title: 'Black Box Test',
    objectives: [
      { id: 'obj-008-1', type: 'ACTIVATE_PART', target: { partType: 'SERVICE_MODULE' } },
      { id: 'obj-008-2', type: 'CONTROLLED_CRASH', target: { minCrashSpeed: 50 } },
    ],
    reward: 55_000, unlocksAfter: ['mission-005'], unlockedParts: [],
  },
  'mission-010': {
    title: 'Science Experiment Alpha',
    objectives: [
      { id: 'obj-010-1', type: 'HOLD_ALTITUDE', target: { minAltitude: 800, maxAltitude: 1_200, duration: 30 } },
      { id: 'obj-010-2', type: 'RETURN_SCIENCE_DATA', target: {} },
    ],
    reward: 75_000, unlocksAfter: ['mission-008'], unlockedParts: ['engine-poodle'],
  },
  'mission-012': {
    title: 'Stage Separation Test',
    objectives: [
      { id: 'obj-012-1', type: 'REACH_ALTITUDE', target: { altitude: 2_000 } },
      { id: 'obj-012-2', type: 'ACTIVATE_PART', target: { partType: 'STACK_DECOUPLER' } },
    ],
    reward: 90_000, unlocksAfter: ['mission-010'],
    unlockedParts: ['engine-reliant', 'srb-small'],
  },
  'mission-014': {
    title: 'Karman Line Approach',
    objectives: [{ id: 'obj-014-1', type: 'REACH_ALTITUDE', target: { altitude: 60_000 } }],
    reward: 200_000, unlocksAfter: ['mission-012'],
    unlockedParts: ['engine-nerv', 'srb-large'],
  },
  'mission-015': {
    title: 'Orbital Satellite Deployment I',
    objectives: [
      { id: 'obj-015-1', type: 'REACH_ORBIT', target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 } },
      { id: 'obj-015-2', type: 'RELEASE_SATELLITE', target: { minAltitude: 80_000 } },
    ],
    reward: 250_000, unlocksAfter: ['mission-016'], unlockedParts: [],
  },
  'mission-016': {
    title: 'Low Earth Orbit',
    objectives: [{ id: 'obj-016-1', type: 'REACH_ORBIT', target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 } }],
    reward: 500_000, unlocksAfter: ['mission-014'],
    unlockedParts: ['tank-large', 'engine-reliant'],
  },
  'mission-017': {
    title: 'Tracked Satellite Deployment',
    objectives: [
      { id: 'obj-017-1', type: 'REACH_ORBIT', target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 } },
      { id: 'obj-017-2', type: 'RELEASE_SATELLITE', target: { minAltitude: 80_000 } },
    ],
    reward: 350_000, unlocksAfter: ['mission-015', 'mission-020'], unlockedParts: [],
  },
  'mission-018': {
    title: 'First Crew Flight',
    objectives: [
      { id: 'obj-018-1', type: 'MINIMUM_CREW', target: { minCrew: 1 } },
      { id: 'obj-018-2', type: 'SAFE_LANDING', target: { maxLandingSpeed: 10 } },
    ],
    reward: 60_000, unlocksAfter: ['mission-009'], unlockedParts: [],
    requiredParts: ['cmd-mk1'], awardsFacilityOnAccept: 'crew-admin',
  },
  'mission-019': {
    title: 'Research Division',
    objectives: [
      { id: 'obj-019-1', type: 'REACH_ALTITUDE', target: { altitude: 5_000 } },
      { id: 'obj-019-2', type: 'RETURN_SCIENCE_DATA', target: {} },
    ],
    reward: 120_000, unlocksAfter: ['mission-010'], unlockedParts: [],
    requiredParts: ['science-module-mk1'], awardsFacilityOnAccept: 'rd-lab',
  },
  'mission-020': {
    title: 'Eyes on the Sky',
    objectives: [{ id: 'obj-020-1', type: 'REACH_ORBIT', target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 } }],
    reward: 250_000, unlocksAfter: ['mission-016'],
    unlockedParts: ['docking-port-std'],
    awardsFacilityOnAccept: 'tracking-station',
  },
  'mission-021': {
    title: 'Orbital Survey',
    objectives: [
      { id: 'obj-021-1', type: 'REACH_ORBIT', target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 } },
      { id: 'obj-021-2', type: 'RETURN_SCIENCE_DATA', target: {} },
    ],
    reward: 200_000, unlocksAfter: ['mission-020'], unlockedParts: [],
  },
  'mission-022': {
    title: 'Network Control',
    objectives: [
      { id: 'obj-022-1', type: 'REACH_ORBIT', target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 } },
      { id: 'obj-022-2', type: 'MULTI_SATELLITE', target: { count: 2, minAltitude: 80_000 } },
    ],
    reward: 400_000, unlocksAfter: ['mission-017'], unlockedParts: [],
  },
};

// ---------------------------------------------------------------------------
// Mission state shape returned by mk* helpers
// ---------------------------------------------------------------------------

interface MissionObjectiveState {
  id: string;
  type: string;
  target: Record<string, number | string>;
  completed: boolean;
  description: string;
}

interface MissionState {
  id: string;
  title: string;
  description: string;
  location: string;
  objectives: MissionObjectiveState[];
  reward: number;
  unlocksAfter: string[];
  unlockedParts: string[];
  status: string;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Save state helpers
// ---------------------------------------------------------------------------

function mkCompleted(id: string): MissionState {
  const d: MissionData | undefined = MD[id];
  if (!d) return { id, title: id, description: '', location: 'desert', objectives: [], reward: 0, unlocksAfter: [], unlockedParts: [], status: 'completed' };
  return {
    id, title: d.title, description: '', location: 'desert',
    objectives: d.objectives.map(o => ({ ...o, completed: true, description: '' })),
    reward: d.reward, unlocksAfter: d.unlocksAfter, unlockedParts: d.unlockedParts,
    status: 'completed',
  };
}

function mkAccepted(id: string): MissionState {
  const d: MissionData = MD[id];
  const m: MissionState = {
    id, title: d.title, description: '', location: 'desert',
    objectives: d.objectives.map(o => ({ ...o, completed: false, description: '' })),
    reward: d.reward, unlocksAfter: d.unlocksAfter, unlockedParts: d.unlockedParts,
    status: 'accepted',
  };
  if (d.requiredParts) m.requiredParts = d.requiredParts;
  if (d.awardsFacilityOnAccept) m.awardsFacilityOnAccept = d.awardsFacilityOnAccept;
  return m;
}

function mkAvailable(id: string): MissionState {
  const d: MissionData = MD[id];
  const m: MissionState = {
    id, title: d.title, description: '', location: 'desert',
    objectives: d.objectives.map(o => ({ ...o, completed: false, description: '' })),
    reward: d.reward, unlocksAfter: d.unlocksAfter, unlockedParts: d.unlockedParts,
    status: 'available',
  };
  if (d.requiredParts) m.requiredParts = d.requiredParts;
  if (d.awardsFacilityOnAccept) m.awardsFacilityOnAccept = d.awardsFacilityOnAccept;
  return m;
}

/** Parameter interface for tutorialSave helper. */
interface TutorialSaveOptions {
  completedIds?: string[];
  acceptedId?: string | null;
  availableIds?: string[];
  parts?: string[];
  crew?: CrewMember[];
  facilities?: Readonly<Record<string, FacilityState>>;
  [key: string]: unknown;
}

/** Build a tutorial-mode save envelope. */
function tutorialSave({
  completedIds = [],
  acceptedId = null,
  availableIds = [],
  parts = TUTORIAL_STARTERS,
  crew = [],
  facilities = { ...STARTER_FACILITIES },
  ...extra
}: TutorialSaveOptions = {}): SaveEnvelope {
  return buildSaveEnvelope({
    saveName: 'Tutorial Revisions E2E',
    tutorialMode: true,
    money: 10_000_000,
    parts,
    crew,
    facilities,
    missions: {
      available: availableIds.map(mkAvailable),
      accepted: acceptedId ? [mkAccepted(acceptedId)] : [],
      completed: completedIds.map(mkCompleted),
    },
    ...extra,
  });
}

// ---------------------------------------------------------------------------
// Flight helpers
// ---------------------------------------------------------------------------

async function waitSpeed(page: Page, speed: number, timeout: number = 60_000): Promise<void> {
  await page.waitForFunction(
    (spd: number) => {
      const ps = window.__flightPs;
      if (!ps) return false;
      return Math.hypot(ps.velX, ps.velY) >= spd;
    },
    speed, { timeout },
  );
}

async function waitLanded(page: Page, timeout: number = 60_000): Promise<void> {
  await page.waitForFunction(
    () => window.__flightPs?.landed === true || window.__flightPs?.crashed === true,
    { timeout },
  );
}

async function setWarp(page: Page, factor: number): Promise<void> {
  await page.waitForFunction(
    () => !(document.querySelector('.hud-warp-btn') as HTMLButtonElement | null)?.disabled,
    { timeout: 10_000 },
  );
  await page.evaluate((f: number) => window.__testSetTimeWarp?.(f), factor);
}

async function triggerReturnViaMenu(page: Page): Promise<void> {
  await page.click('#topbar-menu-btn', { force: true });
  const dropdown = page.locator('#topbar-dropdown');
  await expect(dropdown).toBeVisible({ timeout: 5_000 });
  await dropdown.getByText('Return to Space Agency').click();

  // Handle different return flows — orbit return (ORBIT phase) or abort (FLIGHT).
  const orbitBtn = page.locator('[data-testid="orbit-return-btn"]');
  const abortBtn = page.locator('[data-testid="abort-confirm-btn"]');
  const orbitVisible: boolean = await orbitBtn.isVisible({ timeout: 2_000 }).catch(() => false);
  if (orbitVisible) {
    await orbitBtn.click();
  } else {
    const abortVisible: boolean = await abortBtn.isVisible({ timeout: 2_000 }).catch(() => false);
    if (abortVisible) {
      await abortBtn.click();
    }
  }
}

async function returnToHub(page: Page): Promise<void> {
  // With startTestFlight, the hub-overlay may be visible BEHIND the flight
  // scene.  Always check for the post-flight summary first — clicking its
  // return button triggers processFlightReturn (mission completion).
  const hasSummary: boolean = await page.waitForSelector(
    '#post-flight-summary', { state: 'visible', timeout: 5_000 },
  ).then(() => true).catch(() => false);

  if (hasSummary) {
    await page.click('#post-flight-return-btn');
  } else {
    // No summary — might be at hub (via abort) or still need to dismiss abort dialog.
    const abortBtn = page.locator('[data-testid="abort-confirm-btn"]');
    const didAbort: boolean = await abortBtn.isVisible({ timeout: 1_000 }).catch(() => false);
    if (didAbort) {
      await abortBtn.click();
    }
  }

  // Dismiss unlock notification modal if present (new parts unlocked).
  try {
    const unlockBackdrop = page.locator('#unlock-notification-backdrop');
    await unlockBackdrop.waitFor({ state: 'visible', timeout: 5_000 });
    await unlockBackdrop.locator('.confirm-btn').click();
    await unlockBackdrop.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
  } catch { /* no unlock notification */ }

  // Dismiss return-results overlay if present.
  try {
    const dismissBtn = page.locator('#return-results-dismiss-btn');
    await dismissBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await dismissBtn.click();
    await page.waitForSelector('#return-results-overlay', { state: 'hidden', timeout: 5_000 }).catch(() => {});
  } catch { /* no return results overlay */ }
  await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
}

async function stage(page: Page): Promise<void> {
  await pressStage(page);
}

async function expectCompleted(page: Page, missionId: string): Promise<void> {
  const ok: boolean = await page.evaluate(
    (id: string) => window.__gameState?.missions?.completed?.some(m => m.id === id) ?? false,
    missionId,
  );
  expect(ok).toBe(true);
}

async function expectPartUnlocked(page: Page, partId: string): Promise<void> {
  const ok: boolean = await page.evaluate(
    (id: string) => window.__gameState?.parts?.includes(id) ?? false,
    partId,
  );
  expect(ok).toBe(true);
}

async function expectFacilityBuilt(page: Page, facilityId: string): Promise<void> {
  const ok: boolean = await page.evaluate(
    (id: string) => window.__gameState?.facilities?.[id]?.built === true,
    facilityId,
  );
  expect(ok).toBe(true);
}

async function expectMissionAvailable(page: Page, missionId: string): Promise<void> {
  const ok: boolean = await page.evaluate(
    (id: string) => window.__gameState?.missions?.available?.some(m => m.id === id) ?? false,
    missionId,
  );
  expect(ok).toBe(true);
}

/** Teleport the rocket to orbital conditions. */
async function teleportToOrbitConditions(page: Page): Promise<void> {
  await teleportCraft(page, { posY: 85_000, velX: 8_000 });
}

/** Completed mission IDs for a given range. */
function missionRange(start: number, end: number): string[] {
  const ids: string[] = [];
  for (let i: number = start; i <= end; i++) {
    ids.push(`mission-${String(i).padStart(3, '0')}`);
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe('Tutorial Revisions', () => {
  test.describe.configure({ timeout: 300_000 });

  // =========================================================================
  // GROUP 1: Starter Parts Only — M001-M004
  // =========================================================================

  test.describe('Starter Parts — M001-M004', () => {

    test('M001 — First Flight (reach 100m) with tutorial starters', async ({ page }: { page: Page }) => {
      test.setTimeout(90_000);
      const env: SaveEnvelope = tutorialSave({ acceptedId: 'mission-001' });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);
      await startTestFlight(page, TUTORIAL_STARTERS);
      await stage(page);
      await pressThrottleUp(page);
      await waitForAltitude(page, 100);
      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-001');
    });

    test('M004 — Speed Demon (reach 150 m/s) with tutorial starters', async ({ page }: { page: Page }) => {
      test.setTimeout(90_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001'],
        acceptedId: 'mission-004',
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);
      await startTestFlight(page, TUTORIAL_STARTERS);
      await stage(page);
      await pressThrottleUp(page);
      await waitSpeed(page, 150);
      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-004');
    });
  });

  // =========================================================================
  // GROUP 2: Unlock Chain Progression
  // =========================================================================

  test.describe('Unlock Chain Progression', () => {

    test('completing M004 unlocks M005 and M006', async ({ page }: { page: Page }) => {
      test.setTimeout(90_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001'],
        acceptedId: 'mission-004',
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      // Complete M004 via flight.
      await startTestFlight(page, TUTORIAL_STARTERS);
      await stage(page);
      await pressThrottleUp(page);
      await waitSpeed(page, 150);
      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-004');

      // Verify both parallel tracks unlocked.
      await expectMissionAvailable(page, 'mission-005');
      await expectMissionAvailable(page, 'mission-006');
    });

    test('completing M005 awards parachute-mk2, science-module-mk1, thermometer-mk1', async ({ page }: { page: Page }) => {
      test.setTimeout(120_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004'],
        acceptedId: 'mission-005',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1'],
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      // M005: safe landing at <=10 m/s. Use parachute + burn all fuel for light mass.
      await startTestFlight(page,
        ['parachute-mk1', 'probe-core-mk1', 'tank-small', 'engine-spark'],
        { staging: [{ partIds: ['engine-spark'] }, { partIds: ['parachute-mk1'] }] },
      );
      await stage(page); // fire engine
      await pressThrottleUp(page);
      await waitForAltitude(page, 50);
      // Wait for fuel depletion.
      await page.waitForFunction(
        () => window.__flightPs?.firingEngines?.size === 0,
        { timeout: 30_000 },
      );
      await stage(page); // deploy parachute
      await setWarp(page, 100);
      await waitLanded(page, 120_000);
      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-005');
      await expectPartUnlocked(page, 'parachute-mk2');
      await expectPartUnlocked(page, 'science-module-mk1');
      await expectPartUnlocked(page, 'thermometer-mk1');
    });

    test('completing M010 unlocks M019 (R&D Lab tutorial)', async ({ page }: { page: Page }) => {
      test.setTimeout(180_000);
      // Seed state: M001-M005, M008 completed (M010 prerequisites).
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004', 'mission-005', 'mission-008'],
        acceptedId: 'mission-010',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'parachute-mk2',
          'science-module-mk1', 'thermometer-mk1'],
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      // M010: hold 800-1200m for 30s + return science data.
      // Build: parachute-mk2 + probe + science-module + tank + engine.
      // Staging: 0=engine, 1=parachute, 2=science-module.
      await startTestFlight(page,
        ['parachute-mk2', 'probe-core-mk1', 'science-module-mk1', 'tank-small', 'engine-spark'],
        {
          instruments: { 'science-module-mk1': ['thermometer-mk1'] },
          staging: [
            { partIds: ['engine-spark'] },
            { partIds: ['parachute-mk2'] },
            { partIds: ['science-module-mk1'] },
          ],
        },
      );

      await stage(page); // Stage 0: fire engine
      await pressThrottleUp(page);
      await waitForAltitude(page, 1_400);
      await page.keyboard.press('x'); // cut throttle

      // Deploy parachute (Stage 1).
      await stage(page);
      await setWarp(page, 100);

      // Wait until descending near the band ceiling.
      await page.waitForFunction(
        () => {
          const ps = window.__flightPs;
          return ps && ps.posY <= 1_400 && ps.velY <= 0;
        },
        { timeout: 60_000 },
      );
      await setWarp(page, 5);

      // Wait until inside the altitude band (<= 1200m).
      await page.waitForFunction(
        () => (window.__flightPs?.posY ?? Infinity) <= 1_200,
        { timeout: 30_000 },
      );

      // Activate science module (Stage 2).
      await setWarp(page, 1);
      await stage(page);

      // Warp through the 30s hold.
      await setWarp(page, 100);
      await page.waitForFunction(
        (id: string) => {
          const state = window.__gameState;
          const m = state?.missions?.accepted?.find(x => x.id === id);
          return m?.objectives?.find(o => o.type === 'HOLD_ALTITUDE')?.completed;
        },
        'mission-010',
        { timeout: 90_000 },
      );

      // Continue warp descent to landing.
      await waitLanded(page);
      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-010');

      // Verify M019 (R&D Lab tutorial) unlocked.
      await expectMissionAvailable(page, 'mission-019');
    });

    test('completing M016 unlocks M015 and M020 (Tracking Station tutorial)', async ({ page }: { page: Page }) => {
      test.setTimeout(120_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004', 'mission-005', 'mission-008', 'mission-010', 'mission-012', 'mission-014'],
        acceptedId: 'mission-016',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'tank-medium',
          'engine-reliant', 'engine-nerv', 'decoupler-stack-tr18'],
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      // M016: reach orbit (>=80km, >=7800 m/s).
      await startTestFlight(page,
        ['probe-core-mk1', 'tank-small', 'engine-spark'],
      );
      await stage(page);
      await pressThrottleUp(page);
      await waitForAltitude(page, 100);

      // Teleport to orbital conditions.
      await teleportToOrbitConditions(page);
      await page.waitForFunction(
        (id: string) => {
          const m = window.__gameState?.missions?.accepted?.find(x => x.id === id);
          return m?.objectives?.every(o => o.completed);
        },
        'mission-016',
        { timeout: 10_000 },
      );

      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-016');

      // Verify orbital missions unlocked.
      await expectMissionAvailable(page, 'mission-015');
      await expectMissionAvailable(page, 'mission-020');
    });

    test('completing M017 unlocks M022 (Satellite Network Ops tutorial)', async ({ page }: { page: Page }) => {
      test.setTimeout(120_000);
      const allPrev: string[] = ['mission-001', ...missionRange(4, 16), 'mission-020'];
      const env: SaveEnvelope = tutorialSave({
        completedIds: allPrev,
        acceptedId: 'mission-017',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'satellite-mk1',
          'decoupler-stack-tr18', 'tank-medium', 'engine-nerv', 'engine-reliant',
          'tank-large', 'docking-port-std'],
        facilities: { ...ALL_FACILITIES },
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      // M017: orbit + release satellite.
      await startTestFlight(page,
        ['satellite-mk1', 'decoupler-stack-tr18', 'probe-core-mk1', 'tank-small', 'engine-spark'],
      );
      await stage(page);
      await pressThrottleUp(page);
      await waitForAltitude(page, 100);
      await teleportToOrbitConditions(page);

      // Wait for REACH_ORBIT objective.
      await page.waitForFunction(
        () => {
          const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-017');
          return m?.objectives?.find(o => o.type === 'REACH_ORBIT')?.completed;
        },
        { timeout: 10_000 },
      );

      // Release satellite (decoupler in auto-staged position).
      await stage(page);
      await page.waitForFunction(
        () => {
          const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-017');
          return m?.objectives?.every(o => o.completed);
        },
        { timeout: 10_000 },
      );

      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-017');

      // Verify M022 (Satellite Network Ops tutorial) unlocked.
      await expectMissionAvailable(page, 'mission-022');
    });
  });

  // =========================================================================
  // GROUP 3: Facility Tutorial Awards (Mission Control UI)
  // =========================================================================

  test.describe('Facility Tutorial Awards', () => {

    test('accepting M018 awards CREW_ADMIN facility and cmd-mk1 part', async ({ page }: { page: Page }) => {
      test.setTimeout(60_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004', 'mission-006', 'mission-007', 'mission-009'],
        availableIds: ['mission-018'],
        parts: TUTORIAL_STARTERS,
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      // Navigate to Mission Control and accept M018.
      await page.click('[data-building-id="mission-control"]');
      await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
      await page.click('.mc-accept-btn');

      // Verify CREW_ADMIN facility awarded.
      await expectFacilityBuilt(page, FacilityId.CREW_ADMIN);
      // Verify cmd-mk1 part unlocked (requiredParts on acceptance).
      await expectPartUnlocked(page, 'cmd-mk1');
    });

    test('accepting M019 awards RD_LAB facility', async ({ page }: { page: Page }) => {
      test.setTimeout(60_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004', 'mission-005', 'mission-008', 'mission-010'],
        availableIds: ['mission-019'],
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'science-module-mk1', 'thermometer-mk1'],
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      await page.click('[data-building-id="mission-control"]');
      await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
      await page.click('.mc-accept-btn');

      await expectFacilityBuilt(page, FacilityId.RD_LAB);
    });

    test('accepting M020 awards TRACKING_STATION facility', async ({ page }: { page: Page }) => {
      test.setTimeout(60_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004', 'mission-005', 'mission-008', 'mission-010',
          'mission-012', 'mission-014', 'mission-016'],
        availableIds: ['mission-020'],
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'tank-medium',
          'engine-reliant', 'engine-nerv', 'tank-large'],
        facilities: { ...STARTER_FACILITIES },
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      await page.click('[data-building-id="mission-control"]');
      await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
      await page.click('.mc-accept-btn');

      await expectFacilityBuilt(page, FacilityId.TRACKING_STATION);
    });

    test('accepting M022 awards SATELLITE_OPS facility', async ({ page }: { page: Page }) => {
      test.setTimeout(60_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', ...missionRange(4, 17), 'mission-020'],
        availableIds: ['mission-022'],
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'satellite-mk1',
          'decoupler-stack-tr18', 'tank-medium', 'engine-reliant',
          'engine-nerv', 'tank-large', 'docking-port-std'],
        facilities: { ...ALL_FACILITIES },
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      await page.click('[data-building-id="mission-control"]');
      await page.waitForSelector('#mission-control-overlay', { state: 'visible', timeout: 10_000 });
      await page.click('.mc-accept-btn');

      await expectFacilityBuilt(page, FacilityId.SATELLITE_OPS);
    });

    test('completing M020 awards docking-port-std', async ({ page }: { page: Page }) => {
      test.setTimeout(120_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004', 'mission-005', 'mission-008', 'mission-010',
          'mission-012', 'mission-014', 'mission-016'],
        acceptedId: 'mission-020',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'tank-medium',
          'engine-reliant', 'engine-nerv', 'tank-large'],
        facilities: {
          ...STARTER_FACILITIES,
          [FacilityId.TRACKING_STATION]: { built: true, tier: 1 },
        },
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      // M020: reach orbit.
      await startTestFlight(page, ['probe-core-mk1', 'tank-small', 'engine-spark']);
      await stage(page);
      await pressThrottleUp(page);
      await waitForAltitude(page, 100);
      await teleportToOrbitConditions(page);

      await page.waitForFunction(
        () => {
          const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-020');
          return m?.objectives?.every(o => o.completed);
        },
        { timeout: 10_000 },
      );

      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-020');
      await expectPartUnlocked(page, 'docking-port-std');
    });
  });

  // =========================================================================
  // GROUP 4: Facility Tutorial Flights
  // =========================================================================

  test.describe('Facility Tutorial Flights', () => {

    test('M018 — First Crew Flight (crew + safe landing)', async ({ page }: { page: Page }) => {
      test.setTimeout(120_000);
      const crew: CrewMember[] = [buildCrewMember({ id: 'crew-1', name: 'Test Pilot' })];
      // Realistic state: player completed through M009 (awards cmd-mk1 via M018 prereq).
      // cmd-mk1 dry mass + crew is too heavy for parachute-mk1 (legless landing
      // requires <=5 m/s).  parachute-mk2 provides enough drag.
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004', 'mission-005', 'mission-006', 'mission-007', 'mission-009'],
        acceptedId: 'mission-018',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'parachute-mk2', 'cmd-mk1'],
        crew,
        facilities: {
          ...STARTER_FACILITIES,
          [FacilityId.CREW_ADMIN]: { built: true, tier: 1 },
        },
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      // M018: fly with crew + land safely.
      // parachute-mk2 + cmd-mk1 + tank-small + engine-spark.
      await startTestFlight(page,
        ['parachute-mk2', 'cmd-mk1', 'tank-small', 'engine-spark'],
        {
          crewIds: ['crew-1'],
          staging: [{ partIds: ['engine-spark'] }, { partIds: ['parachute-mk2'] }],
        },
      );

      await stage(page); // fire engine
      await pressThrottleUp(page);
      await waitForAltitude(page, 50);

      // Wait for fuel depletion.
      await page.waitForFunction(
        () => window.__flightPs?.firingEngines?.size === 0,
        { timeout: 30_000 },
      );

      // Deploy parachute.
      await stage(page);
      await setWarp(page, 100);
      await waitLanded(page, 120_000);

      // Safely landed crewed rocket — post-flight summary doesn't auto-trigger.
      // Manually return via the in-flight menu.
      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-018');
    });

    test('M019 — Research Division (5000m + return science)', async ({ page }: { page: Page }) => {
      test.setTimeout(180_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004', 'mission-005', 'mission-008', 'mission-010'],
        acceptedId: 'mission-019',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'parachute-mk2',
          'science-module-mk1', 'thermometer-mk1', 'tank-medium', 'engine-poodle'],
        facilities: {
          ...STARTER_FACILITIES,
          [FacilityId.RD_LAB]: { built: true, tier: 1 },
        },
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      // M019: reach 5000m + return science data.
      // Staging: 0=engine, 1=science-module, 2=parachute.
      await startTestFlight(page,
        ['parachute-mk2', 'probe-core-mk1', 'science-module-mk1', 'tank-small', 'engine-spark'],
        {
          instruments: { 'science-module-mk1': ['thermometer-mk1'] },
          staging: [
            { partIds: ['engine-spark'] },
            { partIds: ['science-module-mk1'] },
            { partIds: ['parachute-mk2'] },
          ],
        },
      );

      await stage(page); // fire engine
      await pressThrottleUp(page);

      // Activate science module at ~1000m.
      await waitForAltitude(page, 1_000);
      await stage(page); // activate science module

      // Continue climbing past 5000m.
      await setWarp(page, 100);
      await waitForAltitude(page, 5_000);
      await page.keyboard.press('x'); // cut throttle

      // Wait for science to be collected.
      await page.waitForFunction(
        () => window.__gameState?.currentFlight?.events?.some(e => e.type === 'SCIENCE_COLLECTED'),
        { timeout: 30_000 },
      );

      // Deploy parachute for safe descent.
      await setWarp(page, 1);
      await stage(page); // deploy parachute
      await setWarp(page, 100);
      await waitLanded(page, 120_000);

      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-019');
    });

    test('M021 — Orbital Survey (orbit + return science)', async ({ page }: { page: Page }) => {
      test.setTimeout(180_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004', 'mission-005', 'mission-008', 'mission-010',
          'mission-012', 'mission-014', 'mission-016', 'mission-020'],
        acceptedId: 'mission-021',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'parachute-mk2',
          'science-module-mk1', 'thermometer-mk1', 'tank-medium',
          'engine-reliant', 'engine-nerv', 'tank-large', 'docking-port-std'],
        facilities: { ...ALL_FACILITIES },
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      // M021: reach orbit + return science data.
      // Strategy: activate science during climb, teleport to orbit, teleport
      // back for safe parachute landing.
      await startTestFlight(page,
        ['parachute-mk2', 'probe-core-mk1', 'science-module-mk1', 'tank-small', 'engine-spark'],
        {
          instruments: { 'science-module-mk1': ['thermometer-mk1'] },
          staging: [
            { partIds: ['engine-spark'] },
            { partIds: ['science-module-mk1'] },
            { partIds: ['parachute-mk2'] },
          ],
        },
      );

      await stage(page); // fire engine
      await pressThrottleUp(page);

      // Activate science module at ~500m.
      await waitForAltitude(page, 500);
      await stage(page); // activate science module

      // Wait for science data to be collected.
      await page.waitForFunction(
        () => window.__gameState?.currentFlight?.events?.some(e => e.type === 'SCIENCE_COLLECTED'),
        { timeout: 30_000 },
      );

      // Teleport to orbit to satisfy REACH_ORBIT.
      await teleportToOrbitConditions(page);
      await page.waitForFunction(
        () => {
          const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-021');
          return m?.objectives?.find(o => o.type === 'REACH_ORBIT')?.completed;
        },
        { timeout: 10_000 },
      );

      // Teleport back to low altitude for safe landing.
      // Must set phase to FLIGHT so the physics uses vertical gravity, not orbital.
      await teleportCraft(page, { posY: 1_500, velX: 0, velY: -2, phase: 'FLIGHT' });

      // Deploy parachute.
      await stage(page);
      await setWarp(page, 100);
      await waitLanded(page, 120_000);

      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-021');
    });

    test('M022 — Network Control (orbit + deploy 2 satellites)', async ({ page }: { page: Page }) => {
      test.setTimeout(120_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', ...missionRange(4, 17), 'mission-020'],
        acceptedId: 'mission-022',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'satellite-mk1',
          'decoupler-stack-tr18', 'tank-medium', 'engine-reliant',
          'engine-nerv', 'tank-large', 'docking-port-std'],
        facilities: { ...ALL_FACILITIES },
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      // M022: orbit + deploy 2 satellites.
      // Auto-staging: engine -> stage 0, decouplers -> stages 1 & 2.
      await startTestFlight(page, [
        'satellite-mk1', 'decoupler-stack-tr18',
        'satellite-mk1', 'decoupler-stack-tr18',
        'probe-core-mk1', 'tank-small', 'engine-spark',
      ]);

      await stage(page); // fire engine
      await pressThrottleUp(page);
      await waitForAltitude(page, 100);

      // Teleport to orbit.
      await teleportToOrbitConditions(page);
      await page.waitForFunction(
        () => {
          const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-022');
          return m?.objectives?.find(o => o.type === 'REACH_ORBIT')?.completed;
        },
        { timeout: 10_000 },
      );

      // Release first satellite (decoupler stage).
      await stage(page);
      // Wait for decoupler separation
      await page.evaluate(() => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r()))));

      // Release second satellite (decoupler stage).
      await stage(page);

      // Wait for MULTI_SATELLITE objective.
      await page.waitForFunction(
        () => {
          const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-022');
          return m?.objectives?.every(o => o.completed);
        },
        { timeout: 15_000 },
      );

      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-022');
    });
  });

  // =========================================================================
  // GROUP 5: Instrument-in-Module System (M008, M010)
  // =========================================================================

  test.describe('Instrument-in-Module System', () => {

    test('M008 — Black Box Test with loaded thermometer instrument', async ({ page }: { page: Page }) => {
      test.setTimeout(120_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004', 'mission-005'],
        acceptedId: 'mission-008',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'parachute-mk2',
          'science-module-mk1', 'thermometer-mk1'],
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      // M008: activate science module (with instrument) + crash >=50 m/s.
      // Staging: 0=engine + science-module (both fire together).
      await startTestFlight(page,
        ['probe-core-mk1', 'science-module-mk1', 'tank-small', 'engine-spark'],
        {
          instruments: { 'science-module-mk1': ['thermometer-mk1'] },
          staging: [{ partIds: ['engine-spark', 'science-module-mk1'] }],
        },
      );

      await stage(page); // fire engine AND activate science module
      await pressThrottleUp(page);

      // Verify the science module activated (PART_ACTIVATED event for SERVICE_MODULE).
      await page.waitForFunction(
        () => (window.__gameState?.currentFlight?.events as { type: string; partType?: string }[] | undefined)?.some(
          e => e.type === 'PART_ACTIVATED' && e.partType === 'SERVICE_MODULE',
        ),
        { timeout: 10_000 },
      );

      // Climb to ~500m so free-fall gives >=50 m/s impact.
      await waitForAltitude(page, 500);
      await page.keyboard.press('x'); // cut throttle

      // Let it crash.
      await waitLanded(page, 60_000);
      await returnToHub(page);
      await expectCompleted(page, 'mission-008');
    });

    test('M010 — Science Experiment Alpha with loaded instrument + altitude hold', async ({ page }: { page: Page }) => {
      test.setTimeout(180_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004', 'mission-005', 'mission-008'],
        acceptedId: 'mission-010',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'parachute-mk2',
          'science-module-mk1', 'thermometer-mk1'],
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      // M010: hold 800-1200m for 30s + return science data via instrument.
      await startTestFlight(page,
        ['parachute-mk2', 'probe-core-mk1', 'science-module-mk1', 'tank-small', 'engine-spark'],
        {
          instruments: { 'science-module-mk1': ['thermometer-mk1'] },
          staging: [
            { partIds: ['engine-spark'] },
            { partIds: ['parachute-mk2'] },
            { partIds: ['science-module-mk1'] },
          ],
        },
      );

      // Stage 0: fire engine.
      await stage(page);
      await pressThrottleUp(page);
      await waitForAltitude(page, 1_400);
      await page.keyboard.press('x'); // cut throttle

      // Stage 1: deploy parachute.
      await stage(page);
      await setWarp(page, 100);

      // Wait until descending near the band.
      await page.waitForFunction(
        () => {
          const ps = window.__flightPs;
          return ps && ps.posY <= 1_400 && ps.velY <= 0;
        },
        { timeout: 60_000 },
      );
      await setWarp(page, 5);

      // Wait until inside the altitude band.
      await page.waitForFunction(
        () => (window.__flightPs?.posY ?? Infinity) <= 1_200,
        { timeout: 30_000 },
      );

      // Stage 2: activate science module inside the band.
      await setWarp(page, 1);
      await stage(page);

      // Warp through the 30s hold.
      await setWarp(page, 100);
      await page.waitForFunction(
        (id: string) => {
          const state = window.__gameState;
          const m = state?.missions?.accepted?.find(x => x.id === id);
          return m?.objectives?.find(o => o.type === 'HOLD_ALTITUDE')?.completed;
        },
        'mission-010',
        { timeout: 90_000 },
      );

      // Continue descent to landing (RETURN_SCIENCE_DATA completes on safe landing).
      await waitLanded(page);
      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-010');
      await expectPartUnlocked(page, 'engine-poodle');
    });
  });

  // =========================================================================
  // GROUP 6: Orbital Gameplay — M014-M017
  // =========================================================================

  test.describe('Orbital Gameplay — M014-M017', () => {

    test('M014 — Karman Line Approach (reach 60,000m) in tutorial mode', async ({ page }: { page: Page }) => {
      test.setTimeout(120_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004', 'mission-005', 'mission-008', 'mission-010', 'mission-012'],
        acceptedId: 'mission-014',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'tank-medium',
          'engine-reliant', 'decoupler-stack-tr18', 'engine-poodle',
          'science-module-mk1', 'thermometer-mk1'],
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      await startTestFlight(page, ['probe-core-mk1', 'tank-small', 'engine-spark']);
      await stage(page);
      await pressThrottleUp(page);
      await waitForAltitude(page, 100);

      // Teleport to 65km.
      await page.evaluate(async () => {
        const ps = window.__flightPs;
        if (ps) { ps.posY = 65_000; }
        if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
      });

      await page.waitForFunction(
        () => {
          const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-014');
          return m?.objectives?.every(o => o.completed);
        },
        { timeout: 10_000 },
      );

      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-014');
      await expectPartUnlocked(page, 'engine-nerv');
      await expectPartUnlocked(page, 'srb-large');
    });

    test('M015 — Orbital Satellite Deployment I (orbit + release satellite)', async ({ page }: { page: Page }) => {
      test.setTimeout(120_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004', 'mission-005', 'mission-008', 'mission-010',
          'mission-012', 'mission-014', 'mission-016'],
        acceptedId: 'mission-015',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'satellite-mk1',
          'decoupler-stack-tr18', 'tank-medium', 'engine-reliant',
          'engine-nerv', 'tank-large'],
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      // Satellite + decoupler + probe + tank + engine.
      // Auto-staging: engine -> stage 0, decoupler -> stage 1.
      await startTestFlight(page, [
        'satellite-mk1', 'decoupler-stack-tr18',
        'probe-core-mk1', 'tank-small', 'engine-spark',
      ]);

      await stage(page);
      await pressThrottleUp(page);
      await waitForAltitude(page, 100);
      await teleportToOrbitConditions(page);

      // Wait for REACH_ORBIT objective.
      await page.waitForFunction(
        () => {
          const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-015');
          return m?.objectives?.find(o => o.type === 'REACH_ORBIT')?.completed;
        },
        { timeout: 10_000 },
      );

      // Release satellite.
      await stage(page);
      await page.waitForFunction(
        () => {
          const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-015');
          return m?.objectives?.every(o => o.completed);
        },
        { timeout: 10_000 },
      );

      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-015');
    });

    test('M016 — Low Earth Orbit (>=80km AND >=7,800 m/s) in tutorial mode', async ({ page }: { page: Page }) => {
      test.setTimeout(120_000);
      const env: SaveEnvelope = tutorialSave({
        completedIds: ['mission-001', 'mission-004', 'mission-005', 'mission-008', 'mission-010',
          'mission-012', 'mission-014'],
        acceptedId: 'mission-016',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'tank-medium',
          'engine-reliant', 'engine-nerv', 'decoupler-stack-tr18'],
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      await startTestFlight(page, ['probe-core-mk1', 'tank-small', 'engine-spark']);
      await stage(page);
      await pressThrottleUp(page);
      await waitForAltitude(page, 100);
      await teleportToOrbitConditions(page);

      await page.waitForFunction(
        () => {
          const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-016');
          return m?.objectives?.every(o => o.completed);
        },
        { timeout: 10_000 },
      );

      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-016');
      await expectPartUnlocked(page, 'tank-large');
    });

    test('M017 — Tracked Satellite Deployment (orbit + satellite via Tracking Station)', async ({ page }: { page: Page }) => {
      test.setTimeout(120_000);
      const allPrev: string[] = ['mission-001', ...missionRange(4, 16), 'mission-020'];
      const env: SaveEnvelope = tutorialSave({
        completedIds: allPrev,
        acceptedId: 'mission-017',
        parts: [...TUTORIAL_STARTERS, 'parachute-mk1', 'satellite-mk1',
          'decoupler-stack-tr18', 'tank-medium', 'engine-reliant',
          'engine-nerv', 'tank-large', 'docking-port-std'],
        facilities: { ...ALL_FACILITIES },
      });
      await page.setViewportSize({ width: VP_W, height: VP_H });
      await seedAndLoadSave(page, env);

      await startTestFlight(page, [
        'satellite-mk1', 'decoupler-stack-tr18',
        'probe-core-mk1', 'tank-small', 'engine-spark',
      ]);

      await stage(page);
      await pressThrottleUp(page);
      await waitForAltitude(page, 100);
      await teleportToOrbitConditions(page);

      await page.waitForFunction(
        () => {
          const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-017');
          return m?.objectives?.find(o => o.type === 'REACH_ORBIT')?.completed;
        },
        { timeout: 10_000 },
      );

      // Release satellite.
      await stage(page);
      await page.waitForFunction(
        () => {
          const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-017');
          return m?.objectives?.every(o => o.completed);
        },
        { timeout: 10_000 },
      );

      await triggerReturnViaMenu(page);
      await returnToHub(page);
      await expectCompleted(page, 'mission-017');
    });
  });
});
