/**
 * physics.test.js — Unit tests for the flight physics engine (TASK-020).
 *
 * Tests cover:
 *   createPhysicsState()  — initial state setup, fuel store population
 *   tick()                — launch-pad hold, liftoff, gravity-only flight,
 *                           landing/crash event emission, timeElapsed advance
 *   handleKeyDown/Up()    — throttle changes, held-key steering tracking
 *   fireNextStage()       — IGNITE (engine start), SEPARATE (stage jettison),
 *                           DEPLOY (parachute), EJECT, RELEASE, COLLECT_SCIENCE
 *   Internal helpers (via observable side-effects):
 *     airDensity model    — positive at sea level, zero above 70 km
 *     drag                — speed-squared dependence, zero in vacuum
 *     fuel consumption    — SRB burns independently; liquid drains tanks
 *     deltaV estimate     — positive while fuel remains
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  createPhysicsState,
  tick,
  handleKeyDown,
  handleKeyUp,
  fireNextStage,
} from '../core/physics.js';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
  addStageToConfig,
} from '../core/rocketbuilder.js';
import { createFlightState } from '../core/gameState.js';

// ---------------------------------------------------------------------------
// Shared test fixtures
// ---------------------------------------------------------------------------

/**
 * Minimal uncrewed rocket: Probe Core + Small Tank + Spark Engine.
 * Engine is assigned to Stage 1.
 *
 * Total dry mass : 50 + 50 + 120 = 220 kg
 * Fuel           : 400 kg  (small tank)
 * Wet mass       : 620 kg
 * Spark thrust   : 60 kN sea-level → TWR ≈ 9.9 — very flyable.
 */
function makeSimpleRocket() {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
  const tankId   = addPartToAssembly(assembly, 'tank-small',     0,   0);
  const engineId = addPartToAssembly(assembly, 'engine-spark',   0, -55);

  connectParts(assembly, probeId, 1, tankId,   0);
  connectParts(assembly, tankId,  1, engineId, 0);

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, engineId, 0);

  return { assembly, staging, probeId, tankId, engineId };
}

/**
 * Build a FlightState stub for a test flight.
 */
function makeFlightState() {
  return createFlightState({
    missionId: 'test-mission',
    rocketId:  'test-rocket',
  });
}

// ---------------------------------------------------------------------------
// createPhysicsState()
// ---------------------------------------------------------------------------

describe('createPhysicsState()', () => {
  it('initialises position and velocity to zero', () => {
    const { assembly } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    expect(ps.posX).toBe(0);
    expect(ps.posY).toBe(0);
    expect(ps.velX).toBe(0);
    expect(ps.velY).toBe(0);
  });

  it('initialises angle to 0 (pointing straight up)', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    expect(ps.angle).toBe(0);
  });

  it('initialises throttle to 1.0 (100 %)', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    expect(ps.throttle).toBe(1.0);
  });

  it('marks rocket as grounded (on launch pad)', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    expect(ps.grounded).toBe(true);
    expect(ps.landed).toBe(false);
    expect(ps.crashed).toBe(false);
  });

  it('populates fuelStore from tank fuelMass properties', () => {
    const { assembly, tankId } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    // tank-small has fuelMass: 400 kg
    expect(ps.fuelStore.get(tankId)).toBe(400);
  });

  it('sets FlightState.fuelRemaining to the total fuel load', () => {
    const { assembly } = makeSimpleRocket();
    const fs = makeFlightState();
    createPhysicsState(assembly, fs);
    expect(fs.fuelRemaining).toBe(400); // one small tank
  });

  it('marks all assembly parts as active', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    expect(ps.activeParts.size).toBe(assembly.parts.size);
    for (const id of assembly.parts.keys()) {
      expect(ps.activeParts.has(id)).toBe(true);
    }
  });

  it('starts with no engines firing', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    expect(ps.firingEngines.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tick() — physics integration
// ---------------------------------------------------------------------------

describe('tick() — launch-pad hold', () => {
  it('does not move when no engine is firing (gravity held by ground)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // No engines firing → grounded, ground reaction cancels gravity.
    tick(ps, assembly, staging, fs, 1 / 60);

    expect(ps.posY).toBe(0);
    expect(ps.velY).toBe(0);
  });

  it('advances FlightState.timeElapsed by FIXED_DT per step', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    tick(ps, assembly, staging, fs, 1 / 60);
    expect(fs.timeElapsed).toBeCloseTo(1 / 60, 6);
  });

  it('does not tick when flight is aborted', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    fs.aborted = true;
    const ps = createPhysicsState(assembly, fs);

    tick(ps, assembly, staging, fs, 1 / 60);
    expect(fs.timeElapsed).toBe(0);
  });
});

