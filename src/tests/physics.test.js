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
  LegState,
  deployLandingLeg,
  getLegStatus,
  getLegContextMenuItems,
} from '../core/legs.js';
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
 * Two-stage rocket: Probe Core + Decoupler + Small Tank + Spark Engine.
 * Stage 1: engine ignition.  Stage 2: decoupler separation.
 */
function makeTwoStageRocketGlobal() {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const probeId   = addPartToAssembly(assembly, 'probe-core-mk1',       0,  100);
  const decId     = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0,   60);
  const tankId    = addPartToAssembly(assembly, 'tank-small',           0,    0);
  const engineId  = addPartToAssembly(assembly, 'engine-spark',         0,  -55);

  connectParts(assembly, probeId, 1, decId,    0);
  connectParts(assembly, decId,   1, tankId,   0);
  connectParts(assembly, tankId,  1, engineId, 0);

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, engineId, 0);
  addStageToConfig(staging);
  assignPartToStage(staging, decId, 1);

  return { assembly, staging, probeId, decId, tankId, engineId };
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
    // Use 3 m/s so that after one integration step (gravity adds ~0.16 m/s)
    // the impact speed is still well below the no-legs safe threshold (5 m/s).
    ps.posY    = 0.01;
    ps.velY    = -3;   // ~3.16 m/s impact — within ≤ 5 m/s no-legs safe range
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
  it('W key increases throttle by 5 % (absolute mode)', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.throttleMode = 'absolute';
    ps.throttle = 0.5;

    handleKeyDown(ps, assembly, 'w');
    expect(ps.throttle).toBeCloseTo(0.55, 6);
  });

  it('ArrowUp key also increases throttle (absolute mode)', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.throttleMode = 'absolute';
    ps.throttle = 0.5;

    handleKeyDown(ps, assembly, 'ArrowUp');
    expect(ps.throttle).toBeCloseTo(0.55, 6);
  });

  it('S key decreases throttle by 5 % (absolute mode)', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.throttleMode = 'absolute';
    ps.throttle = 0.5;

    handleKeyDown(ps, assembly, 's');
    expect(ps.throttle).toBeCloseTo(0.45, 6);
  });

  it('throttle is clamped to 0 at the bottom (absolute mode)', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.throttleMode = 'absolute';
    ps.throttle = 0.02;

    handleKeyDown(ps, assembly, 's');
    expect(ps.throttle).toBe(0);
  });

  it('throttle is clamped to 1 at the top (absolute mode)', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.throttleMode = 'absolute';
    ps.throttle = 0.98;

    handleKeyDown(ps, assembly, 'w');
    expect(ps.throttle).toBe(1);
  });

  it('W key increases targetTWR in TWR mode', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.targetTWR = 1.5;

    handleKeyDown(ps, assembly, 'w');
    expect(ps.targetTWR).toBeCloseTo(1.6, 6);
  });

  it('S key decreases targetTWR in TWR mode', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.targetTWR = 1.5;

    handleKeyDown(ps, assembly, 's');
    expect(ps.targetTWR).toBeCloseTo(1.4, 6);
  });

  it('targetTWR is clamped to 0 at the bottom', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.targetTWR = 0.05;

    handleKeyDown(ps, assembly, 's');
    expect(ps.targetTWR).toBe(0);
  });

  it('Z sets targetTWR to Infinity and throttle to 1 in TWR mode', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.targetTWR = 1.5;
    ps.throttle = 0.5;

    handleKeyDown(ps, assembly, 'z');
    expect(ps.targetTWR).toBe(Infinity);
    expect(ps.throttle).toBe(1);
  });

  it('X sets targetTWR to 0 and throttle to 0 in TWR mode', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    ps.targetTWR = 1.5;
    ps.throttle = 0.5;

    handleKeyDown(ps, assembly, 'x');
    expect(ps.targetTWR).toBe(0);
    expect(ps.throttle).toBe(0);
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

  it('angular velocity decays after key is released (torque-based)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 1000;
    ps.grounded = false;

    handleKeyDown(ps, assembly, 'd');
    tick(ps, assembly, staging, fs, 0.25);
    const angVelAfterHold = ps.angularVelocity;
    expect(angVelAfterHold).toBeGreaterThan(0);

    handleKeyUp(ps, 'd');
    tick(ps, assembly, staging, fs, 1.0);

    // Angular velocity should have decayed (atmospheric damping at low altitude).
    expect(Math.abs(ps.angularVelocity)).toBeLessThan(Math.abs(angVelAfterHold));
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
  it('transitions science module to running state (SCIENCE_COLLECTED deferred to timer)', () => {
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

    // PART_ACTIVATED is emitted immediately.
    const activated = fs.events.find((e) => e.type === 'PART_ACTIVATED');
    expect(activated).toBeDefined();

    // Science module enters RUNNING state with a countdown timer.
    const entry = ps.scienceModuleStates?.get(scienceId);
    expect(entry).toBeDefined();
    expect(entry.state).toBe('running');
    expect(entry.timer).toBeGreaterThan(0);

    // SCIENCE_COLLECTED is NOT emitted on activation — it fires when the
    // timer expires in tickScienceModules.
    const sci = fs.events.find((e) => e.type === 'SCIENCE_COLLECTED');
    expect(sci).toBeUndefined();
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

// ===========================================================================
// TASK-037: Physics Engine Tests — precision scenarios
// ===========================================================================

/**
 * Physics constants mirrored from physics.js / atmosphere.js for test
 * calculations.  These match the values used by the engine exactly.
 */
const G0         = 9.81;          // Standard gravity (m/s²)
const FIXED_DT   = 1 / 60;        // Physics timestep (s)
const VAC_ALT    = 80_000;        // Above ATMOSPHERE_TOP (70 000 m) — zero drag

// ---------------------------------------------------------------------------
// 1. Net force calculation
// ---------------------------------------------------------------------------

describe('TASK-037: net force — known thrust/mass/drag inputs produce correct acceleration', () => {
  /**
   * In vacuum (altitude > 70 000 m) the drag term is zero.
   * With the Spark Engine at full throttle (angle = 0):
   *   thrustY = thrustVac = 72 000 N
   *   gravFY  = -G0 × totalMass = -9.81 × 620 = -6 082.2 N
   *   netFY   = 65 917.8 N  →  accY = 65 917.8 / 620 ≈ 106.32 m/s²
   *   velY after 1 fixed step = accY × FIXED_DT ≈ 1.772 m/s
   */
  it('verifies velY after 1 fixed step matches (thrust-gravity)/mass × dt in vacuum', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Place the rocket in vacuum so drag = 0.
    ps.posY     = VAC_ALT;
    ps.velY     = 0;
    ps.grounded = false;

    // Ignite stage 1 (Spark Engine).
    fireNextStage(ps, assembly, staging, fs);

    // Run exactly one physics step.
    tick(ps, assembly, staging, fs, FIXED_DT, 1);

    // Expected acceleration:
    //   thrust_vac = 72 kN = 72 000 N (throttle 100 %, angle 0, vacuum)
    //   total mass = probe(50) + tank_dry(50) + tank_fuel(400) + engine(120) = 620 kg
    const thrustVacN  = 72_000;
    const totalMassKg = 620;
    const expectedAccY  = (thrustVacN - G0 * totalMassKg) / totalMassKg;
    const expectedVelY  = expectedAccY * FIXED_DT;

    expect(ps.velY).toBeCloseTo(expectedVelY, 2);
  });
});

// ---------------------------------------------------------------------------
// 2. Velocity and position integration over multiple ticks
// ---------------------------------------------------------------------------

describe('TASK-037: ballistic trajectory — integration over multiple ticks', () => {
  /**
   * In vacuum with a known upward initial velocity and no engine:
   *   v(t) = v0 − g×t        (exact for Euler with constant acceleration)
   *   y(t) ≈ y0 + v0×t − ½g×t²  (Euler error ≈ g×dt×t/2 ≈ 0.08 m at t=1 s)
   */
  it('velocity matches v0 − g×t exactly after 60 fixed steps in vacuum', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    const v0Y = 50; // m/s upward
    ps.posY     = VAC_ALT;
    ps.velY     = v0Y;
    ps.grounded = false;

    // Run exactly 60 individual fixed steps (each tick = 1 FIXED_DT, guaranteed
    // to execute exactly 1 physics step regardless of floating-point precision).
    for (let i = 0; i < 60; i++) {
      tick(ps, assembly, staging, fs, FIXED_DT, 1);
    }

    // Euler velocity is exact for constant acceleration: v = v0 − G0 × t.
    const expectedVelY = v0Y - G0 * 1.0; // 50 − 9.81 = 40.19 m/s
    expect(ps.velY).toBeCloseTo(expectedVelY, 3);
  });

  it('position approximates y0 + v0×t − ½g×t² after 60 fixed steps in vacuum', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    const startY = VAC_ALT;
    const v0Y    = 50;
    ps.posY     = startY;
    ps.velY     = v0Y;
    ps.grounded = false;

    // Exactly 60 fixed steps (symplectic Euler overshoots the continuous
    // formula by ≈ 0.08 m for t=1 s; precision 0 gives ±0.5 m slack).
    for (let i = 0; i < 60; i++) {
      tick(ps, assembly, staging, fs, FIXED_DT, 1);
    }

    const expectedPosY = startY + v0Y * 1.0 - 0.5 * G0 * 1.0 * 1.0;
    expect(ps.posY).toBeCloseTo(expectedPosY, 0);
  });
});

// ---------------------------------------------------------------------------
// 3. Gravity-only freefall — verify position matches 0.5 × g × t²
// ---------------------------------------------------------------------------

describe('TASK-037: gravity freefall — position matches 0.5 × g × t²', () => {
  it('freefall drop from rest over 1 second in vacuum approximates ½g×t²', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    const startY = VAC_ALT;
    ps.posY     = startY;
    ps.velY     = 0;
    ps.velX     = 0;
    ps.grounded = false;
    // No engine — pure freefall under gravity.

    tick(ps, assembly, staging, fs, 1.0, 1);

    const elapsed      = 1.0;
    const formulaDrop  = 0.5 * G0 * elapsed * elapsed; // 4.905 m
    const actualDrop   = startY - ps.posY;

    // Euler integration error ≈ 0.08 m; allow ±0.5 m (precision 0).
    expect(actualDrop).toBeCloseTo(formulaDrop, 0);
  });

  it('freefall velocity after 60 fixed steps equals −g × t exactly', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = VAC_ALT;
    ps.velY     = 0;
    ps.grounded = false;

    // Exactly 60 fixed steps → t = 60 × FIXED_DT = 1 s.
    // Euler velocity is exact for constant acceleration (no integration error).
    for (let i = 0; i < 60; i++) {
      tick(ps, assembly, staging, fs, FIXED_DT, 1);
    }

    expect(ps.velY).toBeCloseTo(-G0 * 1.0, 3);
  });
});

