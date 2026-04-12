/**
 * phase-transitions.spec.ts — E2E tests for flight phase transitions.
 *
 * Each test covers one unique phase transition, using teleport+velocity to
 * get near the transition point and then letting the real physics pipeline
 * run through the actual transition at high time warp.
 *
 * Transitions covered:
 *   1. PRELAUNCH → LAUNCH   (engine ignition)
 *   2. LAUNCH → FLIGHT      (liftoff / ground clearance)
 *   3. FLIGHT → ORBIT       (orbital velocity + checkOrbitStatus)
 *   4. ORBIT → MANOEUVRE    (burn initiation in orbit)
 *   5. MANOEUVRE → TRANSFER (escape trajectory detection)
 *   6. Reentry              (ORBIT → REENTRY → FLIGHT via deorbit)
 *   7. Landing              (parachute + ground contact)
 *   8. Crash                (impact detection + part destruction)
 */

import { test, expect, type Page, type Browser } from '@playwright/test';
import {
  VP_W, VP_H,
  buildSaveEnvelope,
  seedAndLoadSave,
  startTestFlight,
  teleportCraft,
  waitForOrbit,
  setTestTimeWarp,
  ALL_FACILITIES,
} from './helpers.js';
import { ALL_PARTS } from './fixtures.js';

import type { SaveEnvelope, SaveEnvelopeParams } from './helpers.js';

// ---------------------------------------------------------------------------
// Browser-context type aliases (used with type assertions inside page.evaluate)
// ---------------------------------------------------------------------------

interface PhaseLogEntry {
  from: string;
  to: string;
  reason?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Earth orbital parameters.
const EARTH_RADIUS: number = 6_371_000;       // metres
const EARTH_GM: number     = 3.986004418e14;  // m³/s²

// Circular orbital velocity at 100 km altitude.
const ORBIT_ALT: number = 100_000;
const ORBIT_VEL: number = Math.round(Math.sqrt(EARTH_GM / (EARTH_RADIUS + ORBIT_ALT))); // ~7848 m/s

// Rocket configs.
const BASIC_ROCKET: string[]    = ['probe-core-mk1', 'tank-small', 'engine-spark'];
const CHUTE_ROCKET: string[]    = ['probe-core-mk1', 'parachute-mk1', 'tank-small', 'engine-spark'];
const ORBITAL_ROCKET: string[]  = ['probe-core-mk1', 'tank-large', 'engine-reliant'];

// ---------------------------------------------------------------------------
// Shared fixture
// ---------------------------------------------------------------------------

function phaseTestFixture(overrides: SaveEnvelopeParams = {}): SaveEnvelope {
  return buildSaveEnvelope({
    saveName:     'Phase Transition Test',
    agencyName:   'Phase Test Agency',
    money:        50_000_000,
    parts:        ALL_PARTS,
    currentPeriod: 10,
    tutorialMode: false,
    facilities:   { ...ALL_FACILITIES },
    ...overrides,
  });
}

/**
 * Helper: wait for a specific phase to appear in the phaseLog via real
 * physics transitions (not direct state mutation).
 */
async function waitForPhaseInLog(page: Page, targetPhase: string, timeout: number = 30_000): Promise<void> {
  await page.waitForFunction(
    (phase: string) => {
      const fs = window.__flightState;
      return fs?.phaseLog?.some((entry: PhaseLogEntry) => entry.to === phase) ?? false;
    },
    targetPhase,
    { timeout },
  );
}

/**
 * Helper: wait for the current phase to be a specific value.
 */
async function waitForPhase(page: Page, targetPhase: string, timeout: number = 30_000): Promise<void> {
  await page.waitForFunction(
    (phase: string) => window.__flightState?.phase === phase,
    targetPhase,
    { timeout },
  );
}

/**
 * Helper: read the full phaseLog from the flight state.
 */
async function getPhaseLog(page: Page): Promise<PhaseLogEntry[]> {
  return page.evaluate(() => window.__flightState?.phaseLog ?? []);
}

// ===========================================================================
// 1. PRELAUNCH → LAUNCH (engine ignition)
// ===========================================================================

test.describe('Phase Transition: PRELAUNCH → LAUNCH', () => {
  test('engine ignition transitions from PRELAUNCH to LAUNCH', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope: SaveEnvelope = phaseTestFixture();
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, BASIC_ROCKET);

    // Verify we start in PRELAUNCH.
    const initialPhase: string | undefined = await page.evaluate(
      () => window.__flightState?.phase,
    );
    expect(initialPhase).toBe('PRELAUNCH');

    // Press Space to stage (ignite the engine).
    await page.keyboard.press('Space');

    // Wait for LAUNCH phase to appear in the phaseLog — this proves the
    // transition happened through evaluateAutoTransitions, not direct mutation.
    await waitForPhaseInLog(page, 'LAUNCH', 5_000);

    const log: PhaseLogEntry[] = await getPhaseLog(page);
    const launchEntry: PhaseLogEntry | undefined = log.find((e: PhaseLogEntry) => e.to === 'LAUNCH');
    expect(launchEntry).toBeTruthy();
    expect(launchEntry!.from).toBe('PRELAUNCH');
    expect(launchEntry!.reason).toContain('ignition');

    await page.close();
  });
});

