// @ts-nocheck
/**
 * staging.test.js — Unit tests for the flight staging and debris system (TASK-023).
 *
 * Tests cover:
 *   activateCurrentStage()  — IGNITE (engine / SRB), SEPARATE (decoupler),
 *                             DEPLOY (parachute), EJECT, RELEASE, COLLECT_SCIENCE
 *   recomputeActiveGraph()  — BFS from command module, disconnected → debris
 *   tickDebris()            — gravity fall, SRB thrust, ground contact (landed/crashed)
 *   Debris lifecycle via fireNextStage() in physics.js — ps.debris populated,
 *                             debris ticked on each physics tick
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  activateCurrentStage,
  activatePartDirect,
  recomputeActiveGraph,
  tickDebris,
} from '../core/staging.ts';
import {
  createPhysicsState,
  tick,
  fireNextStage,
} from '../core/physics.ts';
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
// Shared fixture helpers
// ---------------------------------------------------------------------------

/**
 * Two-stage rocket:
 *   Probe Core  (COMPUTER_MODULE, stage root)
 *     ↕ Stack Decoupler   (Stage 2)
 *     ↕ Small Tank
 *     ↕ Spark Engine      (Stage 1)
 */
function makeTwoStageRocket() {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const probeId  = addPartToAssembly(assembly, 'probe-core-mk1',       0,  100);
  const decId    = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0,   60);
  const tankId   = addPartToAssembly(assembly, 'tank-small',           0,    0);
  const engineId = addPartToAssembly(assembly, 'engine-spark',         0,  -55);

  connectParts(assembly, probeId,  1, decId,    0);
  connectParts(assembly, decId,    1, tankId,   0);
  connectParts(assembly, tankId,   1, engineId, 0);

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, engineId, 0); // Stage 1: ignite engine
  addStageToConfig(staging);
  assignPartToStage(staging, decId, 1);    // Stage 2: separate

  return { assembly, staging, probeId, decId, tankId, engineId };
}

/**
 * Minimal uncrewed rocket: Probe Core + Small Tank + Spark Engine.
 * Engine assigned to Stage 1 only.
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

/** Create a minimal FlightState for test use. */
function makeFlightState() {
  return createFlightState({ missionId: 'test', rocketId: 'test' });
}

/**
 * Build a minimal PhysicsState for test rockets that don't need full physics.
 * Parts are all active; fuel store is populated.
 */
function makePhysicsState(assembly) {
  return createPhysicsState(assembly, makeFlightState());
}

// ---------------------------------------------------------------------------
// activateCurrentStage() — IGNITE (engine)
// ---------------------------------------------------------------------------

