import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import {
  VP_W, VP_H,
  seedAndLoadSave, navigateToVab,
  teleportCraft, startTestFlight,
  pressStage, pressThrottleUp, pressThrottleCut,
} from './helpers.js';

/**
 * E2E — Mission Progression
 *
 * Tests all 15 missions in the Desert R&D campaign.  Each test is fully
 * independent: it seeds localStorage with the exact game state needed
 * (previous missions completed, parts unlocked, money, crew, accepted mission),
 * builds a rocket in the VAB, flies it, and verifies the mission completes
 * and that any unlocked parts appear in the game state (and in the VAB panel
 * for missions that unlock parts).
 *
 * Playwright config has fullyParallel: true with 4 workers, so all tests
 * run concurrently in separate browser pages.
 */

// ---------------------------------------------------------------------------
// Mission template types
// ---------------------------------------------------------------------------

interface ObjectiveTemplate {
  id: string;
  type: string;
  target: Record<string, unknown>;
}

interface MissionTemplate {
  title: string;
  objectives: ObjectiveTemplate[];
  reward: number;
  unlocksAfter: string[];
  unlockedParts: string[];
}

// ---------------------------------------------------------------------------
// Crew member type
// ---------------------------------------------------------------------------

interface CrewMember {
  id: string;
  name: string;
  hireDate: string;
  status: string;
  missionsFlown: number;
  flightsFlown: number;
  deathDate: string | null;
  deathCause: string | null;
  assignedRocketId: string | null;
}

// ---------------------------------------------------------------------------
// Constants (domain-specific to this file)
// ---------------------------------------------------------------------------

const STARTING_MONEY = 10_000_000;

const STARTER_PARTS: string[] = [
  'cmd-mk1', 'probe-core-mk1', 'tank-small', 'engine-spark',
  'parachute-mk1', 'decoupler-stack-tr18',
];

// ---------------------------------------------------------------------------
// Mission objective templates  (compact — only the data needed for seeding)
// ---------------------------------------------------------------------------

const OBJ: Record<string, MissionTemplate> = {
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
    reward: 35_000, unlocksAfter: ['mission-004'], unlockedParts: ['parachute-mk2'],
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
  'mission-009': {
    title: 'Ejector Seat Test',
    objectives: [{ id: 'obj-009-1', type: 'EJECT_CREW', target: { minAltitude: 200 } }],
    reward: 45_000, unlocksAfter: ['mission-007'], unlockedParts: [],
  },
  'mission-010': {
    title: 'Science Experiment Alpha',
    objectives: [
      { id: 'obj-010-1', type: 'HOLD_ALTITUDE', target: { minAltitude: 800, maxAltitude: 1_200, duration: 30 } },
      { id: 'obj-010-2', type: 'RETURN_SCIENCE_DATA', target: {} },
    ],
    reward: 75_000, unlocksAfter: ['mission-008'], unlockedParts: ['engine-poodle'],
  },
  'mission-011': {
    title: 'Emergency Systems Verified',
    objectives: [
      { id: 'obj-011-1', type: 'EJECT_CREW', target: { minAltitude: 100 } },
      { id: 'obj-011-2', type: 'CONTROLLED_CRASH', target: { minCrashSpeed: 50 } },
    ],
    reward: 55_000, unlocksAfter: ['mission-008', 'mission-009'], unlockedParts: [],
  },
  'mission-012': {
    title: 'Stage Separation Test',
    objectives: [
      { id: 'obj-012-1', type: 'REACH_ALTITUDE', target: { altitude: 2_000 } },
      { id: 'obj-012-2', type: 'ACTIVATE_PART', target: { partType: 'STACK_DECOUPLER' } },
    ],
    reward: 90_000, unlocksAfter: ['mission-010'], unlockedParts: ['engine-reliant', 'srb-small'],
  },
  'mission-013': {
    title: 'High Altitude Record',
    objectives: [{ id: 'obj-013-1', type: 'REACH_ALTITUDE', target: { altitude: 20_000 } }],
    reward: 120_000, unlocksAfter: ['mission-011'], unlockedParts: [],
  },
  'mission-014': {
    title: 'Kármán Line Approach',
    objectives: [{ id: 'obj-014-1', type: 'REACH_ALTITUDE', target: { altitude: 60_000 } }],
    reward: 200_000, unlocksAfter: ['mission-012'], unlockedParts: ['engine-nerv', 'srb-large'],
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
    reward: 500_000, unlocksAfter: ['mission-014'], unlockedParts: ['tank-large', 'engine-reliant'],
  },
  'mission-017': {
    title: 'Tracked Satellite Deployment',
    objectives: [
      { id: 'obj-017-1', type: 'REACH_ORBIT', target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 } },
      { id: 'obj-017-2', type: 'RELEASE_SATELLITE', target: { minAltitude: 80_000 } },
    ],
    reward: 350_000, unlocksAfter: ['mission-015', 'mission-020'], unlockedParts: [],
  },
  'mission-020': {
    title: 'Eyes on the Sky',
    objectives: [{ id: 'obj-020-1', type: 'REACH_ORBIT', target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 } }],
    reward: 250_000, unlocksAfter: ['mission-016'], unlockedParts: ['docking-port-std'],
  },
};

