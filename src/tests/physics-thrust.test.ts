import { describe, it, expect } from 'vitest';
import {
  updateThrottleFromTWR,
  computeThrust,
} from '../core/physics/thrust.ts';
import { createPhysicsState } from '../core/physics/init.ts';
import { gravityForBody } from '../core/physics/gravity.ts';
import { SEA_LEVEL_DENSITY } from '../core/atmosphere.ts';
import { MalfunctionType, REDUCED_THRUST_FACTOR } from '../core/constants.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
} from '../core/rocketbuilder.ts';
import { createFlightState } from '../core/gameState.ts';

import type { PhysicsState, RocketAssembly } from '../core/physics.ts';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

function makeLiquidRocket(): { assembly: RocketAssembly; engineId: string; wetMass: number } {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
  const tankId   = addPartToAssembly(assembly, 'tank-small',     0,   0);
  const engineId = addPartToAssembly(assembly, 'engine-spark',   0, -55);

  connectParts(assembly, probeId, 1, tankId,   0);
  connectParts(assembly, tankId,  1, engineId, 0);

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, engineId, 0);

  // dry 50 + 50 + 120 = 220; fuel 400 → wet = 620.
  return { assembly, engineId, wetMass: 620 };
}

function makeSRBOnlyRocket(): { assembly: RocketAssembly; srbId: string; wetMass: number } {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0,   20);
  const srbId   = addPartToAssembly(assembly, 'srb-small',       20,   0);
  connectParts(assembly, probeId, 1, srbId, 0);
  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, srbId, 0);

  // dry 50 + 180 = 230; SRB fuel 900 → wet = 1130.
  return { assembly, srbId, wetMass: 1130 };
}

function makePs(assembly: RocketAssembly): PhysicsState {
  const fs = createFlightState({ missionId: 'test-mission', rocketId: 'test-rocket' });
  const ps = createPhysicsState(assembly, fs);
  ps.grounded = false;
  ps.landed   = false;
  return ps;
}

// ---------------------------------------------------------------------------
// updateThrottleFromTWR() — TWR-mode throttle conversion.
// ---------------------------------------------------------------------------

describe('updateThrottleFromTWR()', () => {
  it('is a no-op when throttleMode is not twr @smoke', () => {
    const { assembly, engineId } = makeLiquidRocket();
    const ps = makePs(assembly);
    ps.throttleMode = 'absolute';
    ps.throttle     = 0.42;
    ps.targetTWR    = 5;
    ps.firingEngines.add(engineId);

    updateThrottleFromTWR(ps, assembly, 'EARTH');

    // Throttle preserved — function short-circuits in absolute mode.
    expect(ps.throttle).toBe(0.42);
  });

  it('targetTWR === Infinity sets throttle to 1 (max thrust)', () => {
    const { assembly, engineId } = makeLiquidRocket();
    const ps = makePs(assembly);
    ps.targetTWR = Infinity;
    ps.firingEngines.add(engineId);

    updateThrottleFromTWR(ps, assembly, 'EARTH');
    expect(ps.throttle).toBe(1);
  });

  it('targetTWR <= 0 sets throttle to 0 @smoke', () => {
    const { assembly, engineId } = makeLiquidRocket();
    const ps = makePs(assembly);
    ps.firingEngines.add(engineId);

    ps.targetTWR = 0;
    updateThrottleFromTWR(ps, assembly, 'EARTH');
    expect(ps.throttle).toBe(0);

    ps.targetTWR = -0.5;
    updateThrottleFromTWR(ps, assembly, 'EARTH');
    expect(ps.throttle).toBe(0);
  });

  it('no liquid engines firing (SRB-only) leaves throttle unchanged — cannot throttle SRBs', () => {
    const { assembly, srbId } = makeSRBOnlyRocket();
    const ps = makePs(assembly);
    ps.throttle = 0.7;
    ps.targetTWR = 2.0;
    ps.firingEngines.add(srbId);

    updateThrottleFromTWR(ps, assembly, 'EARTH');
    expect(ps.throttle).toBe(0.7);
  });

  it('computes throttle for requested TWR on EARTH', () => {
    const { assembly, engineId, wetMass } = makeLiquidRocket();
    const ps = makePs(assembly);
    ps.targetTWR = 1.0;
    ps.firingEngines.add(engineId);

    updateThrottleFromTWR(ps, assembly, 'EARTH');

    // maxLiquidThrustN = 60 kN × 1000 = 60000 N (weatherIspModifier NOT applied here).
    const g: number = gravityForBody('EARTH', 0);
    const needed: number = 1.0 * wetMass * g; // no SRB thrust
    const expected: number = Math.max(0, Math.min(1, needed / 60_000));
    expect(ps.throttle).toBeCloseTo(expected, 6);
    expect(ps.throttle).toBeGreaterThan(0);
    expect(ps.throttle).toBeLessThan(1);
  });

  it('clamps throttle to [0, 1] when requested TWR exceeds max achievable', () => {
    const { assembly, engineId } = makeLiquidRocket();
    const ps = makePs(assembly);
    ps.targetTWR = 1000; // absurdly high
    ps.firingEngines.add(engineId);

    updateThrottleFromTWR(ps, assembly, 'EARTH');
    expect(ps.throttle).toBe(1);
  });

  it('accounts for SRB thrust by subtracting it from the liquid-engine demand', () => {
    // Build: probe + engine-spark + srb-small (both firing).
    const assembly = createRocketAssembly();
    const staging  = createStagingConfig();
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
    const tankId   = addPartToAssembly(assembly, 'tank-small',     0,   0);
    const engineId = addPartToAssembly(assembly, 'engine-spark',   0, -55);
    const srbId    = addPartToAssembly(assembly, 'srb-small',     20,   0);
    connectParts(assembly, probeId, 1, tankId,   0);
    connectParts(assembly, tankId,  1, engineId, 0);
    syncStagingWithAssembly(assembly, staging);
    assignPartToStage(staging, engineId, 0);
    assignPartToStage(staging, srbId, 0);

    const ps = makePs(assembly);
    ps.targetTWR = 2.0;
    ps.firingEngines.add(engineId);
    ps.firingEngines.add(srbId);

    updateThrottleFromTWR(ps, assembly, 'EARTH');

    // Mass = probe 50 + tank 50 + engine 120 + srb 180 + fuel (400 + 900) = 1700.
    // SRB thrust = 180 kN = 180_000 N. Liquid max = 60_000 N.
    const totalMass = 1700;
    const g: number = gravityForBody('EARTH', 0);
    const needed: number = 2.0 * totalMass * g - 180_000;
    const expected: number = Math.max(0, Math.min(1, needed / 60_000));
    expect(ps.throttle).toBeCloseTo(expected, 6);
  });
});