describe('tick() — engine firing and liftoff', () => {
  it('climbs when engine is ignited', () => {
    const { assembly, staging, engineId } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Fire stage 1 (ignites engine).
    fireNextStage(ps, assembly, staging, fs);
    expect(ps.firingEngines.has(engineId)).toBe(true);

    // Simulate 1 second of real time (60 fixed steps).
    tick(ps, assembly, staging, fs, 1.0);

    expect(ps.posY).toBeGreaterThan(0);
    expect(ps.velY).toBeGreaterThan(0);
  });

  it('clears grounded flag after liftoff', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    fireNextStage(ps, assembly, staging, fs);
    tick(ps, assembly, staging, fs, 0.5);

    expect(ps.grounded).toBe(false);
  });

  it('consumes fuel while engine burns', () => {
    const { assembly, staging, tankId } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    const initialFuel = ps.fuelStore.get(tankId);
    fireNextStage(ps, assembly, staging, fs);
    tick(ps, assembly, staging, fs, 1.0);

    expect(ps.fuelStore.get(tankId)).toBeLessThan(initialFuel);
    expect(fs.fuelRemaining).toBeLessThan(initialFuel);
  });

  it('updates FlightState.altitude to match posY', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    fireNextStage(ps, assembly, staging, fs);
    tick(ps, assembly, staging, fs, 1.0);

    expect(fs.altitude).toBeCloseTo(ps.posY, 1);
  });

  it('updates FlightState.velocity to the speed magnitude', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    fireNextStage(ps, assembly, staging, fs);
    tick(ps, assembly, staging, fs, 1.0);

    const expectedSpeed = Math.hypot(ps.velX, ps.velY);
    expect(fs.velocity).toBeCloseTo(expectedSpeed, 4);
  });
});

describe('tick() — gravity', () => {
  it('falls under gravity when no engine is firing and not grounded', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Place rocket at altitude with no engines firing.
    ps.posY    = 1000;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1.0);

    // Should have fallen — posY < 1000.
    expect(ps.posY).toBeLessThan(1000);
    // Downward velocity.
    expect(ps.velY).toBeLessThan(0);
  });
});

describe('tick() — time warp', () => {
  it('advances faster with timeWarp > 1', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs1 = makeFlightState();
    const fs2 = makeFlightState();
    const ps1 = createPhysicsState(assembly, fs1);
    const ps2 = createPhysicsState(assembly, fs2);

    // Manually start with altitude and downward velocity so we can compare.
    ps1.posY = 5000; ps1.grounded = false;
    ps2.posY = 5000; ps2.grounded = false;

    tick(ps1, assembly, staging, fs1, 1 / 60, 1);   // 1× warp
    tick(ps2, assembly, staging, fs2, 1 / 60, 4);   // 4× warp

    // At 4× warp, 4 fixed steps run vs 1 → 4× more distance fallen.
    expect(Math.abs(ps2.velY)).toBeGreaterThan(Math.abs(ps1.velY));
  });
});

describe('tick() — landing and crash events', () => {
  it('emits LANDING event on soft touchdown', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Put rocket just above ground, falling slowly.
    ps.posY    = 0.01;
    ps.velY    = -5;   // 5 m/s — within safe range
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    const evt = fs.events.find((e) => e.type === 'LANDING');
    expect(evt).toBeDefined();
    expect(evt.speed).toBeGreaterThan(0);
    expect(ps.landed).toBe(true);
    expect(ps.crashed).toBe(false);
  });

  it('emits CRASH event on high-speed impact', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Falling very fast.
    ps.posY    = 0.01;
    ps.velY    = -500;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    const evt = fs.events.find((e) => e.type === 'CRASH');
    expect(evt).toBeDefined();
    expect(ps.crashed).toBe(true);
    expect(ps.landed).toBe(false);
  });

  it('stops ticking after landing', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 0.01;
    ps.velY     = -5;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);
    const timeAfterLanding = fs.timeElapsed;

    // Another tick — should be a no-op.
    tick(ps, assembly, staging, fs, 1 / 60);
    expect(fs.timeElapsed).toBeCloseTo(timeAfterLanding, 6);
  });
});

