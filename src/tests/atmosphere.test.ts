// @ts-nocheck
/**
 * atmosphere.test.js — Unit tests for the atmosphere model and reentry heat
 * simulation (TASK-021, TASK-064).
 *
 * Tests cover:
 *   airDensity()          — sea-level value, exponential falloff, zero above 70 km
 *   terminalVelocity()    — basic formula, vacuum returns Infinity
 *   isReentryCondition()  — both thresholds (altitude and speed)
 *   computeHeatRate()     — zero below threshold, proportional above
 *   getLeadingPartId()    — ascending vs descending selection
 *   getHeatTolerance()    — defaults for structural / heat shield / custom
 *   getShieldedPartIds()  — heat shield protection logic (orientation-aware)
 *   getHeatRatio()        — heat-to-tolerance ratio for rendering
 *   updateHeat()          — heat accumulates on leading part, dissipates on others,
 *                           exposed parts get fractional heat, shielded parts cool,
 *                           part destroyed when tolerance exceeded, events emitted,
 *                           destroyed parts removed from activeParts / firingEngines
 *   tick() integration    — heat applied when physics tick runs in reentry conditions
 */

import { describe, it, expect } from 'vitest';
import {
  airDensity,
  airDensityForBody,
  atmosphereTopForBody,
  terminalVelocity,
  isReentryCondition,
  isReentryConditionForBody,
  computeHeatRate,
  computeSolarHeatRate,
  getLeadingPartId,
  getShieldedPartIds,
  getHeatTolerance,
  getHeatRatio,
  updateHeat,
  updateSolarHeat,
  ATMOSPHERE_TOP,
  SEA_LEVEL_DENSITY,
  SCALE_HEIGHT,
  REENTRY_SPEED_THRESHOLD,
  DEFAULT_HEAT_TOLERANCE,
  HEAT_SHIELD_TOLERANCE,
  HEAT_DISSIPATION_PER_TICK,
  EXPOSED_HEAT_FRACTION,
} from '../core/atmosphere.ts';
import {
  SUN_DESTRUCTION_ALTITUDE,
  SUN_HEAT_START_ALTITUDE,
  SUN_HEAT_RATE_BASE,
} from '../core/constants.ts';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
} from '../core/rocketbuilder.ts';
import { getPartById } from '../data/parts.ts';
import { createFlightState } from '../core/gameState.ts';
import { createPhysicsState, tick } from '../core/physics.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Minimal uncrewed rocket:
 *   Probe Core  y= 60   (top / nose)
 *   Small Tank  y=  0   (centre)
 *   Spark Engine y=-55  (bottom — first to face atmosphere during descent)
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
 * Rocket with heat shield:
 *   Probe Core    y= 60   (top / nose)
 *   Small Tank    y=  0   (centre)
 *   Heat Shield   y=-30   (below tank, above engine)
 *   Spark Engine  y=-55   (bottom)
 */
function makeShieldedRocket() {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
  const tankId   = addPartToAssembly(assembly, 'tank-small',     0,   0);
  const shieldId = addPartToAssembly(assembly, 'heat-shield-mk1', 0, -30);
  const engineId = addPartToAssembly(assembly, 'engine-spark',   0, -55);

  connectParts(assembly, probeId, 1, tankId,   0);
  connectParts(assembly, tankId,  1, shieldId, 0);
  connectParts(assembly, shieldId, 1, engineId, 0);

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, engineId, 0);

  return { assembly, staging, probeId, tankId, shieldId, engineId };
}

function makeFlightState() {
  return createFlightState({ missionId: 'test', rocketId: 'test' });
}

/**
 * Return the instance ID of the part with the minimum Y (lowest physical
 * position) among all active parts — i.e. the leading face when descending.
 */
function findLowestActivePartId(ps, assembly) {
  return Array.from(assembly.parts.entries())
    .filter(([id]) => ps.activeParts.has(id))
    .sort(([, a], [, b]) => a.y - b.y)[0][0];
}

/**
 * Return the instance ID of the part with the maximum Y (highest physical
 * position) among all active parts — i.e. the leading face when ascending.
 */
function findHighestActivePartId(ps, assembly) {
  return Array.from(assembly.parts.entries())
    .filter(([id]) => ps.activeParts.has(id))
    .sort(([, a], [, b]) => b.y - a.y)[0][0];
}

// ---------------------------------------------------------------------------
// airDensity()
// ---------------------------------------------------------------------------

describe('airDensity()', () => {
  it('returns SEA_LEVEL_DENSITY at altitude 0', () => {
    expect(airDensity(0)).toBeCloseTo(SEA_LEVEL_DENSITY, 6);
  });

  it('returns 0 at ATMOSPHERE_TOP', () => {
    expect(airDensity(ATMOSPHERE_TOP)).toBe(0);
  });

  it('returns 0 above ATMOSPHERE_TOP', () => {
    expect(airDensity(ATMOSPHERE_TOP + 1_000)).toBe(0);
    expect(airDensity(200_000)).toBe(0);
  });

  it('returns less than sea-level density at any positive altitude', () => {
    expect(airDensity(1_000)).toBeLessThan(SEA_LEVEL_DENSITY);
    expect(airDensity(30_000)).toBeLessThan(airDensity(10_000));
  });

  it('density at one scale height is approximately 1/e of sea-level density', () => {
    expect(airDensity(SCALE_HEIGHT)).toBeCloseTo(SEA_LEVEL_DENSITY / Math.E, 6);
  });

  it('matches the exponential formula at a known altitude', () => {
    const alt      = 8_500;
    const expected = SEA_LEVEL_DENSITY * Math.exp(-alt / SCALE_HEIGHT);
    expect(airDensity(alt)).toBeCloseTo(expected, 8);
  });

  it('treats negative altitude the same as altitude 0', () => {
    expect(airDensity(-100)).toBeCloseTo(SEA_LEVEL_DENSITY, 6);
  });
});