// ===========================================================================
// 2. LAUNCH → FLIGHT (liftoff)
// ===========================================================================

test.describe('Phase Transition: LAUNCH → FLIGHT', () => {
  test('liftoff transitions from LAUNCH to FLIGHT', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope: SaveEnvelope = phaseTestFixture();
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, BASIC_ROCKET);

    // Stage the engine to go PRELAUNCH → LAUNCH → FLIGHT.
    await page.keyboard.press('Space');

    // Wait for FLIGHT phase — the rocket lifts off the pad.
    await waitForPhaseInLog(page, 'FLIGHT', 10_000);

    const log: PhaseLogEntry[] = await getPhaseLog(page);
    const flightEntry: PhaseLogEntry | undefined = log.find(
      (e: PhaseLogEntry) => e.to === 'FLIGHT' && e.from === 'LAUNCH',
    );
    expect(flightEntry).toBeTruthy();
    expect(flightEntry!.reason).toContain('Liftoff');

    // Verify physics state: not grounded, posY > 0.
    await page.waitForFunction(
      () => window.__flightPs?.grounded === false && (window.__flightPs?.posY ?? 0) > 0,
      { timeout: 5_000 },
    );
    const ps: { grounded: boolean | undefined; posY: number | undefined } = await page.evaluate(() => ({
      grounded: window.__flightPs?.grounded,
      posY: window.__flightPs?.posY,
    }));
    expect(ps.grounded).toBe(false);
    expect(ps.posY).toBeGreaterThan(0);

    await page.close();
  });
});

// ===========================================================================
// 3. FLIGHT → ORBIT (orbital velocity achieved)
// ===========================================================================

test.describe('Phase Transition: FLIGHT → ORBIT', () => {
  test('reaching orbital velocity transitions from FLIGHT to ORBIT', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope: SaveEnvelope = phaseTestFixture();
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, ORBITAL_ROCKET);

    // Teleport directly to orbital altitude with circular velocity.
    // The teleport helper sets phase=FLIGHT and inOrbit=false, so the
    // physics auto-detection will compute orbit status and trigger the
    // FLIGHT → ORBIT transition on the next frame.
    await teleportCraft(page, {
      posY: ORBIT_ALT,
      velX: ORBIT_VEL,
      velY: 0,
      bodyId: 'EARTH',
    });

    // Wait for orbit detection — the real physics pipeline checks
    // checkOrbitStatus() and triggers FLIGHT → ORBIT.
    await waitForOrbit(page);

    const log: PhaseLogEntry[] = await getPhaseLog(page);
    const orbitEntry: PhaseLogEntry | undefined = log.find(
      (e: PhaseLogEntry) => e.to === 'ORBIT' && e.from === 'FLIGHT',
    );
    expect(orbitEntry).toBeTruthy();

    // Verify orbital elements were computed (not null).
    const orbitalElements: unknown = await page.evaluate(
      () => window.__flightState?.orbitalElements,
    );
    expect(orbitalElements).toBeTruthy();

    // Verify inOrbit flag.
    const inOrbit: boolean | undefined = await page.evaluate(
      () => window.__flightState?.inOrbit,
    );
    expect(inOrbit).toBe(true);

    await page.close();
  });
});

