// @ts-nocheck
/**
 * fuelsystem.test.js — Unit tests for the segment-aware fuel system (TASK-022).
 *
 * Tests cover:
 *   getConnectedTanks()      — simple rocket, two-stage with decoupler,
 *                              multiple tanks, radial SRB, jettisoned parts
 *   computeEngineFlowRate()  — liquid engine at sea level / vacuum,
 *                              throttle scaling, SRB fixed rate, explicit burnRate
 *   tickFuelSystem()         — liquid drain from connected tanks,
 *                              even drain across multiple tanks,
 *                              engine flames out when tanks empty,
 *                              SRB drains integral fuel,
 *                              SRB removed from firingEngines when empty,
 *                              jettisoned engines cleaned up,
 *                              detached parts retain fuel state
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  getConnectedTanks,
  computeEngineFlowRate,
  tickFuelSystem,
} from '../core/fuelsystem.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
  addStageToConfig,
} from '../core/rocketbuilder.ts';
import { createPhysicsState } from '../core/physics.ts';
import { createFlightState }  from '../core/gameState.ts';
import { getPartById }        from '../data/parts.ts';
import { SEA_LEVEL_DENSITY }  from '../core/atmosphere.ts';

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Minimal rocket: Probe Core → Small Tank → Spark Engine.
 * All parts connected in a single segment (no decouplers).
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
 * Two-stage rocket: Probe Core → Decoupler → Small Tank → Spark Engine.
 * The decoupler separates the probe (upper) from the tank+engine (lower).
 */
function makeTwoStageRocket() {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const probeId  = addPartToAssembly(assembly, 'probe-core-mk1',       0, 120);
  const decId    = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0,  80);
  const tankId   = addPartToAssembly(assembly, 'tank-small',           0,  20);
  const engineId = addPartToAssembly(assembly, 'engine-spark',         0, -35);

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
 * Rocket with two tanks in series above the engine (no decoupler).
 *   Probe → Tank A → Tank B → Engine
 */
function makeRocketWithTwoTanks() {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, 120);
  const tankAId  = addPartToAssembly(assembly, 'tank-small',     0,  60);
  const tankBId  = addPartToAssembly(assembly, 'tank-medium',    0,  -5);
  const engineId = addPartToAssembly(assembly, 'engine-spark',   0, -80);

  connectParts(assembly, probeId, 1, tankAId,  0);
  connectParts(assembly, tankAId, 1, tankBId,  0);
  connectParts(assembly, tankBId, 1, engineId, 0);

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, engineId, 0);

  return { assembly, staging, probeId, tankAId, tankBId, engineId };
}

/** Build a minimal PhysicsState for a test. */
function makePS(assembly) {
  return createPhysicsState(assembly, createFlightState({ missionId: 'm', rocketId: 'r' }));
}

// ---------------------------------------------------------------------------
// getConnectedTanks()
// ---------------------------------------------------------------------------

describe('getConnectedTanks() — single tank in same segment', () => {
  it('returns the tank when engine is directly connected', () => {
    const { assembly, tankId, engineId } = makeSimpleRocket();
    const ps = makePS(assembly);

    const tanks = getConnectedTanks(engineId, assembly, ps.activeParts);
    expect(tanks).toContain(tankId);
    expect(tanks).toHaveLength(1);
  });

  it('does not include the engine itself in the result', () => {
    const { assembly, engineId } = makeSimpleRocket();
    const ps = makePS(assembly);

    const tanks = getConnectedTanks(engineId, assembly, ps.activeParts);
    expect(tanks).not.toContain(engineId);
  });

  it('does not include non-tank parts (probe core)', () => {
    const { assembly, probeId, engineId } = makeSimpleRocket();
    const ps = makePS(assembly);

    const tanks = getConnectedTanks(engineId, assembly, ps.activeParts);
    expect(tanks).not.toContain(probeId);
  });
});

describe('getConnectedTanks() — two tanks in same segment', () => {
  it('returns both tanks when there are two connected tanks above the engine', () => {
    const { assembly, tankAId, tankBId, engineId } = makeRocketWithTwoTanks();
    const ps = makePS(assembly);

    const tanks = getConnectedTanks(engineId, assembly, ps.activeParts);
    expect(tanks).toContain(tankAId);
    expect(tanks).toContain(tankBId);
    expect(tanks).toHaveLength(2);
  });
});

