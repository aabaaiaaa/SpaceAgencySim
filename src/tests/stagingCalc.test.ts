/**
 * stagingCalc.test.ts — Unit tests for computeStageDeltaV() from stagingCalc.ts.
 *
 * Tests cover delta-v via Tsiolkovsky equation, TWR, ISP averaging,
 * jettison behaviour, edge cases (no engine, no fuel, invalid stage index).
 */

import { describe, it, expect } from 'vitest';
import { computeStageDeltaV } from '../core/stagingCalc.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
  addStageToConfig,
} from '../core/rocketbuilder.ts';
import { airDensity, SEA_LEVEL_DENSITY } from '../core/atmosphere.ts';

import type { RocketAssembly, StagingConfig } from '../core/rocketbuilder.ts';

// ---------------------------------------------------------------------------
// Constants used in hand calculations
// ---------------------------------------------------------------------------

const G0 = 9.81;

// engine-spark properties
const SPARK_THRUST_KN = 60;
const SPARK_ISP_SL    = 290;
const SPARK_ISP_VAC   = 320;
const SPARK_MASS      = 120;

// engine-reliant properties
const RELIANT_THRUST_KN = 240;
const RELIANT_ISP_SL    = 310;
const RELIANT_ISP_VAC   = 345;
const RELIANT_MASS      = 500;

// tank-small properties
const TANK_DRY_MASS  = 50;
const TANK_FUEL_MASS = 400;

// probe-core-mk1
const PROBE_MASS = 50;

// decoupler-stack-tr18
const DECOUPLER_MASS = 50;

// srb-small properties
const SRB_DRY_MASS  = 180;
const SRB_FUEL_MASS = 900;
const SRB_THRUST_KN = 180;
const SRB_ISP_SL    = 175;
const SRB_ISP_VAC   = 190;

// ---------------------------------------------------------------------------
// Helper: build a simple single-stage rocket (probe + tank + engine-spark)
// ---------------------------------------------------------------------------