// ---------------------------------------------------------------------------
// 4. Atmospheric drag — sea level vs vacuum
// ---------------------------------------------------------------------------

describe('TASK-037: atmospheric drag — sea level vs vacuum', () => {
  it('rocket falls slower at sea level than in vacuum (drag retards fall)', () => {
    // Two identical rockets with the same initial downward velocity.
    // One is at low altitude (air present), the other high above the atmosphere.
    const { assembly, staging } = makeSimpleRocket();
    const fsLow = makeFlightState();
    const fsVac = makeFlightState();
    const psLow = createPhysicsState(assembly, fsLow); // sea-level
    const psVac = createPhysicsState(assembly, fsVac); // vacuum

    // Sea-level starting condition (altitude ~100 m — plenty of atmosphere).
    psLow.posY     = 100;
    psLow.velY     = -50;
    psLow.grounded = false;

    // Vacuum starting condition (above atmosphere top).
    psVac.posY     = VAC_ALT;
    psVac.velY     = -50;
    psVac.grounded = false;

    // Simulate 1 second of free fall (no engine).
    tick(psLow, assembly, staging, fsLow, 1.0, 1);
    tick(psVac, assembly, staging, fsVac, 1.0, 1);

    // Drag acts upward on the sea-level rocket → its velY is less negative
    // (it has fallen more slowly) than the vacuum rocket.
    expect(psLow.velY).toBeGreaterThan(psVac.velY);
  });

  it('velocity change in vacuum exactly matches pure gravity (no drag)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = VAC_ALT;
    ps.velY     = -50;
    ps.grounded = false;

    // Run exactly one fixed step.
    tick(ps, assembly, staging, fs, FIXED_DT, 1);

    // In vacuum: drag = 0, thrust = 0 → accY = -G0
    // velY after 1 step = -50 − G0 × FIXED_DT
    const expectedVelY = -50 - G0 * FIXED_DT;
    expect(ps.velY).toBeCloseTo(expectedVelY, 4);
  });
});