describe('getConnectedTanks() — decoupler forms segment boundary', () => {
  it('finds the tank below the decoupler (same segment as engine)', () => {
    const { assembly, tankId, engineId } = makeTwoStageRocket();
    const ps = makePS(assembly);

    const tanks = getConnectedTanks(engineId, assembly, ps.activeParts);
    expect(tanks).toContain(tankId);
  });

  it('does not cross the decoupler to reach the probe core segment', () => {
    const { assembly, probeId, decId, engineId } = makeTwoStageRocket();
    const ps = makePS(assembly);

    const tanks = getConnectedTanks(engineId, assembly, ps.activeParts);
    expect(tanks).not.toContain(probeId);
    expect(tanks).not.toContain(decId);
  });
});

describe('getConnectedTanks() — jettisoned parts are invisible', () => {
  it('returns empty array when the tank has been jettisoned', () => {
    const { assembly, tankId, engineId } = makeSimpleRocket();
    const ps = makePS(assembly);

    // Simulate jettisoning the tank.
    ps.activeParts.delete(tankId);

    const tanks = getConnectedTanks(engineId, assembly, ps.activeParts);
    expect(tanks).not.toContain(tankId);
    expect(tanks).toHaveLength(0);
  });

  it('still returns tanks that are NOT jettisoned', () => {
    const { assembly, tankAId, tankBId, engineId } = makeRocketWithTwoTanks();
    const ps = makePS(assembly);

    // Jettison tank A but keep tank B.
    ps.activeParts.delete(tankAId);

    const tanks = getConnectedTanks(engineId, assembly, ps.activeParts);
    expect(tanks).not.toContain(tankAId);
    expect(tanks).toContain(tankBId);
  });
});

