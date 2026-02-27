/**
 * atmosphere.test.js — Unit tests for the atmosphere model and reentry heat
 * simulation (TASK-021).
 *
 * Tests cover:
 *   airDensity()          — sea-level value, exponential falloff, zero above 70 km
 *   terminalVelocity()    — basic formula, vacuum returns Infinity
 *   isReentryCondition()  — both thresholds (altitude and speed)
 *   computeHeatRate()     — zero below threshold, proportional above
 *   getLeadingPartId()    — ascending vs descending selection
 *   getHeatTolerance()    — defaults for structural / heat shield / custom
 *   updateHeat()          — heat accumulates on leading part, dissipates on others,
 *                           part destroyed when tolerance exceeded, events emitted,
 *                           destroyed parts removed from activeParts / firingEngines
 *   tick() integration    — heat applied when physics tick runs in reentry conditions
 */

import { describe, it, expect } from 'vitest';
import {
  airDensity,
  terminalVelocity,
  isReentryCondition,
  computeHeatRate,
  getLeadingPartId,
  getHeatTolerance,
  updateHeat,
  ATMOSPHERE_TOP,
  SEA_LEVEL_DENSITY,
  SCALE_HEIGHT,
  REENTRY_SPEED_THRESHOLD,
  DEFAULT_HEAT_TOLERANCE,
  HEAT_SHIELD_TOLERANCE,
  HEAT_DISSIPATION_PER_TICK,
} from '../core/atmosphere.js';
import {
  createRocketAssembly,
  addPartToAssembly,
  connectParts,
  createStagingConfig,
  syncStagingWithAssembly,
  assignPartToStage,
} from '../core/rocketbuilder.js';
import { getPartById } from '../data/parts.js';
import { createFlightState } from '../core/gameState.js';
import { createPhysicsState, tick } from '../core/physics.js';

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

  it('non-leading parts with pre-existing heat dissipate during reentry', () => {
    const { assembly } = makeSimpleRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Pre-load heat on ALL parts.
    for (const id of ps.activeParts) ps.heatMap.set(id, 100);

    ps.posY = 50_000;
    ps.velY = -3_000;
    ps.grounded = false;

    const density   = airDensity(50_000);
    const leadingId = findLowestActivePartId(ps, assembly);

    updateHeat(ps, assembly, fs, 3_000, 50_000, density);

    // Every non-leading part should have cooled from 100.
    for (const id of ps.activeParts) {
      if (id !== leadingId) {
        expect(ps.heatMap.get(id)).toBeLessThan(100);
      }
    }
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
    expect(evt.description).toContain('reentry heat');
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