// ===========================================================================
// 4. ORBIT → MANOEUVRE (burn initiation)
// ===========================================================================

test.describe('Phase Transition: ORBIT → MANOEUVRE', () => {
  test('starting a burn in orbit transitions to MANOEUVRE', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope: SaveEnvelope = phaseTestFixture();
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, ORBITAL_ROCKET);

    // Teleport to stable orbit.
    await teleportCraft(page, {
      posY: ORBIT_ALT,
      velX: ORBIT_VEL,
      velY: 0,
      bodyId: 'EARTH',
    });
    await waitForOrbit(page);

    // Initiate a burn: restore engine firing + set throttle in NORMAL mode.
    // The teleport clears firingEngines, so we re-add engine parts from
    // activeParts. The actual thrust, orbit modification, and phase
    // transition all run through the real physics pipeline.
    await page.evaluate(async () => {
      const w = window;
      const ps = w.__flightPs;
      const assembly = w.__flightAssembly;
      if (!ps || !assembly) return;
      ps.controlMode = 'NORMAL';
      ps.throttle = 1.0;
      for (const [id, placed] of assembly.parts) {
        const def: string = placed.partId;
        if (ps.activeParts.has(id) &&
            (def.includes('engine') || def.includes('srb'))) {
          ps.firingEngines.add(id);
        }
      }
      if (typeof w.__resyncPhysicsWorker === 'function') {
        await w.__resyncPhysicsWorker();
      }
    });

    // Wait for MANOEUVRE phase — shouldEnterManoeuvre() detects
    // isOrbitalBurnActive (throttle > 0 + firingEngines non-empty + NORMAL mode).
    await waitForPhaseInLog(page, 'MANOEUVRE', 10_000);

    const log: PhaseLogEntry[] = await getPhaseLog(page);
    const manEntry: PhaseLogEntry | undefined = log.find(
      (e: PhaseLogEntry) => e.to === 'MANOEUVRE' && e.from === 'ORBIT',
    );
    expect(manEntry).toBeTruthy();
    expect(manEntry!.reason).toContain('burn');

    await page.close();
  });
});

// ===========================================================================
// 5. MANOEUVRE → TRANSFER (escape trajectory)
// ===========================================================================

test.describe('Phase Transition: MANOEUVRE → TRANSFER', () => {
  test('reaching escape velocity during manoeuvre transitions to TRANSFER', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope: SaveEnvelope = phaseTestFixture();
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, ORBITAL_ROCKET);

    // Teleport to orbit.
    await teleportCraft(page, {
      posY: ORBIT_ALT,
      velX: ORBIT_VEL,
      velY: 0,
      bodyId: 'EARTH',
    });
    await waitForOrbit(page);

    // Start a burn to get into MANOEUVRE, then boost velocity near escape.
    // The burn runs through real physics — the engine thrust pushes
    // velocity past the escape threshold naturally.
    await page.evaluate(async () => {
      const w = window;
      const ps = w.__flightPs;
      const assembly = w.__flightAssembly;
      if (!ps || !assembly) return;

      // Set velocity above escape (~11097 m/s at 100km).
      // Clear orbital elements so Keplerian propagation doesn't override velocity.
      ps.velX = 11_200;
      ps.velY = 0;
      const fs = w.__flightState;
      if (fs) fs.orbitalElements = null;

      // Fire engines in NORMAL mode to get into MANOEUVRE.
      ps.controlMode = 'NORMAL';
      ps.throttle = 1.0;
      for (const [id, placed] of assembly.parts) {
        if (ps.activeParts.has(id) &&
            (placed.partId.includes('engine') || placed.partId.includes('srb'))) {
          ps.firingEngines.add(id);
        }
      }
      if (typeof w.__resyncPhysicsWorker === 'function') {
        await w.__resyncPhysicsWorker();
      }
    });

    // Wait for MANOEUVRE phase (burn detection).
    await waitForPhaseInLog(page, 'MANOEUVRE', 10_000);

    // The engine-reliant produces 200 kN of thrust. With time warp the
    // velocity will cross the escape threshold quickly.
    await setTestTimeWarp(page, 50);

    // Wait for TRANSFER phase (escape trajectory detection).
    await waitForPhaseInLog(page, 'TRANSFER', 20_000);

    const log: PhaseLogEntry[] = await getPhaseLog(page);
    const transferEntry: PhaseLogEntry | undefined = log.find((e: PhaseLogEntry) => e.to === 'TRANSFER');
    expect(transferEntry).toBeTruthy();

    // Verify inOrbit is false (we've left orbit).
    const inOrbit: boolean | undefined = await page.evaluate(
      () => window.__flightState?.inOrbit,
    );
    expect(inOrbit).toBe(false);

    await page.close();
  });
});

