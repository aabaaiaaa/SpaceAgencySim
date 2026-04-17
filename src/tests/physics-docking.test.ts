import { describe, it, expect } from 'vitest';
import {
  applyDockingMovement,
  computeDockingRadialOut,
} from '../core/physics/docking.ts';
import { createPhysicsState } from '../core/physics/init.ts';
import { BODY_RADIUS, ControlMode } from '../core/constants.ts';
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
// Shared test fixtures — mirrors physics.test.ts's makeSimpleRocket().
// ---------------------------------------------------------------------------

function makeSimpleRocket(): { assembly: RocketAssembly; totalMass: number } {
  const assembly = createRocketAssembly();
  const staging  = createStagingConfig();

  const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0,  60);
  const tankId   = addPartToAssembly(assembly, 'tank-small',     0,   0);
  const engineId = addPartToAssembly(assembly, 'engine-spark',   0, -55);

  connectParts(assembly, probeId, 1, tankId,   0);
  connectParts(assembly, tankId,  1, engineId, 0);

  syncStagingWithAssembly(assembly, staging);
  assignPartToStage(staging, engineId, 0);

  // Wet mass for thrust accel calc — rough figure matching fixture comments.
  return { assembly, totalMass: 620 };
}

function makePs(mode: ControlMode): PhysicsState {
  const { assembly } = makeSimpleRocket();
  const fs = createFlightState({ missionId: 'test-mission', rocketId: 'test-rocket' });
  const ps = createPhysicsState(assembly, fs);
  ps.controlMode = mode;
  ps.grounded = false;
  ps.landed = false;
  return ps;
}

// ---------------------------------------------------------------------------
// computeDockingRadialOut() — body-aware radial direction.
// ---------------------------------------------------------------------------

