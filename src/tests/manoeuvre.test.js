/**
 * manoeuvre.test.js — Unit tests for the orbital manoeuvre system (TASK-024).
 *
 * Tests cover:
 *   Orbit recalculation      — elements update after state vector changes
 *   Orbital burn detection    — isOrbitalBurnActive in various control modes
 *   Transfer delta-v          — Earth→Moon and Moon→Earth Hohmann transfers
 *   Transfer targets          — target list generation
 *   SOI transitions           — escape and child-body entry detection
 *   Escape trajectory         — specific energy check
 *   Gravity assist            — turn angle and delta-v computation
 *   Manoeuvre phase logic     — shouldEnterManoeuvre / shouldExitManoeuvre
 *   Transfer phase logic      — shouldEnterTransfer
 *   Route planning            — transfer route computation
 *   Formatting helpers        — time and delta-v display strings
 */

import { describe, it, expect } from 'vitest';
import {
  recalculateOrbit,
  isOrbitalBurnActive,
  computeTransferDeltaV,
  getTransferTargets,
  checkSOITransition,
  isEscapeTrajectory,
  computeGravityAssist,
  applyGravityAssist,
  shouldEnterManoeuvre,
  shouldExitManoeuvre,
  shouldEnterTransfer,
  computeTransferRoute,
  formatTransferTime,
  formatDeltaV,
  SOI_RADIUS,
  BODY_ORBIT_RADIUS,
  BODY_PARENT,
  BODY_CHILDREN,
} from '../core/manoeuvre.js';
import {
  CelestialBody,
  BODY_GM,
  BODY_RADIUS,
  FlightPhase,
  ControlMode,
} from '../core/constants.js';
import { circularOrbitVelocity } from '../core/orbit.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Create a minimal PhysicsState-like object for testing.
 */
function makePs(overrides = {}) {
  return {
    posX: 0,
    posY: 150_000,                   // 150 km altitude (LEO)
    velX: 7800,                      // ~orbital velocity
    velY: 0,
    angle: 0,
    throttle: 0,
    firingEngines: new Set(),
    controlMode: ControlMode.NORMAL,
    ...overrides,
  };
}

/**
 * Create a minimal FlightState-like object for testing.
 */