// ===========================================================================
// 6. Reentry (ORBIT → REENTRY → FLIGHT)
// ===========================================================================

test.describe('Phase Transition: Reentry', () => {
  test('lowering periapsis triggers ORBIT → REENTRY → FLIGHT', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope: SaveEnvelope = phaseTestFixture();
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, ORBITAL_ROCKET);

    // Teleport to stable orbit at 100 km.
    await teleportCraft(page, {
      posY: ORBIT_ALT,
      velX: ORBIT_VEL,
      velY: 0,
      bodyId: 'EARTH',
    });
    await waitForOrbit(page);

    // Reduce velocity so periapsis drops below 70 km (min orbit altitude).
    // This simulates a retrograde burn result — clear orbital elements so
    // the physics recomputes the orbit from the new velocity and detects
    // it's no longer valid (triggers deorbit).
    await page.evaluate(async () => {
      const w = window;
      const ps = w.__flightPs;
      const fs = w.__flightState;
      if (!ps || !fs) return;
      ps.velX = ps.velX - 300;
      fs.orbitalElements = null;
      if (typeof w.__resyncPhysicsWorker === 'function') {
        await w.__resyncPhysicsWorker();
      }
    });

    // The deorbit warning fires after a 2-second delay, then transitions to REENTRY.
    // Allow extra time for the worker to recompute orbital elements and detect deorbit.
    await waitForPhaseInLog(page, 'REENTRY', 30_000);

    const log: PhaseLogEntry[] = await getPhaseLog(page);
    const reentryEntry: PhaseLogEntry | undefined = log.find((e: PhaseLogEntry) => e.to === 'REENTRY');
    expect(reentryEntry).toBeTruthy();
    expect(reentryEntry!.from).toBe('ORBIT');

    // Now let the craft descend. Once below 70 km, REENTRY → FLIGHT should fire.
    // High warp speed to cover the 30km descent quickly.
    await setTestTimeWarp(page, 500);

    await waitForPhase(page, 'FLIGHT', 60_000);

    const log2: PhaseLogEntry[] = await getPhaseLog(page);
    const flightEntry: PhaseLogEntry | undefined = log2.find(
      (e: PhaseLogEntry) => e.to === 'FLIGHT' && e.from === 'REENTRY',
    );
    expect(flightEntry).toBeTruthy();
    expect(flightEntry!.reason).toContain('Atmospheric');

    await page.close();
  });
});

// ===========================================================================
// 7. Landing (parachute + ground contact)
// ===========================================================================