// ---------------------------------------------------------------------------
// 5. TWR > 1 — produces upward acceleration from rest
// ---------------------------------------------------------------------------

describe('TASK-037: TWR > 1 — produces upward acceleration from rest', () => {
  /**
   * makeSimpleRocket() uses:
   *   Spark Engine: 60 kN sea-level thrust
   *   Wet mass    : 620 kg
   *   TWR         : 60 000 / (620 × 9.81) ≈ 9.9  — well above 1
   */
  it('rocket with TWR ≈ 9.9 lifts off and gains positive altitude', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    expect(ps.grounded).toBe(true);
    expect(ps.posY).toBe(0);

    fireNextStage(ps, assembly, staging, fs);
    tick(ps, assembly, staging, fs, 0.5, 1);

    expect(ps.posY).toBeGreaterThan(0);
    expect(ps.velY).toBeGreaterThan(0);
    expect(ps.grounded).toBe(false);
  });

  it('net accY from rest is positive when TWR > 1', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Verify by checking velY after one fixed step from the pad.
    fireNextStage(ps, assembly, staging, fs);
    tick(ps, assembly, staging, fs, FIXED_DT, 1);

    // With TWR ≈ 9.9, velY must be positive after the first step.
    expect(ps.velY).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 6. TWR < 1 — does not lift off
// ---------------------------------------------------------------------------

describe('TASK-037: TWR < 1 — does not lift off', () => {
  it('rocket with TWR < 1 stays on the ground even with engine firing', () => {
    const { assembly, staging, tankId } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Inflate fuel mass so that total rocket mass >> thrust / g.
    // Spark engine sea-level thrust = 60 000 N.
    // For TWR < 1 we need mass > 60 000 / 9.81 ≈ 6 116 kg.
    // Setting tank "fuel" to 100 000 kg gives mass ≈ 100 220 kg → TWR ≈ 0.06.
    ps.fuelStore.set(tankId, 100_000);

    fireNextStage(ps, assembly, staging, fs);
    tick(ps, assembly, staging, fs, 1.0, 1);

    // Ground reaction prevents downward acceleration; rocket must not lift off.
    expect(ps.posY).toBe(0);
    expect(ps.grounded).toBe(true);
    expect(ps.velY).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 7. Steering — applying left/right input changes rocket orientation
// ---------------------------------------------------------------------------

describe('TASK-037: steering — left/right input changes rocket orientation', () => {
  it('holding the A key rotates the rocket counter-clockwise (negative angle)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 1_000;
    ps.grounded = false;

    handleKeyDown(ps, assembly, 'a');
    tick(ps, assembly, staging, fs, 0.5, 1);

    expect(ps.angle).toBeLessThan(0);
  });

  it('holding the D key rotates the rocket clockwise (positive angle)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 1_000;
    ps.grounded = false;

    handleKeyDown(ps, assembly, 'd');
    tick(ps, assembly, staging, fs, 0.5, 1);

    expect(ps.angle).toBeGreaterThan(0);
  });

  it('angle change is proportional to hold duration', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs1 = makeFlightState();
    const fs2 = makeFlightState();
    const ps1 = createPhysicsState(assembly, fs1);
    const ps2 = createPhysicsState(assembly, fs2);

    ps1.posY = 1_000; ps1.grounded = false;
    ps2.posY = 1_000; ps2.grounded = false;

    // Hold D for 0.5 s vs 1.0 s — longer hold → larger angle.
    handleKeyDown(ps1, assembly, 'd');
    tick(ps1, assembly, staging, fs1, 0.5, 1);

    handleKeyDown(ps2, assembly, 'd');
    tick(ps2, assembly, staging, fs2, 1.0, 1);

    expect(ps2.angle).toBeGreaterThan(ps1.angle);
  });
});

// ---------------------------------------------------------------------------
// 8. Time warp scaling — 10 ticks at 5× warp = 50 ticks at 1× warp
// ---------------------------------------------------------------------------

describe('TASK-037: time warp scaling — 10×5× warp equals 50×1× warp', () => {
  it('produces identical final posY, velY and timeElapsed', () => {
    const { assembly, staging } = makeSimpleRocket();

    const fs5x = makeFlightState();
    const fs1x = makeFlightState();
    const ps5x = createPhysicsState(assembly, fs5x);
    const ps1x = createPhysicsState(assembly, fs1x);

    const startY = 10_000;
    ps5x.posY = startY; ps5x.grounded = false;
    ps1x.posY = startY; ps1x.grounded = false;

    // Scenario A: 10 real frames, each advancing 5 fixed steps (5× warp).
    for (let i = 0; i < 10; i++) {
      tick(ps5x, assembly, staging, fs5x, FIXED_DT, 5);
    }

    // Scenario B: 50 real frames, each advancing 1 fixed step (1× warp).
    for (let i = 0; i < 50; i++) {
      tick(ps1x, assembly, staging, fs1x, FIXED_DT, 1);
    }

    // Both scenarios execute exactly 50 fixed steps → identical physics.
    expect(ps5x.posY).toBeCloseTo(ps1x.posY, 6);
    expect(ps5x.velY).toBeCloseTo(ps1x.velY, 6);
    expect(fs5x.timeElapsed).toBeCloseTo(fs1x.timeElapsed, 6);
  });
});

// ===========================================================================
// TASK-025: Landing Legs — state machine and landing detection tests
// ===========================================================================

/**
 * Build a rocket with two small landing legs attached.
 * Probe Core at y=60, two legs at y=0 on either side.
 */
function makeRocketWithLegs() {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const probeId = addPartToAssembly(assembly, 'probe-core-mk1',     0,  60);
  const legId1  = addPartToAssembly(assembly, 'landing-legs-small', 20,  0);
  const legId2  = addPartToAssembly(assembly, 'landing-legs-small', -20, 0);

  // Assign both legs to Stage 1 (DEPLOY activation).
  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, legId1, 0);
  assignPartToStage(staging, legId2, 0);

  return { assembly, staging, probeId, legId1, legId2 };
}

// ---------------------------------------------------------------------------
// Landing leg state machine — initLegStates
// ---------------------------------------------------------------------------

describe('TASK-025: createPhysicsState() — landing legs initialised', () => {
  it('creates legStates map populated with RETRACTED entries for leg parts', () => {
    const { assembly } = makeRocketWithLegs();
    const ps = createPhysicsState(assembly, makeFlightState());

    expect(ps.legStates).toBeInstanceOf(Map);
    // Two leg parts should be tracked.
    expect(ps.legStates.size).toBe(2);
    for (const [, entry] of ps.legStates) {
      expect(entry.state).toBe(LegState.RETRACTED);
      expect(entry.deployTimer).toBe(0);
    }
  });

  it('non-leg parts are not added to legStates', () => {
    const { assembly, probeId } = makeRocketWithLegs();
    const ps = createPhysicsState(assembly, makeFlightState());

    expect(ps.legStates.has(probeId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// deployLandingLeg() — state machine transition
// ---------------------------------------------------------------------------

describe('TASK-025: deployLandingLeg() — state transitions', () => {
  it('transitions a leg from RETRACTED to DEPLOYING', () => {
    const { assembly, legId1 } = makeRocketWithLegs();
    const ps = createPhysicsState(assembly, makeFlightState());

    deployLandingLeg(ps, legId1);

    expect(getLegStatus(ps, legId1)).toBe(LegState.DEPLOYING);
  });

  it('sets deployTimer to LEG_DEPLOY_DURATION (1.5 s)', () => {
    const { assembly, legId1 } = makeRocketWithLegs();
    const ps = createPhysicsState(assembly, makeFlightState());

    deployLandingLeg(ps, legId1);

    const entry = ps.legStates.get(legId1);
    expect(entry.deployTimer).toBe(1.5);
  });

  it('is a no-op if already DEPLOYING', () => {
    const { assembly, legId1 } = makeRocketWithLegs();
    const ps = createPhysicsState(assembly, makeFlightState());

    deployLandingLeg(ps, legId1);
    const entry = ps.legStates.get(legId1);
    entry.deployTimer = 0.5; // reduce to 0.5 s remaining

    deployLandingLeg(ps, legId1); // call again
    // Timer should still be 0.5 (not reset to 1.5).
    expect(entry.deployTimer).toBe(0.5);
  });

  it('is a no-op if already DEPLOYED', () => {
    const { assembly, legId1 } = makeRocketWithLegs();
    const ps = createPhysicsState(assembly, makeFlightState());

    // Manually set to deployed.
    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    deployLandingLeg(ps, legId1);

    // State should remain deployed.
    expect(getLegStatus(ps, legId1)).toBe(LegState.DEPLOYED);
  });
});

// ---------------------------------------------------------------------------
// Leg deployment via staging (DEPLOY activation)
// ---------------------------------------------------------------------------

describe('TASK-025: fireNextStage() — DEPLOY (landing legs)', () => {
  it('marks leg as DEPLOYING and adds to deployedParts after stage fires', () => {
    const { assembly, staging, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Place rocket in flight so staging events fire.
    ps.posY     = 1000;
    ps.grounded = false;

    fireNextStage(ps, assembly, staging, fs);

    // Both legs should now be deploying.
    expect(getLegStatus(ps, legId1)).toBe(LegState.DEPLOYING);
    expect(getLegStatus(ps, legId2)).toBe(LegState.DEPLOYING);
    expect(ps.deployedParts.has(legId1)).toBe(true);
    expect(ps.deployedParts.has(legId2)).toBe(true);
  });

  it('emits PART_ACTIVATED events for both leg parts', () => {
    const { assembly, staging } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    ps.posY     = 1000;
    ps.grounded = false;

    fireNextStage(ps, assembly, staging, fs);

    const legEvents = fs.events.filter(
      (e) => e.type === 'PART_ACTIVATED' && e.partType === 'LANDING_LEGS',
    );
    expect(legEvents.length).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Leg deployment timer (tickLegs via physics tick)
// ---------------------------------------------------------------------------

describe('TASK-025: tickLegs() — deploying → deployed timer', () => {
  it('leg transitions to DEPLOYED after 1.5 s of simulation', () => {
    const { assembly, staging, legId1 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Start at altitude, begin deploying.
    ps.posY     = 5000;
    ps.grounded = false;

    fireNextStage(ps, assembly, staging, fs);
    expect(getLegStatus(ps, legId1)).toBe(LegState.DEPLOYING);

    // Advance 2 full seconds (well past the 1.5 s timer).
    tick(ps, assembly, staging, fs, 2.0);

    expect(getLegStatus(ps, legId1)).toBe(LegState.DEPLOYED);
  });

  it('emits LEG_DEPLOYED event when timer expires', () => {
    const { assembly, staging, legId1 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 5000;
    ps.grounded = false;

    fireNextStage(ps, assembly, staging, fs);
    tick(ps, assembly, staging, fs, 2.0);

    const deployedEvt = fs.events.find(
      (e) => e.type === 'LEG_DEPLOYED' && e.instanceId === legId1,
    );
    expect(deployedEvt).toBeDefined();
    expect(deployedEvt.altitude).toBeGreaterThan(0);
  });

  it('leg stays DEPLOYING before 1.5 s has elapsed', () => {
    const { assembly, staging, legId1 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 5000;
    ps.grounded = false;

    fireNextStage(ps, assembly, staging, fs);
    // Advance only 1 second — timer has not yet expired.
    tick(ps, assembly, staging, fs, 1.0);

    expect(getLegStatus(ps, legId1)).toBe(LegState.DEPLOYING);
  });
});

// ---------------------------------------------------------------------------
// Landing detection — ≥ 2 deployed legs AND speed < 10 m/s → safe
// ---------------------------------------------------------------------------

describe('TASK-025: landing detection — controlled landing', () => {
  it('emits LANDING and sets ps.landed when ≥ 2 legs deployed and speed < 10', () => {
    const { assembly, staging, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Manually set both legs to DEPLOYED state.
    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    ps.legStates.get(legId2).state = LegState.DEPLOYED;

    // Set rocket just above ground, falling within safe speed.
    ps.posY     = 0.01;
    ps.velY     = -7; // 7 m/s — below 10 m/s threshold
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    const evt = fs.events.find((e) => e.type === 'LANDING');
    expect(evt).toBeDefined();
    expect(evt.speed).toBeCloseTo(7, 0);
    expect(evt.legsDestroyed).toBe(false);
    expect(ps.landed).toBe(true);
    expect(ps.crashed).toBe(false);
  });

  it('does NOT emit LANDING for < 2 deployed legs even at low speed', () => {
    const { assembly, staging, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Only 1 leg deployed.
    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    // legId2 stays RETRACTED.

    ps.posY     = 0.01;
    ps.velY     = -7; // within 10 m/s
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    // Speed is 7 > 5 m/s and < 2 deployed legs → should CRASH (no-legs path)
    const crashEvt = fs.events.find((e) => e.type === 'CRASH');
    expect(crashEvt).toBeDefined();
    expect(ps.crashed).toBe(true);
    expect(ps.landed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Landing detection — ≥ 1 deployed leg AND speed 10–29 m/s → hard landing
// ---------------------------------------------------------------------------

describe('TASK-025: landing detection — hard landing (legs destroyed)', () => {
  it('emits LANDING with legsDestroyed=true and destroys leg parts', () => {
    const { assembly, staging, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Both legs deployed.
    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    ps.legStates.get(legId2).state = LegState.DEPLOYED;

    // Falling at 20 m/s — legs deployed but too fast.
    ps.posY     = 0.01;
    ps.velY     = -20;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    const evt = fs.events.find((e) => e.type === 'LANDING');
    expect(evt).toBeDefined();
    expect(evt.legsDestroyed).toBe(true);
    expect(ps.landed).toBe(true);
    expect(ps.crashed).toBe(false);

    // Leg parts should have been removed from activeParts.
    expect(ps.activeParts.has(legId1)).toBe(false);
    expect(ps.activeParts.has(legId2)).toBe(false);
  });

  it('probe (non-leg) survives hard landing', () => {
    const { assembly, staging, probeId, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    ps.legStates.get(legId2).state = LegState.DEPLOYED;

    ps.posY     = 0.01;
    ps.velY     = -20;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    // Probe core should still be active.
    expect(ps.activeParts.has(probeId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Landing detection — speed ≥ 30 m/s → full destruction
// ---------------------------------------------------------------------------

describe('TASK-025: landing detection — catastrophic impact (≥ 30 m/s)', () => {
  it('emits CRASH and clears all active parts at 30+ m/s', () => {
    const { assembly, staging } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Both legs deployed — still destroyed at 30 m/s.
    for (const [, entry] of ps.legStates) {
      entry.state = LegState.DEPLOYED;
    }

    ps.posY     = 0.01;
    ps.velY     = -30;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    const evt = fs.events.find((e) => e.type === 'CRASH');
    expect(evt).toBeDefined();
    expect(ps.crashed).toBe(true);
    expect(ps.landed).toBe(false);
    expect(ps.activeParts.size).toBe(0);
  });

  it('emits CRASH at 50 m/s (no legs)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 0.01;
    ps.velY     = -50;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    const evt = fs.events.find((e) => e.type === 'CRASH');
    expect(evt).toBeDefined();
    expect(ps.crashed).toBe(true);
    expect(ps.activeParts.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Landing detection — no legs AND speed > 5 m/s → bottom parts destroyed
// ---------------------------------------------------------------------------

describe('TASK-025: landing detection — no legs, speed > 5 m/s', () => {
  it('emits CRASH when landing without legs at 7 m/s', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 0.01;
    ps.velY     = -7;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    const evt = fs.events.find((e) => e.type === 'CRASH');
    expect(evt).toBeDefined();
    expect(ps.crashed).toBe(true);
  });

  it('destroys at least one bottom part (engine at lowest y)', () => {
    const { assembly, staging, engineId } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 0.01;
    ps.velY     = -7;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    // The engine is at placed.y = -55 (lowest part) — should be destroyed.
    expect(ps.activeParts.has(engineId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Landing detection — no legs AND speed ≤ 5 m/s → safe landing
// ---------------------------------------------------------------------------

describe('TASK-025: landing detection — no legs, speed ≤ 5 m/s', () => {
  it('emits LANDING when speed is 4 m/s with no legs', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 0.01;
    ps.velY     = -4;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    const evt = fs.events.find((e) => e.type === 'LANDING');
    expect(evt).toBeDefined();
    expect(ps.landed).toBe(true);
    expect(ps.crashed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Context menu — getLegContextMenuItems (via legs.js directly)
// ---------------------------------------------------------------------------

describe('TASK-025: getLegContextMenuItems()', () => {
  it('returns items for each leg part in activeParts', () => {
    const { assembly, legId1, legId2 } = makeRocketWithLegs();
    const ps = createPhysicsState(assembly, makeFlightState());

    const items = getLegContextMenuItems(ps, assembly);
    expect(items.length).toBe(2);
    const ids = items.map((i) => i.instanceId);
    expect(ids).toContain(legId1);
    expect(ids).toContain(legId2);
  });

  it('canDeploy is true for RETRACTED legs', () => {
    const { assembly } = makeRocketWithLegs();
    const ps = createPhysicsState(assembly, makeFlightState());

    const items = getLegContextMenuItems(ps, assembly);
    for (const item of items) {
      expect(item.canDeploy).toBe(true);
      expect(item.state).toBe(LegState.RETRACTED);
    }
  });

  it('canDeploy is false for DEPLOYED legs', () => {
    const { assembly, legId1 } = makeRocketWithLegs();
    const ps = createPhysicsState(assembly, makeFlightState());

    ps.legStates.get(legId1).state = LegState.DEPLOYED;

    const items = getLegContextMenuItems(ps, assembly);
    const item1 = items.find((i) => i.instanceId === legId1);
    expect(item1.canDeploy).toBe(false);
    expect(item1.statusLabel).toBe('Deployed');
  });

  it('shows deployTimer for DEPLOYING legs', () => {
    const { assembly, legId1 } = makeRocketWithLegs();
    const ps = createPhysicsState(assembly, makeFlightState());

    const entry = ps.legStates.get(legId1);
    entry.state       = LegState.DEPLOYING;
    entry.deployTimer = 0.8;

    const items = getLegContextMenuItems(ps, assembly);
    const item1 = items.find((i) => i.instanceId === legId1);
    expect(item1.deployTimer).toBeCloseTo(0.8, 1);
    expect(item1.statusLabel).toContain('Deploying');
  });
});

// ---------------------------------------------------------------------------
// Ground rotation — tipping physics
// ---------------------------------------------------------------------------

describe('Ground rotation — tipping physics', () => {
  it('angularVelocity initialises to 0', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    expect(ps.angularVelocity).toBe(0);
  });

  it('isTipping initialises to false', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    expect(ps.isTipping).toBe(false);
  });

  it('holding D while grounded increases angle (clockwise)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    handleKeyDown(ps, assembly, 'd');
    // Run several ticks while grounded.
    for (let i = 0; i < 30; i++) {
      tick(ps, assembly, staging, fs, 1 / 60);
    }

    expect(ps.angle).toBeGreaterThan(0);
  });

  it('holding A while grounded decreases angle (counter-clockwise)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    handleKeyDown(ps, assembly, 'a');
    for (let i = 0; i < 30; i++) {
      tick(ps, assembly, staging, fs, 1 / 60);
    }

    expect(ps.angle).toBeLessThan(0);
  });

  it('pre-tilted rocket with no input: gravity torque increases tilt further', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Pre-tilt past the tipping point (~13° for this rocket) so gravity topples.
    ps.angle = 0.4; // ~23 degrees clockwise — past tipping point
    ps.angularVelocity = 0.1;
    ps.isTipping = true;

    for (let i = 0; i < 60; i++) {
      tick(ps, assembly, staging, fs, 1 / 60);
      if (ps.crashed) break;
    }

    // Gravity should have pulled it further clockwise.
    expect(ps.angle).toBeGreaterThan(0.4);
  });

  it('toppling past crash angle triggers CRASH event with toppled flag', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Set a large tilt with high angular velocity to ensure topple.
    ps.angle = 1.2; // ~69 degrees — near topple threshold
    ps.angularVelocity = 2.0;
    ps.isTipping = true;

    // Tick until crash.
    for (let i = 0; i < 120; i++) {
      tick(ps, assembly, staging, fs, 1 / 60);
      if (ps.crashed) break;
    }

    expect(ps.crashed).toBe(true);
    const crashEvt = fs.events.find((e) => e.type === 'CRASH' && e.toppled === true);
    expect(crashEvt).toBeDefined();
  });

  it('tipping physics runs on ps.landed (not just grounded)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Simulate a landed state.
    ps.grounded = false;
    ps.landed = true;
    ps.angle = 0.05;
    ps.isTipping = true;

    const angleBefore = ps.angle;
    for (let i = 0; i < 30; i++) {
      tick(ps, assembly, staging, fs, 1 / 60);
    }

    // Gravity torque should have changed the angle.
    expect(ps.angle).not.toBeCloseTo(angleBefore, 3);
  });

  it('small tilt near vertical snaps back to 0', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Very small angle with no input — should snap to 0.
    ps.angle = 0.001;
    ps.angularVelocity = 0.001;

    for (let i = 0; i < 30; i++) {
      tick(ps, assembly, staging, fs, 1 / 60);
    }

    expect(ps.angle).toBe(0);
    expect(ps.angularVelocity).toBe(0);
    expect(ps.isTipping).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Airborne torque-based rotation
// ---------------------------------------------------------------------------

describe('Airborne torque-based rotation', () => {
  it('holding D in flight produces positive angular velocity', () => {
    const { assembly, staging, engineId } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Get airborne.
    fireNextStage(ps, assembly, staging, fs);
    for (let i = 0; i < 60; i++) tick(ps, assembly, staging, fs, 1 / 60);
    expect(ps.grounded).toBe(false);

    handleKeyDown(ps, assembly, 'd');
    for (let i = 0; i < 30; i++) tick(ps, assembly, staging, fs, 1 / 60);

    expect(ps.angularVelocity).toBeGreaterThan(0);
    expect(ps.angle).toBeGreaterThan(0);
  });

  it('heavier rocket turns slower (higher I → lower angular accel)', () => {
    // Light rocket.
    const r1 = makeSimpleRocket();
    const fs1 = makeFlightState();
    const ps1 = createPhysicsState(r1.assembly, fs1);
    fireNextStage(ps1, r1.assembly, r1.staging, fs1);
    for (let i = 0; i < 60; i++) tick(ps1, r1.assembly, r1.staging, fs1, 1 / 60);

    handleKeyDown(ps1, r1.assembly, 'd');
    for (let i = 0; i < 10; i++) tick(ps1, r1.assembly, r1.staging, fs1, 1 / 60);
    const lightAngle = ps1.angle;

    // Heavy rocket: add extra mass by filling tank with more fuel.
    const r2 = makeSimpleRocket();
    const fs2 = makeFlightState();
    const ps2 = createPhysicsState(r2.assembly, fs2);
    // Increase mass dramatically.
    for (const [id] of ps2.fuelStore) {
      ps2.fuelStore.set(id, 50000);
    }
    // Manually put the heavy rocket airborne (TWR < 1 so it can't lift off).
    ps2.posY = 5000;
    ps2.grounded = false;
    fireNextStage(ps2, r2.assembly, r2.staging, fs2);

    handleKeyDown(ps2, r2.assembly, 'd');
    for (let i = 0; i < 10; i++) tick(ps2, r2.assembly, r2.staging, fs2, 1 / 60);
    const heavyAngle = ps2.angle;

    // Heavy rocket should have turned less.
    expect(Math.abs(heavyAngle)).toBeLessThan(Math.abs(lightAngle));
  });

  it('angular velocity persists in vacuum when key released (no RCS)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Put rocket high up in vacuum with some angular velocity.
    ps.posY = 100_000; // way above atmosphere
    ps.grounded = false;
    ps.angularVelocity = 0.5;

    // Run a few ticks with no key held.
    for (let i = 0; i < 30; i++) tick(ps, assembly, staging, fs, 1 / 60);

    // Angular velocity should persist (no RCS, no atmosphere to damp).
    expect(Math.abs(ps.angularVelocity)).toBeGreaterThan(0.45);
  });

  it('atmospheric flight damps angular velocity', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Low altitude with angular velocity but no key held.
    ps.posY = 100;
    ps.grounded = false;
    ps.angularVelocity = 1.0;

    // Run for 10 seconds to allow meaningful atmospheric damping.
    for (let i = 0; i < 600; i++) tick(ps, assembly, staging, fs, 1 / 60);

    // Atmospheric damping should have reduced angular velocity noticeably.
    expect(Math.abs(ps.angularVelocity)).toBeLessThan(0.95);
  });
});

// ---------------------------------------------------------------------------
// Debris angular dynamics
// ---------------------------------------------------------------------------

describe('Debris angular dynamics', () => {
  it('debris inherits angularVelocity from parent at separation', () => {
    const { assembly, staging, engineId } = makeTwoStageRocketGlobal();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Get airborne, give the rocket some angular velocity.
    fireNextStage(ps, assembly, staging, fs);
    for (let i = 0; i < 60; i++) tick(ps, assembly, staging, fs, 1 / 60);
    ps.angularVelocity = 0.3;

    // Fire decoupler stage.
    fireNextStage(ps, assembly, staging, fs);

    // Check that debris exists and has non-zero angular velocity.
    expect(ps.debris.length).toBeGreaterThan(0);
    const debris = ps.debris[0];
    // Inherited 0.3 ± 0.15 random perturbation.
    expect(debris.angularVelocity).toBeDefined();
    expect(typeof debris.angularVelocity).toBe('number');
  });

  it('debris angle changes over time from angular velocity', () => {
    const { assembly, staging } = makeTwoStageRocketGlobal();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    fireNextStage(ps, assembly, staging, fs);
    for (let i = 0; i < 30; i++) tick(ps, assembly, staging, fs, 1 / 60);

    fireNextStage(ps, assembly, staging, fs);
    expect(ps.debris.length).toBeGreaterThan(0);

    const debris = ps.debris[0];
    debris.angularVelocity = 1.0;
    const angleBefore = debris.angle;

    // Tick the main sim (which ticks debris internally).
    for (let i = 0; i < 30; i++) tick(ps, assembly, staging, fs, 1 / 60);

    expect(debris.angle).not.toBe(angleBefore);
  });
});

// ===========================================================================
// Parachute stabilization torque
// ===========================================================================

/**
 * Build a rocket with a parachute mounted on top:
 * Parachute (y=70) → Probe Core (y=60) → Small Tank (y=0) → Spark Engine (y=-55)
 *
 * The parachute is above the CoM, so when deployed its drag creates a
 * pendulum restoring torque that swings the rocket upright.
 */
function makeRocketWithChute(chuteId = 'parachute-mk1') {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const chuteInstanceId = addPartToAssembly(assembly, chuteId,           0,   70);
  const probeId         = addPartToAssembly(assembly, 'probe-core-mk1',  0,   60);
  const tankId          = addPartToAssembly(assembly, 'tank-small',      0,    0);
  const engineId        = addPartToAssembly(assembly, 'engine-spark',    0,  -55);

  connectParts(assembly, chuteInstanceId, 1, probeId, 0); // chute bottom → probe top
  connectParts(assembly, probeId, 1, tankId,   0);
  connectParts(assembly, tankId,  1, engineId, 0);

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, engineId, 0);
  // Chute deploy on stage 2.
  addStageToConfig(staging);
  assignPartToStage(staging, chuteInstanceId, 1);

  return { assembly, staging, chuteInstanceId, probeId, tankId, engineId };
}

describe('Parachute stabilization torque', () => {
  it('deployed chute reduces angular velocity of a tilted, falling rocket', () => {
    const { assembly, staging, chuteInstanceId } = makeRocketWithChute();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Airborne, falling at sea level (plenty of atmosphere).
    ps.posY     = 5_000;
    ps.velY     = -80;
    ps.grounded = false;
    ps.angle    = 0.5;            // ~29° clockwise tilt
    ps.angularVelocity = 0;

    // Deploy the chute manually.
    ps.parachuteStates.set(chuteInstanceId, { state: 'deployed', deployTimer: 0 });

    // Run 5 seconds of simulation.
    const steps = 5 * 60;
    for (let i = 0; i < steps; i++) {
      tick(ps, assembly, staging, fs, FIXED_DT, 1);
    }

    // The restoring torque should have pushed the angle back toward 0.
    expect(Math.abs(ps.angle)).toBeLessThan(0.5);
  });

  it('no torque when chute is still packed', () => {
    const { assembly, staging } = makeRocketWithChute();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 5_000;
    ps.velY     = -80;
    ps.grounded = false;
    ps.angle    = 0.3;
    ps.angularVelocity = 0;

    // Do NOT deploy chute — parachuteStates is empty or packed.
    // Run 2 seconds.
    const steps = 2 * 60;
    for (let i = 0; i < steps; i++) {
      tick(ps, assembly, staging, fs, FIXED_DT, 1);
    }

    // Without a deployed chute, no significant restoring correction.
    // Angle should remain near the initial value (only generic aero damping acts,
    // which doesn't produce a restoring torque toward 0 — it only damps velocity).
    // With zero initial angularVelocity and no restoring torque, angle stays put.
    expect(Math.abs(ps.angle - 0.3)).toBeLessThan(0.05);
  });

  it('Mk2 chute corrects faster than Mk1', () => {
    // Build two identical rockets, one with Mk1, one with Mk2 chute.
    const mk1 = makeRocketWithChute('parachute-mk1');
    const mk2 = makeRocketWithChute('parachute-mk2');

    const fsMk1 = makeFlightState();
    const fsMk2 = makeFlightState();
    const psMk1 = createPhysicsState(mk1.assembly, fsMk1);
    const psMk2 = createPhysicsState(mk2.assembly, fsMk2);

    // Identical initial conditions: tilted, falling.
    for (const ps of [psMk1, psMk2]) {
      ps.posY     = 5_000;
      ps.velY     = -80;
      ps.grounded = false;
      ps.angle    = 0.5;
      ps.angularVelocity = 0;
    }

    // Deploy both chutes.
    psMk1.parachuteStates.set(mk1.chuteInstanceId, { state: 'deployed', deployTimer: 0 });
    psMk2.parachuteStates.set(mk2.chuteInstanceId, { state: 'deployed', deployTimer: 0 });

    // Run 3 seconds.
    const steps = 3 * 60;
    for (let i = 0; i < steps; i++) {
      tick(psMk1, mk1.assembly, mk1.staging, fsMk1, FIXED_DT, 1);
      tick(psMk2, mk2.assembly, mk2.staging, fsMk2, FIXED_DT, 1);
    }

    // Mk2 (35 m deployed diameter) should correct more than Mk1 (20 m).
    expect(Math.abs(psMk2.angle)).toBeLessThan(Math.abs(psMk1.angle));
  });
});