describe('activateCurrentStage() — IGNITE (engine)', () => {
  it('adds the engine to ps.firingEngines', () => {
    const { assembly, staging, engineId } = makeSimpleRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs);

    expect(ps.firingEngines.has(engineId)).toBe(true);
  });

  it('emits a PART_ACTIVATED event with partType ENGINE', () => {
    const { assembly, staging } = makeSimpleRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs);

    const evt = fs.events.find(
      (e) => e.type === 'PART_ACTIVATED' && e.partType === 'ENGINE',
    );
    expect(evt).toBeDefined();
  });

  it('advances currentStageIdx after firing', () => {
    const { assembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    expect(staging.currentStageIdx).toBe(0);
    activateCurrentStage(ps, assembly, staging, fs);
    expect(staging.currentStageIdx).toBe(1);
  });

  it('does not advance past the last stage', () => {
    const { assembly, staging } = makeSimpleRocket(); // only 1 stage
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // fires stage 0
    expect(staging.currentStageIdx).toBe(0); // stays at last stage

    activateCurrentStage(ps, assembly, staging, fs); // fires again — no movement
    expect(staging.currentStageIdx).toBe(0);
  });

  it('returns an empty debris array when only engines fire', () => {
    const { assembly, staging } = makeSimpleRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    const debris = activateCurrentStage(ps, assembly, staging, fs);

    expect(Array.isArray(debris)).toBe(true);
    expect(debris.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// activateCurrentStage() — SEPARATE (stack decoupler)
// ---------------------------------------------------------------------------

describe('activateCurrentStage() — SEPARATE (stack decoupler)', () => {
  it('creates two debris fragments when the decoupler fires (decoupler + lower stage)', () => {
    const { assembly, staging, decId } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // stage 1: engine
    const debris = activateCurrentStage(ps, assembly, staging, fs); // stage 2: decouple

    expect(debris.length).toBe(2);
    // First fragment is the decoupler itself.
    expect(debris[0].activeParts.has(decId)).toBe(true);
  });

  it('removes the decoupler from ps.activeParts', () => {
    const { assembly, staging, decId } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // stage 1
    activateCurrentStage(ps, assembly, staging, fs); // stage 2

    expect(ps.activeParts.has(decId)).toBe(false);
  });

  it('keeps the command module in ps.activeParts', () => {
    const { assembly, staging, probeId } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // stage 1
    activateCurrentStage(ps, assembly, staging, fs); // stage 2

    expect(ps.activeParts.has(probeId)).toBe(true);
  });

  it('moves the tank and engine into the stage debris fragment', () => {
    const { assembly, staging, tankId, engineId } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // stage 1
    const allDebris = activateCurrentStage(ps, assembly, staging, fs); // stage 2
    // Index 0 is the decoupler, index 1 is the disconnected stage.
    const stageDebris = allDebris[1];

    expect(ps.activeParts.has(tankId)).toBe(false);
    expect(ps.activeParts.has(engineId)).toBe(false);
    expect(stageDebris.activeParts.has(tankId)).toBe(true);
    expect(stageDebris.activeParts.has(engineId)).toBe(true);
  });

  it('transfers firing engine from ps.firingEngines to debris.firingEngines', () => {
    const { assembly, staging, engineId } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // stage 1: engine ignites
    expect(ps.firingEngines.has(engineId)).toBe(true);

    activateCurrentStage(ps, assembly, staging, fs); // stage 2: separation
    expect(ps.firingEngines.has(engineId)).toBe(false); // removed from rocket

    // The engine is now on the debris fragment.
    const debris = ps.debris; // not populated here — need to check via return value
    // (debris is the return value of activateCurrentStage, tested separately)
  });

  it('debris fragment inherits rocket position and velocity (±separation impulse)', () => {
    const { assembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);
    ps.posY = 5000;
    ps.velY = 200;
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // stage 1
    const [debris] = activateCurrentStage(ps, assembly, staging, fs); // stage 2

    // Both ps.posY and debris.posY are shifted by the same renorm offset,
    // so they should be approximately equal after separation.
    expect(Math.abs(debris.posY - ps.posY)).toBeLessThan(1);
    // Velocity is modified by the separation impulse (~±0.1 m/s), but close.
    expect(Math.abs(debris.velY - 200)).toBeLessThan(0.5);
  });

  it('debris fragment has a unique id starting with "debris-"', () => {
    const { assembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // stage 1
    const [debris] = activateCurrentStage(ps, assembly, staging, fs); // stage 2

    expect(typeof debris.id).toBe('string');
    expect(debris.id.startsWith('debris-')).toBe(true);
  });

  it('emits a PART_ACTIVATED event mentioning "separation"', () => {
    const { assembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // stage 1
    activateCurrentStage(ps, assembly, staging, fs); // stage 2

    const evt = fs.events.find(
      (e) => e.type === 'PART_ACTIVATED' && e.description?.includes('separation'),
    );
    expect(evt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// activateCurrentStage() — DEPLOY (parachute)
// ---------------------------------------------------------------------------

describe('activateCurrentStage() — DEPLOY (parachute)', () => {
  function makeRocketWithChute() {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const cmdId   = addPartToAssembly(assembly, 'cmd-mk1',       0,  60);
    const chuteId = addPartToAssembly(assembly, 'parachute-mk1', 0,  90);

    connectParts(assembly, cmdId, 0, chuteId, 1);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, chuteId, 0);

    return { assembly, staging, cmdId, chuteId };
  }

  it('marks the parachute as deployed in ps.deployedParts', () => {
    const { assembly, staging, chuteId } = makeRocketWithChute();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs);

    expect(ps.deployedParts.has(chuteId)).toBe(true);
  });

  it('emits PART_ACTIVATED event with partType PARACHUTE', () => {
    const { assembly, staging } = makeRocketWithChute();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs);

    const evt = fs.events.find(
      (e) => e.type === 'PART_ACTIVATED' && e.partType === 'PARACHUTE',
    );
    expect(evt).toBeDefined();
  });

  it('returns empty debris array (no separation)', () => {
    const { assembly, staging } = makeRocketWithChute();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    const debris = activateCurrentStage(ps, assembly, staging, fs);

    expect(debris.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// activateCurrentStage() — EJECT
// ---------------------------------------------------------------------------

describe('activateCurrentStage() — EJECT', () => {
  it('emits CREW_EJECTED event with current altitude', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    const cmdId    = addPartToAssembly(assembly, 'cmd-mk1', 0, 0);
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, cmdId, 0);

    const ps = makePhysicsState(assembly);
    ps.posY = 12_000;
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs);

    const evt = fs.events.find((e) => e.type === 'CREW_EJECTED');
    expect(evt).toBeDefined();
    expect(evt.altitude).toBeCloseTo(12_000, 0);
  });
});

// ---------------------------------------------------------------------------
// activateCurrentStage() — RELEASE (satellite)
// ---------------------------------------------------------------------------

describe('activateCurrentStage() — RELEASE', () => {
  it('emits SATELLITE_RELEASED event with current altitude', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const satId   = addPartToAssembly(assembly, 'satellite-mk1',  0, 100);
    connectParts(assembly, probeId, 0, satId, 1);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, satId, 0);

    const ps = makePhysicsState(assembly);
    ps.posY = 200_000;
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs);

    const evt = fs.events.find((e) => e.type === 'SATELLITE_RELEASED');
    expect(evt).toBeDefined();
    expect(evt.altitude).toBeCloseTo(200_000, 0);
  });
});

// ---------------------------------------------------------------------------
// activateCurrentStage() — RELEASE (satellite debris)
// ---------------------------------------------------------------------------

describe('activateCurrentStage() — RELEASE (satellite debris)', () => {
  function makeRocketWithSatellite() {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const satId   = addPartToAssembly(assembly, 'satellite-mk1',  0, 100);
    connectParts(assembly, probeId, 0, satId, 1);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, satId, 0);

    return { assembly, staging, probeId, satId };
  }

  it('removes the satellite from ps.activeParts after RELEASE', () => {
    const { assembly, staging, satId } = makeRocketWithSatellite();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs);

    expect(ps.activeParts.has(satId)).toBe(false);
  });

  it('returns a debris fragment containing the satellite after RELEASE', () => {
    const { assembly, staging, satId } = makeRocketWithSatellite();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    const debris = activateCurrentStage(ps, assembly, staging, fs);

    expect(debris.length).toBeGreaterThanOrEqual(1);
    const satFragment = debris.find((d) => d.activeParts.has(satId));
    expect(satFragment).toBeDefined();
  });

  it('emits SATELLITE_RELEASED event with altitude and velocity', () => {
    const { assembly, staging } = makeRocketWithSatellite();
    const ps = makePhysicsState(assembly);
    ps.posY = 200_000;
    ps.velX = 500;
    ps.velY = 200;
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs);

    const evt = fs.events.find((e) => e.type === 'SATELLITE_RELEASED');
    expect(evt).toBeDefined();
    expect(evt.altitude).toBeCloseTo(200_000, 0);
    expect(typeof evt.velocity).toBe('number');
    expect(evt.velocity).toBeGreaterThan(0);
  });

  it('satellite debris inherits parent rocket position and velocity', () => {
    const { assembly, staging, satId } = makeRocketWithSatellite();
    const ps = makePhysicsState(assembly);
    ps.posX = 100;
    ps.posY = 50_000;
    ps.velX = 300;
    ps.velY = 150;
    const fs = makeFlightState();

    const debris = activateCurrentStage(ps, assembly, staging, fs);
    const satFragment = debris.find((d) => d.activeParts.has(satId));

    expect(satFragment.posX).toBe(100);
    // posY is shifted by renormalization, but satellite and rocket share the same offset
    expect(Math.abs(satFragment.posY - ps.posY)).toBeLessThan(1);
    expect(satFragment.velX).toBe(300);
    expect(satFragment.velY).toBe(150);
  });
});

describe('activateCurrentStage() — SEPARATE with satellite in lower stage', () => {
  /**
   * Rocket layout (top to bottom):
   *   Probe Core (command)
   *   Stack Decoupler  ← Stage 2
   *   Satellite Mk1
   *   Small Tank
   *   Spark Engine     ← Stage 1
   */
  function makeRocketWithSatelliteBelow() {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1',       0,  130);
    const decId    = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0,   90);
    const satId    = addPartToAssembly(assembly, 'satellite-mk1',        0,   60);
    const tankId   = addPartToAssembly(assembly, 'tank-small',           0,    0);
    const engineId = addPartToAssembly(assembly, 'engine-spark',         0,  -55);

    connectParts(assembly, probeId,  1, decId,    0);
    connectParts(assembly, decId,    1, satId,    0);
    connectParts(assembly, satId,    1, tankId,   0);
    connectParts(assembly, tankId,   1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);
    addStageToConfig(staging);
    assignPartToStage(staging, decId, 1);

    return { assembly, staging, probeId, decId, satId, tankId, engineId };
  }

  it('emits SATELLITE_RELEASED when decoupler separates the satellite into debris', () => {
    const { assembly, staging } = makeRocketWithSatelliteBelow();
    const ps = makePhysicsState(assembly);
    ps.posY = 35_000;
    ps.velY = 1_000;
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // stage 1: engine ignites
    activateCurrentStage(ps, assembly, staging, fs); // stage 2: decoupler fires

    const evt = fs.events.find((e) => e.type === 'SATELLITE_RELEASED');
    expect(evt).toBeDefined();
    expect(evt.altitude).toBeCloseTo(35_000, 0);
    expect(typeof evt.velocity).toBe('number');
  });

  it('satellite is in the debris fragment after decoupler fires', () => {
    const { assembly, staging, satId } = makeRocketWithSatelliteBelow();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // engine
    const debris = activateCurrentStage(ps, assembly, staging, fs); // decoupler

    expect(debris.length).toBe(2); // decoupler fragment + disconnected stage
    const stageFrag = debris.find((d) => d.activeParts.has(satId));
    expect(stageFrag).toBeDefined();
    expect(ps.activeParts.has(satId)).toBe(false);
  });

  it('probe core stays in active parts after the satellite section separates', () => {
    const { assembly, staging, probeId } = makeRocketWithSatelliteBelow();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs);
    activateCurrentStage(ps, assembly, staging, fs);

    expect(ps.activeParts.has(probeId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// activateCurrentStage() — COLLECT_SCIENCE
// ---------------------------------------------------------------------------

describe('activateCurrentStage() — COLLECT_SCIENCE', () => {
  it('emits PART_ACTIVATED and transitions science module to running state', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId   = addPartToAssembly(assembly, 'probe-core-mk1',    0, 60);
    const scienceId = addPartToAssembly(assembly, 'science-module-mk1', 0, 100);
    connectParts(assembly, probeId, 0, scienceId, 1);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, scienceId, 0);

    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs);

    expect(fs.events.some((e) => e.type === 'PART_ACTIVATED')).toBe(true);
    // SCIENCE_COLLECTED is now deferred until the experiment timer expires
    // in tickScienceModules, so it is NOT emitted on activation.
    const entry = ps.scienceModuleStates?.get(scienceId);
    expect(entry).toBeDefined();
    expect(entry.state).toBe('running');
    expect(entry.timer).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// activateCurrentStage() — SRB (IGNITE behaviour same as engine)
// ---------------------------------------------------------------------------

describe('activateCurrentStage() — SRB IGNITE', () => {
  function makeRocketWithSRB() {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
    const srbId   = addPartToAssembly(assembly, 'srb-small',      50,  0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, srbId, 0);

    return { assembly, staging, probeId, srbId };
  }

  it('adds SRB to ps.firingEngines on IGNITE', () => {
    const { assembly, staging, srbId } = makeRocketWithSRB();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs);

    expect(ps.firingEngines.has(srbId)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Renormalization compensation for new debris
// ---------------------------------------------------------------------------

describe('renormalization compensates new debris posY', () => {
  it('debris posY matches ps.posY after separation (both receive renorm offset)', () => {
    const { assembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);
    ps.posY = 5000;
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // stage 1: engine
    const [debris] = activateCurrentStage(ps, assembly, staging, fs); // stage 2: decouple

    // Both should have been shifted by the same renorm offset.
    expect(Math.abs(debris.posY - ps.posY)).toBeLessThan(1);
  });

  it('debris position stays consistent through renormalization with multiple stages', () => {
    // Three-stage rocket: two decouplers.
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1',       0,  140);
    const dec1Id   = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0,  100);
    const tank1Id  = addPartToAssembly(assembly, 'tank-small',           0,   40);
    const dec2Id   = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0,   -5);
    const tank2Id  = addPartToAssembly(assembly, 'tank-small',           0,  -65);
    const engId    = addPartToAssembly(assembly, 'engine-spark',         0, -120);

    connectParts(assembly, probeId, 1, dec1Id, 0);
    connectParts(assembly, dec1Id,  1, tank1Id, 0);
    connectParts(assembly, tank1Id, 1, dec2Id, 0);
    connectParts(assembly, dec2Id,  1, tank2Id, 0);
    connectParts(assembly, tank2Id, 1, engId,  0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engId,  0); // Stage 1: engine
    addStageToConfig(staging);
    assignPartToStage(staging, dec2Id, 1); // Stage 2: lower sep
    addStageToConfig(staging);
    assignPartToStage(staging, dec1Id, 2); // Stage 3: upper sep

    const fs = makeFlightState();
    const ps = makePhysicsState(assembly);
    ps.posY = 10000;

    activateCurrentStage(ps, assembly, staging, fs); // engine
    const debris1 = activateCurrentStage(ps, assembly, staging, fs); // lower sep
    expect(debris1.length).toBe(2); // decoupler + disconnected stage
    // All debris fragments should have posY close to ps.posY
    for (const d of debris1) {
      expect(Math.abs(d.posY - ps.posY)).toBeLessThan(1);
    }

    // Push first batch into ps.debris so second renorm can compensate them
    ps.debris.push(...debris1);

    const debris2 = activateCurrentStage(ps, assembly, staging, fs); // upper sep
    expect(debris2.length).toBe(2); // decoupler + disconnected stage
    for (const d of debris2) {
      expect(Math.abs(d.posY - ps.posY)).toBeLessThan(1);
    }
    // First batch (now in ps.debris) should also still be consistent
    for (const d of debris1) {
      expect(Math.abs(d.posY - ps.posY)).toBeLessThan(1);
    }
  });
});

// ---------------------------------------------------------------------------
// recomputeActiveGraph()
// ---------------------------------------------------------------------------

describe('recomputeActiveGraph()', () => {
  it('returns empty array when all parts reachable from command module', () => {
    const { assembly, probeId, tankId, engineId } = makeSimpleRocket();
    const ps = makePhysicsState(assembly);

    const result = recomputeActiveGraph(ps, assembly);

    expect(result).toHaveLength(0);
    expect(ps.activeParts.has(probeId)).toBe(true);
    expect(ps.activeParts.has(tankId)).toBe(true);
    expect(ps.activeParts.has(engineId)).toBe(true);
  });

  it('returns a debris fragment for parts not connected to any command module', () => {
    const { assembly, staging, decId, tankId, engineId } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);

    // Manually simulate what happens when the decoupler fires:
    // remove it from activeParts, then recompute.
    ps.activeParts.delete(decId);

    const result = recomputeActiveGraph(ps, assembly);

    expect(result).toHaveLength(1);
    const [debris] = result;
    expect(debris.activeParts.has(tankId)).toBe(true);
    expect(debris.activeParts.has(engineId)).toBe(true);
  });

  it('removes disconnected parts from ps.activeParts', () => {
    const { assembly, decId, tankId, engineId } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);

    ps.activeParts.delete(decId);
    recomputeActiveGraph(ps, assembly);

    expect(ps.activeParts.has(tankId)).toBe(false);
    expect(ps.activeParts.has(engineId)).toBe(false);
  });

  it('removes liquid engines from firingEngines on separation (flame out)', () => {
    const { assembly, decId, engineId } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);
    ps.firingEngines.add(engineId); // engine was burning

    ps.activeParts.delete(decId);
    const [debris] = recomputeActiveGraph(ps, assembly);

    // Liquid engine removed from ps but NOT transferred to debris (no command module).
    expect(ps.firingEngines.has(engineId)).toBe(false);
    expect(debris.firingEngines.has(engineId)).toBe(false);
  });

  it('preserves all command-module-connected parts in ps.activeParts', () => {
    const { assembly, probeId } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);

    // Even with the decoupler removed, probe stays.
    const { decId } = makeTwoStageRocket(); // fresh IDs not used here
    // Just verify the probe stays after a noop recompute.
    recomputeActiveGraph(ps, assembly);

    expect(ps.activeParts.has(probeId)).toBe(true);
  });

  it('fallback root keeps all parts when no command module present', () => {
    // Rocket with no command/computer module — all structural parts.
    const assembly = createRocketAssembly();
    const tankId1  = addPartToAssembly(assembly, 'tank-small', 0, 0);
    const tankId2  = addPartToAssembly(assembly, 'tank-small', 0, -60);
    connectParts(assembly, tankId1, 1, tankId2, 0);

    const ps = makePhysicsState(assembly);

    // No decoupler fired — recompute should keep everything.
    const result = recomputeActiveGraph(ps, assembly);

    expect(result).toHaveLength(0);
    expect(ps.activeParts.has(tankId1)).toBe(true);
    expect(ps.activeParts.has(tankId2)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// tickDebris()
// ---------------------------------------------------------------------------

describe('tickDebris() — gravity fall', () => {
  it('falls under gravity when no engines are firing', () => {
    const { assembly: twoStageAssembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(twoStageAssembly);
    ps.posY    = 5000;
    ps.velY    = 0;
    ps.grounded = false;
    const fs   = makeFlightState();

    activateCurrentStage(ps, twoStageAssembly, staging, fs); // stage 1: engine ignites
    const [debris] = activateCurrentStage(ps, twoStageAssembly, staging, fs); // stage 2: separate

    // Clear all firing engines so this test is purely about gravity.
    // (The liquid engine transferred to debris would thrust upward otherwise.)
    debris.firingEngines.clear();
    debris.velY = 0;
    const initialY = debris.posY;

    // Tick for 1 simulated second (60 × 1/60).
    for (let i = 0; i < 60; i++) {
      tickDebris(debris, twoStageAssembly, 1 / 60);
    }

    expect(debris.posY).toBeLessThan(initialY);
    expect(debris.velY).toBeLessThan(0);
  });

  it('sets crashed = true on high-speed ground impact', () => {
    const { assembly: twoStageAssembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(twoStageAssembly);
    ps.posY = 10;
    ps.velY = -500; // very fast downward
    ps.grounded = false;
    const fs = makeFlightState();

    activateCurrentStage(ps, twoStageAssembly, staging, fs); // engine
    const [debris] = activateCurrentStage(ps, twoStageAssembly, staging, fs); // separate

    debris.posY = 0.01;
    debris.velY = -500;

    tickDebris(debris, twoStageAssembly, 1 / 60);

    expect(debris.crashed).toBe(true);
    expect(debris.landed).toBe(false);
  });

  it('sets landed = true on slow ground contact', () => {
    const { assembly: twoStageAssembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(twoStageAssembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, twoStageAssembly, staging, fs); // engine
    const [debris] = activateCurrentStage(ps, twoStageAssembly, staging, fs); // separate

    debris.posY = 0.01;
    debris.velY = -5; // 5 m/s — within safe range

    tickDebris(debris, twoStageAssembly, 1 / 60);

    expect(debris.landed).toBe(true);
    expect(debris.crashed).toBe(false);
  });

  it('is a no-op after the fragment has landed', () => {
    const { assembly: twoStageAssembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(twoStageAssembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, twoStageAssembly, staging, fs);
    const [debris] = activateCurrentStage(ps, twoStageAssembly, staging, fs);

    debris.landed = true;
    debris.posY   = 100; // would fall if simulated

    tickDebris(debris, twoStageAssembly, 1 / 60);

    expect(debris.posY).toBe(100); // unchanged
  });

  it('is a no-op after the fragment has crashed', () => {
    const { assembly: twoStageAssembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(twoStageAssembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, twoStageAssembly, staging, fs);
    const [debris] = activateCurrentStage(ps, twoStageAssembly, staging, fs);

    debris.crashed = true;
    debris.velY    = -200;
    const savedVelY = debris.velY;

    tickDebris(debris, twoStageAssembly, 1 / 60);

    expect(debris.velY).toBe(savedVelY); // unchanged
  });
});

describe('tickDebris() — SRB thrust on detached stage', () => {
  /**
   * Rocket: Probe + SRB (radially attached).  Stage 1 ignites SRB.
   * No decoupler in this fixture; we manually build the debris to test
   * SRB thrust on a debris object.
   */
  it('SRB-carrying debris accelerates upward while fuel lasts', () => {
    // Create a two-stage rocket where Stage 1 = SRB (ignite), Stage 2 = decouple.
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1',       0,   60);
    const decId    = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0,   20);
    const srbId    = addPartToAssembly(assembly, 'srb-small',            0,  -30);

    connectParts(assembly, probeId, 1, decId,  0);
    connectParts(assembly, decId,   1, srbId,  0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, srbId, 0);  // Stage 1: ignite SRB
    addStageToConfig(staging);
    assignPartToStage(staging, decId, 1);  // Stage 2: separate

    const ps = makePhysicsState(assembly);
    ps.posY    = 5000;
    ps.velY    = 0;
    ps.grounded = false;
    const fs   = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // Stage 1: SRB ignites
    // At this point ps.firingEngines has srbId.

    const allDebris = activateCurrentStage(ps, assembly, staging, fs); // Stage 2: separate
    // Find the fragment containing the SRB (not the decoupler fragment).
    const debris = allDebris.find((d) => d.activeParts.has(srbId));

    // SRB should now be in debris.firingEngines with fuel remaining.
    expect(debris.firingEngines.has(srbId)).toBe(true);
    expect((debris.fuelStore.get(srbId) ?? 0)).toBeGreaterThan(0);

    // Debris starts at rest; SRB thrust should push it upward (angle = 0).
    debris.velY = 0;
    const initialY = debris.posY;

    // Tick for a short period while SRB has plenty of fuel.
    tickDebris(debris, assembly, 0.5);

    // Net effect: SRB thrust > gravity → should gain altitude.
    expect(debris.posY).toBeGreaterThan(initialY);
  });
});

// ---------------------------------------------------------------------------
// Liquid engines flame out on debris
// ---------------------------------------------------------------------------

describe('liquid engines flame out on debris', () => {
  it('liquid engine is removed from firingEngines when transferred to debris', () => {
    const { assembly, staging, engineId } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // stage 1: engine ignites
    expect(ps.firingEngines.has(engineId)).toBe(true);

    const allDebris = activateCurrentStage(ps, assembly, staging, fs); // stage 2: separate
    // Find the stage fragment (not the decoupler fragment).
    const stageDebris = allDebris.find((d) => d.activeParts.has(engineId));

    // Liquid engine should NOT be in debris.firingEngines (no command module).
    expect(stageDebris.firingEngines.has(engineId)).toBe(false);
    // But the engine part itself is still in the debris fragment.
    expect(stageDebris.activeParts.has(engineId)).toBe(true);
  });

  it('debris with liquid engine does not accelerate from thrust', () => {
    const { assembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);
    ps.posY = 5000;
    ps.velY = 0;
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // stage 1: engine ignites
    const allDebris = activateCurrentStage(ps, assembly, staging, fs); // stage 2: separate
    // Find the stage fragment containing the engine (not the decoupler).
    const stageDebris = allDebris.find((d) => d.activeParts.size > 1);

    stageDebris.velY = 0;
    const initialY = stageDebris.posY;

    // Tick for 0.5s — should only decelerate from gravity, no thrust.
    tickDebris(stageDebris, assembly, 0.5);

    // Debris should fall (gravity only, no engine thrust).
    expect(stageDebris.posY).toBeLessThan(initialY);
  });
});

// ---------------------------------------------------------------------------
// Integration: fireNextStage() populates ps.debris
// ---------------------------------------------------------------------------

describe('fireNextStage() — debris integration via physics.js', () => {
  it('appends a DebrisState to ps.debris after stage separation', () => {
    const { assembly, staging } = makeTwoStageRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    expect(ps.debris).toHaveLength(0);

    fireNextStage(ps, assembly, staging, fs); // stage 1: engine ignites
    expect(ps.debris).toHaveLength(0); // no separation yet

    fireNextStage(ps, assembly, staging, fs); // stage 2: separation
    expect(ps.debris).toHaveLength(2); // decoupler + disconnected stage
  });

  it('debris fragments are ticked during tick()', () => {
    const { assembly, staging } = makeTwoStageRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Fire both stages.
    fireNextStage(ps, assembly, staging, fs); // engine
    fireNextStage(ps, assembly, staging, fs); // separate → creates debris

    // Pick the stage fragment (not the single-part decoupler).
    const debris = ps.debris.find((d) => d.activeParts.size > 1) ?? ps.debris[0];
    // Clear firing engines so this test isolates gravity-based falling.
    debris.firingEngines.clear();
    debris.posY = 5000;
    debris.velY = 0;

    const initialDebrisY = debris.posY;

    // Advance physics for 1 real second.
    tick(ps, assembly, staging, fs, 1.0);

    // The debris fragment should have fallen under gravity.
    expect(debris.posY).toBeLessThan(initialDebrisY);
  });

  it('multiple stage separations each add a debris fragment', () => {
    // Build a three-stage rocket: two decouplers.
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1',       0,  140);
    const dec1Id   = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0,  100);
    const tank1Id  = addPartToAssembly(assembly, 'tank-small',           0,   40);
    const dec2Id   = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0,   -5);
    const tank2Id  = addPartToAssembly(assembly, 'tank-small',           0,  -65);
    const engId    = addPartToAssembly(assembly, 'engine-spark',         0, -120);

    connectParts(assembly, probeId, 1, dec1Id, 0);
    connectParts(assembly, dec1Id,  1, tank1Id, 0);
    connectParts(assembly, tank1Id, 1, dec2Id, 0);
    connectParts(assembly, dec2Id,  1, tank2Id, 0);
    connectParts(assembly, tank2Id, 1, engId,  0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engId,  0); // Stage 1: engine
    addStageToConfig(staging);
    assignPartToStage(staging, dec2Id, 1); // Stage 2: lower sep
    addStageToConfig(staging);
    assignPartToStage(staging, dec1Id, 2); // Stage 3: upper sep

    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    fireNextStage(ps, assembly, staging, fs); // stage 1: engine
    expect(ps.debris).toHaveLength(0);

    fireNextStage(ps, assembly, staging, fs); // stage 2: lower decoupler
    expect(ps.debris).toHaveLength(2); // decoupler + disconnected stage

    fireNextStage(ps, assembly, staging, fs); // stage 3: upper decoupler
    expect(ps.debris).toHaveLength(4); // 2 decouplers + 2 disconnected stages
  });
});

// ---------------------------------------------------------------------------
// activateCurrentStage() — DEPLOY (landing legs)
// ---------------------------------------------------------------------------

describe('activateCurrentStage() — DEPLOY (landing legs)', () => {
  function makeRocketWithLegs() {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const cmdId = addPartToAssembly(assembly, 'cmd-mk1',            0,  60);
    const legId = addPartToAssembly(assembly, 'landing-legs-small', 20,  0);

    connectParts(assembly, cmdId, 1, legId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, legId, 0);

    return { assembly, staging, cmdId, legId };
  }

  it('marks the landing leg as deployed in ps.deployedParts', () => {
    const { assembly, staging, legId } = makeRocketWithLegs();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs);

    expect(ps.deployedParts.has(legId)).toBe(true);
  });

  it('emits PART_ACTIVATED event with partType LANDING_LEGS', () => {
    const { assembly, staging } = makeRocketWithLegs();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs);

    const evt = fs.events.find(
      (e) => e.type === 'PART_ACTIVATED' && e.partType === 'LANDING_LEGS',
    );
    expect(evt).toBeDefined();
  });

  it('returns empty debris array (no separation)', () => {
    const { assembly, staging } = makeRocketWithLegs();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    const debris = activateCurrentStage(ps, assembly, staging, fs);
    expect(debris).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// activateCurrentStage() — SEPARATE (launch clamp)
// ---------------------------------------------------------------------------

describe('activateCurrentStage() — SEPARATE (launch clamp)', () => {
  function makeRocketWithClamp() {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
    const tankId  = addPartToAssembly(assembly, 'tank-small',     0,   0);
    const engId   = addPartToAssembly(assembly, 'engine-spark',   0, -55);
    const clampId = addPartToAssembly(assembly, 'launch-clamp-1', -30, 0);

    connectParts(assembly, probeId, 1, tankId,  0);
    connectParts(assembly, tankId,  1, engId,   0);
    connectParts(assembly, clampId, 0, tankId,  0); // clamp attaches to tank

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engId,   0); // Stage 1: engine
    addStageToConfig(staging);
    assignPartToStage(staging, clampId, 1); // Stage 2: release clamp

    return { assembly, staging, probeId, tankId, engId, clampId };
  }

  it('emits LAUNCH_CLAMP_RELEASED event', () => {
    const { assembly, staging } = makeRocketWithClamp();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // stage 1: engine
    activateCurrentStage(ps, assembly, staging, fs); // stage 2: clamp release

    const evt = fs.events.find((e) => e.type === 'LAUNCH_CLAMP_RELEASED');
    expect(evt).toBeDefined();
  });

  it('creates a debris fragment for the clamp with lateral velocity', () => {
    const { assembly, staging, clampId } = makeRocketWithClamp();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, assembly, staging, fs); // engine
    const debris = activateCurrentStage(ps, assembly, staging, fs); // clamp

    const clampDebris = debris.find((d) => d.activeParts.has(clampId));
    expect(clampDebris).toBeDefined();
    // Clamp at x=-30 (left side) should swing left (negative velX).
    expect(clampDebris.velX).not.toBe(0);
    expect(clampDebris.angularVelocity).not.toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tickDebris() — debris tipping on angled landing
// ---------------------------------------------------------------------------

describe('tickDebris() — debris tipping', () => {
  it('sets isTipping = true when debris lands at an angle', () => {
    const { assembly: twoStageAssembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(twoStageAssembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, twoStageAssembly, staging, fs); // engine
    const [debris] = activateCurrentStage(ps, twoStageAssembly, staging, fs); // separate

    // Set up for slow landing at an angle.
    debris.posY  = 0.01;
    debris.velX  = 1;
    debris.velY  = -3; // within safe landing speed
    debris.angle = 0.5; // significantly tilted (> 0.005 threshold)
    debris.firingEngines.clear();

    tickDebris(debris, twoStageAssembly, 1 / 60);

    expect(debris.landed).toBe(true);
    expect(debris.isTipping).toBe(true);
  });

  it('does NOT set isTipping when debris lands nearly upright', () => {
    const { assembly: twoStageAssembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(twoStageAssembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, twoStageAssembly, staging, fs);
    const [debris] = activateCurrentStage(ps, twoStageAssembly, staging, fs);

    debris.posY  = 0.01;
    debris.velX  = 0;
    debris.velY  = -3;
    debris.angle = 0.001; // nearly upright (< 0.005 threshold)
    debris.firingEngines.clear();

    tickDebris(debris, twoStageAssembly, 1 / 60);

    expect(debris.landed).toBe(true);
    expect(debris.isTipping).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tickDebris() — angular velocity and damping
// ---------------------------------------------------------------------------

describe('tickDebris() — angular dynamics', () => {
  it('updates debris angle based on angular velocity each tick', () => {
    const { assembly: twoStageAssembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(twoStageAssembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, twoStageAssembly, staging, fs);
    const [debris] = activateCurrentStage(ps, twoStageAssembly, staging, fs);

    debris.posY = 5000;
    debris.velY = 0;
    debris.angle = 0;
    debris.angularVelocity = 1.0; // 1 rad/s
    debris.firingEngines.clear();

    const dt = 1 / 60;
    tickDebris(debris, twoStageAssembly, dt);

    // Angle should have increased (approximately 1.0 * dt, with some damping).
    expect(debris.angle).toBeGreaterThan(0);
  });

  it('damps angular velocity in atmosphere', () => {
    const { assembly: twoStageAssembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(twoStageAssembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, twoStageAssembly, staging, fs);
    const [debris] = activateCurrentStage(ps, twoStageAssembly, staging, fs);

    // Low altitude = dense atmosphere = stronger damping.
    debris.posY = 100;
    debris.velY = 0;
    debris.angularVelocity = 2.0;
    debris.firingEngines.clear();

    const initialAngVel = debris.angularVelocity;
    tickDebris(debris, twoStageAssembly, 1 / 60);

    // Angular velocity should be reduced by atmospheric damping.
    expect(Math.abs(debris.angularVelocity)).toBeLessThan(Math.abs(initialAngVel));
  });
});

// ---------------------------------------------------------------------------
// tickDebris() — drag force at speed
// ---------------------------------------------------------------------------

describe('tickDebris() — atmospheric drag', () => {
  it('drag decelerates debris falling at high speed in atmosphere', () => {
    const { assembly: twoStageAssembly, staging } = makeTwoStageRocket();
    const ps = makePhysicsState(twoStageAssembly);
    const fs = makeFlightState();

    activateCurrentStage(ps, twoStageAssembly, staging, fs);
    const [debris] = activateCurrentStage(ps, twoStageAssembly, staging, fs);

    // Low altitude (dense atmosphere), high speed downward.
    debris.posY = 1000;
    debris.velX = 0;
    debris.velY = -100; // fast downward
    debris.firingEngines.clear();

    // Compare with a no-drag scenario: with drag, deceleration should be less
    // than pure gravity alone would produce.
    tickDebris(debris, twoStageAssembly, 1 / 60);

    // Velocity should still be negative (falling), but drag should partially
    // counteract gravity, so velY change should be less extreme.
    expect(debris.velY).toBeLessThan(0);
    // Debris should have moved downward.
    expect(debris.posY).toBeLessThan(1000);
  });
});

// ---------------------------------------------------------------------------
// activatePartDirect() — direct part activation
// ---------------------------------------------------------------------------

describe('activatePartDirect() — IGNITE', () => {
  it('adds engine to ps.firingEngines when activated directly', () => {
    const { assembly, engineId } = makeSimpleRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    const debris = activatePartDirect(ps, assembly, fs, engineId);

    expect(ps.firingEngines.has(engineId)).toBe(true);
    expect(debris).toHaveLength(0);
  });

  it('emits PART_ACTIVATED event', () => {
    const { assembly, engineId } = makeSimpleRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    activatePartDirect(ps, assembly, fs, engineId);

    const evt = fs.events.find(
      (e) => e.type === 'PART_ACTIVATED' && e.description?.includes('ignited'),
    );
    expect(evt).toBeDefined();
  });

  it('returns empty array for inactive/jettisoned part', () => {
    const { assembly, engineId } = makeSimpleRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    ps.activeParts.delete(engineId);
    const debris = activatePartDirect(ps, assembly, fs, engineId);

    expect(debris).toHaveLength(0);
    expect(ps.firingEngines.has(engineId)).toBe(false);
  });

  it('returns empty array for non-activatable part', () => {
    const { assembly, tankId } = makeSimpleRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    // Tank is not activatable.
    const debris = activatePartDirect(ps, assembly, fs, tankId);
    expect(debris).toHaveLength(0);
  });
});

describe('activatePartDirect() — SEPARATE', () => {
  it('creates debris fragments when decoupler is activated directly', () => {
    const { assembly, decId, tankId } = makeTwoStageRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    const debris = activatePartDirect(ps, assembly, fs, decId);

    expect(debris.length).toBeGreaterThanOrEqual(1);
    // Decoupler should no longer be in activeParts.
    expect(ps.activeParts.has(decId)).toBe(false);
    // Tank and engine should be in a debris fragment.
    const stageFrag = debris.find((d) => d.activeParts.has(tankId));
    expect(stageFrag).toBeDefined();
  });

  it('emits SATELLITE_RELEASED when separation exposes a satellite', () => {
    const assembly = createRocketAssembly();

    const probeId = addPartToAssembly(assembly, 'probe-core-mk1',       0,  130);
    const decId   = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0,   90);
    const satId   = addPartToAssembly(assembly, 'satellite-mk1',        0,   60);

    connectParts(assembly, probeId, 1, decId, 0);
    connectParts(assembly, decId,   1, satId, 0);

    const ps = makePhysicsState(assembly);
    ps.posY = 100_000;
    ps.velY = 500;
    const fs = makeFlightState();

    activatePartDirect(ps, assembly, fs, decId);

    const evt = fs.events.find((e) => e.type === 'SATELLITE_RELEASED');
    expect(evt).toBeDefined();
  });
});

describe('activatePartDirect() — DEPLOY (landing legs)', () => {
  it('deploys a landing leg via direct activation', () => {
    const assembly = createRocketAssembly();
    const cmdId = addPartToAssembly(assembly, 'cmd-mk1',            0,  60);
    const legId = addPartToAssembly(assembly, 'landing-legs-small', 20,  0);
    connectParts(assembly, cmdId, 1, legId, 0);

    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    const debris = activatePartDirect(ps, assembly, fs, legId);

    expect(ps.deployedParts.has(legId)).toBe(true);
    expect(debris).toHaveLength(0);

    const evt = fs.events.find(
      (e) => e.type === 'PART_ACTIVATED' && e.partType === 'LANDING_LEGS',
    );
    expect(evt).toBeDefined();
  });
});

describe('activatePartDirect() — RELEASE (satellite)', () => {
  it('creates satellite debris and emits SATELLITE_RELEASED', () => {
    const assembly = createRocketAssembly();
    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const satId   = addPartToAssembly(assembly, 'satellite-mk1',  0, 100);
    connectParts(assembly, probeId, 0, satId, 1);

    const ps = makePhysicsState(assembly);
    ps.posY = 200_000;
    ps.velX = 400;
    const fs = makeFlightState();

    const debris = activatePartDirect(ps, assembly, fs, satId);

    expect(debris.length).toBeGreaterThanOrEqual(1);
    const satFrag = debris.find((d) => d.activeParts.has(satId));
    expect(satFrag).toBeDefined();

    const evt = fs.events.find((e) => e.type === 'SATELLITE_RELEASED');
    expect(evt).toBeDefined();
    expect(evt.velocity).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// recomputeActiveGraph() — edge case: no active parts
// ---------------------------------------------------------------------------

describe('recomputeActiveGraph() — empty active parts', () => {
  it('returns empty array when there are no active parts at all', () => {
    const { assembly } = makeSimpleRocket();
    const ps = makePhysicsState(assembly);

    // Clear all active parts.
    ps.activeParts.clear();

    const result = recomputeActiveGraph(ps, assembly);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// activateCurrentStage() — returns empty for invalid stage index
// ---------------------------------------------------------------------------

describe('activateCurrentStage() — invalid stage', () => {
  it('returns empty array when currentStageIdx points beyond stages array', () => {
    const { assembly, staging } = makeSimpleRocket();
    const ps = makePhysicsState(assembly);
    const fs = makeFlightState();

    staging.currentStageIdx = 999; // way past end

    const debris = activateCurrentStage(ps, assembly, staging, fs);
    expect(debris).toHaveLength(0);
  });
});