// ---------------------------------------------------------------------------
// Save-state builder
// ---------------------------------------------------------------------------

interface AcceptedMission {
  id: string;
  title: string;
  description: string;
  location: string;
  objectives: { id: string; type: string; completed: boolean; description: string; target: Record<string, unknown> }[];
  reward: number;
  unlocksAfter: string[];
  unlockedParts: string[];
  status: string;
}

/**
 * Build an accepted mission object suitable for `state.missions.accepted`.
 */
function acceptedMission(id: string): AcceptedMission {
  const t = OBJ[id];
  return {
    id, title: t.title,
    description: `E2E test mission ${id}`,
    location: 'desert',
    objectives: t.objectives.map(o => ({ ...o, completed: false, description: o.type })),
    reward: t.reward,
    unlocksAfter: t.unlocksAfter,
    unlockedParts: t.unlockedParts,
    status: 'accepted',
  };
}

interface BuildEnvelopeParams {
  completedIds?: string[];
  acceptedId: string;
  parts: string[];
  crew?: CrewMember[];
}

interface LocalSaveEnvelope {
  saveName: string;
  timestamp: string;
  state: {
    agencyName: string;
    money: number;
    loan: { balance: number; interestRate: number; totalInterestAccrued: number };
    missions: {
      available: unknown[];
      accepted: AcceptedMission[];
      completed: {
        id: string;
        title: string;
        description: string;
        location: string;
        objectives: { id: string; type: string; completed: boolean; description: string; target: Record<string, unknown> }[];
        reward: number;
        unlocksAfter: string[];
        unlockedParts: string[];
        status: string;
      }[];
    };
    crew: CrewMember[];
    rockets: unknown[];
    parts: string[];
    flightHistory: unknown[];
    playTimeSeconds: number;
    currentFlight: null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Build a save-slot envelope to inject into localStorage.
 */
function buildEnvelope({ completedIds = [], acceptedId, parts, crew = [] }: BuildEnvelopeParams): LocalSaveEnvelope {
  return {
    saveName: 'Mission Progression E2E',
    timestamp: new Date().toISOString(),
    state: {
      agencyName:    'Test Agency',
      money:         STARTING_MONEY,
      loan:          { balance: 2_000_000, interestRate: 0.03, totalInterestAccrued: 0 },
      missions: {
        available: [],
        accepted:  [acceptedMission(acceptedId)],
        completed: completedIds.map(id => ({
          id, title: OBJ[id]?.title ?? id, description: '', location: 'desert',
          objectives: (OBJ[id]?.objectives ?? []).map(o => ({ ...o, completed: true, description: o.type })),
          reward: OBJ[id]?.reward ?? 0,
          unlocksAfter: OBJ[id]?.unlocksAfter ?? [],
          unlockedParts: OBJ[id]?.unlockedParts ?? [],
          status: 'completed',
        })),
      },
      crew,
      rockets:         [],
      parts,
      flightHistory:   [],
      playTimeSeconds: 0,
      currentFlight:   null,
    },
  };
}

// ---------------------------------------------------------------------------
// Page interaction helpers
// ---------------------------------------------------------------------------

async function stage(page: Page): Promise<void> {
  await pressStage(page);
}

async function waitWarpUnlocked(page: Page): Promise<void> {
  await page.waitForFunction(
    (): boolean => !(document.querySelector('.hud-warp-btn') as HTMLButtonElement | null)?.disabled,
    { timeout: 5_000 },
  );
}

async function setWarp(page: Page, factor: number): Promise<void> {
  await waitWarpUnlocked(page);
  await page.evaluate(
    (f: number): void => { window.__testSetTimeWarp?.(f); },
    factor,
  );
}

async function waitAlt(page: Page, m: number, timeout: number = 30_000): Promise<void> {
  await page.waitForFunction(
    (alt: number): boolean => (window.__flightPs?.posY ?? 0) >= alt,
    m, { timeout },
  );
}

async function waitSpeed(page: Page, s: number, timeout: number = 30_000): Promise<void> {
  await page.waitForFunction(
    (spd: number): boolean => {
      const ps = window.__flightPs;
      if (!ps) return false;
      return Math.hypot(ps.velX, ps.velY) >= spd;
    },
    s, { timeout },
  );
}

async function waitLanded(page: Page, timeout: number = 30_000): Promise<void> {
  await page.waitForFunction(
    (): boolean => {
      const ps = window.__flightPs;
      return ps?.landed === true || ps?.crashed === true;
    },
    { timeout },
  );
}

async function waitObjectivesComplete(page: Page, missionId: string, timeout: number = 60_000): Promise<void> {
  await page.waitForFunction(
    (id: string): boolean => {
      const state = window.__gameState;
      const m = state?.missions?.accepted?.find(x => x.id === id);
      return m?.objectives?.every(o => o.completed) ?? false;
    },
    missionId, { timeout },
  );
}

async function returnToHub(page: Page): Promise<void> {
  // If we're already at the hub (e.g. after triggerReturnViaMenu aborted),
  // just dismiss any overlays and return.
  const alreadyAtHub = await page.locator('#hub-overlay').isVisible().catch(() => false);

  if (!alreadyAtHub) {
    // Check for orbit return dialog, abort dialog, post-flight summary, or hub.
    const orbitReturn = page.locator('[data-testid="orbit-return-btn"]');
    const abortBtn = page.locator('[data-testid="abort-confirm-btn"]');
    const summary = page.locator('#post-flight-summary');
    const hub = page.locator('#hub-overlay');

    const which = await Promise.race([
      orbitReturn.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'orbit' as const),
      abortBtn.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'abort' as const),
      summary.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'summary' as const),
      hub.waitFor({ state: 'visible', timeout: 30_000 }).then(() => 'hub' as const),
    ]);