function makeSingleStageRocket(): {
  assembly: RocketAssembly;
  staging: StagingConfig;
  probeId: string;
  tankId: string;
  engineId: string;
} {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, 100);
  const tankId   = addPartToAssembly(assembly, 'tank-small',      0,  40);
  const engineId = addPartToAssembly(assembly, 'engine-spark',    0, -25);

  connectParts(assembly, probeId, 1, tankId,   0);
  connectParts(assembly, tankId,  1, engineId, 0);

  syncStagingWithAssembly(assembly, staging);
  // engine-spark is activatable and should be in unstaged after sync
  assignPartToStage(staging, engineId, 0);

  return { assembly, staging, probeId, tankId, engineId };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('computeStageDeltaV()', () => {

  // -----------------------------------------------------------------------
  // 1. Single engine with fuel -- known delta-v (Tsiolkovsky)
  // -----------------------------------------------------------------------

  it('computes correct delta-v for a single engine at sea level @smoke', () => {
    const { assembly, staging } = makeSingleStageRocket();

    // At sea level (dvAltitude = 0): atmFrac = 1, ISP = ISP_SL = 290
    const result = computeStageDeltaV(0, assembly, staging, 0);

    const totalMass = PROBE_MASS + TANK_DRY_MASS + TANK_FUEL_MASS + SPARK_MASS; // 620
    const dryMass   = totalMass - TANK_FUEL_MASS;                                // 220
    const expectedDv = SPARK_ISP_SL * G0 * Math.log(totalMass / dryMass);

    expect(result.engines).toBe(true);
    expect(result.dv).toBeCloseTo(expectedDv, 1);
    expect(result.twr).toBeDefined();
  });

  // -----------------------------------------------------------------------
  // 2. TWR at sea level and at altitude
  // -----------------------------------------------------------------------

  it('computes correct TWR at sea level (dvAltitude=0)', () => {
    const { assembly, staging } = makeSingleStageRocket();
    const result = computeStageDeltaV(0, assembly, staging, 0);

    const totalMass = PROBE_MASS + TANK_DRY_MASS + TANK_FUEL_MASS + SPARK_MASS;
    const thrustN   = SPARK_THRUST_KN * 1000;
    const expectedTwr = thrustN / (totalMass * G0);

    expect(result.twr).toBeCloseTo(expectedTwr, 4);
  });

  it('computes different ISP and TWR at altitude (dvAltitude=50000)', () => {
    const { assembly, staging } = makeSingleStageRocket();
    const resultSL  = computeStageDeltaV(0, assembly, staging, 0);
    const resultAlt = computeStageDeltaV(0, assembly, staging, 50_000);

    // At 50000m, air density is much lower than sea level.
    // ISP blends toward vacuum ISP, so dv should be higher at altitude.
    expect(resultAlt.dv).toBeGreaterThan(resultSL.dv);

    // Verify the exact TWR: thrust is the same, mass is the same,
    // so TWR should be identical regardless of altitude.
    expect(resultAlt.twr).toBeCloseTo(resultSL.twr!, 4);

    // Verify ISP blending with exact calculation
    const density  = airDensity(50_000);
    const atmFrac  = Math.min(1, density / SEA_LEVEL_DENSITY);
    const ispAtAlt = SPARK_ISP_SL * atmFrac + SPARK_ISP_VAC * (1 - atmFrac);

    const totalMass = PROBE_MASS + TANK_DRY_MASS + TANK_FUEL_MASS + SPARK_MASS;
    const dryMass   = totalMass - TANK_FUEL_MASS;
    const expectedDv = ispAtAlt * G0 * Math.log(totalMass / dryMass);

    expect(resultAlt.dv).toBeCloseTo(expectedDv, 1);
  });

  // -----------------------------------------------------------------------
  // 3. Multi-engine thrust-weighted ISP averaging
  // -----------------------------------------------------------------------

  it('averages ISP weighted by thrust for multiple engines @smoke', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId   = addPartToAssembly(assembly, 'probe-core-mk1', 0,   150);
    const tankId    = addPartToAssembly(assembly, 'tank-small',      0,    80);
    const sparkId   = addPartToAssembly(assembly, 'engine-spark',    0,    10);
    const reliantId = addPartToAssembly(assembly, 'engine-reliant',  0,   -40);

    connectParts(assembly, probeId, 1, tankId,    0);
    connectParts(assembly, tankId,  1, sparkId,   0);
    connectParts(assembly, sparkId, 1, reliantId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, sparkId,   0);
    assignPartToStage(staging, reliantId, 0);

    // Evaluate in vacuum (dvAltitude >= 70000)
    const result = computeStageDeltaV(0, assembly, staging, 70_000);

    // In vacuum: atmFrac = 0, so ISP = ispVac for each engine.
    const sparkThrustN   = SPARK_THRUST_KN * 1000;
    const reliantThrustN = RELIANT_THRUST_KN * 1000;
    const totalThrustN   = sparkThrustN + reliantThrustN;

    const avgIsp = (SPARK_ISP_VAC * sparkThrustN + RELIANT_ISP_VAC * reliantThrustN) / totalThrustN;

    const totalMass = PROBE_MASS + TANK_DRY_MASS + TANK_FUEL_MASS + SPARK_MASS + RELIANT_MASS;
    const dryMass   = totalMass - TANK_FUEL_MASS;
    const expectedDv = avgIsp * G0 * Math.log(totalMass / dryMass);

    expect(result.engines).toBe(true);
    expect(result.dv).toBeCloseTo(expectedDv, 1);
    expect(result.twr).toBeCloseTo(totalThrustN / (totalMass * G0), 4);
  });

  // -----------------------------------------------------------------------
  // 4. Jettison behaviour (parts from previous stages excluded from mass)
  // -----------------------------------------------------------------------

  it('excludes jettisoned parts from earlier stages in mass calculation', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    // Two-stage rocket: Stage 0 = lower engine+decoupler, Stage 1 = upper engine
    const probeId    = addPartToAssembly(assembly, 'probe-core-mk1',       0,  200);
    const tank2Id    = addPartToAssembly(assembly, 'tank-small',           0,  140);
    const engine2Id  = addPartToAssembly(assembly, 'engine-spark',         0,   80);
    const decId      = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0,   50);
    const tank1Id    = addPartToAssembly(assembly, 'tank-small',           0,  -10);
    const engine1Id  = addPartToAssembly(assembly, 'engine-spark',         0,  -65);

    connectParts(assembly, probeId,   1, tank2Id,   0);
    connectParts(assembly, tank2Id,   1, engine2Id, 0);
    connectParts(assembly, engine2Id, 1, decId,     0);
    connectParts(assembly, decId,     1, tank1Id,   0);
    connectParts(assembly, tank1Id,   1, engine1Id, 0);

    syncStagingWithAssembly(assembly, staging);
    // Stage 0: fire lower engine and decoupler (fires first)
    assignPartToStage(staging, engine1Id, 0);
    assignPartToStage(staging, decId,     0);

    // Stage 1: upper engine
    addStageToConfig(staging);
    assignPartToStage(staging, engine2Id, 1);

    // Compute stage 1 (second stage) -- in vacuum
    const result = computeStageDeltaV(1, assembly, staging, 70_000);

    // Jettisoned: engine1 (120kg) and decoupler (50kg) from stage 0.
    // Remaining: probe(50) + tank2(50 dry + 400 fuel) + engine2(120) + tank1(50 dry + 400 fuel)
    // Note: tank1 is NOT jettisoned (it's not in stage 0), so its mass is included.
    const jettisonedMass = SPARK_MASS + DECOUPLER_MASS; // 170 kg
    const allPartsMass   = PROBE_MASS + (TANK_DRY_MASS + TANK_FUEL_MASS) * 2 + SPARK_MASS * 2 + DECOUPLER_MASS;
    const totalMass      = allPartsMass - jettisonedMass;
    const totalFuel      = TANK_FUEL_MASS * 2; // both tanks still present
    const dryMass        = totalMass - totalFuel;

    const expectedDv = SPARK_ISP_VAC * G0 * Math.log(totalMass / dryMass);

    expect(result.engines).toBe(true);
    expect(result.dv).toBeCloseTo(expectedDv, 1);
  });

  // -----------------------------------------------------------------------
  // 5. No-engine stage -> returns { dv: 0, engines: false }
  // -----------------------------------------------------------------------

  it('returns dv=0 and engines=false for a stage with no engines', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId = addPartToAssembly(assembly, 'probe-core-mk1',       0, 100);
    const decId   = addPartToAssembly(assembly, 'decoupler-stack-tr18', 0,  60);

    connectParts(assembly, probeId, 1, decId, 0);

    syncStagingWithAssembly(assembly, staging);
    // Decoupler is activatable; assign it to stage 0
    assignPartToStage(staging, decId, 0);

    const result = computeStageDeltaV(0, assembly, staging, 0);

    expect(result.dv).toBe(0);
    expect(result.engines).toBe(false);
  });

  // -----------------------------------------------------------------------
  // 6. Zero fuel -> dv: 0
  // -----------------------------------------------------------------------

  it('returns dv=0 when there is no fuel in the assembly', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    // Probe + engine, no tank
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, 100);
    const engineId = addPartToAssembly(assembly, 'engine-spark',   0,  50);

    connectParts(assembly, probeId, 1, engineId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);

    const result = computeStageDeltaV(0, assembly, staging, 0);

    expect(result.dv).toBe(0);
    expect(result.engines).toBe(true);
    // TWR should still be defined (there's thrust and mass)
    expect(result.twr).toBeDefined();
    expect(result.twr).toBeGreaterThan(0);
  });

  // -----------------------------------------------------------------------
  // 7. High altitude -> near-vacuum ISP
  // -----------------------------------------------------------------------

  it('uses vacuum ISP at high altitude (dvAltitude=70000)', () => {
    const { assembly, staging } = makeSingleStageRocket();

    const result = computeStageDeltaV(0, assembly, staging, 70_000);

    // At 70000m, airDensity returns 0, so atmFrac = 0 and ISP = ispVac
    const totalMass = PROBE_MASS + TANK_DRY_MASS + TANK_FUEL_MASS + SPARK_MASS;
    const dryMass   = totalMass - TANK_FUEL_MASS;
    const expectedDv = SPARK_ISP_VAC * G0 * Math.log(totalMass / dryMass);

    expect(result.dv).toBeCloseTo(expectedDv, 1);
  });

  it('uses vacuum ISP above atmosphere top (dvAltitude=100000)', () => {
    const { assembly, staging } = makeSingleStageRocket();

    const result70k  = computeStageDeltaV(0, assembly, staging, 70_000);
    const result100k = computeStageDeltaV(0, assembly, staging, 100_000);

    // Both are above the atmosphere top, so they should give the same dv
    expect(result100k.dv).toBeCloseTo(result70k.dv, 4);
  });

  // -----------------------------------------------------------------------
  // 8. Invalid stage index -> returns { dv: 0, engines: false }
  // -----------------------------------------------------------------------

  it('returns dv=0 and engines=false for out-of-bounds stage index', () => {
    const { assembly, staging } = makeSingleStageRocket();

    const resultHigh = computeStageDeltaV(999, assembly, staging, 0);
    expect(resultHigh.dv).toBe(0);
    expect(resultHigh.engines).toBe(false);
    expect(resultHigh.twr).toBeUndefined();

    const resultNeg = computeStageDeltaV(-1, assembly, staging, 0);
    expect(resultNeg.dv).toBe(0);
    expect(resultNeg.engines).toBe(false);
    expect(resultNeg.twr).toBeUndefined();
  });

  // -----------------------------------------------------------------------
  // Additional: SRB with built-in fuel
  // -----------------------------------------------------------------------

  it('accounts for SRB built-in fuel mass in delta-v calculation', () => {
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();

    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 100);
    const srbId   = addPartToAssembly(assembly, 'srb-small',      0,   0);

    connectParts(assembly, probeId, 1, srbId, 0);

    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, srbId, 0);

    // SRB at sea level
    const result = computeStageDeltaV(0, assembly, staging, 0);

    const totalMass = PROBE_MASS + SRB_DRY_MASS + SRB_FUEL_MASS; // 50 + 180 + 900 = 1130
    const dryMass   = totalMass - SRB_FUEL_MASS;                   // 230
    const thrustN   = SRB_THRUST_KN * 1000;
    const expectedTwr = thrustN / (totalMass * G0);
    const expectedDv  = SRB_ISP_SL * G0 * Math.log(totalMass / dryMass);

    expect(result.engines).toBe(true);
    expect(result.dv).toBeCloseTo(expectedDv, 1);
    expect(result.twr).toBeCloseTo(expectedTwr, 4);
  });
});