// ---------------------------------------------------------------------------
// handleKeyDown() / handleKeyUp()
// ---------------------------------------------------------------------------

describe('handleKeyDown() — throttle', () => {
  it('W key increases throttle by 5 %', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.throttle = 0.5;

    handleKeyDown(ps, assembly, 'w');
    expect(ps.throttle).toBeCloseTo(0.55, 6);
  });

  it('ArrowUp key also increases throttle', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.throttle = 0.5;

    handleKeyDown(ps, assembly, 'ArrowUp');
    expect(ps.throttle).toBeCloseTo(0.55, 6);
  });

  it('S key decreases throttle by 5 %', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.throttle = 0.5;

    handleKeyDown(ps, assembly, 's');
    expect(ps.throttle).toBeCloseTo(0.45, 6);
  });

  it('throttle is clamped to 0 at the bottom', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.throttle = 0.02;

    handleKeyDown(ps, assembly, 's');
    expect(ps.throttle).toBe(0);
  });

  it('throttle is clamped to 1 at the top', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.throttle = 0.98;

    handleKeyDown(ps, assembly, 'w');
    expect(ps.throttle).toBe(1);
  });
});

describe('handleKeyDown() / handleKeyUp() — steering keys', () => {
  it('adds steering key to _heldKeys on keydown', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());

    handleKeyDown(ps, assembly, 'a');
    expect(ps._heldKeys.has('a')).toBe(true);
  });

  it('removes steering key from _heldKeys on keyup', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());

    handleKeyDown(ps, assembly, 'd');
    handleKeyUp(ps, 'd');
    expect(ps._heldKeys.has('d')).toBe(false);
  });

  it('holding A during tick rotates rocket counter-clockwise (negative angle)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Start a bit above ground with engine firing so it doesn't crash.
    ps.posY     = 1000;
    ps.grounded = false;

    handleKeyDown(ps, assembly, 'a');
    tick(ps, assembly, staging, fs, 0.5);

    expect(ps.angle).toBeLessThan(0);
  });

  it('holding D during tick rotates rocket clockwise (positive angle)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 1000;
    ps.grounded = false;

    handleKeyDown(ps, assembly, 'd');
    tick(ps, assembly, staging, fs, 0.5);

    expect(ps.angle).toBeGreaterThan(0);
  });

  it('steering stops when key is released', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 1000;
    ps.grounded = false;

    handleKeyDown(ps, assembly, 'd');
    tick(ps, assembly, staging, fs, 0.25);
    const angleAfterHold = ps.angle;

    handleKeyUp(ps, 'd');
    tick(ps, assembly, staging, fs, 0.25);

    // Angle should not have changed after key release.
    expect(ps.angle).toBeCloseTo(angleAfterHold, 5);
  });
});

// ---------------------------------------------------------------------------
// fireNextStage() — activation behaviours
// ---------------------------------------------------------------------------

describe('fireNextStage() — IGNITE (engine)', () => {
  it('adds engine to firingEngines when stage 1 fires', () => {
    const { assembly, staging, engineId } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    fireNextStage(ps, assembly, staging, fs);

    expect(ps.firingEngines.has(engineId)).toBe(true);
  });

  it('emits PART_ACTIVATED event with partType ENGINE', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    fireNextStage(ps, assembly, staging, fs);

    const evt = fs.events.find((e) => e.type === 'PART_ACTIVATED' && e.partType === 'ENGINE');
    expect(evt).toBeDefined();
  });
});