    if (which === 'orbit') {
      await orbitReturn.click();
      // Orbit return shows a post-flight summary — click through it.
      await summary.waitFor({ state: 'visible', timeout: 10_000 });
      await page.click('#post-flight-return-btn');
    } else if (which === 'abort') {
      await abortBtn.click();
    } else if (which === 'summary') {
      await page.click('#post-flight-return-btn');
    }
    // If 'hub', already there.
  }

  // An unlock notification modal may appear for newly unlocked parts — dismiss it.
  try {
    const unlockBackdrop = page.locator('#unlock-notification-backdrop');
    await unlockBackdrop.waitFor({ state: 'visible', timeout: 5_000 });
    await unlockBackdrop.locator('.confirm-btn').click();
    await unlockBackdrop.waitFor({ state: 'hidden', timeout: 3_000 }).catch(() => {});
  } catch {
    // No unlock notification — proceed.
  }

  // A return-results overlay may appear on top of the hub — dismiss it.
  try {
    const dismissBtn = page.locator('#return-results-dismiss-btn');
    await dismissBtn.waitFor({ state: 'visible', timeout: 10_000 });
    await dismissBtn.click();
    await page.waitForSelector('#return-results-overlay', { state: 'hidden', timeout: 5_000 }).catch(() => {});
  } catch {
    // No return results overlay — proceed.
  }
  await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 10_000 });
}

/**
 * Trigger the post-flight summary via the in-flight menu.
 * Needed for probe-core rockets that land safely — the auto-trigger only
 * fires when crashed or all COMMAND_MODULE parts are destroyed.
 */
async function triggerReturnViaMenu(page: Page): Promise<void> {
  await page.click('#topbar-menu-btn', { force: true });
  const dropdown = page.locator('#topbar-dropdown');
  await expect(dropdown).toBeVisible({ timeout: 5_000 });
  await dropdown.getByText('Return to Space Agency').click();
  // If the rocket is still in flight, an abort confirmation dialog appears.
  // Aborting skips the post-flight summary and goes straight to hub.
  const abortBtn = page.locator('[data-testid="abort-confirm-btn"]');
  if (await abortBtn.isVisible({ timeout: 1_000 }).catch(() => false)) {
    await abortBtn.click();
    return; // Abort goes directly to hub — no post-flight summary.
  }
}

async function expectCompleted(page: Page, missionId: string): Promise<void> {
  const ok = await page.evaluate(
    (id: string): boolean => window.__gameState?.missions?.completed?.some(m => m.id === id) ?? false,
    missionId,
  );
  expect(ok).toBe(true);
}

async function expectPartUnlocked(page: Page, partId: string): Promise<void> {
  const ok = await page.evaluate(
    (id: string): boolean => window.__gameState?.parts?.includes(id) ?? false,
    partId,
  );
  expect(ok).toBe(true);
}