describe('computeDockingRadialOut()', () => {
  it('flips radial-out on Earth but not on Moon for the same craft state @smoke', () => {
    // Craft at (5_000_000, 0) with velocity (1000, 1000) — prograde ≈ (√½, √½).
    // Initial radial-out = (progY, -progX) = (+√½, -√½).
    // radCheck = progY·posX + (-progX)·(posY + R) = √½·(5_000_000 − R).
    //   EARTH R = 6_371_000 ⇒ radCheck < 0 ⇒ flipped to (-√½, +√½).
    //   MOON  R = 1_737_400 ⇒ radCheck > 0 ⇒ NOT flipped, stays (+√½, -√½).
    const earth = computeDockingRadialOut(5_000_000, 0, 1000, 1000, 0, BODY_RADIUS.EARTH);
    expect(earth.radOutX).toBeLessThan(0);
    expect(earth.radOutY).toBeGreaterThan(0);

    const moon = computeDockingRadialOut(5_000_000, 0, 1000, 1000, 0, BODY_RADIUS.MOON);
    expect(moon.radOutX).toBeGreaterThan(0);
    expect(moon.radOutY).toBeLessThan(0);

    expect(Math.sign(earth.radOutX)).not.toBe(Math.sign(moon.radOutX));
    expect(Math.sign(earth.radOutY)).not.toBe(Math.sign(moon.radOutY));
  });

  it('returns a unit vector (magnitude 1) for non-degenerate velocity', () => {
    const r = computeDockingRadialOut(1_000_000, 100_000, 500, 800, 0.3, BODY_RADIUS.EARTH);
    const mag = Math.hypot(r.radOutX, r.radOutY);
    expect(mag).toBeCloseTo(1, 6);
  });

  it('falls back to prograde from angle when speed is below threshold', () => {
    // speed ≈ 0, angle = 0 ⇒ progX = sin(0) = 0, progY = cos(0) = 1.
    // radOutX = 1, radOutY = 0. radCheck = posX > 0 ⇒ no flip.
    const res = computeDockingRadialOut(10, 0, 0, 0, 0, BODY_RADIUS.MARS);
    expect(res.radOutX).toBeCloseTo(1, 6);
    expect(res.radOutY).toBeCloseTo(0, 6);
  });

  it('produces a different result on MARS vs EARTH (body radius threads through)', () => {
    // For a craft close to the surface (posX small, posY ~ 0), the body radius
    // dominates radCheck — picking different bodies must change the outcome.
    const posX = -5_000_000; // negative posX forces Earth path to flip differently from Mars
    const earth = computeDockingRadialOut(posX, 0, 1000, 1000, 0, BODY_RADIUS.EARTH);
    const mars  = computeDockingRadialOut(posX, 0, 1000, 1000, 0, BODY_RADIUS.MARS);
    // Same inputs, different body radii — at least one component sign should flip.
    const differs =
      Math.sign(earth.radOutX) !== Math.sign(mars.radOutX) ||
      Math.sign(earth.radOutY) !== Math.sign(mars.radOutY) ||
      Math.abs(earth.radOutX - mars.radOutX) > 1e-9 ||
      Math.abs(earth.radOutY - mars.radOutY) > 1e-9;
    expect(differs).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// applyDockingMovement() — RCS-mode craft-relative translation.
// ---------------------------------------------------------------------------

describe('applyDockingMovement() — RCS mode translation @smoke', () => {
  it('no-ops when no keys are held', () => {
    const { assembly, totalMass } = makeSimpleRocket();
    const ps = makePs(ControlMode.RCS);
    ps.velX = 0;
    ps.velY = 0;

    applyDockingMovement(ps, assembly, totalMass, 1 / 60, 'EARTH');

    expect(ps.velX).toBe(0);
    expect(ps.velY).toBe(0);
    expect(ps.rcsActiveDirections.size).toBe(0);
  });

  it('returns early when controlMode is neither DOCKING nor RCS', () => {
    const { assembly, totalMass } = makeSimpleRocket();
    const ps = makePs(ControlMode.NORMAL);
    ps.velX = 0;
    ps.velY = 0;
    ps._heldKeys.add('w');

    applyDockingMovement(ps, assembly, totalMass, 1 / 60, 'EARTH');

    // Neither docking nor RCS — nothing happens.
    expect(ps.velX).toBe(0);
    expect(ps.velY).toBe(0);
    expect(ps.rcsActiveDirections.size).toBe(0);
  });

  it('W with angle 0 adds forward thrust along +Y (craft axis)', () => {
    const { assembly, totalMass } = makeSimpleRocket();
    const ps = makePs(ControlMode.RCS);
    ps.angle = 0;
    ps.velX = 0;
    ps.velY = 0;
    ps._heldKeys.add('w');

    const dt = 1 / 60;
    applyDockingMovement(ps, assembly, totalMass, dt, 'EARTH');

    // RCS thrust = 500 N; accel = 500 / 620 ≈ 0.8065 m/s².
    // angle=0 ⇒ sin=0, cos=1 ⇒ velY += accel*dt, velX unchanged.
    const expectedDv = (500 / totalMass) * dt;
    expect(ps.velX).toBeCloseTo(0, 6);
    expect(ps.velY).toBeCloseTo(expectedDv, 6);
    expect(ps.rcsActiveDirections.has('up')).toBe(true);
  });

  it('S with angle 0 adds backward thrust along -Y', () => {
    const { assembly, totalMass } = makeSimpleRocket();
    const ps = makePs(ControlMode.RCS);
    ps.angle = 0;
    ps._heldKeys.add('s');

    const dt = 1 / 60;
    applyDockingMovement(ps, assembly, totalMass, dt, 'EARTH');

    const expectedDv = -(500 / totalMass) * dt;
    expect(ps.velX).toBeCloseTo(0, 6);
    expect(ps.velY).toBeCloseTo(expectedDv, 6);
    expect(ps.rcsActiveDirections.has('down')).toBe(true);
  });

  it('D with angle 0 adds perpendicular thrust along +X', () => {
    const { assembly, totalMass } = makeSimpleRocket();
    const ps = makePs(ControlMode.RCS);
    ps.angle = 0;
    ps._heldKeys.add('d');

    const dt = 1 / 60;
    applyDockingMovement(ps, assembly, totalMass, dt, 'EARTH');

    // angle=0 ⇒ cosA=1, sinA=0. dvPerpAxis = +accel*dt.
    // ps.velX += dvPerpAxis*cosA = +accel*dt; ps.velY += -dvPerpAxis*sinA = 0.
    const expectedDv = (500 / totalMass) * dt;
    expect(ps.velX).toBeCloseTo(expectedDv, 6);
    expect(ps.velY).toBeCloseTo(0, 6);
    expect(ps.rcsActiveDirections.has('right')).toBe(true);
  });

  it('A with angle 0 adds perpendicular thrust along -X', () => {
    const { assembly, totalMass } = makeSimpleRocket();
    const ps = makePs(ControlMode.RCS);
    ps.angle = 0;
    ps._heldKeys.add('a');

    const dt = 1 / 60;
    applyDockingMovement(ps, assembly, totalMass, dt, 'EARTH');

    const expectedDv = -(500 / totalMass) * dt;
    expect(ps.velX).toBeCloseTo(expectedDv, 6);
    expect(ps.velY).toBeCloseTo(0, 6);
    expect(ps.rcsActiveDirections.has('left')).toBe(true);
  });

  it('rotates RCS thrust by craft angle (90° ⇒ forward becomes +X)', () => {
    const { assembly, totalMass } = makeSimpleRocket();
    const ps = makePs(ControlMode.RCS);
    ps.angle = Math.PI / 2; // rolled 90° clockwise.
    ps._heldKeys.add('w');

    const dt = 1 / 60;
    applyDockingMovement(ps, assembly, totalMass, dt, 'EARTH');

    // sinA=1, cosA=0 ⇒ velX += dvAlongAxis*1, velY += dvAlongAxis*0.
    const expectedDv = (500 / totalMass) * dt;
    expect(ps.velX).toBeCloseTo(expectedDv, 6);
    expect(ps.velY).toBeCloseTo(0, 6);
  });

  it('clears rcsActiveDirections from the previous frame before re-populating', () => {
    const { assembly, totalMass } = makeSimpleRocket();
    const ps = makePs(ControlMode.RCS);
    ps.angle = 0;
    ps.rcsActiveDirections.add('left');   // stale value from previous frame
    ps.rcsActiveDirections.add('right');
    ps._heldKeys.add('w');

    applyDockingMovement(ps, assembly, totalMass, 1 / 60, 'EARTH');

    // Stale 'left' and 'right' are cleared; only 'up' (from W) remains.
    expect(ps.rcsActiveDirections.has('left')).toBe(false);
    expect(ps.rcsActiveDirections.has('right')).toBe(false);
    expect(ps.rcsActiveDirections.has('up')).toBe(true);
  });

  it('combines W+D into both forward and right thrust components', () => {
    const { assembly, totalMass } = makeSimpleRocket();
    const ps = makePs(ControlMode.RCS);
    ps.angle = 0;
    ps._heldKeys.add('w');
    ps._heldKeys.add('d');

    const dt = 1 / 60;
    applyDockingMovement(ps, assembly, totalMass, dt, 'EARTH');

    const accelDt = (500 / totalMass) * dt;
    // angle=0: velX = dvPerp*cos = +accelDt, velY = dvAlong*cos = +accelDt.
    expect(ps.velX).toBeCloseTo(accelDt, 6);
    expect(ps.velY).toBeCloseTo(accelDt, 6);
    expect(ps.rcsActiveDirections.has('up')).toBe(true);
    expect(ps.rcsActiveDirections.has('right')).toBe(true);
  });

  it('uses combined mass when docked (reduces acceleration)', () => {
    const { assembly, totalMass } = makeSimpleRocket();
    const ps = makePs(ControlMode.RCS);
    ps.angle = 0;
    ps._dockedCombinedMass = totalMass * 4; // simulate docked to a larger craft
    ps._heldKeys.add('w');

    const dt = 1 / 60;
    applyDockingMovement(ps, assembly, totalMass, dt, 'EARTH');

    // Effective mass = 4 * totalMass, so accel is ¼ of undocked.
    const expectedDv = (500 / (totalMass * 4)) * dt;
    expect(ps.velY).toBeCloseTo(expectedDv, 6);
  });
});