// ---------------------------------------------------------------------------
// computeThrust() — per-frame thrust force vector.
// ---------------------------------------------------------------------------

describe('computeThrust()', () => {
  it('returns zero thrust when no engines are firing @smoke', () => {
    const { assembly } = makeLiquidRocket();
    const ps = makePs(assembly);
    // firingEngines intentionally empty.

    const { thrustX, thrustY } = computeThrust(ps, assembly, SEA_LEVEL_DENSITY);
    expect(thrustX).toBe(0);
    expect(thrustY).toBe(0);
  });

  it('projects thrust along +Y at angle 0 and scales by throttle (sea-level) @smoke', () => {
    const { assembly, engineId } = makeLiquidRocket();
    const ps = makePs(assembly);
    ps.angle    = 0;
    ps.throttle = 0.5;
    ps.firingEngines.add(engineId);

    const { thrustX, thrustY } = computeThrust(ps, assembly, SEA_LEVEL_DENSITY);
    // At sea level density ratio = 1 → uses thrustSL = 60_000 N.
    // throttle 0.5 → 30_000 N along +Y.
    expect(thrustX).toBeCloseTo(0, 6);
    expect(thrustY).toBeCloseTo(30_000, 6);
  });

  it('uses vacuum thrust in vacuum (density = 0)', () => {
    const { assembly, engineId } = makeLiquidRocket();
    const ps = makePs(assembly);
    ps.angle    = 0;
    ps.throttle = 1;
    ps.firingEngines.add(engineId);

    const { thrustX, thrustY } = computeThrust(ps, assembly, 0);
    // thrustVac = 72 kN = 72_000 N, full throttle.
    expect(thrustX).toBeCloseTo(0, 6);
    expect(thrustY).toBeCloseTo(72_000, 6);
  });

  it('rotates thrust to +X when angle = π/2', () => {
    const { assembly, engineId } = makeLiquidRocket();
    const ps = makePs(assembly);
    ps.angle    = Math.PI / 2;
    ps.throttle = 1;
    ps.firingEngines.add(engineId);

    const { thrustX, thrustY } = computeThrust(ps, assembly, SEA_LEVEL_DENSITY);
    expect(thrustX).toBeCloseTo(60_000, 6);
    expect(thrustY).toBeCloseTo(0, 6);
  });

  it('scales thrust by weatherIspModifier', () => {
    const { assembly, engineId } = makeLiquidRocket();
    const ps = makePs(assembly);
    ps.angle    = 0;
    ps.throttle = 1;
    ps.weatherIspModifier = 0.8;
    ps.firingEngines.add(engineId);

    const { thrustY } = computeThrust(ps, assembly, SEA_LEVEL_DENSITY);
    expect(thrustY).toBeCloseTo(60_000 * 0.8, 6);
  });

  it('ignores throttle for SRBs (always 100 %)', () => {
    const { assembly, srbId } = makeSRBOnlyRocket();
    const ps = makePs(assembly);
    ps.angle    = 0;
    ps.throttle = 0;          // irrelevant for SRBs
    ps.firingEngines.add(srbId);

    const { thrustY } = computeThrust(ps, assembly, SEA_LEVEL_DENSITY);
    // SRB thrust = 180 kN at sea level → 180_000 N.
    expect(thrustY).toBeCloseTo(180_000, 6);
  });

  it('fuel starvation: SRB with zero fuel produces no thrust and is removed from firingEngines @smoke', () => {
    const { assembly, srbId } = makeSRBOnlyRocket();
    const ps = makePs(assembly);
    ps.angle    = 0;
    ps.throttle = 1;
    ps.fuelStore.set(srbId, 0); // drain fuel
    ps.firingEngines.add(srbId);

    const { thrustX, thrustY } = computeThrust(ps, assembly, SEA_LEVEL_DENSITY);
    expect(thrustX).toBe(0);
    expect(thrustY).toBe(0);
    // Exhausted engines are scrubbed from the firing set.
    expect(ps.firingEngines.has(srbId)).toBe(false);
  });

  it('removes a firing entry whose part is no longer active (jettisoned)', () => {
    const { assembly, engineId } = makeLiquidRocket();
    const ps = makePs(assembly);
    ps.angle    = 0;
    ps.throttle = 1;
    ps.firingEngines.add(engineId);
    ps.activeParts.delete(engineId); // simulate jettison

    const { thrustX, thrustY } = computeThrust(ps, assembly, SEA_LEVEL_DENSITY);
    expect(thrustX).toBe(0);
    expect(thrustY).toBe(0);
    expect(ps.firingEngines.has(engineId)).toBe(false);
  });

  it('applies REDUCED_THRUST_FACTOR on ENGINE_REDUCED_THRUST malfunction', () => {
    const { assembly, engineId } = makeLiquidRocket();
    const ps = makePs(assembly);
    ps.angle    = 0;
    ps.throttle = 1;
    ps.firingEngines.add(engineId);
    ps.malfunctions = new Map([
      [engineId, { type: MalfunctionType.ENGINE_REDUCED_THRUST, recovered: false }],
    ]) as PhysicsState['malfunctions'];

    const { thrustY } = computeThrust(ps, assembly, SEA_LEVEL_DENSITY);
    // 60_000 N × REDUCED_THRUST_FACTOR (0.6) = 36_000 N.
    expect(thrustY).toBeCloseTo(60_000 * REDUCED_THRUST_FACTOR, 6);
  });

  it('recovered malfunction does NOT apply the REDUCED_THRUST_FACTOR', () => {
    const { assembly, engineId } = makeLiquidRocket();
    const ps = makePs(assembly);
    ps.angle    = 0;
    ps.throttle = 1;
    ps.firingEngines.add(engineId);
    ps.malfunctions = new Map([
      [engineId, { type: MalfunctionType.ENGINE_REDUCED_THRUST, recovered: true }],
    ]) as PhysicsState['malfunctions'];

    const { thrustY } = computeThrust(ps, assembly, SEA_LEVEL_DENSITY);
    expect(thrustY).toBeCloseTo(60_000, 6);
  });

  it('interpolates linearly between sea-level and vacuum at intermediate density', () => {
    const { assembly, engineId } = makeLiquidRocket();
    const ps = makePs(assembly);
    ps.angle    = 0;
    ps.throttle = 1;
    ps.firingEngines.add(engineId);

    const midDensity: number = SEA_LEVEL_DENSITY * 0.5;
    const { thrustY } = computeThrust(ps, assembly, midDensity);
    // ratio = 0.5 → 0.5·60_000 + 0.5·72_000 = 66_000.
    expect(thrustY).toBeCloseTo(66_000, 6);
  });
});