async function expectPartInVab(page: Page, partId: string): Promise<void> {
  await navigateToVab(page);
  await expect(
    page.locator(`.vab-part-card[data-part-id="${partId}"]`),
  ).toBeVisible({ timeout: 5_000 });
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe('Mission Progression', () => {
  // All tests involve physics simulation + flight.  A generous default timeout
  // avoids flaky failures under CPU contention (4 parallel workers).
  test.describe.configure({ timeout: 120_000 });

  // =========================================================================
  // GROUP 1: Tutorial Chain (M001, M004)
  // =========================================================================

  test('M001 — First Flight (reach 100m)', async ({ page }) => {
    test.setTimeout(60_000);
    const env = buildEnvelope({
      acceptedId: 'mission-001',
      parts: STARTER_PARTS,
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    await startTestFlight(page, ['cmd-mk1', 'tank-small', 'engine-spark']);
    await stage(page);
    await pressThrottleUp(page);
    await waitAlt(page, 100);
    await pressThrottleCut(page);

    // Wait for landing/crash and return.
    await waitLanded(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-001');
  });

  test('M004 — Speed Demon (reach 150 m/s)', async ({ page }) => {
    test.setTimeout(60_000);
    const env = buildEnvelope({
      completedIds: ['mission-001'],
      acceptedId: 'mission-004',
      parts: [...STARTER_PARTS, 'tank-medium'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    await startTestFlight(page, ['cmd-mk1', 'tank-medium', 'engine-spark']);
    await stage(page);
    await pressThrottleUp(page);
    await waitSpeed(page, 150);
    // Objective met — return via menu instead of waiting for long descent.
    await triggerReturnViaMenu(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-004');
  });

  // =========================================================================
  // GROUP 2: Recovery Branch (M005–M007)
  // =========================================================================

  test('M005 — Safe Return I (land ≤10 m/s) → unlocks parachute-mk2', async ({ page }) => {
    test.setTimeout(60_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: m1to4,
      acceptedId: 'mission-005',
      parts: STARTER_PARTS,
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    // Use probe-core for a lighter rocket. Without landing legs, the physics
    // engine requires ≤5 m/s for a LANDING event. Terminal velocity with mk1
    // chute at 320kg dry mass ≈ 4.66 m/s, which is under the 5 m/s threshold.
    await startTestFlight(page, ['parachute-mk1', 'probe-core-mk1', 'tank-small', 'engine-spark'], {
      staging: [
        { partIds: ['engine-spark'] },
        { partIds: ['parachute-mk1'] },
      ],
    });

    // Stage 0: fire engine at full throttle — burn ALL fuel so mass is at
    // dry weight (250kg) when the chute deploys.
    await stage(page);
    await pressThrottleUp(page);

    // Wait for fuel depletion (engine stops firing when tank empties).
    // Dry mass 250kg → terminal velocity with mk1 chute ≈ 4.12 m/s ≤ 5 m/s.
    await waitAlt(page, 50); // confirm engine is firing
    await page.waitForFunction(
      (): boolean => window.__flightPs?.firingEngines?.size === 0,
      { timeout: 15_000 },
    );

    // Stage 1: deploy parachute — mass now ≈ 250kg < 1200kg maxSafeMass.
    await waitWarpUnlocked(page);
    await stage(page);

    // 100× warp for the long descent from high altitude (~14km at burnout).
    await waitWarpUnlocked(page);
    await setWarp(page, 100);

    await waitLanded(page, 120_000);

    // Probe-core rockets don't auto-trigger the post-flight summary
    // (no COMMAND_MODULE parts). Use the in-flight menu instead.
    await triggerReturnViaMenu(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-005');
    await expectPartUnlocked(page, 'parachute-mk2');
    await expectPartInVab(page, 'parachute-mk2');
  });

  test('M006 — Controlled Descent (engine brake, land ≤5 m/s) → unlocks landing-legs-small', async ({ page }) => {
    test.setTimeout(60_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: m1to4,
      acceptedId: 'mission-006',
      parts: STARTER_PARTS,
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    // Use probe-core for lighter rocket: wet 720kg, dry 320kg — both under
    // parachute-mk1 maxSafeMass 1200kg. Terminal velocity ≈ 4.7 m/s < 5 m/s.
    await startTestFlight(page, ['parachute-mk1', 'probe-core-mk1', 'tank-small', 'engine-spark'], {
      staging: [
        { partIds: ['engine-spark'] },
        { partIds: ['parachute-mk1'] },
      ],
    });

    await stage(page); // fire engine (satisfies ACTIVATE_PART ENGINE)
    await pressThrottleUp(page);

    // Burn ALL fuel — dry mass 250kg → terminal velocity 4.12 m/s ≤ 5 m/s.
    // Without legs, the physics engine crashes rockets landing > 5 m/s.
    await waitAlt(page, 50); // confirm engine is firing
    await page.waitForFunction(
      (): boolean => window.__flightPs?.firingEngines?.size === 0,
      { timeout: 15_000 },
    );

    // Deploy parachute for safe descent.
    await waitWarpUnlocked(page);
    await stage(page);

    // 100× warp for descent from high altitude.
    await waitWarpUnlocked(page);
    await setWarp(page, 100);

    await waitLanded(page, 120_000);
    await triggerReturnViaMenu(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-006');
    await expectPartUnlocked(page, 'landing-legs-small');
    await expectPartInVab(page, 'landing-legs-small');
  });

  test('M007 — Leg Day (deploy legs + land ≤10 m/s) → unlocks landing-legs-large', async ({ page }) => {
    test.setTimeout(60_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-006'],
      acceptedId: 'mission-007',
      parts: [...STARTER_PARTS, 'landing-legs-small'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    // Use probe-core for lighter rocket. With 2 deployed legs AND speed < 10
    // the physics uses Case 1 (controlled landing). Terminal velocity at dry
    // mass 480kg with mk1 chute ≈ 5.7 m/s (< 10 m/s with 2 legs → LANDING).
    await startTestFlight(page, [
      'parachute-mk1', 'probe-core-mk1', 'tank-small', 'engine-spark',
      'landing-legs-small', 'landing-legs-small',
    ], {
      staging: [
        { partIds: ['engine-spark'] },
        { partIds: ['parachute-mk1', 'landing-legs-small', 'landing-legs-small'] },
      ],
    });

    await stage(page); // Stage 0: fire engine at full throttle
    await pressThrottleUp(page);
    await waitAlt(page, 300);
    await pressThrottleCut(page);

    // Stage 1: deploy legs + parachute.
    await waitWarpUnlocked(page);
    await stage(page);

    // 100× warp for descent.
    await waitWarpUnlocked(page);
    await setWarp(page, 100);

    await waitLanded(page, 120_000);
    await triggerReturnViaMenu(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-007');
    await expectPartUnlocked(page, 'landing-legs-large');
    await expectPartInVab(page, 'landing-legs-large');
  });

  // =========================================================================
  // GROUP 3: Advanced Missions (M008–M012)
  // =========================================================================

  test('M008 — Black Box Test (activate science + crash ≥50 m/s)', async ({ page }) => {
    test.setTimeout(60_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-005'],
      acceptedId: 'mission-008',
      parts: [...STARTER_PARTS, 'science-module-mk1', 'tank-medium'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    // Build: cmd-mk1 + science-module-mk1 + tank-medium + engine-spark
    await startTestFlight(page, ['cmd-mk1', 'science-module-mk1', 'tank-medium', 'engine-spark'], {
      staging: [
        { partIds: ['engine-spark', 'science-module-mk1'] },
      ],
    });

    await stage(page); // fires engine + activates science module
    await pressThrottleUp(page);

    // Climb to ~500m so free-fall gives ≥50 m/s impact.
    await waitAlt(page, 500);
    await pressThrottleCut(page);

    // Let it crash.
    await waitLanded(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-008');
  });

  test('M009 — Ejector Seat Test (eject crew ≥200m)', async ({ page }) => {
    test.setTimeout(60_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-006', 'mission-007'],
      acceptedId: 'mission-009',
      parts: [...STARTER_PARTS, 'probe-core-mk1', 'cmd-mk1'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    // Uncrewed test: probe-core + cmd-mk1 (for ejector seat) + tank + engine
    await startTestFlight(page, ['cmd-mk1', 'probe-core-mk1', 'tank-small', 'engine-spark'], {
      staging: [
        { partIds: ['engine-spark'] },
        { partIds: ['cmd-mk1'] },
      ],
    });

    await stage(page); // fire engine
    await pressThrottleUp(page);

    await waitAlt(page, 250);
    // Cut throttle BEFORE ejecting — otherwise the remaining rocket body
    // (tank+engine) continues accelerating upward and takes ages to crash.
    await pressThrottleCut(page);

    // Stage 1: eject crew at ≥200m altitude.
    await waitWarpUnlocked(page);
    await stage(page);

    // 100× warp for the rocket body to fall and crash.
    await waitWarpUnlocked(page);
    await setWarp(page, 100);

    await waitLanded(page, 120_000);
    await returnToHub(page);
    await expectCompleted(page, 'mission-009');
  });

  test('M010 — Science Experiment Alpha (hold 800-1200m for 30s + return science)', async ({ page }) => {
    test.setTimeout(60_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-005', 'mission-008'],
      acceptedId: 'mission-010',
      parts: [...STARTER_PARTS, 'science-module-mk1', 'tank-medium', 'parachute-mk2'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    // probe-core (50) + parachute-mk2 (250) + science-module (200) + tank-small (50+400)
    // + engine-spark (120) = 1070kg wet.  Terminal velocity under mk2 chute
    // at ~880kg (with remaining fuel) ≈ 4.4 m/s → safe legless landing.
    // Staging — chute first so we can deploy it for a slow descent through
    // the altitude band, then activate the science module inside the band:
    //   Stage 0: engine (auto)
    //   Stage 1: parachute (deploy above band for slow descent)
    //   Stage 2: science module (activate when inside the band)
    await startTestFlight(page, [
      'parachute-mk2', 'probe-core-mk1', 'science-module-mk1', 'tank-small', 'engine-spark',
    ], {
      staging: [
        { partIds: ['engine-spark'] },
        { partIds: ['parachute-mk2'] },
        { partIds: ['science-module-mk1'] },
      ],
    });

    await stage(page); // Stage 0: fire engine

    // Full throttle climb well above the 1200m band ceiling so the
    // parachute can slow us to terminal velocity before re-entering.
    await pressThrottleUp(page);
    await waitAlt(page, 1400);
    await pressThrottleCut(page); // cut engine

    // Deploy parachute (Stage 1).  The chute opens gradually; by the
    // time the rocket peaks and starts descending, the canopy is fully
    // inflated.  Terminal velocity at ~880kg ≈ 4.4 m/s.
    await stage(page);

    // 100× warp while descending well above the band.
    await waitWarpUnlocked(page);
    await setWarp(page, 100);

    // Slow to 5× near the band ceiling so the staging command can execute
    // before the rocket descends past the band (under CPU contention, the
    // Playwright round-trip takes longer than at 100× warp the rocket needs
    // to traverse the 400m band).
    await page.waitForFunction(
      (): boolean => {
        const ps = window.__flightPs;
        return ps != null && ps.posY <= 1400 && ps.velY <= 0;
      },
      { timeout: 30_000 },
    );
    await setWarp(page, 5);

    // Wait until we descend into the altitude band (≤ 1200m).
    await page.waitForFunction(
      (): boolean => (window.__flightPs?.posY ?? Infinity) <= 1200,
      { timeout: 15_000 },
    );

    // Drop to 1× warp, activate science module inside the band (Stage 2).
    await setWarp(page, 1);
    await stage(page);

    // Verify the hold timer is visible in the objectives HUD.
    await expect(page.locator('[data-testid="hud-obj-hold-timer"]'))
      .toBeVisible({ timeout: 5_000 });

    // 100× warp through the 30s hold + experiment.  At ~4.4 m/s descent
    // the rocket traverses the 400m band in ~90 s — plenty for 30 s.
    await waitWarpUnlocked(page);
    await setWarp(page, 100);

    // Wait for HOLD_ALTITUDE objective completion.
    await page.waitForFunction(
      (id: string): boolean => {
        const state = window.__gameState;
        const m = state?.missions?.accepted?.find(x => x.id === id);
        return m?.objectives?.find(o => o.type === 'HOLD_ALTITUDE')?.completed ?? false;
      },
      'mission-010',
      { timeout: 45_000 },
    );

    // Verify the HUD shows the hold objective as completed (green tick).
    const holdItem = page.locator('.hud-obj-icon.met').first();
    await expect(holdItem).toBeVisible({ timeout: 5_000 });

    // Continue 100× warp descent to landing.
    // RETURN_SCIENCE_DATA completes on safe landing (chute ≤ 5 m/s).
    await waitLanded(page);
    await triggerReturnViaMenu(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-010');
    await expectPartUnlocked(page, 'engine-poodle');
    await expectPartInVab(page, 'engine-poodle');
  });

  test('M011 — Emergency Systems Verified (eject crew ≥100m + crash ≥50 m/s)', async ({ page }) => {
    test.setTimeout(60_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-005', 'mission-006', 'mission-007', 'mission-008', 'mission-009'],
      acceptedId: 'mission-011',
      parts: [...STARTER_PARTS, 'probe-core-mk1', 'cmd-mk1'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    // Uncrewed test: probe-core + cmd-mk1 (for ejector seat) + tank + engine
    await startTestFlight(page, ['cmd-mk1', 'probe-core-mk1', 'tank-small', 'engine-spark'], {
      staging: [
        { partIds: ['engine-spark'] },
        { partIds: ['cmd-mk1'] },
      ],
    });

    await stage(page); // engine
    await pressThrottleUp(page);

    // Climb to ~300m.
    await waitAlt(page, 300);
    await pressThrottleCut(page);

    // Wait until descending past ~150m, then eject at ≥100m.
    await page.waitForFunction(
      (): boolean => {
        const ps = window.__flightPs;
        return ps != null && ps.velY < 0 && ps.posY < 250 && ps.posY > 100;
      },
      { timeout: 10_000 },
    );
    await waitWarpUnlocked(page);
    await stage(page); // eject crew

    // Rocket crashes from height (≥50 m/s impact from ~200m free-fall).
    await waitLanded(page, 120_000);
    await returnToHub(page);
    await expectCompleted(page, 'mission-011');
  });

  test('M012 — Stage Separation Test (reach 2000m + fire decoupler) → unlocks engine-reliant, srb-small', async ({ page }) => {
    test.setTimeout(60_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-005', 'mission-008', 'mission-010'],
      acceptedId: 'mission-012',
      parts: [...STARTER_PARTS, 'tank-medium'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    // Two-stage rocket: use a simple probe + tank + engine and teleport
    // to 2km, then stage the decoupler to complete the ACTIVATE_PART objective.
    await startTestFlight(page, [
      'probe-core-mk1', 'tank-medium', 'engine-spark',
      'decoupler-stack-tr18', 'tank-medium', 'engine-spark',
    ], {
      staging: [
        { partIds: ['engine-spark'] },
        { partIds: ['decoupler-stack-tr18'] },
      ],
    });

    await stage(page); // Stage 0: fire engine
    await pressThrottleUp(page);

    // Verify liftoff, then teleport to 2km.
    await waitAlt(page, 100);
    await teleportCraft(page, { posX: 0, posY: 2_500, velX: 0, velY: 100 });

    // Stage 1: fire decoupler (ACTIVATE_PART objective).
    await waitWarpUnlocked(page);
    await stage(page);

    // Wait for decoupler objective.
    await waitObjectivesComplete(page, 'mission-012', 30_000);

    // Objectives met — return via menu instead of waiting for long descent.
    await triggerReturnViaMenu(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-012');
    await expectPartUnlocked(page, 'engine-reliant');
    await expectPartUnlocked(page, 'srb-small');
    await expectPartInVab(page, 'engine-reliant');
  });

  // =========================================================================
  // GROUP 4: High Altitude & Endgame (M013–M017)
  // =========================================================================

  test('M013 — High Altitude Record (reach 20,000m)', async ({ page }) => {
    test.setTimeout(60_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-005', 'mission-006', 'mission-007', 'mission-008', 'mission-009', 'mission-011'],
      acceptedId: 'mission-013',
      parts: [...STARTER_PARTS, 'tank-medium'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    await startTestFlight(page, [
      'probe-core-mk1', 'tank-medium', 'engine-spark',
      'decoupler-stack-tr18', 'tank-medium', 'engine-spark',
    ], {
      staging: [
        { partIds: ['engine-spark'] },
        { partIds: ['decoupler-stack-tr18', 'engine-spark'] },
      ],
    });
    await stage(page);
    await pressThrottleUp(page);

    // Verify liftoff, then teleport above target altitude.
    await waitAlt(page, 100);
    await teleportCraft(page, { posX: 0, posY: 20_500, velX: 0, velY: 50 });

    // Objective met — return via menu instead of waiting for long descent.
    await triggerReturnViaMenu(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-013');
  });

  test('M014 — Kármán Line Approach (reach 60,000m) → unlocks engine-nerv, srb-large', async ({ page }) => {
    test.setTimeout(60_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-005', 'mission-008', 'mission-010', 'mission-012'],
      acceptedId: 'mission-014',
      parts: [...STARTER_PARTS, 'tank-medium', 'engine-reliant'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    await startTestFlight(page, [
      'probe-core-mk1', 'tank-medium', 'engine-reliant',
    ]);

    await stage(page);
    await pressThrottleUp(page);

    // Verify liftoff, then teleport above target altitude.
    await waitAlt(page, 100);
    await teleportCraft(page, { posX: 0, posY: 61_000, velX: 0, velY: 50 });

    // Objective met — return via menu.
    await triggerReturnViaMenu(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-014');
    await expectPartUnlocked(page, 'engine-nerv');
    await expectPartUnlocked(page, 'srb-large');
    await expectPartInVab(page, 'engine-nerv');
  });

  test('M015 — Orbital Satellite Deployment I (orbit + release satellite >80km)', async ({ page }) => {
    test.setTimeout(60_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [
        ...m1to4, 'mission-005', 'mission-008', 'mission-010', 'mission-012',
        'mission-014', 'mission-016',
      ],
      acceptedId: 'mission-015',
      parts: [
        ...STARTER_PARTS, 'tank-medium', 'engine-reliant', 'engine-nerv',
        'tank-large', 'satellite-mk1', 'decoupler-stack-tr18',
      ],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    // Use startTestFlight to skip the slow VAB build.
    // Staging: stage-0 = reliant, stage-1 = decoupler + nerv, stage-2 = decoupler (satellite release).
    await startTestFlight(page, [
      'satellite-mk1', 'decoupler-stack-tr18', 'probe-core-mk1',
      'tank-medium', 'engine-nerv',
      'decoupler-stack-tr18', 'tank-medium', 'engine-reliant',
    ], {
      staging: [
        { partIds: ['engine-reliant'] },
        { partIds: ['decoupler-stack-tr18', 'engine-nerv'] },
        { partIds: ['decoupler-stack-tr18'] },
      ],
    });

    // Stage engine and throttle up, verify liftoff.
    await stage(page);
    await pressThrottleUp(page);
    await waitAlt(page, 100);

    // Teleport directly to orbit.
    await teleportCraft(page, { posX: 0, posY: 82_000, velX: 8000, velY: 0, orbit: true });

    // Wait for REACH_ORBIT objective.
    await page.waitForFunction((): boolean => {
      const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-015');
      return m?.objectives?.find(o => o.type === 'REACH_ORBIT')?.completed ?? false;
    }, { timeout: 10_000 });

    // Re-teleport to maintain altitude for satellite release (>80km required).
    await teleportCraft(page, { posX: 0, posY: 82_000, velX: 8000, velY: 0, orbit: true });

    // Release satellite.
    await waitWarpUnlocked(page);
    await stage(page); // fire satellite decoupler

    // Wait for RELEASE_SATELLITE objective.
    await waitObjectivesComplete(page, 'mission-015', 30_000);

    // Return via menu.
    await page.click('#topbar-menu-btn', { force: true });
    const dropdown015 = page.locator('#topbar-dropdown');
    await expect(dropdown015).toBeVisible({ timeout: 5_000 });
    await dropdown015.getByText('Return to Space Agency').click();

    await returnToHub(page);
    await expectCompleted(page, 'mission-015');
  });

  test('M016 — Low Earth Orbit (≥80km AND ≥7,800 m/s) → unlocks tank-large', async ({ page }) => {
    test.setTimeout(60_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-005', 'mission-008', 'mission-010', 'mission-012', 'mission-014'],
      acceptedId: 'mission-016',
      parts: [...STARTER_PARTS, 'tank-medium', 'engine-reliant', 'engine-nerv'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    await startTestFlight(page, [
      'probe-core-mk1', 'tank-medium', 'tank-medium', 'engine-nerv',
      'decoupler-stack-tr18', 'tank-medium', 'engine-reliant',
    ], {
      staging: [
        { partIds: ['engine-reliant'] },
        { partIds: ['decoupler-stack-tr18', 'engine-nerv'] },
      ],
    });
    await stage(page);
    await pressThrottleUp(page);

    // Verify liftoff, then teleport directly to orbit.
    await waitAlt(page, 100);
    await teleportCraft(page, { posX: 0, posY: 82_000, velX: 8000, velY: 0, orbit: true });

    // Wait for objectives.
    await page.waitForFunction((): boolean => {
      const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-016');
      return m?.objectives?.every(o => o.completed) ?? false;
    }, { timeout: 10_000 });

    // Return via menu.
    await page.click('#topbar-menu-btn', { force: true });
    const dropdown = page.locator('#topbar-dropdown');
    await expect(dropdown).toBeVisible({ timeout: 5_000 });
    await dropdown.getByText('Return to Space Agency').click();

    await returnToHub(page);
    await expectCompleted(page, 'mission-016');
    await expectPartUnlocked(page, 'tank-large');
    await expectPartInVab(page, 'tank-large');
  });

  test('M017 — Tracked Satellite Deployment (orbit + release satellite >80km, Tracking Station)', async ({ page }) => {
    test.setTimeout(60_000);
    const allPrev = [1, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16].map(
      n => `mission-${String(n).padStart(3, '0')}`);
    const env = buildEnvelope({
      completedIds: [...allPrev, 'mission-020'],
      acceptedId: 'mission-017',
      parts: [
        ...STARTER_PARTS, 'tank-medium', 'engine-reliant', 'engine-nerv',
        'tank-large', 'satellite-mk1', 'decoupler-stack-tr18', 'parachute-mk2',
      ],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);

    // Use startTestFlight to skip the slow VAB build.
    await startTestFlight(page, [
      'satellite-mk1', 'decoupler-stack-tr18', 'probe-core-mk1',
      'tank-medium', 'engine-nerv',
      'decoupler-stack-tr18', 'tank-medium', 'engine-reliant',
    ], {
      staging: [
        { partIds: ['engine-reliant'] },
        { partIds: ['decoupler-stack-tr18', 'engine-nerv'] },
        { partIds: ['decoupler-stack-tr18'] },
      ],
    });

    // Stage engine and throttle up, verify liftoff.
    await stage(page);
    await pressThrottleUp(page);
    await waitAlt(page, 100);

    // Teleport directly to orbit.
    await teleportCraft(page, { posX: 0, posY: 82_000, velX: 8000, velY: 0, orbit: true });

    // Wait for REACH_ORBIT objective.
    await page.waitForFunction((): boolean => {
      const m = window.__gameState?.missions?.accepted?.find(x => x.id === 'mission-017');
      return m?.objectives?.find(o => o.type === 'REACH_ORBIT')?.completed ?? false;
    }, { timeout: 10_000 });

    // Re-teleport to maintain altitude for satellite release (>80km required).
    await teleportCraft(page, { posX: 0, posY: 82_000, velX: 8000, velY: 0, orbit: true });

    // Release satellite.
    await waitWarpUnlocked(page);
    await stage(page);

    // Wait for RELEASE_SATELLITE objective.
    await waitObjectivesComplete(page, 'mission-017', 30_000);

    // Return via menu.
    await page.click('#topbar-menu-btn', { force: true });
    const dropdown017 = page.locator('#topbar-dropdown');
    await expect(dropdown017).toBeVisible({ timeout: 5_000 });
    await dropdown017.getByText('Return to Space Agency').click();

    await returnToHub(page);
    await expectCompleted(page, 'mission-017');
  });

});