// ---------------------------------------------------------------------------
// airDensityForBody()
// ---------------------------------------------------------------------------

describe('airDensityForBody()', () => {
  it('returns non-zero density at sea level for Earth', () => {
    expect(airDensityForBody(0, 'EARTH')).toBeGreaterThan(0);
  });

  it('returns 0 for airless bodies like the Moon', () => {
    expect(airDensityForBody(0, 'MOON')).toBe(0);
  });

  it('returns much higher density for Venus than Earth at sea level', () => {
    expect(airDensityForBody(0, 'VENUS')).toBeGreaterThan(airDensityForBody(0, 'EARTH'));
  });

  it('returns much lower density for Mars than Earth at sea level', () => {
    expect(airDensityForBody(0, 'MARS')).toBeLessThan(airDensityForBody(0, 'EARTH'));
  });

  it('returns 0 above atmosphere top for any body', () => {
    expect(airDensityForBody(300_000, 'VENUS')).toBe(0);
    expect(airDensityForBody(100_000, 'MARS')).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// isReentryConditionForBody()
// ---------------------------------------------------------------------------

describe('isReentryConditionForBody()', () => {
  it('returns false for airless bodies regardless of speed', () => {
    expect(isReentryConditionForBody(100, 5_000, 'MOON')).toBe(false);
    expect(isReentryConditionForBody(100, 5_000, 'MERCURY')).toBe(false);
  });

  it('returns true for Venus when inside atmosphere and fast enough', () => {
    expect(isReentryConditionForBody(100_000, 2_000, 'VENUS')).toBe(true);
  });

  it('returns false above atmosphere top', () => {
    expect(isReentryConditionForBody(260_000, 2_000, 'VENUS')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// terminalVelocity()
// ---------------------------------------------------------------------------

describe('terminalVelocity()', () => {
  it('returns a positive finite value in atmosphere', () => {
    const vt = terminalVelocity(1000, 9.81, 1.225, 0.5, 1.0);
    expect(vt).toBeGreaterThan(0);
    expect(Number.isFinite(vt)).toBe(true);
  });

  it('returns Infinity in vacuum (density = 0)', () => {
    expect(terminalVelocity(1000, 9.81, 0, 0.5, 1.0)).toBe(Infinity);
  });

  it('returns Infinity when Cd is zero', () => {
    expect(terminalVelocity(1000, 9.81, 1.225, 0, 1.0)).toBe(Infinity);
  });

  it('returns Infinity when area is zero', () => {
    expect(terminalVelocity(1000, 9.81, 1.225, 0.5, 0)).toBe(Infinity);
  });

  it('increases with mass (heavier object falls faster)', () => {
    const vt1 = terminalVelocity(500,  9.81, 1.225, 0.5, 1.0);
    const vt2 = terminalVelocity(1000, 9.81, 1.225, 0.5, 1.0);
    expect(vt2).toBeGreaterThan(vt1);
  });

  it('decreases in denser air (same object falls slower)', () => {
    const vtThin  = terminalVelocity(1000, 9.81, 0.5,   0.5, 1.0);
    const vtDense = terminalVelocity(1000, 9.81, 1.225, 0.5, 1.0);
    expect(vtThin).toBeGreaterThan(vtDense);
  });
});

// ---------------------------------------------------------------------------
// isReentryCondition()
// ---------------------------------------------------------------------------

describe('isReentryCondition()', () => {
  it('returns true when inside atmosphere AND faster than threshold', () => {
    expect(isReentryCondition(50_000, 2_000)).toBe(true);
  });

  it('returns false when altitude equals ATMOSPHERE_TOP', () => {
    expect(isReentryCondition(ATMOSPHERE_TOP, 2_000)).toBe(false);
  });

  it('returns false when altitude is above ATMOSPHERE_TOP', () => {
    expect(isReentryCondition(80_000, 5_000)).toBe(false);
  });

  it('returns false when speed equals REENTRY_SPEED_THRESHOLD', () => {
    expect(isReentryCondition(50_000, REENTRY_SPEED_THRESHOLD)).toBe(false);
  });

  it('returns false when speed is below threshold', () => {
    expect(isReentryCondition(50_000, 500)).toBe(false);
  });

  it('returns true just inside both thresholds', () => {
    expect(isReentryCondition(ATMOSPHERE_TOP - 1, REENTRY_SPEED_THRESHOLD + 1)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// computeHeatRate()
// ---------------------------------------------------------------------------

describe('computeHeatRate()', () => {
  it('returns 0 at the speed threshold', () => {
    expect(computeHeatRate(REENTRY_SPEED_THRESHOLD, 1.225)).toBe(0);
  });

  it('returns 0 below the speed threshold', () => {
    expect(computeHeatRate(1_000, 1.225)).toBe(0);
  });

  it('returns a positive value above the threshold', () => {
    expect(computeHeatRate(2_000, 1.225)).toBeGreaterThan(0);
  });

  it('scales linearly with excess speed', () => {
    const rate1 = computeHeatRate(2_000, 1.225); // excess = 500
    const rate2 = computeHeatRate(3_000, 1.225); // excess = 1500 = 3×
    expect(rate2).toBeCloseTo(rate1 * 3, 6);
  });

  it('scales linearly with air density', () => {
    const rate1 = computeHeatRate(2_000, 1.0);
    const rate2 = computeHeatRate(2_000, 2.0);
    expect(rate2).toBeCloseTo(rate1 * 2, 6);
  });

  it('matches the formula: (speed − 1500) × density × 0.01', () => {
    const speed   = 3_000;
    const density = 0.8;
    const expected = (speed - REENTRY_SPEED_THRESHOLD) * density * 0.01;
    expect(computeHeatRate(speed, density)).toBeCloseTo(expected, 8);
  });
});

// ---------------------------------------------------------------------------
// getLeadingPartId()
// ---------------------------------------------------------------------------

describe('getLeadingPartId()', () => {
  it('returns the lowest-Y part when descending (velY < 0)', () => {
    // Engine is at y=-55 (lowest Y = bottom of rocket = leading face on descent).
    const { assembly, engineId } = makeSimpleRocket();
    const ps = { velY: -100, activeParts: new Set(assembly.parts.keys()) };
    expect(getLeadingPartId(ps, assembly)).toBe(engineId);
  });

  it('returns the highest-Y part when ascending (velY > 0)', () => {
    // Probe is at y=60 (highest Y = nose = leading face on ascent).
    const { assembly, probeId } = makeSimpleRocket();
    const ps = { velY: 100, activeParts: new Set(assembly.parts.keys()) };
    expect(getLeadingPartId(ps, assembly)).toBe(probeId);
  });

  it('treats velY = 0 as ascending and returns highest-Y part', () => {
    const { assembly, probeId } = makeSimpleRocket();
    const ps = { velY: 0, activeParts: new Set(assembly.parts.keys()) };
    expect(getLeadingPartId(ps, assembly)).toBe(probeId);
  });

  it('returns null when activeParts is empty', () => {
    const { assembly } = makeSimpleRocket();
    const ps = { velY: -100, activeParts: new Set() };
    expect(getLeadingPartId(ps, assembly)).toBeNull();
  });

  it('returns the only remaining part when one part is active', () => {
    const { assembly, probeId } = makeSimpleRocket();
    const ps = { velY: -100, activeParts: new Set([probeId]) };
    expect(getLeadingPartId(ps, assembly)).toBe(probeId);
  });
});

// ---------------------------------------------------------------------------
// getShieldedPartIds() — heat shield protection
// ---------------------------------------------------------------------------

describe('getShieldedPartIds()', () => {
  it('returns empty set when no heat shields are present', () => {
    const { assembly } = makeSimpleRocket();
    const ps = { velY: -100, activeParts: new Set(assembly.parts.keys()) };
    const shielded = getShieldedPartIds(ps, assembly);
    expect(shielded.size).toBe(0);
  });

  it('shields parts above the heat shield when descending', () => {
    const { assembly, probeId, tankId, shieldId, engineId } = makeShieldedRocket();
    const ps = { velY: -100, activeParts: new Set(assembly.parts.keys()) };
    const shielded = getShieldedPartIds(ps, assembly);

    // Probe (y=60) and Tank (y=0) are above shield (y=-30) → shielded.
    expect(shielded.has(probeId)).toBe(true);
    expect(shielded.has(tankId)).toBe(true);
    // Engine (y=-55) is below shield → NOT shielded.
    expect(shielded.has(engineId)).toBe(false);
    // Shield itself is never in the shielded set.
    expect(shielded.has(shieldId)).toBe(false);
  });

  it('shields parts below the heat shield when ascending', () => {
    const { assembly, probeId, tankId, shieldId, engineId } = makeShieldedRocket();
    const ps = { velY: 100, activeParts: new Set(assembly.parts.keys()) };
    const shielded = getShieldedPartIds(ps, assembly);

    // Engine (y=-55) is below shield (y=-30) → shielded when ascending.
    expect(shielded.has(engineId)).toBe(true);
    // Probe (y=60) and Tank (y=0) are above shield → NOT shielded when ascending.
    expect(shielded.has(probeId)).toBe(false);
    expect(shielded.has(tankId)).toBe(false);
  });

  it('does not shield parts outside the shield width', () => {
    const assembly = createRocketAssembly();
    const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const shieldId = addPartToAssembly(assembly, 'heat-shield-mk1', 0, -30);
    // Place a part far to the side, outside shield width.
    const sidePartId = addPartToAssembly(assembly, 'tank-small', 50, 0);

    const ps = { velY: -100, activeParts: new Set([probeId, shieldId, sidePartId]) };
    const shielded = getShieldedPartIds(ps, assembly);

    // Probe is inline → shielded.
    expect(shielded.has(probeId)).toBe(true);
    // Side part is outside shield width → NOT shielded.
    expect(shielded.has(sidePartId)).toBe(false);
  });

  it('does not shield anything when the heat shield is destroyed (not in activeParts)', () => {
    const { assembly, probeId, tankId, shieldId, engineId } = makeShieldedRocket();
    // Remove shield from active parts (destroyed).
    const ps = { velY: -100, activeParts: new Set([probeId, tankId, engineId]) };
    const shielded = getShieldedPartIds(ps, assembly);
    expect(shielded.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// getHeatTolerance()
// ---------------------------------------------------------------------------

describe('getHeatTolerance()', () => {
  it('returns DEFAULT_HEAT_TOLERANCE for null', () => {
    expect(getHeatTolerance(null)).toBe(DEFAULT_HEAT_TOLERANCE);
  });

  it('returns DEFAULT_HEAT_TOLERANCE for a regular part with no explicit property', () => {
    expect(getHeatTolerance({ type: 'ENGINE', properties: {} })).toBe(DEFAULT_HEAT_TOLERANCE);
  });

  it('returns HEAT_SHIELD_TOLERANCE for a HEAT_SHIELD part with no explicit property', () => {
    expect(getHeatTolerance({ type: 'HEAT_SHIELD', properties: {} })).toBe(HEAT_SHIELD_TOLERANCE);
  });

  it('returns the explicit heatTolerance when set (structural part)', () => {
    expect(getHeatTolerance({ type: 'ENGINE', properties: { heatTolerance: 500 } })).toBe(500);
  });

  it('returns the explicit heatTolerance even on a HEAT_SHIELD (overrides default)', () => {
    expect(getHeatTolerance({ type: 'HEAT_SHIELD', properties: { heatTolerance: 9_999 } })).toBe(9_999);
  });

  it('HEAT_SHIELD_TOLERANCE is greater than DEFAULT_HEAT_TOLERANCE', () => {
    expect(HEAT_SHIELD_TOLERANCE).toBeGreaterThan(DEFAULT_HEAT_TOLERANCE);
  });
});

// ---------------------------------------------------------------------------
// getHeatRatio()
// ---------------------------------------------------------------------------

describe('getHeatRatio()', () => {
  it('returns 0 for a part with no accumulated heat', () => {
    const { assembly, probeId } = makeSimpleRocket();
    const ps = { heatMap: new Map(), activeParts: new Set(assembly.parts.keys()) };
    expect(getHeatRatio(ps, probeId, assembly)).toBe(0);
  });

  it('returns ~0.5 for a part at half its tolerance', () => {
    const { assembly, probeId } = makeSimpleRocket();
    const placed = assembly.parts.get(probeId);
    const def = getPartById(placed.partId);
    const tol = getHeatTolerance(def);
    const ps = { heatMap: new Map([[probeId, tol / 2]]), activeParts: new Set(assembly.parts.keys()) };
    expect(getHeatRatio(ps, probeId, assembly)).toBeCloseTo(0.5, 2);
  });

  it('clamps to 1 when heat exceeds tolerance', () => {
    const { assembly, probeId } = makeSimpleRocket();
    const placed = assembly.parts.get(probeId);
    const def = getPartById(placed.partId);
    const tol = getHeatTolerance(def);
    const ps = { heatMap: new Map([[probeId, tol * 2]]), activeParts: new Set(assembly.parts.keys()) };
    expect(getHeatRatio(ps, probeId, assembly)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// updateHeat() — heat accumulation on leading part
// ---------------------------------------------------------------------------

describe('updateHeat() — reentry heating', () => {
  it('adds heat to the leading-face part when in reentry conditions', () => {
    const { assembly } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    ps.posY = 50_000;
    ps.velY = -3_000; // descending fast — engine (y=-55) leads
    ps.grounded = false;

    const density   = airDensity(50_000);
    const leadingId = findLowestActivePartId(ps, assembly);

    updateHeat(ps, assembly, fs, 3_000, 50_000, density);

    expect(ps.heatMap.get(leadingId) ?? 0).toBeGreaterThan(0);
  });

  it('adds reduced heat to non-leading exposed parts during reentry', () => {
    const { assembly } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    ps.posY = 50_000;
    ps.velY = -3_000;
    ps.grounded = false;

    const density   = airDensity(50_000);
    const leadingId = findLowestActivePartId(ps, assembly);

    updateHeat(ps, assembly, fs, 3_000, 50_000, density);

    // Non-leading parts should also gain heat (at EXPOSED_HEAT_FRACTION rate).
    for (const id of ps.activeParts) {
      if (id !== leadingId) {
        expect(ps.heatMap.get(id) ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it('exposed parts get EXPOSED_HEAT_FRACTION of leading part heat rate', () => {
    const { assembly } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    ps.posY = 50_000;
    ps.velY = -3_000;
    ps.grounded = false;

    const density   = airDensity(50_000);
    const leadingId = findLowestActivePartId(ps, assembly);
    const heatRate  = computeHeatRate(3_000, density);

    updateHeat(ps, assembly, fs, 3_000, 50_000, density);

    // Leading part gets full heatRate.
    expect(ps.heatMap.get(leadingId)).toBeCloseTo(heatRate, 6);
    // Other parts get EXPOSED_HEAT_FRACTION of heatRate.
    for (const id of ps.activeParts) {
      if (id !== leadingId) {
        expect(ps.heatMap.get(id)).toBeCloseTo(heatRate * EXPOSED_HEAT_FRACTION, 6);
      }
    }
  });

  it('shielded parts dissipate heat during reentry instead of accumulating', () => {
    const { assembly, probeId, tankId, shieldId, engineId } = makeShieldedRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Pre-load heat on shielded parts.
    ps.heatMap.set(probeId, 100);
    ps.heatMap.set(tankId, 100);

    ps.posY = 50_000;
    ps.velY = -3_000; // descending — shield protects probe & tank
    ps.grounded = false;

    const density = airDensity(50_000);
    updateHeat(ps, assembly, fs, 3_000, 50_000, density);

    // Shielded parts should have cooled from 100.
    expect(ps.heatMap.get(probeId)).toBeLessThan(100);
    expect(ps.heatMap.get(tankId)).toBeLessThan(100);
    // Engine (leading, unshielded) should have gained heat.
    expect(ps.heatMap.get(engineId)).toBeGreaterThan(0);
  });

  it('all parts dissipate heat when NOT in reentry conditions', () => {
    const { assembly } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    for (const id of ps.activeParts) ps.heatMap.set(id, 50);

    // Low speed — no reentry heating.
    const density = airDensity(20_000);
    updateHeat(ps, assembly, fs, 200, 20_000, density);

    for (const id of ps.activeParts) {
      expect(ps.heatMap.get(id)).toBe(50 - HEAT_DISSIPATION_PER_TICK);
    }
  });

  it('heat does not go below 0 during dissipation', () => {
    const { assembly } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    // heatMap is empty — all parts start at 0.
    const density = airDensity(20_000);
    updateHeat(ps, assembly, fs, 200, 20_000, density);

    for (const id of ps.activeParts) {
      expect(ps.heatMap.get(id) ?? 0).toBeGreaterThanOrEqual(0);
    }
  });

  it('no heat is added when the rocket is in vacuum (altitude >= ATMOSPHERE_TOP)', () => {
    const { assembly } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    ps.posY = ATMOSPHERE_TOP + 1_000;
    ps.velY = -5_000;
    ps.grounded = false;

    // density = 0 in vacuum
    updateHeat(ps, assembly, fs, 5_000, ATMOSPHERE_TOP + 1_000, 0);

    // All parts should have cooled (dissipated from 0, clamped to 0).
    for (const id of ps.activeParts) {
      expect(ps.heatMap.get(id) ?? 0).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// updateHeat() — heat shield protection
// ---------------------------------------------------------------------------

describe('updateHeat() — heat shield protection', () => {
  it('@smoke heat shield absorbs heat while protecting parts behind it', () => {
    const { assembly, probeId, tankId, shieldId, engineId } = makeShieldedRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    ps.posY = 50_000;
    ps.velY = -3_000; // descending
    ps.grounded = false;

    const density = airDensity(50_000);

    // Run several ticks.
    for (let i = 0; i < 10; i++) {
      updateHeat(ps, assembly, fs, 3_000, 50_000, density);
    }

    // The heat shield itself should have accumulated heat (as an exposed part).
    expect(ps.heatMap.get(shieldId)).toBeGreaterThan(0);
    // The engine (leading) should have the most heat.
    expect(ps.heatMap.get(engineId)).toBeGreaterThan(ps.heatMap.get(shieldId));
    // Shielded parts should have no heat (they dissipate each tick and never accumulate).
    expect(ps.heatMap.get(probeId) ?? 0).toBe(0);
    expect(ps.heatMap.get(tankId) ?? 0).toBe(0);
  });

  it('protection reverses with ascent direction', () => {
    const { assembly, probeId, tankId, shieldId, engineId } = makeShieldedRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    ps.posY = 50_000;
    ps.velY = 3_000; // ascending — probe is leading, shield protects engine
    ps.grounded = false;

    const density = airDensity(50_000);

    for (let i = 0; i < 10; i++) {
      updateHeat(ps, assembly, fs, 3_000, 50_000, density);
    }

    // During ascent, engine (below shield) is now shielded.
    expect(ps.heatMap.get(engineId) ?? 0).toBe(0);
    // Probe (leading, above shield) should have the most heat.
    expect(ps.heatMap.get(probeId)).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// updateHeat() — part destruction
// ---------------------------------------------------------------------------

describe('updateHeat() — part destruction', () => {
  it('removes a part from activeParts when accumulated heat exceeds tolerance', () => {
    const { assembly } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    const leadingId = findLowestActivePartId(ps, assembly);

    // Use the part's actual heat tolerance so the test works for any part definition.
    const placed  = assembly.parts.get(leadingId);
    const def     = placed ? getPartById(placed.partId) : null;
    const partTol = getHeatTolerance(def);

    // Set heat exactly at tolerance — one heat tick will push it just over.
    ps.heatMap.set(leadingId, partTol);
    ps.posY = 50_000;
    ps.velY = -3_000;
    ps.grounded = false;

    const density = airDensity(50_000);
    updateHeat(ps, assembly, fs, 3_000, 50_000, density);

    expect(ps.activeParts.has(leadingId)).toBe(false);
  });

  it('removes a destroyed part from firingEngines', () => {
    const { assembly, engineId } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    ps.firingEngines.add(engineId);
    // engineId is at y=-55 — it leads when descending.
    const placed  = assembly.parts.get(engineId);
    const def     = placed ? getPartById(placed.partId) : null;
    const partTol = getHeatTolerance(def);

    ps.heatMap.set(engineId, partTol);
    ps.posY = 50_000;
    ps.velY = -3_000;
    ps.grounded = false;

    const density = airDensity(50_000);
    updateHeat(ps, assembly, fs, 3_000, 50_000, density);

    expect(ps.firingEngines.has(engineId)).toBe(false);
  });

  it('clears the heatMap entry for a destroyed part', () => {
    const { assembly } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    const leadingId = findLowestActivePartId(ps, assembly);
    const placed    = assembly.parts.get(leadingId);
    const def       = placed ? getPartById(placed.partId) : null;
    const partTol   = getHeatTolerance(def);

    ps.heatMap.set(leadingId, partTol);
    ps.posY = 50_000;
    ps.velY = -3_000;
    ps.grounded = false;

    const density = airDensity(50_000);
    updateHeat(ps, assembly, fs, 3_000, 50_000, density);

    expect(ps.heatMap.has(leadingId)).toBe(false);
  });

  it('emits a PART_DESTROYED event when a part overheats', () => {
    const { assembly } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    const leadingId = findLowestActivePartId(ps, assembly);
    const placed    = assembly.parts.get(leadingId);
    const def       = placed ? getPartById(placed.partId) : null;
    const partTol   = getHeatTolerance(def);

    ps.heatMap.set(leadingId, partTol);
    ps.posY = 50_000;
    ps.velY = -3_000;
    ps.grounded = false;

    const density = airDensity(50_000);
    updateHeat(ps, assembly, fs, 3_000, 50_000, density);

    const evt = fs.events.find((e) => e.type === 'PART_DESTROYED');
    expect(evt).toBeDefined();
    expect(evt.instanceId).toBe(leadingId);
    expect(evt.description).toContain('atmospheric heating');
  });

  it('does not destroy a part whose heat is well below tolerance', () => {
    const { assembly } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Set all parts to well below their actual tolerance — no part should be destroyed.
    for (const id of ps.activeParts) {
      const placed  = assembly.parts.get(id);
      const def     = placed ? getPartById(placed.partId) : null;
      const partTol = getHeatTolerance(def);
      ps.heatMap.set(id, Math.floor(partTol / 2));
    }

    const density = airDensity(50_000);
    updateHeat(ps, assembly, fs, 3_000, 50_000, density);

    // No part should be destroyed (leading part got some heat but started at half tolerance).
    const destroyed = fs.events.filter((e) => e.type === 'PART_DESTROYED');
    expect(destroyed.length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Heat shield part definitions
// ---------------------------------------------------------------------------

describe('heat shield part definitions', () => {
  it('heat-shield-mk1 exists and has HEAT_SHIELD type', () => {
    const def = getPartById('heat-shield-mk1');
    expect(def).toBeDefined();
    expect(def.type).toBe('HEAT_SHIELD');
  });

  it('heat-shield-mk2 exists and has HEAT_SHIELD type', () => {
    const def = getPartById('heat-shield-mk2');
    expect(def).toBeDefined();
    expect(def.type).toBe('HEAT_SHIELD');
  });

  it('heat shields have higher thermal tolerance than structural parts', () => {
    const shield = getPartById('heat-shield-mk1');
    const tank   = getPartById('tank-small');
    expect(getHeatTolerance(shield)).toBeGreaterThan(getHeatTolerance(tank));
  });

  it('engines have higher thermal tolerance than tanks', () => {
    const engine = getPartById('engine-spark');
    const tank   = getPartById('tank-small');
    expect(getHeatTolerance(engine)).toBeGreaterThanOrEqual(getHeatTolerance(tank));
  });
});

// ---------------------------------------------------------------------------
// Integration: heat applied via physics tick()
// ---------------------------------------------------------------------------

describe('integration — heat applied through physics tick()', () => {
  it('accumulates heat on the leading part during a reentry tick', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Position inside atmosphere, descending at reentry speed.
    ps.posY     = 50_000;
    ps.velY     = -2_000;
    ps.grounded = false;

    tick(ps, assembly, staging, fs, 1 / 60);

    // Engine (y=-55) is the leading face on descent.
    const leadingId = findLowestActivePartId(ps, assembly);
    expect(ps.heatMap.get(leadingId) ?? 0).toBeGreaterThan(0);
  });

  it('does not accumulate heat when on launch pad (grounded)', () => {
    const { assembly, staging } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    // ps.grounded = true by default — heat update is skipped.

    tick(ps, assembly, staging, fs, 1 / 60);

    for (const id of ps.activeParts) {
      expect(ps.heatMap.get(id) ?? 0).toBe(0);
    }
  });

  it('heatMap is initialised empty by createPhysicsState', () => {
    const { assembly } = makeSimpleRocket();
    const ps = createPhysicsState(assembly, makeFlightState());
    expect(ps.heatMap).toBeInstanceOf(Map);
    expect(ps.heatMap.size).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// atmosphereTopForBody()
// ---------------------------------------------------------------------------

describe('atmosphereTopForBody()', () => {
  it('returns a positive altitude for Earth', () => {
    expect(atmosphereTopForBody('EARTH')).toBeGreaterThan(0);
  });

  it('returns 0 for airless bodies', () => {
    expect(atmosphereTopForBody('MOON')).toBe(0);
    expect(atmosphereTopForBody('MERCURY')).toBe(0);
  });

  it('returns a higher top for Venus than Earth', () => {
    expect(atmosphereTopForBody('VENUS')).toBeGreaterThan(atmosphereTopForBody('EARTH'));
  });

  it('returns a positive altitude for Mars', () => {
    expect(atmosphereTopForBody('MARS')).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// computeSolarHeatRate()
// ---------------------------------------------------------------------------

describe('computeSolarHeatRate()', () => {
  it('returns 0 at or above SUN_HEAT_START_ALTITUDE', () => {
    expect(computeSolarHeatRate(SUN_HEAT_START_ALTITUDE)).toBe(0);
    expect(computeSolarHeatRate(SUN_HEAT_START_ALTITUDE + 1_000_000)).toBe(0);
  });

  it('returns a positive value below SUN_HEAT_START_ALTITUDE', () => {
    const rate = computeSolarHeatRate(SUN_HEAT_START_ALTITUDE - 1_000_000);
    expect(rate).toBeGreaterThan(0);
  });

  it('increases as altitude decreases (closer to Sun)', () => {
    const rateFar = computeSolarHeatRate(SUN_HEAT_START_ALTITUDE / 2);
    const rateClose = computeSolarHeatRate(SUN_HEAT_START_ALTITUDE / 10);
    expect(rateClose).toBeGreaterThan(rateFar);
  });

  it('follows inverse-square law from Sun centre', () => {
    // At SUN_HEAT_START_ALTITUDE, rate = SUN_HEAT_RATE_BASE * (startDist/dist)^2
    // At a halfway point, the ratio should be predictable.
    const alt = SUN_HEAT_START_ALTITUDE / 2;
    const rate = computeSolarHeatRate(alt);
    expect(rate).toBeGreaterThan(SUN_HEAT_RATE_BASE);
  });

  it('handles altitude 0 (Sun surface) without error', () => {
    const rate = computeSolarHeatRate(0);
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate).toBeGreaterThan(0);
  });

  it('handles negative altitude gracefully (clamped to 0)', () => {
    const rate = computeSolarHeatRate(-1000);
    expect(Number.isFinite(rate)).toBe(true);
    expect(rate).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// updateSolarHeat() — solar proximity heating
// ---------------------------------------------------------------------------

describe('updateSolarHeat()', () => {
  /**
   * Build a simple rocket for solar heat tests.
   * Returns the assembly and ids of the parts.
   */
  function makeSolarTestRocket() {
    const assembly = createRocketAssembly();
    const staging = createStagingConfig();
    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const tankId = addPartToAssembly(assembly, 'tank-small', 0, 0);
    const engineId = addPartToAssembly(assembly, 'engine-spark', 0, -55);
    connectParts(assembly, probeId, 1, tankId, 0);
    connectParts(assembly, tankId, 1, engineId, 0);
    syncStagingWithAssembly(assembly, staging);
    return { assembly, staging, probeId, tankId, engineId };
  }

  /**
   * Build a rocket with a solar heat shield for protected-heat tests.
   */
  function makeSolarShieldedRocket() {
    const assembly = createRocketAssembly();
    const staging = createStagingConfig();
    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const tankId = addPartToAssembly(assembly, 'tank-small', 0, 0);
    const shieldId = addPartToAssembly(assembly, 'heat-shield-solar', 0, -30);
    const engineId = addPartToAssembly(assembly, 'engine-spark', 0, -55);
    connectParts(assembly, probeId, 1, tankId, 0);
    connectParts(assembly, tankId, 1, shieldId, 0);
    connectParts(assembly, shieldId, 1, engineId, 0);
    syncStagingWithAssembly(assembly, staging);
    return { assembly, staging, probeId, tankId, shieldId, engineId };
  }

  it('does nothing when altitude >= SUN_HEAT_START_ALTITUDE', () => {
    const { assembly } = makeSolarTestRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    updateSolarHeat(ps, assembly, fs, SUN_HEAT_START_ALTITUDE);

    for (const id of ps.activeParts) {
      expect(ps.heatMap.get(id) ?? 0).toBe(0);
    }
  });

  it('applies heat to all parts when within solar heating zone', () => {
    const { assembly } = makeSolarTestRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    const altitude = SUN_HEAT_START_ALTITUDE / 2;
    updateSolarHeat(ps, assembly, fs, altitude);

    for (const id of ps.activeParts) {
      expect(ps.heatMap.get(id) ?? 0).toBeGreaterThan(0);
    }
  });

  it('destroys all parts instantly in the destruction zone', () => {
    const { assembly } = makeSolarTestRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    const partCountBefore = ps.activeParts.size;
    expect(partCountBefore).toBeGreaterThan(0);

    updateSolarHeat(ps, assembly, fs, SUN_DESTRUCTION_ALTITUDE - 1);

    expect(ps.activeParts.size).toBe(0);
    // Events should be emitted for each destroyed part.
    const destroyEvents = fs.events.filter(e => e.type === 'PART_DESTROYED');
    expect(destroyEvents.length).toBe(partCountBefore);
  });

  it('destruction zone removes parts from firingEngines and heatMap', () => {
    const { assembly, engineId } = makeSolarTestRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    ps.firingEngines.add(engineId);
    ps.heatMap.set(engineId, 100);

    updateSolarHeat(ps, assembly, fs, SUN_DESTRUCTION_ALTITUDE - 1);

    expect(ps.firingEngines.has(engineId)).toBe(false);
    expect(ps.heatMap.has(engineId)).toBe(false);
  });

  it('destruction zone event descriptions mention solar inferno', () => {
    const { assembly } = makeSolarTestRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    updateSolarHeat(ps, assembly, fs, SUN_DESTRUCTION_ALTITUDE - 1);

    const evt = fs.events.find(e => e.type === 'PART_DESTROYED');
    expect(evt).toBeDefined();
    expect(evt.description).toContain('vaporised');
  });

  it('solar heat shield reduces heat on shielded parts', () => {
    const { assembly, probeId, tankId, shieldId, engineId } = makeSolarShieldedRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    // Descending (velY < 0): shield at y=-30 protects parts above (probe, tank).
    ps.velY = -100;

    const altitude = SUN_HEAT_START_ALTITUDE / 2;
    updateSolarHeat(ps, assembly, fs, altitude);

    const probeHeat = ps.heatMap.get(probeId) ?? 0;
    const tankHeat = ps.heatMap.get(tankId) ?? 0;
    const engineHeat = ps.heatMap.get(engineId) ?? 0;

    // Shielded parts should have less heat than unshielded.
    expect(probeHeat).toBeLessThan(engineHeat);
    expect(tankHeat).toBeLessThan(engineHeat);
    // Shielded parts should still get some heat (reduced, not zero).
    expect(probeHeat).toBeGreaterThan(0);
  });

  it('standard heat shield provides STANDARD_SHIELD_SOLAR_RESISTANCE', () => {
    // Use regular heat-shield-mk1 (no solarHeatResistance property).
    const assembly = createRocketAssembly();
    const staging = createStagingConfig();
    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 60);
    const shieldId = addPartToAssembly(assembly, 'heat-shield-mk1', 0, -30);
    const engineId = addPartToAssembly(assembly, 'engine-spark', 0, -55);
    connectParts(assembly, probeId, 1, shieldId, 0);
    connectParts(assembly, shieldId, 1, engineId, 0);
    syncStagingWithAssembly(assembly, staging);

    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);
    ps.velY = -100; // descending — shield at y=-30 protects probe at y=60

    const altitude = SUN_HEAT_START_ALTITUDE / 2;
    updateSolarHeat(ps, assembly, fs, altitude);

    const probeHeat = ps.heatMap.get(probeId) ?? 0;
    const engineHeat = ps.heatMap.get(engineId) ?? 0;

    // Probe is shielded with 0.3 resistance → gets 70% of full heat.
    // Engine is unshielded → gets full heat.
    expect(probeHeat).toBeLessThan(engineHeat);
    expect(probeHeat).toBeGreaterThan(0);
  });

  it('destroys parts when solar heat exceeds tolerance', () => {
    const { assembly, engineId } = makeSolarTestRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Pre-load heat just below tolerance on all parts.
    const placed = assembly.parts.get(engineId);
    const def = placed ? getPartById(placed.partId) : null;
    const tol = getHeatTolerance(def);
    ps.heatMap.set(engineId, tol);

    // Apply solar heat at a close altitude to push over tolerance.
    const altitude = SUN_DESTRUCTION_ALTITUDE + 1_000_000;
    updateSolarHeat(ps, assembly, fs, altitude);

    // Engine should have been destroyed.
    expect(ps.activeParts.has(engineId)).toBe(false);
    const evt = fs.events.find(e => e.type === 'PART_DESTROYED' && e.instanceId === engineId);
    expect(evt).toBeDefined();
    expect(evt.description).toContain('solar radiation');
  });

  it('no shield resistance when no heat shields are active', () => {
    const { assembly } = makeSolarTestRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    const altitude = SUN_HEAT_START_ALTITUDE / 2;
    const solarRate = computeSolarHeatRate(altitude);

    updateSolarHeat(ps, assembly, fs, altitude);

    // All parts get full solar heat rate (no shield).
    for (const id of ps.activeParts) {
      expect(ps.heatMap.get(id)).toBeCloseTo(solarRate, 6);
    }
  });
});