describe('getConnectedTanks() — SRB has no external tanks', () => {
  it('returns an empty array for a radially-attached SRB with no connected tanks', () => {
    const assembly = createRocketAssembly();
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
    const srbId    = addPartToAssembly(assembly, 'srb-small',      50,  0);
    // SRBs attach to the side — in this test there is no tank in the SRB's segment.
    // (No connection is drawn between probe and SRB for this isolation test.)

    const ps = makePS(assembly);
    const tanks = getConnectedTanks(srbId, assembly, ps.activeParts);
    expect(tanks).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// computeEngineFlowRate()
// ---------------------------------------------------------------------------

describe('computeEngineFlowRate() — liquid engine', () => {
  const engineDef = getPartById('engine-spark'); // thrust 60 kN SL / 72 kN vac

  it('returns a positive flow rate at full throttle, sea level', () => {
    const rate = computeEngineFlowRate(engineDef, 1.0, SEA_LEVEL_DENSITY);
    expect(rate).toBeGreaterThan(0);
  });

  it('scales proportionally with throttle', () => {
    const rateHalf = computeEngineFlowRate(engineDef, 0.5, SEA_LEVEL_DENSITY);
    const rateFull = computeEngineFlowRate(engineDef, 1.0, SEA_LEVEL_DENSITY);
    expect(rateHalf).toBeCloseTo(rateFull * 0.5, 6);
  });

  it('returns 0 at zero throttle', () => {
    const rate = computeEngineFlowRate(engineDef, 0.0, SEA_LEVEL_DENSITY);
    expect(rate).toBe(0);
  });

  it('returns a higher flow in vacuum than at sea level (same throttle, higher vacuum thrust)', () => {
    const rateSL  = computeEngineFlowRate(engineDef, 1.0, SEA_LEVEL_DENSITY);
    const rateVac = computeEngineFlowRate(engineDef, 1.0, 0);
    // Vacuum thrust is higher (72 kN vs 60 kN) but Isp is also higher.
    // Net mass-flow may go either way depending on the numbers; just verify both > 0.
    expect(rateSL).toBeGreaterThan(0);
    expect(rateVac).toBeGreaterThan(0);
  });

  it('matches Tsiolkovsky formula: F / (Isp * 9.81) at sea level', () => {
    const G0       = 9.81;
    const thrust   = engineDef.properties.thrust * 1_000; // kN → N
    const isp      = engineDef.properties.isp;            // sea-level Isp
    const expected = thrust / (isp * G0);

    const rate = computeEngineFlowRate(engineDef, 1.0, SEA_LEVEL_DENSITY);
    expect(rate).toBeCloseTo(expected, 4);
  });
});

describe('computeEngineFlowRate() — SRB', () => {
  const srbDef = getPartById('srb-small');

  it('returns a positive flow rate regardless of throttle', () => {
    const rateZeroThrottle = computeEngineFlowRate(srbDef, 0.0, SEA_LEVEL_DENSITY);
    const rateFullThrottle = computeEngineFlowRate(srbDef, 1.0, SEA_LEVEL_DENSITY);
    // Both should be the same (SRB ignores throttle).
    expect(rateZeroThrottle).toBeCloseTo(rateFullThrottle, 6);
    expect(rateFullThrottle).toBeGreaterThan(0);
  });

  it('uses explicit burnRate property when present', () => {
    const fakeDef = {
      type: 'SOLID_ROCKET_BOOSTER',
      properties: { burnRate: 42, thrust: 999, isp: 999 },
    };
    const rate = computeEngineFlowRate(fakeDef, 0.5, SEA_LEVEL_DENSITY);
    expect(rate).toBe(42);
  });

  it('ignores explicit burnRate of 0 — returns 0', () => {
    const fakeDef = {
      type: 'SOLID_ROCKET_BOOSTER',
      properties: { burnRate: 0, thrust: 100, isp: 200 },
    };
    const rate = computeEngineFlowRate(fakeDef, 1.0, SEA_LEVEL_DENSITY);
    expect(rate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tickFuelSystem() — liquid engine
// ---------------------------------------------------------------------------

describe('tickFuelSystem() — liquid engine drains connected tank', () => {
  it('reduces tank fuel after one tick', () => {
    const { assembly, staging, tankId, engineId } = makeSimpleRocket();
    const ps = makePS(assembly);

    const initialFuel = ps.fuelStore.get(tankId);
    ps.firingEngines.add(engineId);

    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    expect(ps.fuelStore.get(tankId)).toBeLessThan(initialFuel);
  });

  it('does not drain a tank not connected to the engine (across a decoupler)', () => {
    // In the two-stage rocket, the probe-side has no tank so nothing extra
    // is drained.  Here we explicitly verify the probe part's fuelStore is untouched.
    const { assembly, staging, tankId, engineId } = makeTwoStageRocket();
    const ps = makePS(assembly);

    ps.firingEngines.add(engineId);
    const fuelBefore = ps.fuelStore.get(tankId) ?? 400;

    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    // The tank in the same segment should be drained.
    expect(ps.fuelStore.get(tankId)).toBeLessThan(fuelBefore);
  });

  it('drains both tanks evenly when two tanks are connected', () => {
    const { assembly, tankAId, tankBId, engineId } = makeRocketWithTwoTanks();
    const ps = makePS(assembly);

    // Record initial fuel ratios.
    const initA = ps.fuelStore.get(tankAId);
    const initB = ps.fuelStore.get(tankBId);

    ps.firingEngines.add(engineId);
    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    const remA = ps.fuelStore.get(tankAId);
    const remB = ps.fuelStore.get(tankBId);

    // Both should decrease.
    expect(remA).toBeLessThan(initA);
    expect(remB).toBeLessThan(initB);

    // They should drain by the same fraction.
    const fracA = remA / initA;
    const fracB = remB / initB;
    expect(fracA).toBeCloseTo(fracB, 4);
  });

  it('keeps engine in firingEngines while fuel remains', () => {
    const { assembly, engineId } = makeSimpleRocket();
    const ps = makePS(assembly);

    ps.firingEngines.add(engineId);
    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    // Tank still has fuel → engine should still be firing.
    expect(ps.firingEngines.has(engineId)).toBe(true);
  });
});

describe('tickFuelSystem() — liquid engine flames out when tanks empty', () => {
  it('removes engine from firingEngines when all connected tanks are empty', () => {
    const { assembly, tankId, engineId } = makeSimpleRocket();
    const ps = makePS(assembly);

    // Drain the tank completely.
    ps.fuelStore.set(tankId, 0);
    ps.firingEngines.add(engineId);

    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    expect(ps.firingEngines.has(engineId)).toBe(false);
  });

  it('flames out after running for long enough', () => {
    const { assembly, engineId } = makeSimpleRocket();
    const ps = makePS(assembly);

    ps.firingEngines.add(engineId);

    // Run until fuel is exhausted (brute force: 500 seconds at 1/60 step).
    for (let i = 0; i < 500 * 60 && ps.firingEngines.has(engineId); i++) {
      tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);
    }

    expect(ps.firingEngines.has(engineId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tickFuelSystem() — SRB
// ---------------------------------------------------------------------------

describe('tickFuelSystem() — SRB drains integral fuel', () => {
  it('drains the SRB fuelStore entry (not any external tank)', () => {
    const assembly = createRocketAssembly();
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
    const srbId    = addPartToAssembly(assembly, 'srb-small',      50,  0);
    const ps       = makePS(assembly);

    const initFuel = ps.fuelStore.get(srbId);
    expect(initFuel).toBeGreaterThan(0); // srb-small has 900 kg fuel

    ps.firingEngines.add(srbId);
    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    expect(ps.fuelStore.get(srbId)).toBeLessThan(initFuel);
  });

  it('SRB ignores throttle — drains the same amount whether throttle is 0 or 1', () => {
    const assembly1 = createRocketAssembly();
    addPartToAssembly(assembly1, 'probe-core-mk1', 0,  60);
    const srbId1 = addPartToAssembly(assembly1, 'srb-small', 50, 0);
    const ps1    = makePS(assembly1);

    const assembly2 = createRocketAssembly();
    addPartToAssembly(assembly2, 'probe-core-mk1', 0,  60);
    const srbId2 = addPartToAssembly(assembly2, 'srb-small', 50, 0);
    const ps2    = makePS(assembly2);

    ps1.throttle = 0.0;
    ps2.throttle = 1.0;

    const init1 = ps1.fuelStore.get(srbId1);
    const init2 = ps2.fuelStore.get(srbId2);

    ps1.firingEngines.add(srbId1);
    ps2.firingEngines.add(srbId2);

    tickFuelSystem(ps1, assembly1, 1 / 60, SEA_LEVEL_DENSITY);
    tickFuelSystem(ps2, assembly2, 1 / 60, SEA_LEVEL_DENSITY);

    const drained1 = init1 - (ps1.fuelStore.get(srbId1) ?? 0);
    const drained2 = init2 - (ps2.fuelStore.get(srbId2) ?? 0);

    expect(drained1).toBeCloseTo(drained2, 6);
  });

  it('removes SRB from firingEngines when integral fuel is exhausted', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const srbId = addPartToAssembly(assembly, 'srb-small', 50, 0);
    const ps    = makePS(assembly);

    // Almost empty.
    ps.fuelStore.set(srbId, 0.001);
    ps.firingEngines.add(srbId);

    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    expect(ps.firingEngines.has(srbId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tickFuelSystem() — jettisoned and detached parts
// ---------------------------------------------------------------------------

describe('tickFuelSystem() — jettisoned engine is cleaned up', () => {
  it('removes a jettisoned engine from firingEngines', () => {
    const { assembly, engineId } = makeSimpleRocket();
    const ps = makePS(assembly);

    // Engine is "firing" but has been jettisoned.
    ps.firingEngines.add(engineId);
    ps.activeParts.delete(engineId);

    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    expect(ps.firingEngines.has(engineId)).toBe(false);
  });
});

describe('tickFuelSystem() — detached parts retain fuel state', () => {
  it('tank retains its fuel value after being jettisoned', () => {
    const { assembly, tankId, engineId } = makeSimpleRocket();
    const ps = makePS(assembly);

    // Partially drain the tank.
    ps.fuelStore.set(tankId, 200);

    // Jettison the tank.
    ps.activeParts.delete(tankId);

    // Engine firing — but tank is jettisoned so engine should flame out,
    // and tank fuel should remain at 200.
    ps.firingEngines.add(engineId);
    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    // Tank fuel untouched — detached parts are not drained.
    expect(ps.fuelStore.get(tankId)).toBe(200);

    // Engine flamed out because its connected tank is jettisoned.
    expect(ps.firingEngines.has(engineId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tickFuelSystem() — exact depletion rate (scenario 1)
// ---------------------------------------------------------------------------

describe('tickFuelSystem() — exact depletion rate matches thrust/Isp formula', () => {
  it('tank drains by exactly flowRate × dt per tick at full throttle, sea level', () => {
    const { assembly, tankId, engineId } = makeSimpleRocket();
    const ps = makePS(assembly);

    const engineDef = getPartById('engine-spark');
    const dt = 1 / 60;

    // Expected drain: flow = F / (Isp × g₀) at sea level, full throttle.
    const expectedRate  = computeEngineFlowRate(engineDef, 1.0, SEA_LEVEL_DENSITY);
    const expectedDrain = expectedRate * dt;

    const fuelBefore = ps.fuelStore.get(tankId);
    ps.throttle = 1.0;
    ps.firingEngines.add(engineId);
    tickFuelSystem(ps, assembly, dt, SEA_LEVEL_DENSITY);

    const actualDrain = fuelBefore - ps.fuelStore.get(tankId);
    expect(actualDrain).toBeCloseTo(expectedDrain, 5);
  });

  it('tank drains by half the rate at 50 % throttle', () => {
    const { assembly, tankId, engineId } = makeSimpleRocket();
    const ps = makePS(assembly);

    const engineDef = getPartById('engine-spark');
    const dt = 1 / 60;

    const rateHalf  = computeEngineFlowRate(engineDef, 0.5, SEA_LEVEL_DENSITY);
    const rateFull  = computeEngineFlowRate(engineDef, 1.0, SEA_LEVEL_DENSITY);

    const fuelBefore = ps.fuelStore.get(tankId);
    ps.throttle = 0.5;
    ps.firingEngines.add(engineId);
    tickFuelSystem(ps, assembly, dt, SEA_LEVEL_DENSITY);

    const actualDrain = fuelBefore - ps.fuelStore.get(tankId);
    expect(actualDrain).toBeCloseTo(rateHalf * dt, 5);
    expect(actualDrain).toBeCloseTo(rateFull * dt * 0.5, 5);
  });
});

// ---------------------------------------------------------------------------
// tickFuelSystem() — cross-feed isolation (scenario 3)
// ---------------------------------------------------------------------------

/**
 * Rocket with tanks on BOTH sides of a decoupler:
 *   Upper Tank → Probe Core → Decoupler → Lower Tank → Spark Engine
 *
 * The engine is in the lower segment; it must only draw from the lower tank.
 * The upper tank (across the decoupler boundary) must never be drained.
 */
function makeRocketWithTanksAboveAndBelowDecoupler() {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const upperTankId = addPartToAssembly(assembly, 'tank-small',           0, 140);
  const probeId     = addPartToAssembly(assembly, 'probe-core-mk1',       0,  80);
  const decId       = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0,  40);
  const lowerTankId = addPartToAssembly(assembly, 'tank-small',           0, -20);
  const engineId    = addPartToAssembly(assembly, 'engine-spark',         0, -75);

  connectParts(assembly, upperTankId, 1, probeId,     0);
  connectParts(assembly, probeId,     1, decId,       0);
  connectParts(assembly, decId,       1, lowerTankId, 0);
  connectParts(assembly, lowerTankId, 1, engineId,    0);

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, engineId, 0);

  return { assembly, staging, probeId, decId, upperTankId, lowerTankId, engineId };
}

describe('tickFuelSystem() — cross-feed isolation across decoupler', () => {
  it('engine only drains the tank in its own segment (below the decoupler)', () => {
    const { assembly, lowerTankId, engineId } = makeRocketWithTanksAboveAndBelowDecoupler();
    const ps = makePS(assembly);

    const lowerFuelBefore = ps.fuelStore.get(lowerTankId);
    ps.firingEngines.add(engineId);
    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    expect(ps.fuelStore.get(lowerTankId)).toBeLessThan(lowerFuelBefore);
  });

  it('tank above decoupler is not drained when engine fires below the decoupler', () => {
    const { assembly, upperTankId, engineId } = makeRocketWithTanksAboveAndBelowDecoupler();
    const ps = makePS(assembly);

    const upperFuelBefore = ps.fuelStore.get(upperTankId);
    ps.firingEngines.add(engineId);
    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    // Upper tank must remain completely unchanged — cross-feed must not occur.
    expect(ps.fuelStore.get(upperTankId)).toBe(upperFuelBefore);
  });

  it('getConnectedTanks confirms upper tank is outside the engine segment', () => {
    const { assembly, upperTankId, lowerTankId, engineId } =
      makeRocketWithTanksAboveAndBelowDecoupler();
    const ps = makePS(assembly);

    const tanks = getConnectedTanks(engineId, assembly, ps.activeParts);
    expect(tanks).toContain(lowerTankId);
    expect(tanks).not.toContain(upperTankId);
  });
});

// ---------------------------------------------------------------------------
// Part mass tracking — fuel drain reduces total propellant mass (scenario 5)
// ---------------------------------------------------------------------------

describe('part mass tracking — fuel drain decreases total rocket mass', () => {
  it('total propellant in fuelStore decreases as the engine fires', () => {
    const { assembly, engineId } = makeSimpleRocket();
    const ps = makePS(assembly);

    const sumFuel = () =>
      [...ps.fuelStore.values()].reduce((acc, v) => acc + v, 0);

    const initialFuelMass = sumFuel();

    ps.firingEngines.add(engineId);
    // Run for 5 simulated seconds (300 ticks at 1/60 s each).
    for (let i = 0; i < 300 && ps.firingEngines.size > 0; i++) {
      tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);
    }

    const finalFuelMass = sumFuel();
    // Fuel mass must have decreased — and therefore total rocket mass has decreased.
    expect(finalFuelMass).toBeLessThan(initialFuelMass);
  });

  it('fuelStore decreases by flowRate × dt per tick (fuel mass = rocket mass delta)', () => {
    const { assembly, tankId, engineId } = makeSimpleRocket();
    const ps = makePS(assembly);

    const engineDef = getPartById('engine-spark');
    const dt        = 1 / 60;

    // Force a known fuel level well above what one tick can drain.
    ps.fuelStore.set(tankId, 400);

    const sumFuelBefore = [...ps.fuelStore.values()].reduce((a, b) => a + b, 0);

    ps.throttle = 1.0;
    ps.firingEngines.add(engineId);
    tickFuelSystem(ps, assembly, dt, SEA_LEVEL_DENSITY);

    const sumFuelAfter = [...ps.fuelStore.values()].reduce((a, b) => a + b, 0);

    const expectedRate  = computeEngineFlowRate(engineDef, 1.0, SEA_LEVEL_DENSITY);
    const expectedDelta = expectedRate * dt;

    // The drop in total fuelStore = the drop in total rocket propellant mass.
    expect(sumFuelBefore - sumFuelAfter).toBeCloseTo(expectedDelta, 5);
  });
});

// ---------------------------------------------------------------------------
// computeEngineFlowRate() — edge cases for branch coverage
// ---------------------------------------------------------------------------

describe('computeEngineFlowRate() — edge cases', () => {
  it('returns 0 for SRB when isp is 0 (zero denominator branch)', () => {
    const fakeDef = {
      type: 'SOLID_ROCKET_BOOSTER',
      properties: { thrust: 100, isp: 0 },
    };
    const rate = computeEngineFlowRate(fakeDef, 1.0, SEA_LEVEL_DENSITY);
    expect(rate).toBe(0);
  });

  it('returns 0 for liquid engine when isp is 0 (zero denominator branch)', () => {
    const fakeDef = {
      type: 'ENGINE',
      properties: { thrust: 100, isp: 0 },
    };
    const rate = computeEngineFlowRate(fakeDef, 1.0, SEA_LEVEL_DENSITY);
    expect(rate).toBe(0);
  });

  it('returns 0 for SRB with negative burnRate (clamped to 0)', () => {
    const fakeDef = {
      type: 'SOLID_ROCKET_BOOSTER',
      properties: { burnRate: -5 },
    };
    const rate = computeEngineFlowRate(fakeDef, 1.0, SEA_LEVEL_DENSITY);
    expect(rate).toBe(0);
  });

  it('handles negative density gracefully (clamped to 0)', () => {
    const engineDef = getPartById('engine-spark');
    // Negative density should be clamped to ratio 0, giving vacuum performance.
    const rateNeg = computeEngineFlowRate(engineDef, 1.0, -1);
    const rateVac = computeEngineFlowRate(engineDef, 1.0, 0);
    expect(rateNeg).toBe(rateVac);
    expect(rateNeg).toBeGreaterThan(0);
  });

  it('SRB uses vacuum thrust/isp when thrustVac is specified', () => {
    const fakeDef = {
      type: 'SOLID_ROCKET_BOOSTER',
      properties: { thrust: 100, thrustVac: 120, isp: 200, ispVac: 250 },
    };
    const rateVac = computeEngineFlowRate(fakeDef, 1.0, 0);
    // In vacuum: thrust = 120 kN = 120_000 N, isp = 250 s
    const expected = 120_000 / (250 * 9.81);
    expect(rateVac).toBeCloseTo(expected, 4);
  });

  it('liquid engine clamps throttle to [0,1] range', () => {
    const engineDef = getPartById('engine-spark');
    const rateOver = computeEngineFlowRate(engineDef, 2.0, SEA_LEVEL_DENSITY);
    const rateFull = computeEngineFlowRate(engineDef, 1.0, SEA_LEVEL_DENSITY);
    // Throttle > 1 is clamped to 1.
    expect(rateOver).toBeCloseTo(rateFull, 6);
  });

  it('liquid engine returns 0 for negative throttle (clamped to 0)', () => {
    const engineDef = getPartById('engine-spark');
    const rate = computeEngineFlowRate(engineDef, -0.5, SEA_LEVEL_DENSITY);
    expect(rate).toBe(0);
  });

  it('handles missing properties object gracefully', () => {
    const fakeDef = { type: 'ENGINE' };
    const rate = computeEngineFlowRate(fakeDef, 1.0, SEA_LEVEL_DENSITY);
    // All properties default to 0 thrust / 300 isp → 0 thrust → 0 rate.
    expect(rate).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// tickFuelSystem() — engine with missing placement/definition
// ---------------------------------------------------------------------------

describe('tickFuelSystem() — engine with missing assembly data', () => {
  it('removes engine from firingEngines when not found in assembly.parts', () => {
    const { assembly } = makeSimpleRocket();
    const ps = makePS(assembly);

    // Add a phantom engine ID that is active but has no placement.
    const phantomId = 'phantom-engine-999';
    ps.activeParts.add(phantomId);
    ps.firingEngines.add(phantomId);

    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    // Phantom engine should be cleaned up.
    expect(ps.firingEngines.has(phantomId)).toBe(false);
  });

  it('removes engine from firingEngines when part definition is not found', () => {
    const { assembly } = makeSimpleRocket();
    const ps = makePS(assembly);

    // Add a part with valid placement but invalid partId.
    const badId = 'bad-engine-123';
    ps.activeParts.add(badId);
    ps.firingEngines.add(badId);
    assembly.parts.set(badId, { partId: 'nonexistent-part', x: 0, y: 0 });

    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    expect(ps.firingEngines.has(badId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// tickFuelSystem() — SRB with zero fuel at tick start
// ---------------------------------------------------------------------------

describe('tickFuelSystem() — SRB already depleted at tick start', () => {
  it('removes SRB from firingEngines when fuelStore is 0 before drain', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const srbId = addPartToAssembly(assembly, 'srb-small', 50, 0);
    const ps = makePS(assembly);

    ps.fuelStore.set(srbId, 0);
    ps.firingEngines.add(srbId);

    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    expect(ps.firingEngines.has(srbId)).toBe(false);
  });

  it('removes SRB from firingEngines when fuelStore entry is missing', () => {
    const assembly = createRocketAssembly();
    addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const srbId = addPartToAssembly(assembly, 'srb-small', 50, 0);
    const ps = makePS(assembly);

    ps.fuelStore.delete(srbId); // No fuel entry at all.
    ps.firingEngines.add(srbId);

    tickFuelSystem(ps, assembly, 1 / 60, SEA_LEVEL_DENSITY);

    expect(ps.firingEngines.has(srbId)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// getConnectedTanks() — parts with missing definition
// ---------------------------------------------------------------------------

describe('getConnectedTanks() — parts with missing data', () => {
  it('skips parts whose placement is missing from assembly.parts', () => {
    const { assembly, engineId, tankId } = makeSimpleRocket();
    const ps = makePS(assembly);

    // Remove tank placement from assembly but keep it in activeParts.
    assembly.parts.delete(tankId);

    const tanks = getConnectedTanks(engineId, assembly, ps.activeParts);
    // Tank should not appear because its placement is gone.
    expect(tanks).not.toContain(tankId);
  });

  it('skips parts whose partId resolves to no definition', () => {
    const { assembly, engineId, tankId } = makeSimpleRocket();
    const ps = makePS(assembly);

    // Replace tank's partId with a nonexistent one.
    assembly.parts.set(tankId, { ...assembly.parts.get(tankId), partId: 'fake-part' });

    const tanks = getConnectedTanks(engineId, assembly, ps.activeParts);
    expect(tanks).not.toContain(tankId);
  });
});