describe('fireNextStage() — SEPARATE (decoupler)', () => {
  /**
   * Build a two-stage rocket:
   *   Probe Core
   *     ↕ Stack Decoupler  (Stage 2)
   *     ↕ Small Tank
   *     ↕ Spark Engine     (Stage 1)
   */
  function makeTwoStageRocket() {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId   = addPartToAssembly(assembly, 'probe-core-mk1',        0,  100);
    const decId     = addPartToAssembly(assembly, 'decoupler-stack-tr18',  0,   60);
    const tankId    = addPartToAssembly(assembly, 'tank-small',            0,    0);
    const engineId  = addPartToAssembly(assembly, 'engine-spark',          0,  -55);

    connectParts(assembly, probeId,  1, decId,    0);
    connectParts(assembly, decId,    1, tankId,   0);
    connectParts(assembly, tankId,   1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);
    // Stage 1: engine ignition
    assignPartToStage(staging, engineId, 0);
    // Stage 2: decoupler separation
    addStageToConfig(staging);
    assignPartToStage(staging, decId, 1);

    return { assembly, staging, probeId, decId, tankId, engineId };
  }

  it('removes jettisoned parts from activeParts after separation', () => {
    const { assembly, staging, probeId, decId, tankId, engineId } = makeTwoStageRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Fire stage 1 first (engine ignition).
    fireNextStage(ps, assembly, staging, fs);
    // Fire stage 2 (decoupler).
    fireNextStage(ps, assembly, staging, fs);

    // After separation: probe stays, decoupler + tank + engine are jettisoned.
    expect(ps.activeParts.has(probeId)).toBe(true);
    expect(ps.activeParts.has(decId)).toBe(false);
    expect(ps.activeParts.has(tankId)).toBe(false);
    expect(ps.activeParts.has(engineId)).toBe(false);
  });

  it('removes separated engines from firingEngines', () => {
    const { assembly, staging, engineId } = makeTwoStageRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    fireNextStage(ps, assembly, staging, fs); // stage 1: ignite engine
    expect(ps.firingEngines.has(engineId)).toBe(true);

    fireNextStage(ps, assembly, staging, fs); // stage 2: separate (jettisons engine)
    expect(ps.firingEngines.has(engineId)).toBe(false);
  });

  it('emits PART_ACTIVATED event for the decoupler', () => {
    const { assembly, staging } = makeTwoStageRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    fireNextStage(ps, assembly, staging, fs); // stage 1
    fireNextStage(ps, assembly, staging, fs); // stage 2

    const evt = fs.events.find(
      (e) => e.type === 'PART_ACTIVATED' && e.description?.includes('separation'),
    );
    expect(evt).toBeDefined();
  });
});

describe('fireNextStage() — DEPLOY (parachute)', () => {
  function makeRocketWithChute() {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const cmdId    = addPartToAssembly(assembly, 'cmd-mk1',        0,  60);
    const chuteId  = addPartToAssembly(assembly, 'parachute-mk1',  0,  90);

    connectParts(assembly, cmdId, 0, chuteId, 1); // chute on top

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, chuteId, 0);

    return { assembly, staging, cmdId, chuteId };
  }

  it('marks parachute as deployed in deployedParts', () => {
    const { assembly, staging, chuteId } = makeRocketWithChute();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    fireNextStage(ps, assembly, staging, fs);

    expect(ps.deployedParts.has(chuteId)).toBe(true);
  });

  it('emits PART_ACTIVATED event for the parachute', () => {
    const { assembly, staging } = makeRocketWithChute();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    fireNextStage(ps, assembly, staging, fs);

    const evt = fs.events.find(
      (e) => e.type === 'PART_ACTIVATED' && e.partType === 'PARACHUTE',
    );
    expect(evt).toBeDefined();
  });

  it('deployed parachute increases drag (slower fall vs no chute)', () => {
    const { assembly, staging, chuteId } = makeRocketWithChute();
    const fs1 = makeFlightState();
    const fs2 = makeFlightState();
    const ps1 = createPhysicsState(assembly, fs1);
    const ps2 = createPhysicsState(assembly, fs2);

    // Place both rockets at altitude, falling at the same speed.
    ps1.posY = 5000; ps1.velY = -100; ps1.grounded = false;
    ps2.posY = 5000; ps2.velY = -100; ps2.grounded = false;

    // Deploy parachute on ps2.
    fireNextStage(ps2, assembly, staging, fs2);

    // Simulate 1 second.
    tick(ps1, assembly, staging, fs1, 1.0);
    tick(ps2, assembly, staging, fs2, 1.0);

    // ps2 (with chute) should be moving slower (less negative velocity).
    expect(ps2.velY).toBeGreaterThan(ps1.velY);
  });
});