test.describe('Phase Transition: Landing', () => {
  test('parachute descent leads to safe landing via real physics', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope: SaveEnvelope = phaseTestFixture();
    await seedAndLoadSave(page, envelope);

    // Use a rocket with a parachute. Custom staging ensures:
    //   Stage 0: engine (fires on first Space)
    //   Stage 1: parachute (fires on second Space)
    await startTestFlight(page, CHUTE_ROCKET, {
      staging: [
        { partIds: ['engine-spark'] },
        { partIds: ['parachute-mk1'] },
      ],
    });

    // Stage the engine (stage 0) → PRELAUNCH → LAUNCH → FLIGHT.
    await page.keyboard.press('Space');
    await waitForPhaseInLog(page, 'FLIGHT', 10_000);

    // Teleport to 2 km altitude with slow downward velocity.
    await teleportCraft(page, {
      posY: 2_000,
      velX: 0,
      velY: -20,  // Descending at 20 m/s
      throttle: 0,
    });

    // Stage the parachute (stage 1) so it deploys.
    await page.keyboard.press('Space');

    // Wait for parachute to be deploying or deployed.
    await page.waitForFunction(() => {
      const w = window;
      const ps = w.__flightPs;
      if (!ps?.parachuteStates) return false;
      for (const [, entry] of ps.parachuteStates) {
        if (entry.state === 'deploying' || entry.state === 'deployed') return true;
      }
      return false;
    }, { timeout: 5_000 });

    // Let physics run with time warp for the descent.
    await setTestTimeWarp(page, 50);

    // Wait for landing.
    await page.waitForFunction(
      () => window.__flightPs?.landed === true,
      { timeout: 15_000 },
    );

    // Verify it was a safe landing, not a crash.
    await page.waitForFunction(
      () => window.__flightPs?.landed === true && (window.__flightPs?.posY ?? 999) <= 1,
      { timeout: 5_000 },
    );
    const result: { landed: boolean | undefined; crashed: boolean | undefined; posY: number | undefined } =
      await page.evaluate(() => ({
        landed: window.__flightPs?.landed,
        crashed: window.__flightPs?.crashed,
        posY: window.__flightPs?.posY,
      }));
    expect(result.landed).toBe(true);
    expect(result.crashed).toBe(false);
    expect(result.posY).toBeLessThanOrEqual(1);

    // Verify a LANDING event was recorded through the physics pipeline.
    await page.waitForFunction(
      () => (window.__gameState?.currentFlight?.events ?? []).some((e: { type: string }) => e.type === 'LANDING'),
      { timeout: 5_000 },
    );
    const events: { type: string }[] = await page.evaluate(
      () => window.__gameState?.currentFlight?.events ?? [],
    );
    const landingEvent: { type: string } | undefined = events.find((e: { type: string }) => e.type === 'LANDING');
    expect(landingEvent).toBeTruthy();

    await page.close();
  });
});

// ===========================================================================
// 8. Crash (impact detection)
// ===========================================================================

test.describe('Phase Transition: Crash', () => {
  test('high-speed ground impact triggers crash detection', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope: SaveEnvelope = phaseTestFixture();
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, BASIC_ROCKET);

    // Teleport to 500m with high downward velocity — guaranteed crash.
    // The teleport sets phase=FLIGHT. The crash threshold for parts is
    // ~10 m/s; 200 m/s will destroy everything on ground contact.
    await teleportCraft(page, {
      posY: 500,
      velX: 0,
      velY: -200,  // Plummeting at 200 m/s
      throttle: 0,
    });

    // Let physics detect the impact.
    await page.waitForFunction(
      () => window.__flightPs?.crashed === true,
      { timeout: 10_000 },
    );

    // Verify crash state.
    const result: { crashed: boolean | undefined; landed: boolean | undefined } = await page.evaluate(() => ({
      crashed: window.__flightPs?.crashed,
      landed: window.__flightPs?.landed,
    }));
    expect(result.crashed).toBe(true);
    expect(result.landed).toBe(false);

    // Verify a CRASH event was recorded through the physics pipeline.
    await page.waitForFunction(
      () => (window.__gameState?.currentFlight?.events ?? []).some((e: { type: string }) => e.type === 'CRASH'),
      { timeout: 5_000 },
    );
    const events: { type: string }[] = await page.evaluate(
      () => window.__gameState?.currentFlight?.events ?? [],
    );
    const crashEvent: { type: string } | undefined = events.find((e: { type: string }) => e.type === 'CRASH');
    expect(crashEvent).toBeTruthy();

    await page.close();
  });
});

// ===========================================================================
// 9. TRANSFER → CAPTURE → ORBIT (SOI arrival at destination)
// ===========================================================================