function makeFlightState(overrides = {}) {
  return {
    phase: FlightPhase.ORBIT,
    bodyId: CelestialBody.EARTH,
    timeElapsed: 0,
    inOrbit: true,
    orbitalElements: null,
    phaseLog: [],
    events: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Constants and data structure tests
// ---------------------------------------------------------------------------

describe('Manoeuvre — constants', () => {
  it('defines SOI radii for Earth and Moon', () => {
    expect(SOI_RADIUS.EARTH).toBeGreaterThan(0);
    expect(SOI_RADIUS.MOON).toBeGreaterThan(0);
    expect(SOI_RADIUS.EARTH).toBeGreaterThan(SOI_RADIUS.MOON);
  });

  it('defines Moon orbital radius around Earth', () => {
    expect(BODY_ORBIT_RADIUS.MOON).toBeCloseTo(384_400_000, -5);
  });

  it('defines parent-child relationships', () => {
    expect(BODY_PARENT.SUN).toBeNull();
    expect(BODY_PARENT.EARTH).toBe('SUN');
    expect(BODY_PARENT.MOON).toBe('EARTH');
    expect(BODY_CHILDREN.SUN).toContain('EARTH');
    expect(BODY_CHILDREN.EARTH).toContain('MOON');
    expect(BODY_CHILDREN.MOON).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Orbit recalculation
// ---------------------------------------------------------------------------

describe('Manoeuvre — recalculateOrbit', () => {
  it('returns valid elements for a circular LEO orbit', () => {
    const v = circularOrbitVelocity(150_000, CelestialBody.EARTH);
    const ps = makePs({ posX: 0, posY: 150_000, velX: v, velY: 0 });
    const elements = recalculateOrbit(ps, CelestialBody.EARTH, 0);

    expect(elements).not.toBeNull();
    expect(elements.semiMajorAxis).toBeGreaterThan(BODY_RADIUS.EARTH);
    expect(elements.eccentricity).toBeLessThan(0.01);
  });

  it('returns null for escape trajectory', () => {
    // Very high velocity at low altitude → escape
    const ps = makePs({ posX: 0, posY: 150_000, velX: 20_000, velY: 0 });
    const elements = recalculateOrbit(ps, CelestialBody.EARTH, 0);
    expect(elements).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Orbital burn detection
// ---------------------------------------------------------------------------

describe('Manoeuvre — isOrbitalBurnActive', () => {
  it('returns true when throttle > 0 and engines are firing in NORMAL mode', () => {
    const ps = makePs({ throttle: 0.5, firingEngines: new Set(['eng1']) });
    expect(isOrbitalBurnActive(ps)).toBe(true);
  });

  it('returns false in DOCKING mode even with throttle', () => {
    const ps = makePs({
      throttle: 0.5,
      firingEngines: new Set(['eng1']),
      controlMode: ControlMode.DOCKING,
    });
    expect(isOrbitalBurnActive(ps)).toBe(false);
  });

  it('returns false in RCS mode', () => {
    const ps = makePs({
      throttle: 0.5,
      firingEngines: new Set(['eng1']),
      controlMode: ControlMode.RCS,
    });
    expect(isOrbitalBurnActive(ps)).toBe(false);
  });

  it('returns false when throttle is zero', () => {
    const ps = makePs({ throttle: 0, firingEngines: new Set(['eng1']) });
    expect(isOrbitalBurnActive(ps)).toBe(false);
  });

  it('returns false when no engines are firing', () => {
    const ps = makePs({ throttle: 1, firingEngines: new Set() });
    expect(isOrbitalBurnActive(ps)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Transfer delta-v calculations
// ---------------------------------------------------------------------------

describe('Manoeuvre — computeTransferDeltaV', () => {
  it('returns null for same-body transfer', () => {
    const result = computeTransferDeltaV(CelestialBody.EARTH, CelestialBody.EARTH, 150_000);
    expect(result).toBeNull();
  });

  it('computes Earth → Moon transfer with reasonable delta-v', () => {
    const result = computeTransferDeltaV(CelestialBody.EARTH, CelestialBody.MOON, 150_000);
    expect(result).not.toBeNull();
    expect(result.departureDV).toBeGreaterThan(2000);   // ~3.1 km/s departure
    expect(result.departureDV).toBeLessThan(5000);
    expect(result.captureDV).toBeGreaterThan(100);
    expect(result.totalDV).toBeGreaterThan(result.departureDV);
    expect(result.transferTime).toBeGreaterThan(100_000);  // ~5 days
    expect(result.transferTime).toBeLessThan(1_000_000);
  });

  it('computes Moon → Earth transfer with reasonable delta-v', () => {
    const result = computeTransferDeltaV(CelestialBody.MOON, CelestialBody.EARTH, 50_000);
    expect(result).not.toBeNull();
    expect(result.departureDV).toBeGreaterThan(500);
    expect(result.totalDV).toBeGreaterThan(result.departureDV);
    expect(result.transferTime).toBeGreaterThan(100_000);
  });

  it('departure delta-v decreases with higher orbit altitude', () => {
    const lowOrbit = computeTransferDeltaV(CelestialBody.EARTH, CelestialBody.MOON, 150_000);
    const highOrbit = computeTransferDeltaV(CelestialBody.EARTH, CelestialBody.MOON, 2_000_000);
    // Higher orbit means less energy needed to reach Moon.
    expect(highOrbit.departureDV).toBeLessThan(lowOrbit.departureDV);
  });
});

// ---------------------------------------------------------------------------
// Transfer targets
// ---------------------------------------------------------------------------

describe('Manoeuvre — getTransferTargets', () => {
  it('returns Moon as target when orbiting Earth', () => {
    const targets = getTransferTargets(CelestialBody.EARTH, 150_000);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.some(t => t.bodyId === CelestialBody.MOON)).toBe(true);
  });

  it('returns Earth as target when orbiting Moon', () => {
    const targets = getTransferTargets(CelestialBody.MOON, 50_000);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.some(t => t.bodyId === CelestialBody.EARTH)).toBe(true);
  });

  it('includes delta-v and transfer time for each target', () => {
    const targets = getTransferTargets(CelestialBody.EARTH, 150_000);
    for (const t of targets) {
      expect(t.departureDV).toBeGreaterThan(0);
      expect(t.totalDV).toBeGreaterThan(0);
      expect(t.transferTime).toBeGreaterThan(0);
      expect(t.name).toBeTruthy();
    }
  });
});

// ---------------------------------------------------------------------------
// SOI transition detection
// ---------------------------------------------------------------------------

describe('Manoeuvre — checkSOITransition', () => {
  it('no transition for normal LEO orbit', () => {
    const ps = makePs({ posX: 0, posY: 150_000, velX: 7800, velY: 0 });
    const fs = makeFlightState();
    const result = checkSOITransition(ps, fs);
    expect(result.transition).toBe(false);
  });

  it('detects Moon SOI entry on transfer trajectory', () => {
    // Position near Moon's orbital distance with high velocity.
    const moonDist = BODY_ORBIT_RADIUS.MOON;
    const ps = makePs({
      posX: 0,
      posY: moonDist - BODY_RADIUS.EARTH,
      velX: 1100,
      velY: 0,
    });
    const fs = makeFlightState();
    const result = checkSOITransition(ps, fs);
    expect(result.transition).toBe(true);
    expect(result.newBodyId).toBe(CelestialBody.MOON);
  });
});

// ---------------------------------------------------------------------------
// Escape trajectory detection
// ---------------------------------------------------------------------------

describe('Manoeuvre — isEscapeTrajectory', () => {
  it('returns false for bound orbit', () => {
    const v = circularOrbitVelocity(150_000, CelestialBody.EARTH);
    const ps = makePs({ posX: 0, posY: 150_000, velX: v, velY: 0 });
    expect(isEscapeTrajectory(ps, CelestialBody.EARTH)).toBe(false);
  });

  it('returns true when velocity exceeds escape velocity', () => {
    const ps = makePs({ posX: 0, posY: 150_000, velX: 20_000, velY: 0 });
    expect(isEscapeTrajectory(ps, CelestialBody.EARTH)).toBe(true);
  });

  it('returns false at zero velocity', () => {
    const ps = makePs({ posX: 0, posY: 150_000, velX: 0, velY: 0 });
    expect(isEscapeTrajectory(ps, CelestialBody.EARTH)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Gravitational assist
// ---------------------------------------------------------------------------

describe('Manoeuvre — computeGravityAssist', () => {
  it('returns zero delta-v for zero excess speed', () => {
    const result = computeGravityAssist(CelestialBody.MOON, 50_000, 0);
    expect(result.valid).toBe(true);
    expect(result.deltaV).toBe(0);
    expect(result.turnAngle).toBe(0);
  });

  it('returns invalid for negative periapsis altitude', () => {
    const result = computeGravityAssist(CelestialBody.MOON, -1000, 1000);
    expect(result.valid).toBe(false);
  });

  it('computes reasonable turn angle for lunar flyby', () => {
    // 1 km/s excess speed, 50 km periapsis at Moon.
    const result = computeGravityAssist(CelestialBody.MOON, 50_000, 1000);
    expect(result.valid).toBe(true);
    expect(result.turnAngle).toBeGreaterThan(0);
    expect(result.turnAngle).toBeLessThan(Math.PI); // < 180°
    expect(result.deltaV).toBeGreaterThan(0);
    expect(result.deltaV).toBeLessThan(2000); // max 2v∞
  });

  it('higher excess speed gives smaller turn angle', () => {
    const slow = computeGravityAssist(CelestialBody.MOON, 50_000, 500);
    const fast = computeGravityAssist(CelestialBody.MOON, 50_000, 2000);
    expect(fast.turnAngle).toBeLessThan(slow.turnAngle);
  });

  it('lower periapsis gives larger turn angle', () => {
    const high = computeGravityAssist(CelestialBody.MOON, 100_000, 1000);
    const low = computeGravityAssist(CelestialBody.MOON, 20_000, 1000);
    expect(low.turnAngle).toBeGreaterThan(high.turnAngle);
  });
});

// ---------------------------------------------------------------------------
// Phase logic — shouldEnterManoeuvre
// ---------------------------------------------------------------------------

describe('Manoeuvre — shouldEnterManoeuvre', () => {
  it('returns true when in ORBIT with active burn', () => {
    const ps = makePs({ throttle: 1, firingEngines: new Set(['eng1']) });
    const fs = makeFlightState({ phase: FlightPhase.ORBIT });
    expect(shouldEnterManoeuvre(ps, fs)).toBe(true);
  });

  it('returns false when not in ORBIT', () => {
    const ps = makePs({ throttle: 1, firingEngines: new Set(['eng1']) });
    const fs = makeFlightState({ phase: FlightPhase.FLIGHT });
    expect(shouldEnterManoeuvre(ps, fs)).toBe(false);
  });

  it('returns false when not thrusting', () => {
    const ps = makePs({ throttle: 0 });
    const fs = makeFlightState({ phase: FlightPhase.ORBIT });
    expect(shouldEnterManoeuvre(ps, fs)).toBe(false);
  });

  it('returns false in docking mode', () => {
    const ps = makePs({
      throttle: 1,
      firingEngines: new Set(['eng1']),
      controlMode: ControlMode.DOCKING,
    });
    const fs = makeFlightState({ phase: FlightPhase.ORBIT });
    expect(shouldEnterManoeuvre(ps, fs)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase logic — shouldExitManoeuvre
// ---------------------------------------------------------------------------

describe('Manoeuvre — shouldExitManoeuvre', () => {
  it('returns true in MANOEUVRE with no burn and valid orbit', () => {
    const v = circularOrbitVelocity(150_000, CelestialBody.EARTH);
    const ps = makePs({ posX: 0, posY: 150_000, velX: v, velY: 0, throttle: 0 });
    const fs = makeFlightState({ phase: FlightPhase.MANOEUVRE });
    expect(shouldExitManoeuvre(ps, fs, CelestialBody.EARTH)).toBe(true);
  });

  it('returns false when still burning', () => {
    const v = circularOrbitVelocity(150_000, CelestialBody.EARTH);
    const ps = makePs({
      posX: 0, posY: 150_000, velX: v, velY: 0,
      throttle: 1, firingEngines: new Set(['eng1']),
    });
    const fs = makeFlightState({ phase: FlightPhase.MANOEUVRE });
    expect(shouldExitManoeuvre(ps, fs, CelestialBody.EARTH)).toBe(false);
  });

  it('returns false when not in MANOEUVRE phase', () => {
    const v = circularOrbitVelocity(150_000, CelestialBody.EARTH);
    const ps = makePs({ posX: 0, posY: 150_000, velX: v, velY: 0, throttle: 0 });
    const fs = makeFlightState({ phase: FlightPhase.ORBIT });
    expect(shouldExitManoeuvre(ps, fs, CelestialBody.EARTH)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Phase logic — shouldEnterTransfer
// ---------------------------------------------------------------------------

describe('Manoeuvre — shouldEnterTransfer', () => {
  it('returns true when on escape trajectory in ORBIT', () => {
    const ps = makePs({ posX: 0, posY: 150_000, velX: 20_000, velY: 0 });
    const fs = makeFlightState({ phase: FlightPhase.ORBIT });
    expect(shouldEnterTransfer(ps, fs)).toBe(true);
  });

  it('returns true when on escape trajectory in MANOEUVRE', () => {
    const ps = makePs({ posX: 0, posY: 150_000, velX: 20_000, velY: 0 });
    const fs = makeFlightState({ phase: FlightPhase.MANOEUVRE });
    expect(shouldEnterTransfer(ps, fs)).toBe(true);
  });

  it('returns false for bound orbit', () => {
    const v = circularOrbitVelocity(150_000, CelestialBody.EARTH);
    const ps = makePs({ posX: 0, posY: 150_000, velX: v, velY: 0 });
    const fs = makeFlightState({ phase: FlightPhase.ORBIT });
    expect(shouldEnterTransfer(ps, fs)).toBe(false);
  });

  it('returns false in FLIGHT phase', () => {
    const ps = makePs({ posX: 0, posY: 150_000, velX: 20_000, velY: 0 });
    const fs = makeFlightState({ phase: FlightPhase.FLIGHT });
    expect(shouldEnterTransfer(ps, fs)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Route planning
// ---------------------------------------------------------------------------

describe('Manoeuvre — computeTransferRoute', () => {
  it('returns a route for Earth → Moon', () => {
    const route = computeTransferRoute(
      CelestialBody.EARTH, CelestialBody.MOON, 150_000, null,
    );
    expect(route).not.toBeNull();
    expect(route.fromBodyId).toBe(CelestialBody.EARTH);
    expect(route.toBodyId).toBe(CelestialBody.MOON);
    expect(route.departureDV).toBeGreaterThan(0);
    expect(route.burnDirection).toBe('PROGRADE');
    expect(route.burnPoint).toBe('periapsis');
    expect(route.transferPath.length).toBeGreaterThan(0);
  });

  it('returns a route for Moon → Earth', () => {
    const route = computeTransferRoute(
      CelestialBody.MOON, CelestialBody.EARTH, 50_000, null,
    );
    expect(route).not.toBeNull();
    expect(route.burnDirection).toBe('RETROGRADE');
    expect(route.transferPath.length).toBeGreaterThan(0);
  });

  it('returns null for same body', () => {
    const route = computeTransferRoute(
      CelestialBody.EARTH, CelestialBody.EARTH, 150_000, null,
    );
    expect(route).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

describe('Manoeuvre — formatTransferTime', () => {
  it('formats seconds as minutes', () => {
    expect(formatTransferTime(120)).toBe('2 min');
    expect(formatTransferTime(300)).toBe('5 min');
  });

  it('formats seconds as hours', () => {
    expect(formatTransferTime(7200)).toBe('2.0 hr');
  });

  it('formats seconds as days', () => {
    expect(formatTransferTime(259200)).toBe('3.0 days');
  });
});

describe('Manoeuvre — formatDeltaV', () => {
  it('formats small values in m/s', () => {
    expect(formatDeltaV(500)).toBe('500 m/s');
  });

  it('formats large values in km/s', () => {
    expect(formatDeltaV(3100)).toBe('3.1 km/s');
  });
});