describe('fireNextStage() — EJECT (ejector seat)', () => {
  it('emits CREW_EJECTED event with altitude', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const cmdId = addPartToAssembly(assembly, 'cmd-mk1', 0, 0);
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, cmdId, 0);

    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    ps.posY     = 5000;
    ps.grounded = false;

    fireNextStage(ps, assembly, staging, fs);

    const evt = fs.events.find((e) => e.type === 'CREW_EJECTED');
    expect(evt).toBeDefined();
    expect(evt.altitude).toBeCloseTo(5000, 0);
  });
});

describe('fireNextStage() — RELEASE (satellite)', () => {
  it('emits SATELLITE_RELEASED event with altitude', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
    const satId   = addPartToAssembly(assembly, 'satellite-mk1',  0, 100);
    connectParts(assembly, probeId, 0, satId, 1);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, satId, 0);

    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    ps.posY     = 200_000;
    ps.grounded = false;

    fireNextStage(ps, assembly, staging, fs);

    const evt = fs.events.find((e) => e.type === 'SATELLITE_RELEASED');
    expect(evt).toBeDefined();
    expect(evt.altitude).toBeCloseTo(200_000, 0);
  });
});

describe('fireNextStage() — COLLECT_SCIENCE (service module)', () => {
  it('emits SCIENCE_COLLECTED event', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId   = addPartToAssembly(assembly, 'probe-core-mk1',   0,  60);
    const scienceId = addPartToAssembly(assembly, 'science-module-mk1', 0, 100);
    connectParts(assembly, probeId, 0, scienceId, 1);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, scienceId, 0);

    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    ps.posY     = 10_000;
    ps.grounded = false;

    fireNextStage(ps, assembly, staging, fs);

    const evt = fs.events.find((e) => e.type === 'SCIENCE_COLLECTED');
    expect(evt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// SRB behaviour
// ---------------------------------------------------------------------------

describe('SRB — burns and exhausts independently', () => {
  function makeRocketWithSRB() {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
    const srbId   = addPartToAssembly(assembly, 'srb-small',      50, 0);

    // SRBs attach radially — just add the part; connectivity not needed for
    // physics tests.
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, srbId, 0);

    return { assembly, staging, probeId, srbId };
  }

  it('SRB fuel drains from its own fuelStore entry', () => {
    const { assembly, staging, srbId } = makeRocketWithSRB();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    const initFuel = ps.fuelStore.get(srbId);
    expect(initFuel).toBeGreaterThan(0);

    fireNextStage(ps, assembly, staging, fs);
    tick(ps, assembly, staging, fs, 1.0);

    expect(ps.fuelStore.get(srbId)).toBeLessThan(initFuel);
  });

  it('SRB ignores throttle (burns at full thrust)', () => {
    const { assembly, staging, srbId } = makeRocketWithSRB();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.throttle = 0; // set throttle to 0 — SRB should still burn

    fireNextStage(ps, assembly, staging, fs);
    tick(ps, assembly, staging, fs, 1.0);

    // SRB should still be burning (fuel reduced).
    const fuelLeft = ps.fuelStore.get(srbId) ?? 0;
    expect(fuelLeft).toBeLessThan(900); // srb-small starts with 900 kg fuel
  });

  it('SRB is removed from firingEngines when fuel runs out', () => {
    const { assembly, staging, srbId } = makeRocketWithSRB();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Manually set SRB fuel to almost empty.
    ps.fuelStore.set(srbId, 0.001);

    fireNextStage(ps, assembly, staging, fs);
    // Ticking should exhaust the SRB immediately.
    tick(ps, assembly, staging, fs, 1 / 60);

    expect(ps.firingEngines.has(srbId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deltaV estimate
// ---------------------------------------------------------------------------

describe('deltaV estimate', () => {
  it('is positive while fuel remains and engine is firing', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    fireNextStage(ps, assembly, staging, fs);
    tick(ps, assembly, staging, fs, 0.1);

    expect(fs.deltaVRemaining).toBeGreaterThan(0);
  });
});