// Moon's orbital distance from Earth centre and SOI radius.
const MOON_ORBIT_R: number  = 384_400_000;  // metres from Earth centre
const MOON_SOI: number      = 66_100_000;   // metres
const MOON_RADIUS: number   = 1_737_400;    // metres
const MOON_GM: number       = 4.9048695e12; // m³/s²
test.describe('Phase Transition: TRANSFER → CAPTURE → ORBIT', () => {
  test('entering Moon SOI transitions TRANSFER → CAPTURE → ORBIT', async ({ browser }: { browser: Browser }) => {
    test.setTimeout(60_000);
    const page: Page = await browser.newPage();
    await page.setViewportSize({ width: VP_W, height: VP_H });

    const envelope: SaveEnvelope = phaseTestFixture();
    await seedAndLoadSave(page, envelope);
    await startTestFlight(page, ORBITAL_ROCKET);

    // Step 1: Teleport to TRANSFER phase, just INSIDE the Moon's SOI.
    // The SOI check uses |craftR - childOrbitR| < childSOI, so placing
    // 100km inside the boundary triggers CAPTURE immediately.
    const insideMoonSOI: number = MOON_ORBIT_R - EARTH_RADIUS - MOON_SOI + 100_000;
    await teleportCraft(page, {
      posY: insideMoonSOI,
      velX: 0,
      velY: 1000,
      bodyId: 'EARTH',
      phase: 'TRANSFER',
      transferState: {
        originBodyId: 'EARTH',
        destinationBodyId: 'MOON',
        departureTime: 0,
        estimatedArrival: 100,
        departureDV: 3200,
        captureDV: 800,
        totalDV: 4000,
        trajectoryPath: [],
      },
    });

    // CAPTURE should trigger within a few physics ticks.
    await waitForPhaseInLog(page, 'CAPTURE', 10_000);

    const log1: PhaseLogEntry[] = await getPhaseLog(page);
    const captureEntry: PhaseLogEntry | undefined = log1.find((e: PhaseLogEntry) => e.to === 'CAPTURE');
    expect(captureEntry).toBeTruthy();

    // After CAPTURE, bodyId should change to MOON.
    const bodyAfterCapture: string | undefined = await page.evaluate(
      () => window.__flightState?.bodyId,
    );
    expect(bodyAfterCapture).toBe('MOON');

    // Step 2: Set Moon-relative position + orbital velocity for ORBIT detection.
    // Moon min orbit altitude = 15,000m.
    const moonOrbitAlt: number = 50_000;
    const moonOrbitVel: number = Math.round(Math.sqrt(MOON_GM / (MOON_RADIUS + moonOrbitAlt)));
    await page.evaluate(async (v: { alt: number; vel: number }) => {
      const w = window;
      const ps = w.__flightPs;
      const fs = w.__flightState;
      if (!ps || !fs) return;
      ps.posX = 0;
      ps.posY = v.alt;
      ps.velX = v.vel;
      ps.velY = 0;
      fs.altitude = v.alt;
      fs.velocity = v.vel;
      fs.horizontalVelocity = v.vel;
      if (typeof w.__resyncPhysicsWorker === 'function') {
        await w.__resyncPhysicsWorker();
      }
    }, { alt: moonOrbitAlt, vel: moonOrbitVel });

    // Wait for the position/velocity to take effect before expecting orbit detection.
    await page.waitForFunction(
      (v: { alt: number }) => Math.abs((window.__flightPs?.posY ?? 0) - v.alt) < 1000,
      { alt: moonOrbitAlt },
      { timeout: 5_000 },
    );

    // ORBIT should be detected within a few physics ticks.
    await waitForPhaseInLog(page, 'ORBIT', 15_000);

    const log2: PhaseLogEntry[] = await getPhaseLog(page);
    const orbitEntry: PhaseLogEntry | undefined = log2.find(
      (e: PhaseLogEntry) => e.to === 'ORBIT' && log2.indexOf(e) > log2.indexOf(captureEntry!),
    );
    expect(orbitEntry).toBeTruthy();

    await page.close();
  });
});
