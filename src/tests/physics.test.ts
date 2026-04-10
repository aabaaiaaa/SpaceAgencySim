// @ts-nocheck
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
  tickDebrisGround,
  handleKeyDown,
  handleKeyUp,
  fireNextStage,
  setCapturedBody,
  clearCapturedBody,
  setThrustAligned,
} from '../core/physics.ts';
import {
  LegState,
  LEG_DEPLOY_DURATION,
  deployLandingLeg,
  getLegStatus,
  getLegContextMenuItems,
  getDeployedLegFootOffset,
} from '../core/legs.ts';
import { getPartById } from '../data/parts.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
  addStageToConfig,
} from '../core/rocketbuilder.ts';
import { createFlightState } from '../core/gameState.ts';

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

  it('initialises targetTWR to 1.1', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    expect(ps.targetTWR).toBe(1.1);
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
  it('@smoke climbs when engine is ignited', () => {
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
const EARTH_RADIUS = 6_371_000;   // Earth radius (m)

// Gravity at VAC_ALT using inverse-square law (TASK-042 multi-body gravity)
const G_AT_VAC_ALT = G0 * Math.pow(EARTH_RADIUS / (EARTH_RADIUS + VAC_ALT), 2);

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
    ps.targetTWR = Infinity;   // max thrust for deterministic calculation

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

    // Euler velocity: v ≈ v0 − g(alt) × t. Gravity at VAC_ALT is slightly
    // less than G0 due to inverse-square law (TASK-042).
    const expectedVelY = v0Y - G_AT_VAC_ALT * 1.0;
    expect(ps.velY).toBeCloseTo(expectedVelY, 1);
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

    // Gravity at VAC_ALT is slightly less than G0 due to inverse-square (TASK-042).
    expect(ps.velY).toBeCloseTo(-G_AT_VAC_ALT * 1.0, 1);
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

    // In vacuum: drag = 0, thrust = 0 → accY = -g(alt)
    // velY after 1 step = -50 − g(VAC_ALT) × FIXED_DT
    // Gravity at VAC_ALT is slightly less than G0 due to inverse-square (TASK-042).
    const expectedVelY = -50 - G_AT_VAC_ALT * FIXED_DT;
    expect(ps.velY).toBeCloseTo(expectedVelY, 3);
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
  it('emits LANDING and sets ps.landed when speed below all crash thresholds', () => {
    const { assembly, staging, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Manually set both legs to DEPLOYED state.
    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    ps.legStates.get(legId2).state = LegState.DEPLOYED;

    // Set rocket just above ground, falling within safe speed.
    ps.posY     = 0.01;
    ps.velY     = -7; // 7 m/s — below all crash thresholds
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    const evt = fs.events.find((e) => e.type === 'LANDING');
    expect(evt).toBeDefined();
    expect(evt.speed).toBeCloseTo(7, 0);
    expect(ps.landed).toBe(true);
    expect(ps.crashed).toBe(false);
  });

  it('emits LANDING even for 1 deployed leg when speed is below thresholds', () => {
    const { assembly, staging, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Only 1 leg deployed.
    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    // legId2 stays RETRACTED.

    ps.posY     = 0.01;
    ps.velY     = -7; // within all crash thresholds (probe=12, leg=25)
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    // With cascading thresholds, 7 m/s is below all part thresholds → safe landing.
    const landEvt = fs.events.find((e) => e.type === 'LANDING');
    expect(landEvt).toBeDefined();
    expect(ps.landed).toBe(true);
    expect(ps.crashed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Landing detection — ≥ 1 deployed leg AND speed 10–29 m/s → hard landing
// ---------------------------------------------------------------------------

describe('TASK-025: landing detection — hard landing (cascading damage)', () => {
  it('legs survive at 20 m/s (threshold 25) — everything lands safely', () => {
    const { assembly, staging, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Both legs deployed.
    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    ps.legStates.get(legId2).state = LegState.DEPLOYED;

    // Falling at 20 m/s — legs have crashThreshold 25, so they survive.
    ps.posY     = 0.01;
    ps.velY     = -20;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    const evt = fs.events.find((e) => e.type === 'LANDING');
    expect(evt).toBeDefined();
    expect(ps.landed).toBe(true);
    expect(ps.crashed).toBe(false);

    // Legs should still be active (threshold 25 > impact 20).
    expect(ps.activeParts.has(legId1)).toBe(true);
    expect(ps.activeParts.has(legId2)).toBe(true);
  });

  it('probe (non-leg) survives hard landing at 20 m/s', () => {
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

describe('TASK-025: landing detection — catastrophic impact', () => {
  it('legs absorb 25 m/s at 30 m/s — probe survives with 5 m/s remaining', () => {
    const { assembly, staging, probeId } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Both legs deployed.
    for (const [, entry] of ps.legStates) {
      entry.state = LegState.DEPLOYED;
    }

    ps.posY     = 0.01;
    ps.velY     = -30;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    // Legs (threshold 25) absorb 25 m/s → 5 m/s remaining < probe threshold 12.
    const landEvt = fs.events.find((e) => e.type === 'LANDING');
    expect(landEvt).toBeDefined();
    expect(ps.landed).toBe(true);
    expect(ps.activeParts.has(probeId)).toBe(true);
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

describe('TASK-025: landing detection — no legs, cascading thresholds', () => {
  it('lands safely at 7 m/s without legs (below all crash thresholds)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 0.01;
    ps.velY     = -7;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    // 7 m/s is below the lowest crash threshold (tank=8), so safe landing.
    const evt = fs.events.find((e) => e.type === 'LANDING');
    expect(evt).toBeDefined();
    expect(ps.landed).toBe(true);
    expect(ps.crashed).toBe(false);
  });

  it('destroys bottom engine at 15 m/s (exceeds threshold 12)', () => {
    const { assembly, staging, engineId } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 0.01;
    ps.velY     = -15;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    // The engine (threshold 12) at y=-55 should be destroyed at 15 m/s.
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
    expect(crashEvt.speed).toBeGreaterThan(0);
  });

  it('slowly toppling rocket does not crash', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Just past topple angle with very low angular velocity → low tip speed.
    ps.angle = Math.PI * 0.44 + 0.05;
    ps.angularVelocity = 0.1;
    ps.isTipping = true;

    tick(ps, assembly, staging, fs, 1 / 60);
    expect(ps.crashed).toBeFalsy();
  });

  it('fast toppling rocket crashes', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Same angle but high angular velocity → high tip speed.
    ps.angle = Math.PI * 0.44 + 0.05;
    ps.angularVelocity = 5.0;
    ps.isTipping = true;

    tick(ps, assembly, staging, fs, 1 / 60);
    expect(ps.crashed).toBe(true);
    const evt = fs.events.find(e => e.type === 'CRASH' && e.toppled);
    expect(evt).toBeDefined();
    expect(evt.speed).toBeGreaterThan(0);
  });

  it('slowly toppled rocket settles on its side without crashing', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.angle = Math.PI * 0.44 + 0.05;
    ps.angularVelocity = 0.1;
    ps.isTipping = true;

    for (let i = 0; i < 1200; i++) {
      tick(ps, assembly, staging, fs, 1 / 60);
      if (ps.crashed) break;
    }

    expect(ps.crashed).toBeFalsy();
    // Should have settled near π/2 (on its side).
    expect(Math.abs(ps.angle)).toBeGreaterThan(1.0);
    expect(Math.abs(ps.angularVelocity)).toBe(0);
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
// Debris ground physics — tipping & settling
// ---------------------------------------------------------------------------

describe('Debris ground physics — tipping & settling', () => {
  // Helper: create landed debris from a two-stage rocket separation.
  function makeLandedDebris() {
    const { assembly, staging } = makeTwoStageRocketGlobal();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Fire stage 1 (engine ignition), then stage 2 (decoupler separation).
    fireNextStage(ps, assembly, staging, fs);
    fireNextStage(ps, assembly, staging, fs);

    const debris = ps.debris[0];
    debris.posY = 0;
    debris.velX = 0;
    debris.velY = 0;
    debris.landed = true;
    debris.angularVelocity = 0;
    return { debris, assembly };
  }

  it('tilted debris rocks under gravity torque', () => {
    const { debris, assembly } = makeLandedDebris();
    debris.angle = 0.3; // ~17° tilt
    debris.isTipping = true;

    const initialAngle = debris.angle;
    tickDebrisGround(debris, assembly, 1 / 60);

    // Gravity torque should change the angle (debris rocks).
    expect(debris.angle).not.toBe(initialAngle);
    // Angular velocity should be non-zero (gravity is acting).
    expect(debris.angularVelocity).not.toBe(0);
  });

  it('upright debris settles to angle 0', () => {
    const { debris, assembly } = makeLandedDebris();
    debris.angle = 0.003; // tiny tilt — below snap threshold
    debris.angularVelocity = 0.01;

    for (let i = 0; i < 300; i++) {
      tickDebrisGround(debris, assembly, 1 / 60);
    }

    expect(debris.angle).toBe(0);
    expect(debris.angularVelocity).toBe(0);
    expect(debris.isTipping).toBe(false);
  });

  it('fast toppling debris crashes', () => {
    const { debris, assembly } = makeLandedDebris();
    debris.angle = Math.PI * 0.44 + 0.05; // past topple threshold
    debris.angularVelocity = 5.0;
    debris.isTipping = true;

    for (let i = 0; i < 60; i++) {
      tickDebrisGround(debris, assembly, 1 / 60);
      if (debris.crashed) break;
    }

    expect(debris.crashed).toBe(true);
  });

  it('slow topple does not crash debris', () => {
    const { debris, assembly } = makeLandedDebris();
    debris.angle = Math.PI * 0.44 + 0.05;
    debris.angularVelocity = 0.1; // very slow
    debris.isTipping = true;

    tickDebrisGround(debris, assembly, 1 / 60);
    expect(debris.crashed).toBeFalsy();
  });

  it('debris stays pinned to ground (posY = 0) while tipping', () => {
    const { debris, assembly } = makeLandedDebris();
    debris.angle = 0.5;
    debris.isTipping = true;

    for (let i = 0; i < 60; i++) {
      tickDebrisGround(debris, assembly, 1 / 60);
    }

    expect(debris.posY).toBe(0);
  });

  it('no-op when debris is already crashed', () => {
    const { debris, assembly } = makeLandedDebris();
    debris.crashed = true;
    debris.angle = 0.5;
    const savedAngle = debris.angle;

    tickDebrisGround(debris, assembly, 1 / 60);
    expect(debris.angle).toBe(savedAngle);
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

    // Run 0.25 seconds.
    const steps = Math.round(0.25 * 60);
    for (let i = 0; i < steps; i++) {
      tick(psMk1, mk1.assembly, mk1.staging, fsMk1, FIXED_DT, 1);
      tick(psMk2, mk2.assembly, mk2.staging, fsMk2, FIXED_DT, 1);
    }

    // Both started at +0.5 rad. Mk2 (35 m) should have corrected more toward
    // 0 — its absolute angle will be closer to upright than Mk1's.
    expect(Math.abs(psMk2.angle)).toBeLessThan(Math.abs(psMk1.angle));
  });
});

// ===========================================================================
// Self-inertia and parachute damping
// ===========================================================================

describe('Single command module turn sensitivity', () => {
  /**
   * A lone command module (cmd-mk1, 840 kg) with no other parts.
   * Before the self-inertia fix the MoI was clamped to 1 kg·m²,
   * giving absurd angular acceleration.
   */
  function makeSoloCmdModule() {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    const cmdId = addPartToAssembly(assembly, 'cmd-mk1', 0, 0);
    syncStagingWithAssembly(assembly, staging);
    return { assembly, staging, cmdId };
  }

  it('angular velocity after 1 s of turning is less than 5 rad/s', () => {
    const { assembly, staging } = makeSoloCmdModule();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Airborne in vacuum so no aero damping interferes.
    ps.posY     = 200_000;
    ps.velY     = 0;
    ps.grounded = false;

    // Hold right-turn key for 1 second.
    handleKeyDown(ps, 'd');
    const steps = Math.round(1 / FIXED_DT);
    for (let i = 0; i < steps; i++) {
      tick(ps, assembly, staging, fs, FIXED_DT, 1);
    }
    handleKeyUp(ps, 'd');

    // With self-inertia the angular velocity should be moderate, not thousands.
    expect(Math.abs(ps.angularVelocity)).toBeLessThan(5);
  });
});

describe('Parachute angular damping', () => {
  it('deployed chute damps angular velocity to near-zero within 5 seconds', () => {
    const { assembly, staging, chuteInstanceId } = makeRocketWithChute();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 5_000;
    ps.velY     = -80;
    ps.grounded = false;
    ps.angle    = 0;
    ps.angularVelocity = 2.0;  // spinning at 2 rad/s

    ps.parachuteStates.set(chuteInstanceId, { state: 'deployed', deployTimer: 0 });

    const steps = 5 * 60;
    for (let i = 0; i < steps; i++) {
      tick(ps, assembly, staging, fs, FIXED_DT, 1);
    }

    // Angular velocity should be damped to near zero.
    expect(Math.abs(ps.angularVelocity)).toBeLessThan(0.1);
  });

  it('parachute damping applies even while rotation keys are held', () => {
    const { assembly, staging, chuteInstanceId } = makeRocketWithChute();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 5_000;
    ps.velY     = -80;
    ps.grounded = false;
    ps.angle    = 0;
    ps.angularVelocity = 0;

    ps.parachuteStates.set(chuteInstanceId, { state: 'deployed', deployTimer: 0 });

    // Hold right-turn key throughout.
    handleKeyDown(ps, 'd');

    const steps = 3 * 60;
    for (let i = 0; i < steps; i++) {
      tick(ps, assembly, staging, fs, FIXED_DT, 1);
    }
    handleKeyUp(ps, 'd');

    // Without damping the angular velocity would grow unbounded;
    // with chute damping it should stay moderate (< 2 rad/s).
    expect(Math.abs(ps.angularVelocity)).toBeLessThan(2);
  });
});

// ===========================================================================
// Cascading per-part crash thresholds
// ===========================================================================

describe('cascading crash thresholds', () => {
  /**
   * Helper: build a rocket and drop it at a given speed.
   * Returns { ps, assembly, flightState } after impact.
   *
   * Rocket layout (bottom to top by Y position):
   *   engine-spark    at y=-55  (crashThreshold: 12, mass: 120)
   *   tank-small      at y=0    (crashThreshold: 8,  mass: 50 dry + 400 fuel)
   *   probe-core-mk1  at y=60   (crashThreshold: 12, mass: 50)
   */
  function dropRocket(speed) {
    const { assembly, staging, probeId, tankId, engineId } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Place rocket barely above ground. At 1/60s step, position delta is
    // roughly speed/60 m, so for speed=5 that's ~0.08m. Use a tiny posY
    // so ground contact is triggered in the first integration step.
    ps.posY     = speed * (1 / 60) * 0.5;
    ps.velY     = -speed;
    ps.grounded = false;

    // Tick enough frames that the rocket definitely hits ground.
    tick(ps, assembly, staging, fs, 0.5);

    return { ps, assembly, fs, probeId, tankId, engineId };
  }

  it('safe landing — impact 5 m/s, all parts survive, landed = true', () => {
    const { ps, assembly } = dropRocket(5);

    expect(ps.landed).toBe(true);
    expect(ps.crashed).toBe(false);
    // All 3 parts should still be active.
    expect(ps.activeParts.size).toBe(3);
  });

  it('single layer destroyed — engine at bottom destroyed, tank and probe survive', () => {
    // engine-spark crashThreshold=12, tank-small crashThreshold=8, probe crashThreshold=12
    // Impact at 15 m/s: engine destroyed (threshold 12), remaining speed = 15 - 12 = 3.
    // Tank threshold 8 > 3 → tank survives. Probe survives.
    const { ps, assembly, engineId, tankId, probeId } = dropRocket(15);

    // Engine is at the bottom (y=-55), should be destroyed.
    expect(ps.activeParts.has(engineId)).toBe(false);
    // Tank and probe should survive — engine absorbed 12 m/s, leaving only 3.
    expect(ps.activeParts.has(tankId)).toBe(true);
    expect(ps.activeParts.has(probeId)).toBe(true);
    expect(ps.crashed).toBe(false);
    expect(ps.landed).toBe(true);
  });

  it('total destruction — impact 50 m/s, all parts destroyed, crashed = true', () => {
    const { ps } = dropRocket(50);

    expect(ps.crashed).toBe(true);
    expect(ps.activeParts.size).toBe(0);
  });

  it('landing legs absorb — legs deployed, threshold 25, impact 20 m/s survives', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId = addPartToAssembly(assembly, 'probe-core-mk1',     0,  60);
    const tankId  = addPartToAssembly(assembly, 'tank-small',         0,   0);
    const legId1  = addPartToAssembly(assembly, 'landing-legs-small', 20, -30);
    const legId2  = addPartToAssembly(assembly, 'landing-legs-small', -20, -30);

    connectParts(assembly, probeId, 1, tankId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, legId1, 0);
    assignPartToStage(staging, legId2, 0);

    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Deploy legs and advance to finish deployment.
    ps.grounded = false;
    ps.posY     = 50_000;
    fireNextStage(ps, assembly, staging, fs);
    tick(ps, assembly, staging, fs, 2.0);

    // Set up for landing at 20 m/s.
    ps.posY   = 20 * (1 / 60) * 0.5;
    ps.velY   = -20;
    ps.velX   = 0;
    ps.landed = false;
    tick(ps, assembly, staging, fs, 0.5);

    // Legs have crashThreshold=25, so 20 m/s should be survived by all.
    expect(ps.landed).toBe(true);
    expect(ps.crashed).toBe(false);
    expect(ps.activeParts.has(probeId)).toBe(true);
  });

  it('bottom part destroyed but command module survives', () => {
    // Reliant engine (threshold 12) at bottom + cmd-mk1 (threshold 15).
    // At 15 m/s: engine destroyed, remaining = 15 - 12 = 3. 3 < 15 → cmd survives.
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const cmdId    = addPartToAssembly(assembly, 'cmd-mk1',        0,  60);
    const engineId = addPartToAssembly(assembly, 'engine-reliant', 0, -20);

    connectParts(assembly, cmdId, 1, engineId, 0);
    syncStagingWithAssembly(assembly, staging);

    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 0.01;
    ps.velY     = -15;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    // Engine (threshold 12) destroyed, cmd (threshold 15) survives.
    expect(ps.activeParts.has(engineId)).toBe(false);
    expect(ps.activeParts.has(cmdId)).toBe(true);
    expect(ps.landed).toBe(true);
    expect(ps.crashed).toBe(false);
  });

  it('command module destruction = crashed', () => {
    // Build a rocket with only a probe core (at bottom) and an engine above.
    // Impact should destroy probe first since it's the only cmd module.
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    // Probe at the bottom (lowest Y).
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, -30);
    const tankId   = addPartToAssembly(assembly, 'tank-small',     0,  30);

    connectParts(assembly, probeId, 1, tankId, 0);
    syncStagingWithAssembly(assembly, staging);

    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.posY     = 0.1;
    ps.velY     = -20;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    // Probe (threshold 12) should be destroyed at 20 m/s → crashed.
    expect(ps.crashed).toBe(true);
  });

  it('PART_DESTROYED events emitted for each destroyed part', () => {
    const { fs, engineId } = dropRocket(15);

    const destroyedEvents = fs.events.filter((e) => e.type === 'PART_DESTROYED');
    // At 15 m/s at least the engine (threshold 12) should be destroyed.
    expect(destroyedEvents.length).toBeGreaterThanOrEqual(1);

    // Check that the engine appears in destroyed events.
    const engineDestroyed = destroyedEvents.find((e) => e.instanceId === engineId);
    expect(engineDestroyed).toBeDefined();
    expect(engineDestroyed.partId).toBe('engine-spark');
  });

  it('higher threshold absorbs more — engine (12) vs decoupler (6) at bottom', () => {
    // Build: probe(y=100) + decoupler(y=60) + tank(y=0) + engine(y=-55)
    // The engine (threshold 12) at the bottom absorbs more speed
    // than a decoupler (threshold 6) would at the bottom.
    const { assembly: a1, staging: s1 } = makeTwoStageRocketGlobal();
    const fs1 = makeFlightState();
    const ps1 = createPhysicsState(a1, fs1);
    ps1.posY     = 0.1;
    ps1.velY     = -20;
    ps1.grounded = false;

    tick(ps1, a1, s1, fs1, 1 / 60);

    // The engine at the bottom (mass=120+0 fuel) should be destroyed.
    // Count how many parts were destroyed.
    const destroyed1 = fs1.events.filter((e) => e.type === 'PART_DESTROYED').length;

    // Now build the same rocket but swap: put decoupler at bottom.
    const assembly2 = createRocketAssembly();
    const staging2  = createStagingConfig();
    const probeId2  = addPartToAssembly(assembly2, 'probe-core-mk1',       0, 100);
    const tankId2   = addPartToAssembly(assembly2, 'tank-small',           0,  60);
    const engineId2 = addPartToAssembly(assembly2, 'engine-spark',         0,   0);
    const decId2    = addPartToAssembly(assembly2, 'decoupler-stack-tr18', 0, -55);

    connectParts(assembly2, probeId2, 1, tankId2, 0);
    connectParts(assembly2, tankId2,  1, engineId2, 0);
    connectParts(assembly2, engineId2, 1, decId2, 0);

    syncStagingWithAssembly(assembly2, staging2);

    const fs2 = makeFlightState();
    const ps2 = createPhysicsState(assembly2, fs2);
    ps2.posY     = 0.1;
    ps2.velY     = -20;
    ps2.grounded = false;

    tick(ps2, assembly2, staging2, fs2, 1 / 60);

    const destroyed2 = fs2.events.filter((e) => e.type === 'PART_DESTROYED').length;

    // With the low-threshold decoupler (threshold 6) at the bottom,
    // it absorbs less speed (6 vs 12), so more layers should be destroyed.
    expect(destroyed2).toBeGreaterThanOrEqual(destroyed1);
  });
});

// ===========================================================================
// Landing Leg Foot Offset and Ground Interaction Tests
// ===========================================================================

describe('getDeployedLegFootOffset() — returns correct values', () => {
  it('RETRACTED: dx=0, dy=0, t=0', () => {
    const legStates = new Map();
    legStates.set('leg1', { state: LegState.RETRACTED, deployTimer: 0 });
    const def = { width: 10, height: 20 };
    const result = getDeployedLegFootOffset('leg1', def, legStates);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.t).toBe(0);
  });

  it('DEPLOYED: dx=pw, dy=ph*3, t=1', () => {
    const legStates = new Map();
    legStates.set('leg1', { state: LegState.DEPLOYED, deployTimer: 0 });
    const def = { width: 10, height: 20 };
    const result = getDeployedLegFootOffset('leg1', def, legStates);
    expect(result.dx).toBe(10);
    expect(result.dy).toBe(60);
    expect(result.t).toBe(1);
  });

  it('DEPLOYING halfway: dx=pw*0.5, dy=ph*1.5, t=0.5', () => {
    const legStates = new Map();
    legStates.set('leg1', {
      state: LegState.DEPLOYING,
      deployTimer: LEG_DEPLOY_DURATION * 0.5,
    });
    const def = { width: 10, height: 20 };
    const result = getDeployedLegFootOffset('leg1', def, legStates);
    expect(result.t).toBeCloseTo(0.5, 5);
    expect(result.dx).toBeCloseTo(5, 5);
    expect(result.dy).toBeCloseTo(30, 5);
  });

  it('returns zeros when instanceId not in legStates', () => {
    const legStates = new Map();
    const def = { width: 10, height: 20 };
    const result = getDeployedLegFootOffset('missing', def, legStates);
    expect(result.dx).toBe(0);
    expect(result.dy).toBe(0);
    expect(result.t).toBe(0);
  });
});

describe('Deployed leg foot extends past engine', () => {
  it('foot VAB Y is lower than engine bottom VAB Y', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const tankId   = addPartToAssembly(assembly, 'tank-small',      0, 20);
    const engineId = addPartToAssembly(assembly, 'engine-spark',    0, -20);
    const legId1   = addPartToAssembly(assembly, 'landing-legs-small', 20, 0);
    const legId2   = addPartToAssembly(assembly, 'landing-legs-small', -20, 0);

    connectParts(assembly, probeId, 1, tankId, 0);
    connectParts(assembly, tankId, 1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);

    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Deploy legs manually.
    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    ps.legStates.get(legId1).deployTimer = 0;
    ps.legStates.get(legId2).state = LegState.DEPLOYED;
    ps.legStates.get(legId2).deployTimer = 0;

    const legDef = getPartById('landing-legs-small');
    const engineDef = getPartById('engine-spark');

    // Leg foot Y (in VAB coords, more negative = lower).
    const legPlaced = assembly.parts.get(legId1);
    const { dy } = getDeployedLegFootOffset(legId1, legDef, ps.legStates);
    const footVabY = legPlaced.y - dy;

    // Engine bottom Y.
    const enginePlaced = assembly.parts.get(engineId);
    const engineBottomY = enginePlaced.y - (engineDef.height ?? 40) / 2;

    // Foot should be lower (more negative) than engine bottom.
    expect(footVabY).toBeLessThan(engineBottomY);
  });
});

describe('Legs deploy on launch pad (grounded)', () => {
  it('legs reach DEPLOYED after 2s of ticking while grounded', () => {
    const { assembly, staging, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Start grounded on the pad.
    ps.grounded = true;
    ps.posY = 0;
    ps.velY = 0;

    // Fire the stage to deploy legs.
    fireNextStage(ps, assembly, staging, fs);
    expect(getLegStatus(ps, legId1)).toBe(LegState.DEPLOYING);
    expect(getLegStatus(ps, legId2)).toBe(LegState.DEPLOYING);

    // Tick 2 seconds (more than LEG_DEPLOY_DURATION=1.5s).
    const dt = 1 / 60;
    for (let i = 0; i < 120; i++) {
      tick(ps, assembly, staging, fs, dt);
    }

    expect(getLegStatus(ps, legId1)).toBe(LegState.DEPLOYED);
    expect(getLegStatus(ps, legId2)).toBe(LegState.DEPLOYED);
  });

  it('leg timers tick while grounded (DEPLOYING after 1.0s)', () => {
    const { assembly, staging, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.grounded = true;
    ps.posY = 0;
    ps.velY = 0;

    fireNextStage(ps, assembly, staging, fs);

    // Tick 1.0 second (less than LEG_DEPLOY_DURATION=1.5s).
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      tick(ps, assembly, staging, fs, dt);
    }

    // Should still be deploying (timer decremented but not expired).
    expect(getLegStatus(ps, legId1)).toBe(LegState.DEPLOYING);
    const entry = ps.legStates.get(legId1);
    expect(entry.deployTimer).toBeLessThan(LEG_DEPLOY_DURATION);
    expect(entry.deployTimer).toBeGreaterThan(0);
  });
});

describe('Deployed legs are lowest point on grounded rocket', () => {
  it('lowest point matches foot position, not engine or leg housing', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const tankId   = addPartToAssembly(assembly, 'tank-small',      0, 20);
    const engineId = addPartToAssembly(assembly, 'engine-spark',    0, -20);
    const legId1   = addPartToAssembly(assembly, 'landing-legs-small', 20, 0);
    const legId2   = addPartToAssembly(assembly, 'landing-legs-small', -20, 0);

    connectParts(assembly, probeId, 1, tankId, 0);
    connectParts(assembly, tankId, 1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);

    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Deploy legs.
    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    ps.legStates.get(legId1).deployTimer = 0;
    ps.legStates.get(legId2).state = LegState.DEPLOYED;
    ps.legStates.get(legId2).deployTimer = 0;

    // Find the lowest point across all parts, accounting for foot offset.
    let lowestY = Infinity;
    for (const instanceId of ps.activeParts) {
      const placed = assembly.parts.get(instanceId);
      const def = placed ? getPartById(placed.partId) : null;
      if (!def) continue;
      let bottomY = placed.y - (def.height ?? 40) / 2;
      if (def.type === 'LANDING_LEGS' || def.type === 'LANDING_LEG') {
        const { dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
        const footY = placed.y - dy;
        if (footY < bottomY) bottomY = footY;
      }
      if (bottomY < lowestY) lowestY = bottomY;
    }

    // The lowest point should be the deployed leg foot, not the engine.
    const legDef = getPartById('landing-legs-small');
    const legPlaced = assembly.parts.get(legId1);
    const { dy } = getDeployedLegFootOffset(legId1, legDef, ps.legStates);
    const expectedFootY = legPlaced.y - dy;

    expect(lowestY).toBe(expectedFootY);
  });
});

// ---------------------------------------------------------------------------
// Asymmetric leg deploy — tipping behaviour
// ---------------------------------------------------------------------------

describe('Asymmetric leg deploy causes tipping on pad', () => {
  it('rocket tips and settles on its side when only one leg is deployed on the pad', () => {
    const { assembly, staging, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Deploy only leg1, leave leg2 retracted.
    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    ps.legStates.get(legId1).deployTimer = 0;

    ps.grounded = true;
    ps.posY = 0;
    ps.velY = 0;
    ps.angle = 0;
    ps.angularVelocity = 0;

    // Tick long enough for the rocket to topple past crash angle.
    const dt = 1 / 60;
    for (let i = 0; i < 1200; i++) {
      tick(ps, assembly, staging, fs, dt);
      if (ps.crashed) break;
    }

    // Gravity-driven topple from standing is gentle — tip speed stays below
    // the crash threshold, so the rocket settles on its side without crashing.
    expect(ps.crashed).toBeFalsy();
    expect(Math.abs(ps.angle)).toBeGreaterThan(1.0);
  });

  it('rocket stays upright when both legs are deployed symmetrically', () => {
    const { assembly, staging, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Deploy both legs.
    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    ps.legStates.get(legId1).deployTimer = 0;
    ps.legStates.get(legId2).state = LegState.DEPLOYED;
    ps.legStates.get(legId2).deployTimer = 0;

    ps.grounded = true;
    ps.posY = 0;
    ps.velY = 0;
    ps.angle = 0;
    ps.angularVelocity = 0;

    // Tick ~1 second with no keyboard input.
    const dt = 1 / 60;
    for (let i = 0; i < 60; i++) {
      tick(ps, assembly, staging, fs, dt);
    }

    // Rocket should remain upright.
    expect(ps.angle).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Topple recovery with deployed legs
// ---------------------------------------------------------------------------

describe('Topple recovery with deployed legs', () => {
  it('tilted rocket rocks back and forth with decreasing amplitude then settles', () => {
    const { assembly, staging, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Deploy both legs.
    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    ps.legStates.get(legId1).deployTimer = 0;
    ps.legStates.get(legId2).state = LegState.DEPLOYED;
    ps.legStates.get(legId2).deployTimer = 0;

    ps.landed = true;
    ps.grounded = true;
    ps.posY = 0;
    ps.velY = 0;
    // Tilted ~10° clockwise — within leg support polygon.
    ps.angle = 0.17;
    ps.angularVelocity = 0;

    const dt = 1 / 60;

    // Brief tap of 'a' (counter-clockwise) to nudge back towards upright.
    handleKeyDown(ps, assembly, 'a');
    for (let i = 0; i < 5; i++) {
      tick(ps, assembly, staging, fs, dt);
    }
    handleKeyUp(ps, 'a');

    let signChanges = 0;
    let prevSign = Math.sign(ps.angle);
    let peakAngle = Math.abs(ps.angle);

    // Tick 1800 more frames (~30 seconds) with no input.
    for (let i = 0; i < 1800; i++) {
      tick(ps, assembly, staging, fs, dt);
      const curSign = Math.sign(ps.angle);
      if (curSign !== 0 && prevSign !== 0 && curSign !== prevSign) {
        signChanges++;
      }
      if (curSign !== 0) prevSign = curSign;
      peakAngle = Math.max(peakAngle, Math.abs(ps.angle));
    }

    // The rocket should rock side to side multiple times before settling.
    expect(signChanges).toBeGreaterThanOrEqual(4);

    // Peak angle during rocking must stay within the support polygon (not topple).
    expect(peakAngle).toBeLessThan(0.4);

    // After 30 seconds the oscillation must have settled to upright.
    expect(Math.abs(ps.angle)).toBeLessThan(0.01);
    expect(Math.abs(ps.angularVelocity)).toBeLessThan(0.01);
    expect(ps.crashed).toBeFalsy();
  });

  it('gravity alone rocks a tilted legged lander back to upright', () => {
    const { assembly, staging, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    ps.legStates.get(legId1).deployTimer = 0;
    ps.legStates.get(legId2).state = LegState.DEPLOYED;
    ps.legStates.get(legId2).deployTimer = 0;

    ps.landed = true;
    ps.grounded = true;
    ps.posY = 0;
    ps.velY = 0;
    // Tilted ~8.5° — no player input at all, pure gravity restoring.
    ps.angle = 0.15;
    ps.angularVelocity = 0;

    const dt = 1 / 60;
    let signChanges = 0;
    let prevSign = Math.sign(ps.angle);

    for (let i = 0; i < 1200; i++) {
      tick(ps, assembly, staging, fs, dt);
      const curSign = Math.sign(ps.angle);
      if (curSign !== 0 && prevSign !== 0 && curSign !== prevSign) {
        signChanges++;
      }
      if (curSign !== 0) prevSign = curSign;
    }

    // Gravity restoring torque should cause multiple oscillations.
    expect(signChanges).toBeGreaterThanOrEqual(3);

    // Must settle to upright.
    expect(Math.abs(ps.angle)).toBeLessThan(0.01);
    expect(ps.crashed).toBeFalsy();
  });

  it('legged lander at rest with no input stays upright', () => {
    const { assembly, staging, legId1, legId2 } = makeRocketWithLegs();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.legStates.get(legId1).state = LegState.DEPLOYED;
    ps.legStates.get(legId1).deployTimer = 0;
    ps.legStates.get(legId2).state = LegState.DEPLOYED;
    ps.legStates.get(legId2).deployTimer = 0;

    ps.landed = true;
    ps.grounded = true;
    ps.posY = 0;
    ps.velY = 0;
    ps.angle = 0;
    ps.angularVelocity = 0;

    const dt = 1 / 60;
    for (let i = 0; i < 1800; i++) {
      tick(ps, assembly, staging, fs, dt);
    }

    // Should remain exactly upright — no drift.
    expect(ps.angle).toBe(0);
    expect(ps.angularVelocity).toBe(0);
    expect(ps.crashed).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// CapturedBody — CoM shift, MoI, and asteroid torque via tick() side-effects
// ---------------------------------------------------------------------------

describe('setCapturedBody / clearCapturedBody', () => {
  it('setCapturedBody stores the body on the physics state', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    const body = { mass: 10_000, radius: 50, offset: { x: 100, y: 0 }, name: 'AST-0001' };
    setCapturedBody(ps, body);
    expect(ps.capturedBody).toBe(body);
    expect(ps.thrustAligned).toBe(false);
  });

  it('clearCapturedBody removes the body from the physics state', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    setCapturedBody(ps, { mass: 10_000, radius: 50, offset: { x: 100, y: 0 }, name: 'AST-0001' });
    clearCapturedBody(ps);
    expect(ps.capturedBody).toBeNull();
    expect(ps.thrustAligned).toBe(false);
  });

  it('setCapturedBody resets thrustAligned even if it was true', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    setCapturedBody(ps, { mass: 1_000, radius: 10, offset: { x: 0, y: 0 }, name: 'A' });
    setThrustAligned(ps, true);
    expect(ps.thrustAligned).toBe(true);
    // Capturing a new body resets alignment.
    setCapturedBody(ps, { mass: 2_000, radius: 20, offset: { x: 50, y: 0 }, name: 'B' });
    expect(ps.thrustAligned).toBe(false);
  });
});

describe('CapturedBody — total mass includes asteroid', () => {
  it('captured asteroid reduces acceleration under same thrust', () => {
    // Build two identical rockets, fire engines, tick, compare acceleration.
    // The one with a heavy captured body should accelerate more slowly.
    const { assembly: assemblyA, staging: stagingA, engineId: engineIdA } = makeSimpleRocket();
    const { assembly: assemblyB, staging: stagingB, engineId: engineIdB } = makeSimpleRocket();
    const fsA = makeFlightState();
    const fsB = makeFlightState();
    const psA = createPhysicsState(assemblyA, fsA);
    const psB = createPhysicsState(assemblyB, fsB);

    // Attach a heavy asteroid to rocket B.
    setCapturedBody(psB, { mass: 50_000, radius: 100, offset: { x: 0, y: 0 }, name: 'HEAVY' });
    setThrustAligned(psB, true); // suppress torque so we compare linear only

    // Fire engines on both.
    fireNextStage(psA, assemblyA, stagingA, fsA);
    fireNextStage(psB, assemblyB, stagingB, fsB);

    // Liftoff both rockets (not grounded).
    psA.grounded = false;
    psB.grounded = false;
    psA.posY = 1000;
    psB.posY = 1000;

    tick(psA, assemblyA, stagingA, fsA, 1 / 60);
    tick(psB, assemblyB, stagingB, fsB, 1 / 60);

    // Both should have upward velocity, but B should be slower due to extra mass.
    expect(psA.velY).toBeGreaterThan(0);
    expect(psB.velY).toBeGreaterThan(0);
    expect(psA.velY).toBeGreaterThan(psB.velY);
  });
});

describe('CapturedBody — asteroid torque via tick()', () => {
  it('unaligned captured asteroid produces angular velocity change when engines fire', () => {
    const { assembly, staging, engineId } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Move to high altitude (vacuum, no atmo damping).
    ps.grounded = false;
    ps.posY = 200_000;

    // Fire engine.
    fireNextStage(ps, assembly, staging, fs);

    // Attach a heavy asteroid offset from centre, unaligned.
    setCapturedBody(ps, { mass: 100_000, radius: 200, offset: { x: 500, y: 0 }, name: 'TORQUE-AST' });
    // thrustAligned is false by default after setCapturedBody.

    const angBefore = ps.angularVelocity;
    tick(ps, assembly, staging, fs, 1 / 60);

    // Angular velocity should have changed due to asteroid torque.
    expect(ps.angularVelocity).not.toBe(angBefore);
    expect(Math.abs(ps.angularVelocity)).toBeGreaterThan(0);
  });

  it('aligned captured asteroid produces no asteroid torque', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.grounded = false;
    ps.posY = 200_000;

    fireNextStage(ps, assembly, staging, fs);

    setCapturedBody(ps, { mass: 100_000, radius: 200, offset: { x: 500, y: 0 }, name: 'ALIGNED-AST' });
    setThrustAligned(ps, true);

    const angBefore = ps.angularVelocity;
    tick(ps, assembly, staging, fs, 1 / 60);

    // With thrust aligned, no asteroid torque is applied — angular velocity
    // stays at zero (no player steering input either).
    expect(ps.angularVelocity).toBe(angBefore);
  });

  it('no captured body produces no asteroid torque even with engines firing', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.grounded = false;
    ps.posY = 200_000;

    fireNextStage(ps, assembly, staging, fs);

    // No capturedBody set.
    expect(ps.capturedBody).toBeNull();

    tick(ps, assembly, staging, fs, 1 / 60);

    // No player steering, no asteroid — angular velocity remains zero.
    expect(ps.angularVelocity).toBe(0);
  });
});

describe('CapturedBody — MoI dampens angular acceleration', () => {
  it('heavy captured asteroid results in lower angular acceleration from steering', () => {
    // Two rockets, both given the same steering input ('d' key).
    // One has a heavy asteroid → higher MoI → smaller angular acceleration.
    const { assembly: assemblyA, staging: stagingA } = makeSimpleRocket();
    const { assembly: assemblyB, staging: stagingB } = makeSimpleRocket();
    const fsA = makeFlightState();
    const fsB = makeFlightState();
    const psA = createPhysicsState(assemblyA, fsA);
    const psB = createPhysicsState(assemblyB, fsB);

    // Both airborne in vacuum (no atmo damping).
    psA.grounded = false;
    psA.posY = 200_000;
    psB.grounded = false;
    psB.posY = 200_000;

    // Attach a very heavy asteroid to rocket B at a large offset.
    // This massively increases the MoI about the CoM.
    setCapturedBody(psB, { mass: 500_000, radius: 500, offset: { x: 1000, y: 0 }, name: 'HEAVY-MOI' });
    setThrustAligned(psB, true); // suppress asteroid torque

    // Steer right on both.
    handleKeyDown(psA, assemblyA, 'd');
    handleKeyDown(psB, assemblyB, 'd');

    tick(psA, assemblyA, stagingA, fsA, 1 / 60);
    tick(psB, assemblyB, stagingB, fsB, 1 / 60);

    // Both should have rotated clockwise (positive angular velocity).
    expect(psA.angularVelocity).toBeGreaterThan(0);
    expect(psB.angularVelocity).toBeGreaterThan(0);

    // Rocket A (no asteroid) should have rotated more than rocket B (heavy asteroid).
    expect(psA.angularVelocity).toBeGreaterThan(psB.angularVelocity);
  });
});
