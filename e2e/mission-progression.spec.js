import { test, expect } from '@playwright/test';
import {
  VP_W, VP_H,
  CENTRE_X, CANVAS_CENTRE_Y,
  dragPartToCanvas, placePart,
  seedAndLoadSave, navigateToVab,
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
// Constants (domain-specific to this file)
// ---------------------------------------------------------------------------

const STARTING_MONEY = 10_000_000;

const STARTER_PARTS = [
  'cmd-mk1', 'probe-core-mk1', 'tank-small', 'engine-spark',
  'parachute-mk1', 'decoupler-stack-tr18',
];

// ---------------------------------------------------------------------------
// Part snap-point geometry  (offset from centre, screen-space)
// ---------------------------------------------------------------------------

const GEO = {
  'cmd-mk1':              { topY: -20, botY: 20,  leftX: -20, rightX: 20 },
  'probe-core-mk1':       { topY:  -5, botY:  5 },
  'tank-small':            { topY: -20, botY: 20,  leftX: -10, rightX: 10 },
  'tank-medium':           { topY: -30, botY: 30,  leftX: -15, rightX: 15 },
  'tank-large':            { topY: -50, botY: 50,  leftX: -20, rightX: 20 },
  'engine-spark':          { topY: -15, botY: 15 },
  'engine-reliant':        { topY: -20, botY: 20 },
  'engine-nerv':           { topY: -20, botY: 20 },
  'engine-poodle':         { topY: -15, botY: 15 },
  'parachute-mk1':         { topY:  -5, botY:  5,  leftX: -10, rightX: 10 },
  'parachute-mk2':         { topY:  -7, botY:  7,  leftX: -15, rightX: 15 },
  'decoupler-stack-tr18':  { topY:  -5, botY:  5 },
  'decoupler-radial':      { leftX: -5, rightX: 5 },
  'science-module-mk1':    { topY: -10, botY: 10,  leftX: -15, rightX: 15 },
  'satellite-mk1':         { topY: -10, botY: 10 },
  'landing-legs-small':    { leftX: -5, rightX: 5 },
  'landing-legs-large':    { leftX: -7, rightX: 7 },
  'srb-small':             { topY: -40, leftX: -10, rightX: 10 },
  'srb-large':             { topY: -60, leftX: -15, rightX: 15 },
};

/**
 * Compute screen-Y positions for a vertical stack of parts.
 * Parts are listed top-to-bottom.  The first part is placed at `anchorY`.
 */
function stackYs(partIds, anchorY = CANVAS_CENTRE_Y) {
  const ys = [anchorY];
  for (let i = 1; i < partIds.length; i++) {
    const prev = GEO[partIds[i - 1]];
    const curr = GEO[partIds[i]];
    ys.push(ys[i - 1] + prev.botY - curr.topY);
  }
  return ys;
}

// ---------------------------------------------------------------------------
// Mission objective templates  (compact — only the data needed for seeding)
// ---------------------------------------------------------------------------

const OBJ = {
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

/**
 * Build an accepted mission object suitable for `state.missions.accepted`.
 */
function acceptedMission(id) {
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

/**
 * Build a save-slot envelope to inject into localStorage.
 *
 * @param {object} opts
 * @param {string[]} opts.completedIds   - mission IDs already completed
 * @param {string}   opts.acceptedId     - mission to accept for this flight
 * @param {string[]} opts.parts          - unlocked part IDs
 * @param {object[]} [opts.crew]         - crew members
 */
function buildEnvelope({ completedIds = [], acceptedId, parts, crew = [] }) {
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

/** Minimal crew member for tests requiring crew. */
function testCrew() {
  return {
    id: 'test-pilot-1',
    name: 'Test Pilot',
    hireDate: new Date().toISOString(),
    status: 'active',
    missionsFlown: 0,
    flightsFlown: 0,
    deathDate: null,
    deathCause: null,
    assignedRocketId: null,
  };
}

// ---------------------------------------------------------------------------
// Page interaction helpers
// ---------------------------------------------------------------------------

async function openStaging(page) {
  const panel = page.locator('#vab-staging-panel');
  if (!await panel.isVisible()) {
    await page.click('#vab-btn-staging');
  }
  await expect(panel).toBeVisible({ timeout: 3_000 });
}

async function addStage(page) {
  await page.click('#vab-staging-add');
}

async function dragToStage(page, chipText, stageIdx) {
  await page.dragAndDrop(
    `[data-drop-zone="unstaged"] .vab-stage-chip:has-text("${chipText}")`,
    `[data-drop-zone="stage-${stageIdx}"]`,
  );
}

/**
 * Programmatically move an unstaged part to a stage (more reliable than drag-and-drop).
 * Creates intermediate stages if needed.
 * @param {string} partId  Part definition ID (e.g. 'parachute-mk1')
 * @param {number} stageIdx  Target stage index (0-based)
 */
async function stagePartFromUnstaged(page, partId, stageIdx) {
  await page.evaluate(({ partId, stageIdx }) => {
    const config = window.__vabStagingConfig;
    const assembly = window.__vabAssembly;
    const idx = config.unstaged.findIndex(instanceId => {
      const placed = assembly.parts.get(instanceId);
      return placed?.partId === partId;
    });
    if (idx < 0) throw new Error(`No unstaged part found: ${partId}`);
    const [instanceId] = config.unstaged.splice(idx, 1);
    while (config.stages.length <= stageIdx) {
      config.stages.push({ instanceIds: [] });
    }
    config.stages[stageIdx].instanceIds.push(instanceId);
  }, { partId, stageIdx });
}

/**
 * Move a part from one stage to another.
 */
async function movePartBetweenStages(page, partId, fromStageIdx, toStageIdx) {
  await page.evaluate(({ partId, fromStageIdx, toStageIdx }) => {
    const config = window.__vabStagingConfig;
    const assembly = window.__vabAssembly;
    const stage = config.stages[fromStageIdx];
    const idx = stage.instanceIds.findIndex(instanceId => {
      const placed = assembly.parts.get(instanceId);
      return placed?.partId === partId;
    });
    if (idx < 0) throw new Error(`No part ${partId} in stage ${fromStageIdx}`);
    const [instanceId] = stage.instanceIds.splice(idx, 1);
    while (config.stages.length <= toStageIdx) {
      config.stages.push({ instanceIds: [] });
    }
    config.stages[toStageIdx].instanceIds.push(instanceId);
  }, { partId, fromStageIdx, toStageIdx });
}

async function launch(page, { selectCrew = false } = {}) {
  const btn = page.locator('#vab-btn-launch');
  await expect(btn).not.toBeDisabled({ timeout: 5_000 });
  await btn.click();
  // Handle crew dialog.
  await page.waitForSelector('#vab-crew-overlay', { state: 'visible', timeout: 5_000 });
  if (selectCrew) {
    await page.selectOption('.vab-crew-seat-select[data-seat="0"]', 'test-pilot-1');
  }
  await page.click('#vab-crew-confirm');
  // Wait for flight.
  await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 15_000 });
  await page.waitForFunction(
    () => window.__flightPs != null,
    { timeout: 10_000 },
  );
}

/** Launch from a rocket with probe core (no crew dialog). */
async function launchProbe(page) {
  const btn = page.locator('#vab-btn-launch');
  await expect(btn).not.toBeDisabled({ timeout: 5_000 });
  await btn.click();
  // Probe cores have no seats — no crew dialog appears. Go straight to flight.
  // But if a cmd-mk1 is on the rocket, the dialog WILL appear.
  // Try to detect and handle both cases.
  const crewOverlay = page.locator('#vab-crew-overlay');
  const flightHud   = page.locator('#flight-hud');
  const which = await Promise.race([
    crewOverlay.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'crew'),
    flightHud.waitFor({ state: 'visible', timeout: 10_000 }).then(() => 'flight'),
  ]);
  if (which === 'crew') {
    await page.click('#vab-crew-confirm');
    await page.waitForSelector('#flight-hud', { state: 'visible', timeout: 15_000 });
  }
  await page.waitForFunction(() => window.__flightPs != null, { timeout: 10_000 });
}

async function stage(page) {
  await page.keyboard.press('Space');
}

async function waitWarpUnlocked(page) {
  await page.waitForFunction(
    () => !document.querySelector('.hud-warp-btn')?.disabled,
    { timeout: 10_000 },
  );
}

async function setWarp(page, factor) {
  await waitWarpUnlocked(page);
  await page.click(`[data-warp="${factor}"]`);
}

async function waitAlt(page, m, timeout = 60_000) {
  await page.waitForFunction(
    alt => (window.__flightPs?.posY ?? 0) >= alt,
    m, { timeout },
  );
}

async function waitSpeed(page, s, timeout = 60_000) {
  await page.waitForFunction(
    spd => {
      const ps = window.__flightPs;
      if (!ps) return false;
      return Math.hypot(ps.velX, ps.velY) >= spd;
    },
    s, { timeout },
  );
}

async function waitLanded(page, timeout = 60_000) {
  await page.waitForFunction(
    () => window.__flightPs?.landed === true || window.__flightPs?.crashed === true,
    { timeout },
  );
}

async function waitOrbit(page, alt, vel, timeout = 180_000) {
  await page.waitForFunction(
    ([a, v]) => {
      const ps = window.__flightPs;
      if (!ps) return false;
      return ps.posY >= a && Math.hypot(ps.velX, ps.velY) >= v;
    },
    [alt, vel], { timeout },
  );
}

async function waitObjectivesComplete(page, missionId, timeout = 120_000) {
  await page.waitForFunction(
    id => {
      const state = window.__gameState;
      const m = state?.missions?.accepted?.find(x => x.id === id);
      return m?.objectives?.every(o => o.completed) ?? false;
    },
    missionId, { timeout },
  );
}

async function returnToHub(page) {
  // If we're already at the hub (e.g. after triggerReturnViaMenu aborted),
  // just dismiss any overlays and return.
  const alreadyAtHub = await page.locator('#hub-overlay').isVisible().catch(() => false);

  if (!alreadyAtHub) {
    // If an abort confirmation dialog is visible (mid-flight return), dismiss it.
    // Aborting skips the post-flight summary and goes straight to hub.
    const abortBtn = page.locator('[data-testid="abort-confirm-btn"]');
    const didAbort = await abortBtn.isVisible({ timeout: 1_000 }).catch(() => false);
    if (didAbort) {
      await abortBtn.click();
    } else {
      // Landed/crashed — post-flight summary appears; click through it.
      await page.waitForSelector('#post-flight-summary', { state: 'visible', timeout: 60_000 });
      await page.click('#post-flight-return-btn');
    }
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
    await dismissBtn.waitFor({ state: 'visible', timeout: 15_000 });
    await dismissBtn.click();
    await page.waitForSelector('#return-results-overlay', { state: 'hidden', timeout: 5_000 }).catch(() => {});
  } catch {
    // No return results overlay — proceed.
  }
  await page.waitForSelector('#hub-overlay', { state: 'visible', timeout: 15_000 });
}

/**
 * Trigger the post-flight summary via the in-flight menu.
 * Needed for probe-core rockets that land safely — the auto-trigger only
 * fires when crashed or all COMMAND_MODULE parts are destroyed.
 */
async function triggerReturnViaMenu(page) {
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

async function expectCompleted(page, missionId) {
  const ok = await page.evaluate(
    id => window.__gameState?.missions?.completed?.some(m => m.id === id) ?? false,
    missionId,
  );
  expect(ok).toBe(true);
}

async function expectPartUnlocked(page, partId) {
  const ok = await page.evaluate(
    id => window.__gameState?.parts?.includes(id) ?? false,
    partId,
  );
  expect(ok).toBe(true);
}

async function expectPartInVab(page, partId) {
  await navigateToVab(page);
  await expect(
    page.locator(`.vab-part-card[data-part-id="${partId}"]`),
  ).toBeVisible({ timeout: 5_000 });
}

// ---------------------------------------------------------------------------
// Rocket build helpers
// ---------------------------------------------------------------------------

/**
 * Build a vertical stack of parts in the VAB.
 * `parts` are listed top-to-bottom.  The first part is placed at anchorY.
 */
async function buildStack(page, parts, anchorY = CANVAS_CENTRE_Y) {
  const ys = stackYs(parts, anchorY);
  for (let i = 0; i < parts.length; i++) {
    await placePart(page, parts[i], CENTRE_X, ys[i], i + 1);
  }
}

/**
 * Place a radial part on the LEFT side of a parent part.
 * @param parentPartId  Part ID of the parent (must already be placed)
 * @param radialPartId  Part ID of the radial part to attach
 * @param parentY       Screen Y of the parent part's centre
 */
async function placeRadialLeft(page, radialPartId, parentPartId, parentY) {
  const parent = GEO[parentPartId];
  const child  = GEO[radialPartId];
  const x = CENTRE_X + parent.leftX - child.rightX;
  await dragPartToCanvas(page, radialPartId, x, parentY);
}

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

test.describe('Mission Progression', () => {
  // All tests involve physics simulation + flight.  A generous default timeout
  // avoids flaky failures under CPU contention (4 parallel workers).
  test.describe.configure({ timeout: 300_000 });

  // =========================================================================
  // GROUP 1: Tutorial Chain (M001, M004)
  // =========================================================================

  test('M001 — First Flight (reach 100m)', async ({ page }) => {
    test.setTimeout(90_000);
    const env = buildEnvelope({
      acceptedId: 'mission-001',
      parts: STARTER_PARTS,
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);

    // Build: cmd-mk1 + tank-small + engine-spark
    await buildStack(page, ['cmd-mk1', 'tank-small', 'engine-spark']);

    await launch(page);
    await stage(page);
    await page.keyboard.press('z');
    await waitAlt(page, 100);
    await page.keyboard.press('x');

    // Wait for landing/crash and return.
    await waitLanded(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-001');
  });

  test('M004 — Speed Demon (reach 150 m/s)', async ({ page }) => {
    test.setTimeout(90_000);
    const env = buildEnvelope({
      completedIds: ['mission-001'],
      acceptedId: 'mission-004',
      parts: [...STARTER_PARTS, 'tank-medium'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);
    await buildStack(page, ['cmd-mk1', 'tank-medium', 'engine-spark']);
    await launch(page);
    await stage(page);
    await page.keyboard.press('z');
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
    test.setTimeout(120_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: m1to4,
      acceptedId: 'mission-005',
      parts: STARTER_PARTS,
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);

    // Use probe-core for a lighter rocket. Without landing legs, the physics
    // engine requires ≤5 m/s for a LANDING event. Terminal velocity with mk1
    // chute at 320kg dry mass ≈ 4.66 m/s, which is under the 5 m/s threshold.
    await buildStack(page, ['parachute-mk1', 'probe-core-mk1', 'tank-small', 'engine-spark']);

    // Staging: engine auto-staged to stage-0. Move parachute to stage-1.
    await stagePartFromUnstaged(page, 'parachute-mk1', 1);

    await launchProbe(page);

    // Stage 0: fire engine at full throttle — burn ALL fuel so mass is at
    // dry weight (250kg) when the chute deploys.
    await stage(page);
    await page.keyboard.press('z');

    // Wait for fuel depletion (engine stops firing when tank empties).
    // Dry mass 250kg → terminal velocity with mk1 chute ≈ 4.12 m/s ≤ 5 m/s.
    await waitAlt(page, 50); // confirm engine is firing
    await page.waitForFunction(
      () => window.__flightPs?.firingEngines?.size === 0,
      { timeout: 30_000 },
    );

    // Stage 1: deploy parachute — mass now ≈ 250kg < 1200kg maxSafeMass.
    await waitWarpUnlocked(page);
    await stage(page);

    // 50× warp for the long descent from high altitude (~14km at burnout).
    await waitWarpUnlocked(page);
    await setWarp(page, 50);

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
    test.setTimeout(120_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: m1to4,
      acceptedId: 'mission-006',
      parts: STARTER_PARTS,
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);

    // Use probe-core for lighter rocket: wet 720kg, dry 320kg — both under
    // parachute-mk1 maxSafeMass 1200kg. Terminal velocity ≈ 4.7 m/s < 5 m/s.
    await buildStack(page, ['parachute-mk1', 'probe-core-mk1', 'tank-small', 'engine-spark']);

    // Engine in stage-0 (auto), parachute in stage-1.
    await stagePartFromUnstaged(page, 'parachute-mk1', 1);

    await launchProbe(page);
    await stage(page); // fire engine (satisfies ACTIVATE_PART ENGINE)
    await page.keyboard.press('z');

    // Burn ALL fuel — dry mass 250kg → terminal velocity 4.12 m/s ≤ 5 m/s.
    // Without legs, the physics engine crashes rockets landing > 5 m/s.
    await waitAlt(page, 50); // confirm engine is firing
    await page.waitForFunction(
      () => window.__flightPs?.firingEngines?.size === 0,
      { timeout: 30_000 },
    );

    // Deploy parachute for safe descent.
    await waitWarpUnlocked(page);
    await stage(page);

    // 50× warp for descent from high altitude.
    await waitWarpUnlocked(page);
    await setWarp(page, 50);

    await waitLanded(page, 120_000);
    await triggerReturnViaMenu(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-006');
    await expectPartUnlocked(page, 'landing-legs-small');
    await expectPartInVab(page, 'landing-legs-small');
  });

  test('M007 — Leg Day (deploy legs + land ≤10 m/s) → unlocks landing-legs-large', async ({ page }) => {
    test.setTimeout(120_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-006'],
      acceptedId: 'mission-007',
      parts: [...STARTER_PARTS, 'landing-legs-small'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);

    // Use probe-core for lighter rocket. With 2 deployed legs AND speed < 10
    // the physics uses Case 1 (controlled landing). Terminal velocity at dry
    // mass 480kg with mk1 chute ≈ 5.7 m/s (< 10 m/s with 2 legs → LANDING).
    const stackParts = ['parachute-mk1', 'probe-core-mk1', 'tank-small', 'engine-spark'];
    await buildStack(page, stackParts);
    const ys = stackYs(stackParts);
    const tankY = ys[2]; // tank-small Y position

    // Turn off mirror mode to control leg placement precisely.
    const mirrorBtn = page.locator('button:has-text("Mirror")');
    const isPressed = await mirrorBtn.getAttribute('aria-pressed');
    if (isPressed === 'true') await mirrorBtn.click();

    // Attach 2 landing-legs-small radially (left + right of tank).
    await placeRadialLeft(page, 'landing-legs-small', 'tank-small', tankY);
    await page.waitForFunction(
      count => (window.__vabAssembly?.parts?.size ?? 0) >= count,
      5, { timeout: 5_000 },
    );
    // Place second leg on the right side.
    const parentGeo = GEO['tank-small'];
    const childGeo = GEO['landing-legs-small'];
    await dragPartToCanvas(page, 'landing-legs-small', CENTRE_X + parentGeo.rightX - childGeo.leftX, tankY);
    await page.waitForFunction(
      count => (window.__vabAssembly?.parts?.size ?? 0) >= count,
      6, { timeout: 5_000 },
    );

    // Staging: engine in stage-0 (auto). Move BOTH legs + parachute to stage-1.
    await stagePartFromUnstaged(page, 'parachute-mk1', 1);
    await stagePartFromUnstaged(page, 'landing-legs-small', 1);
    await stagePartFromUnstaged(page, 'landing-legs-small', 1); // second leg

    await launchProbe(page);
    await stage(page); // Stage 0: fire engine at full throttle
    await page.keyboard.press('z');
    await waitAlt(page, 300);
    await page.keyboard.press('x');

    // Stage 1: deploy legs + parachute.
    await waitWarpUnlocked(page);
    await stage(page);

    // 50× warp for descent.
    await waitWarpUnlocked(page);
    await setWarp(page, 50);

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
    test.setTimeout(120_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-005'],
      acceptedId: 'mission-008',
      parts: [...STARTER_PARTS, 'science-module-mk1', 'tank-medium'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);

    // Build: cmd-mk1 + science-module-mk1 + tank-medium + engine-spark
    await buildStack(page, ['cmd-mk1', 'science-module-mk1', 'tank-medium', 'engine-spark']);

    // Stage 1: engine + science module — move science module into stage-0.
    await stagePartFromUnstaged(page, 'science-module-mk1', 0);

    await launch(page);
    await stage(page); // fires engine + activates science module
    await page.keyboard.press('z');

    // Climb to ~500m so free-fall gives ≥50 m/s impact.
    await waitAlt(page, 500);
    await page.keyboard.press('x');

    // Let it crash.
    await waitLanded(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-008');
  });

  test('M009 — Ejector Seat Test (eject crew ≥200m)', async ({ page }) => {
    test.setTimeout(120_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-006', 'mission-007'],
      acceptedId: 'mission-009',
      parts: [...STARTER_PARTS, 'probe-core-mk1', 'cmd-mk1'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);

    // Uncrewed test: probe-core + cmd-mk1 (for ejector seat) + tank + engine
    await buildStack(page, ['cmd-mk1', 'probe-core-mk1', 'tank-small', 'engine-spark']);

    // Stage 1: engine (auto in stage-0). Stage 2: ejector seat.
    await stagePartFromUnstaged(page, 'cmd-mk1', 1);

    await launchProbe(page);
    await stage(page); // fire engine
    await page.keyboard.press('z');

    await waitAlt(page, 250);
    // Cut throttle BEFORE ejecting — otherwise the remaining rocket body
    // (tank+engine) continues accelerating upward and takes ages to crash.
    await page.keyboard.press('x');

    // Stage 1: eject crew at ≥200m altitude.
    await waitWarpUnlocked(page);
    await stage(page);

    // 50× warp for the rocket body to fall and crash.
    await waitWarpUnlocked(page);
    await setWarp(page, 50);

    await waitLanded(page, 120_000);
    await returnToHub(page);
    await expectCompleted(page, 'mission-009');
  });

  test('M010 — Science Experiment Alpha (hold 800-1200m for 30s + return science)', async ({ page }) => {
    test.setTimeout(180_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-005', 'mission-008'],
      acceptedId: 'mission-010',
      parts: [...STARTER_PARTS, 'science-module-mk1', 'tank-medium', 'parachute-mk2'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);

    // probe-core (50) + parachute-mk2 (250) + science-module (200) + tank-small (50+400)
    // + engine-spark (120) = 1070kg wet.  Terminal velocity under mk2 chute
    // at ~880kg (with remaining fuel) ≈ 4.4 m/s → safe legless landing.
    await buildStack(page, [
      'parachute-mk2', 'probe-core-mk1', 'science-module-mk1', 'tank-small', 'engine-spark',
    ]);

    // Staging — chute first so we can deploy it for a slow descent through
    // the altitude band, then activate the science module inside the band:
    //   Stage 0: engine (auto)
    //   Stage 1: parachute (deploy above band for slow descent)
    //   Stage 2: science module (activate when inside the band)
    await stagePartFromUnstaged(page, 'parachute-mk2', 1);
    await stagePartFromUnstaged(page, 'science-module-mk1', 2);

    await launchProbe(page);
    await stage(page); // Stage 0: fire engine

    // Full throttle climb well above the 1200m band ceiling so the
    // parachute can slow us to terminal velocity before re-entering.
    await page.keyboard.press('z');
    await waitAlt(page, 1400);
    await page.keyboard.press('x'); // cut engine

    // Deploy parachute (Stage 1).  The chute opens gradually; by the
    // time the rocket peaks and starts descending, the canopy is fully
    // inflated.  Terminal velocity at ~880kg ≈ 4.4 m/s.
    await stage(page);

    // 50× warp while descending well above the band.
    await waitWarpUnlocked(page);
    await setWarp(page, 50);

    // Slow to 5× near the band ceiling so the staging command can execute
    // before the rocket descends past the band (under CPU contention, the
    // Playwright round-trip takes longer than at 50× warp the rocket needs
    // to traverse the 400m band).
    await page.waitForFunction(
      () => {
        const ps = window.__flightPs;
        return ps && ps.posY <= 1400 && ps.velY <= 0;
      },
      { timeout: 60_000 },
    );
    await setWarp(page, 5);

    // Wait until we descend into the altitude band (≤ 1200m).
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? Infinity) <= 1200,
      { timeout: 30_000 },
    );

    // Drop to 1× warp, activate science module inside the band (Stage 2).
    await setWarp(page, 1);
    await stage(page);

    // Verify the hold timer is visible in the objectives HUD.
    await expect(page.locator('[data-testid="hud-obj-hold-timer"]'))
      .toBeVisible({ timeout: 10_000 });

    // 50× warp through the 30s hold + experiment.  At ~4.4 m/s descent
    // the rocket traverses the 400m band in ~90 s — plenty for 30 s.
    await waitWarpUnlocked(page);
    await setWarp(page, 50);

    // Wait for HOLD_ALTITUDE objective completion.
    await page.waitForFunction(
      id => {
        const state = window.__gameState;
        const m = state?.missions?.accepted?.find(x => x.id === id);
        return m?.objectives?.find(o => o.type === 'HOLD_ALTITUDE')?.completed;
      },
      'mission-010',
      { timeout: 90_000 },
    );

    // Verify the HUD shows the hold objective as completed (green tick).
    const holdItem = page.locator('.hud-obj-icon.met').first();
    await expect(holdItem).toBeVisible({ timeout: 5_000 });

    // Continue 50× warp descent to landing.
    // RETURN_SCIENCE_DATA completes on safe landing (chute ≤ 5 m/s).
    await waitLanded(page);
    await triggerReturnViaMenu(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-010');
    await expectPartUnlocked(page, 'engine-poodle');
    await expectPartInVab(page, 'engine-poodle');
  });

  test('M011 — Emergency Systems Verified (eject crew ≥100m + crash ≥50 m/s)', async ({ page }) => {
    test.setTimeout(120_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-005', 'mission-006', 'mission-007', 'mission-008', 'mission-009'],
      acceptedId: 'mission-011',
      parts: [...STARTER_PARTS, 'probe-core-mk1', 'cmd-mk1'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);

    // Uncrewed test: probe-core + cmd-mk1 (for ejector seat) + tank + engine
    await buildStack(page, ['cmd-mk1', 'probe-core-mk1', 'tank-small', 'engine-spark']);

    // Staging: Stage 0 = engine (auto). Stage 1 = ejector seat.
    await stagePartFromUnstaged(page, 'cmd-mk1', 1);

    await launchProbe(page);
    await stage(page); // engine
    await page.keyboard.press('z');

    // Climb to ~300m.
    await waitAlt(page, 300);
    await page.keyboard.press('x');

    // Wait until descending past ~150m, then eject at ≥100m.
    await page.waitForFunction(
      () => {
        const ps = window.__flightPs;
        return ps && ps.velY < 0 && ps.posY < 250 && ps.posY > 100;
      },
      { timeout: 20_000 },
    );
    await waitWarpUnlocked(page);
    await stage(page); // eject crew

    // Rocket crashes from height (≥50 m/s impact from ~200m free-fall).
    await waitLanded(page, 120_000);
    await returnToHub(page);
    await expectCompleted(page, 'mission-011');
  });

  test('M012 — Stage Separation Test (reach 2000m + fire decoupler) → unlocks engine-reliant, srb-small', async ({ page }) => {
    test.setTimeout(120_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-005', 'mission-008', 'mission-010'],
      acceptedId: 'mission-012',
      parts: [...STARTER_PARTS, 'tank-medium'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);

    // Two-stage rocket (top to bottom):
    //   cmd-mk1 → tank-medium → engine-spark → decoupler → tank-medium → engine-spark
    await buildStack(page, [
      'cmd-mk1', 'tank-medium', 'engine-spark',
      'decoupler-stack-tr18', 'tank-medium', 'engine-spark',
    ]);

    // Auto-staging puts BOTH engines in stage-0 and decoupler in stage-1.
    // We need: stage-0 = lower engine only, stage-1 = decoupler + upper engine.
    // Move the first engine (upper, placed first) from stage-0 to stage-1.
    await movePartBetweenStages(page, 'engine-spark', 0, 1);

    await launch(page);
    await stage(page); // Stage 0: fire lower engine
    await page.keyboard.press('z');

    // 50× warp for the slow first stage climb (TWR ~1.4).
    await waitWarpUnlocked(page);
    await setWarp(page, 50);

    // Wait for 2000m.
    await waitAlt(page, 2_000);

    // Stage 1: decouple + fire upper engine.
    await setWarp(page, 1);
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
    test.setTimeout(120_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-005', 'mission-006', 'mission-007', 'mission-008', 'mission-009', 'mission-011'],
      acceptedId: 'mission-013',
      parts: [...STARTER_PARTS, 'tank-medium'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);

    // Two-stage rocket for high altitude.
    await buildStack(page, [
      'cmd-mk1', 'tank-medium', 'engine-spark',
      'decoupler-stack-tr18', 'tank-medium', 'engine-spark',
    ]);

    // Fix staging: move upper engine from stage-0 to stage-1 (with decoupler).
    await movePartBetweenStages(page, 'engine-spark', 0, 1);

    await launch(page);
    await stage(page);
    await page.keyboard.press('z');

    // 50× warp for the slow first stage climb (TWR ~1.6, takes ~36s game time).
    await waitWarpUnlocked(page);
    await setWarp(page, 50);

    // Wait for ~5km, then separate.
    await waitAlt(page, 5_000);
    await setWarp(page, 1);
    await waitWarpUnlocked(page);
    await stage(page); // separate + fire upper engine

    // Re-engage 50× warp and coast to 20km.
    await waitWarpUnlocked(page);
    await setWarp(page, 50);
    await waitAlt(page, 20_000, 60_000);

    // Objective met — return via menu instead of waiting for long descent.
    await setWarp(page, 1);
    await triggerReturnViaMenu(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-013');
  });

  test('M014 — Kármán Line Approach (reach 60,000m) → unlocks engine-nerv, srb-large', async ({ page }) => {
    test.setTimeout(180_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-005', 'mission-008', 'mission-010', 'mission-012'],
      acceptedId: 'mission-014',
      parts: [...STARTER_PARTS, 'tank-medium', 'engine-reliant'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);

    // Two-stage rocket with reliant first stage for more thrust.
    await buildStack(page, [
      'cmd-mk1', 'tank-medium', 'engine-spark',
      'decoupler-stack-tr18', 'tank-medium', 'engine-reliant',
    ]);

    // Fix staging: move upper engine from stage-0 to stage-1 (with decoupler).
    await movePartBetweenStages(page, 'engine-spark', 0, 1);

    await launch(page);
    await stage(page);
    await page.keyboard.press('z');

    // 50× warp for first stage climb.
    await waitWarpUnlocked(page);
    await setWarp(page, 50);

    // Reliant burns fast.  Separate at ~10km.
    await waitAlt(page, 10_000);
    await setWarp(page, 1);
    await waitWarpUnlocked(page);
    await stage(page);

    // Re-engage 50× warp to coast to 60km.
    await waitWarpUnlocked(page);
    await setWarp(page, 50);
    await waitAlt(page, 60_000, 120_000);

    // Objective met — return via menu instead of waiting for long descent.
    await setWarp(page, 1);
    await triggerReturnViaMenu(page);
    await returnToHub(page);
    await expectCompleted(page, 'mission-014');
    await expectPartUnlocked(page, 'engine-nerv');
    await expectPartUnlocked(page, 'srb-large');
    await expectPartInVab(page, 'engine-nerv');
  });

  test('M015 — Orbital Satellite Deployment I (orbit + release satellite >80km)', async ({ page }) => {
    test.setTimeout(300_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [
        ...m1to4, 'mission-005', 'mission-008', 'mission-010', 'mission-012',
        'mission-014', 'mission-016',
      ],
      acceptedId: 'mission-015',
      parts: [
        ...STARTER_PARTS, 'tank-medium', 'engine-reliant', 'engine-nerv',
        'tank-large', 'satellite-mk1',
      ],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);

    // Orbital rocket with satellite payload:
    //   satellite-mk1 + decoupler + cmd-mk1 + tank-medium + tank-medium + engine-nerv
    //   + decoupler + tank-medium + engine-reliant
    await buildStack(page, [
      'satellite-mk1', 'decoupler-stack-tr18', 'cmd-mk1',
      'tank-medium', 'tank-medium', 'engine-nerv',
      'decoupler-stack-tr18', 'tank-medium', 'engine-reliant',
    ]);

    // Programmatic staging:
    //   stage-0: reliant (lower engine)
    //   stage-1: lower decoupler + nerv engine (stage separation)
    //   stage-2: upper decoupler (satellite release)
    await page.evaluate(() => {
      const config = window.__vabStagingConfig;
      const assembly = window.__vabAssembly;
      const byPartId = {};
      for (const [instanceId, placed] of assembly.parts) {
        if (!byPartId[placed.partId]) byPartId[placed.partId] = [];
        byPartId[placed.partId].push(instanceId);
      }
      config.stages = [];
      config.unstaged = [];
      config.stages.push({ instanceIds: [byPartId['engine-reliant'][0]] });
      config.stages.push({ instanceIds: [byPartId['decoupler-stack-tr18'][1], byPartId['engine-nerv'][0]] });
      config.stages.push({ instanceIds: [byPartId['decoupler-stack-tr18'][0]] });
      const staged = new Set(config.stages.flatMap(s => s.instanceIds));
      for (const [instanceId] of assembly.parts) {
        if (!staged.has(instanceId)) config.unstaged.push(instanceId);
      }
    });

    await launch(page);
    await stage(page); // fire lower engine (reliant)
    await page.keyboard.press('z');

    // Slight tilt at ~2km.
    await waitAlt(page, 2_000);
    await page.keyboard.down('d');
    await page.waitForFunction(
      () => Math.abs(window.__flightPs?.angle ?? 0) > 0.3,
      { timeout: 10_000 },
    );
    await page.keyboard.up('d');

    // Separate first stage at ~8km.
    await waitAlt(page, 8_000);
    await waitWarpUnlocked(page);
    await stage(page); // decouple + fire nerv

    // Set slight tilt to climb fast.
    await page.evaluate(async () => {
      const ps = window.__flightPs;
      if (ps) { ps.angle = 0.2; ps.angularVelocity = 0; }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
    });

    // 50× warp for nerv burn.
    await waitWarpUnlocked(page);
    await setWarp(page, 50);

    // Wait to reach 80km altitude.
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) >= 80_000,
      { timeout: 180_000 },
    );

    // Inject horizontal velocity for orbit conditions.
    await page.evaluate(async () => {
      const ps = window.__flightPs;
      if (ps) {
        ps.velX = 8000;
        ps.velY = Math.max(ps.velY, 0);
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
    });

    // Wait for REACH_ORBIT objective.
    await page.waitForFunction(
      () => {
        const state = window.__gameState;
        const m = state?.missions?.accepted?.find(x => x.id === 'mission-015');
        return m?.objectives?.find(o => o.type === 'REACH_ORBIT')?.completed;
      },
      { timeout: 10_000 },
    );

    // Release satellite while still in orbit.
    await setWarp(page, 1);
    await waitWarpUnlocked(page);
    await stage(page); // fire satellite decoupler

    // Wait for RELEASE_SATELLITE objective.
    await waitObjectivesComplete(page, 'mission-015', 30_000);

    // Return to hub via menu (in orbit, won't land naturally).
    await page.click('#topbar-menu-btn', { force: true });
    const dropdown = page.locator('#topbar-dropdown');
    await expect(dropdown).toBeVisible();
    await dropdown.getByText('Return to Space Agency').click();

    await returnToHub(page);
    await expectCompleted(page, 'mission-015');
  });

  test('M016 — Low Earth Orbit (≥80km AND ≥7,800 m/s) → unlocks tank-large', async ({ page }) => {
    test.setTimeout(300_000);
    const m1to4 = ['mission-001', 'mission-004'];
    const env = buildEnvelope({
      completedIds: [...m1to4, 'mission-005', 'mission-008', 'mission-010', 'mission-012', 'mission-014'],
      acceptedId: 'mission-016',
      parts: [...STARTER_PARTS, 'tank-medium', 'engine-reliant', 'engine-nerv'],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);

    // Two-stage orbital rocket:
    //   Upper: cmd-mk1 + tank-medium + tank-medium + engine-nerv (ISP 800s)
    //   Lower: decoupler + tank-medium + engine-reliant (240kN)
    await buildStack(page, [
      'cmd-mk1', 'tank-medium', 'tank-medium', 'engine-nerv',
      'decoupler-stack-tr18', 'tank-medium', 'engine-reliant',
    ]);

    // Fix staging: move nerv from stage-0 to stage-1 (with decoupler).
    await movePartBetweenStages(page, 'engine-nerv', 0, 1);

    await launch(page);
    await stage(page); // fire lower engine (reliant)
    await page.keyboard.press('z');

    // Fly mostly vertical to build altitude. Slight tilt at 2km.
    await waitAlt(page, 2_000);
    await page.keyboard.down('d');
    await page.waitForFunction(
      () => Math.abs(window.__flightPs?.angle ?? 0) > 0.3,
      { timeout: 10_000 },
    );
    await page.keyboard.up('d');

    // Separate at ~8km.
    await waitAlt(page, 8_000);
    await waitWarpUnlocked(page);
    await stage(page); // decouple + fire nerv

    // Set slight tilt (0.2 rad ≈ 11°) to climb fast while building some
    // horizontal speed. The nerv has TWR ~1.25 at full mass — mostly vertical
    // thrust exceeds gravity and rocket keeps climbing.
    await page.evaluate(async () => {
      const ps = window.__flightPs;
      if (ps) { ps.angle = 0.2; ps.angularVelocity = 0; }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
    });

    // 50× warp for long nerv burn.
    await waitWarpUnlocked(page);
    await setWarp(page, 50);

    // Wait to reach 80km altitude.
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) >= 80_000,
      { timeout: 180_000 },
    );

    // At 80km, inject horizontal velocity to simulate orbital insertion.
    // The game uses constant gravity so true orbit is impossible; the
    // REACH_ORBIT objective simply checks alt >= 80km AND speed >= 7800.
    await page.evaluate(async () => {
      const ps = window.__flightPs;
      if (ps) {
        ps.velX = 8000;
        ps.velY = Math.max(ps.velY, 0); // keep any upward velocity
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
    });

    // Wait for objective to trigger.
    await page.waitForFunction(
      () => {
        const state = window.__gameState;
        const m = state?.missions?.accepted?.find(x => x.id === 'mission-016');
        return m?.objectives?.every(o => o.completed);
      },
      { timeout: 10_000 },
    );

    // Mission complete — return via menu (in orbit, won't land).
    await page.keyboard.press('x');
    await setWarp(page, 1);
    await page.click('#topbar-menu-btn', { force: true });
    const dropdown = page.locator('#topbar-dropdown');
    await expect(dropdown).toBeVisible();
    await dropdown.getByText('Return to Space Agency').click();

    await returnToHub(page);
    await expectCompleted(page, 'mission-016');
    await expectPartUnlocked(page, 'tank-large');
    await expectPartInVab(page, 'tank-large');
  });

  test('M017 — Tracked Satellite Deployment (orbit + release satellite >80km, Tracking Station)', async ({ page }) => {
    test.setTimeout(300_000);
    // All previous missions + mission-020 (Tracking Station tutorial) completed.
    const allPrev = Array.from({ length: 16 }, (_, i) =>
      `mission-${String(i + 1).padStart(3, '0')}`);
    const env = buildEnvelope({
      completedIds: [...allPrev, 'mission-020'],
      acceptedId: 'mission-017',
      parts: [
        ...STARTER_PARTS, 'tank-medium', 'engine-reliant', 'engine-nerv',
        'tank-large', 'satellite-mk1', 'parachute-mk2',
      ],
    });
    await page.setViewportSize({ width: VP_W, height: VP_H });
    await seedAndLoadSave(page, env);
    await navigateToVab(page);

    // Orbital rocket with satellite payload:
    //   satellite-mk1 + decoupler + cmd-mk1 + tank-medium + tank-medium + engine-nerv
    //   + decoupler + tank-medium + engine-reliant
    await buildStack(page, [
      'satellite-mk1', 'decoupler-stack-tr18', 'cmd-mk1',
      'tank-medium', 'tank-medium', 'engine-nerv',
      'decoupler-stack-tr18', 'tank-medium', 'engine-reliant',
    ]);

    // Programmatic staging (same pattern as M015) to ensure correct order:
    //   stage-0: reliant (lower engine)
    //   stage-1: lower decoupler + nerv engine (stage separation)
    //   stage-2: upper decoupler (satellite release)
    await page.evaluate(() => {
      const config = window.__vabStagingConfig;
      const assembly = window.__vabAssembly;
      const byPartId = {};
      for (const [instanceId, placed] of assembly.parts) {
        if (!byPartId[placed.partId]) byPartId[placed.partId] = [];
        byPartId[placed.partId].push(instanceId);
      }
      config.stages = [];
      config.unstaged = [];
      // stage-0: reliant engine only
      config.stages.push({ instanceIds: [byPartId['engine-reliant'][0]] });
      // stage-1: lower decoupler (second placed = index 1) + nerv engine
      config.stages.push({ instanceIds: [byPartId['decoupler-stack-tr18'][1], byPartId['engine-nerv'][0]] });
      // stage-2: upper decoupler (first placed = index 0, satellite release)
      config.stages.push({ instanceIds: [byPartId['decoupler-stack-tr18'][0]] });
      // unstaged: everything else
      const staged = new Set(config.stages.flatMap(s => s.instanceIds));
      for (const [instanceId] of assembly.parts) {
        if (!staged.has(instanceId)) config.unstaged.push(instanceId);
      }
    });

    await launch(page);
    await stage(page); // fire lower engine (reliant)
    await page.keyboard.press('z');

    // Slight tilt at ~2km.
    await waitAlt(page, 2_000);
    await page.keyboard.down('d');
    await page.waitForFunction(
      () => Math.abs(window.__flightPs?.angle ?? 0) > 0.3,
      { timeout: 10_000 },
    );
    await page.keyboard.up('d');

    // Separate first stage at ~8km.
    await waitAlt(page, 8_000);
    await waitWarpUnlocked(page);
    await stage(page); // decouple + fire nerv

    // Set slight tilt to climb fast.
    await page.evaluate(async () => {
      const ps = window.__flightPs;
      if (ps) { ps.angle = 0.2; ps.angularVelocity = 0; }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
    });

    // 50× warp for nerv burn.
    await waitWarpUnlocked(page);
    await setWarp(page, 50);

    // Wait to reach 80km altitude.
    await page.waitForFunction(
      () => (window.__flightPs?.posY ?? 0) >= 80_000,
      { timeout: 180_000 },
    );

    // Inject horizontal velocity for orbit conditions.
    await page.evaluate(async () => {
      const ps = window.__flightPs;
      if (ps) {
        ps.velX = 8000;
        ps.velY = Math.max(ps.velY, 0);
      }
      if (typeof window.__resyncPhysicsWorker === 'function') { await window.__resyncPhysicsWorker(); }
    });

    // Wait for REACH_ORBIT objective.
    await page.waitForFunction(
      () => {
        const state = window.__gameState;
        const m = state?.missions?.accepted?.find(x => x.id === 'mission-017');
        return m?.objectives?.find(o => o.type === 'REACH_ORBIT')?.completed;
      },
      { timeout: 10_000 },
    );

    // Release satellite while still in orbit.
    await setWarp(page, 1);
    await waitWarpUnlocked(page);
    await stage(page); // fire satellite decoupler

    // Wait for RELEASE_SATELLITE objective.
    await waitObjectivesComplete(page, 'mission-017', 30_000);

    // Return to hub via menu (in orbit, won't land naturally).
    await page.click('#topbar-menu-btn', { force: true });
    const dropdown = page.locator('#topbar-dropdown');
    await expect(dropdown).toBeVisible();
    await dropdown.getByText('Return to Space Agency').click();

    await returnToHub(page);
    await expectCompleted(page, 'mission-017');
  });

});
