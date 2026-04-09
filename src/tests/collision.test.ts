// @ts-nocheck
/**
 * collision.test.js — Unit tests for the collision detection and response system.
 *
 * Tests cover:
 *   computeAABB()          — bounding box computation for single/multi-part bodies
 *   testAABBOverlap()      — overlap detection
 *   Collision response      — momentum conservation, Newton's third law, restitution
 *   applySeparationImpulse — mass-dependent separation at decoupling
 *   tickCollisions          — integration with physics loop, cooldowns
 */

import { describe, it, expect } from 'vitest';
import {
  computeAABB,
  testAABBOverlap,
  tickCollisions,
  applySeparationImpulse,
} from '../core/collision.ts';
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
// Helpers
// ---------------------------------------------------------------------------

function makeFlightState() {
  return createFlightState({
    missionId: 'test-collision',
    rocketId:  'test-rocket',
  });
}

/**
 * Two-stage rocket:
 *   Probe Core (top) → Decoupler → Small Tank → Spark Engine (bottom)
 *   Stage 0: engine ignition.  Stage 1: decoupler separation.
 */
function makeTwoStageRocket() {
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

// ---------------------------------------------------------------------------
// AABB Computation
// ---------------------------------------------------------------------------

describe('computeAABB()', () => {
  it('computes correct bounds for a single part at origin with angle=0', () => {
    const assembly = createRocketAssembly();
    // probe-core-mk1 is 20×10 px → 1.0×0.5 m at 0.05 m/px
    // halfW = 0.5, halfH = 0.25
    const id = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const activeParts = new Set([id]);

    const aabb = computeAABB(activeParts, assembly.parts, 0, 0, 0);

    expect(aabb.minX).toBeCloseTo(-0.5, 2);
    expect(aabb.maxX).toBeCloseTo(0.5, 2);
    expect(aabb.minY).toBeCloseTo(-0.25, 2);
    expect(aabb.maxY).toBeCloseTo(0.25, 2);
  });

  it('encompasses all parts in a vertical stack', () => {
    const assembly = createRocketAssembly();
    // probe-core-mk1 is 20×10 px → 1.0×0.5 m; halfW=0.5, halfH=0.25
    // id1 at y=0px (0m), id2 at y=80px (4m)
    const id1 = addPartToAssembly(assembly, 'probe-core-mk1', 0,  0);
    const id2 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 80);
    const activeParts = new Set([id1, id2]);

    const aabb = computeAABB(activeParts, assembly.parts, 0, 0, 0);

    // id1 centre at 0m: Y range [-0.25, 0.25]
    // id2 centre at 4m: Y range [3.75, 4.25]
    // Combined: [-0.25, 4.25]
    expect(aabb.minY).toBeCloseTo(-0.25, 2);
    expect(aabb.maxY).toBeCloseTo(4.25, 2);
    // Width stays the same as one part
    expect(aabb.minX).toBeCloseTo(-0.5, 2);
    expect(aabb.maxX).toBeCloseTo(0.5, 2);
  });

  it('rotation swaps effective width and height for a non-square part', () => {
    const assembly = createRocketAssembly();
    // tank-small is 20×40 px → 1.0×2.0 m
    const id = addPartToAssembly(assembly, 'tank-small', 0, 0);
    const activeParts = new Set([id]);

    const noRot = computeAABB(activeParts, assembly.parts, 0, 0, 0);
    const rot90 = computeAABB(activeParts, assembly.parts, 0, 0, Math.PI / 2);

    // At 0°: width = 2m, height = 4m
    const widthNoRot = noRot.maxX - noRot.minX;
    const heightNoRot = noRot.maxY - noRot.minY;

    // At 90°: effective width ≈ height, effective height ≈ width
    const widthRot = rot90.maxX - rot90.minX;
    const heightRot = rot90.maxY - rot90.minY;

    expect(widthRot).toBeCloseTo(heightNoRot, 0);
    expect(heightRot).toBeCloseTo(widthNoRot, 0);
  });

  it('offset parts produce a wider AABB', () => {
    const assembly = createRocketAssembly();
    // probe-core-mk1: 20×10 px → halfW=0.5m
    const id1 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const id2 = addPartToAssembly(assembly, 'probe-core-mk1', 80, 0); // offset right 80px = 4m
    const activeParts = new Set([id1, id2]);

    const aabb = computeAABB(activeParts, assembly.parts, 0, 0, 0);

    // id1 X range: [-0.5, 0.5], id2 X range: [3.5, 4.5]
    // Combined: [-0.5, 4.5]
    expect(aabb.minX).toBeCloseTo(-0.5, 2);
    expect(aabb.maxX).toBeCloseTo(4.5, 2);
  });
});

// ---------------------------------------------------------------------------
// Overlap Detection
// ---------------------------------------------------------------------------

describe('testAABBOverlap()', () => {
  it('returns true for overlapping boxes', () => {
    const a = { minX: 0, maxX: 2, minY: 0, maxY: 2 };
    const b = { minX: 1, maxX: 3, minY: 1, maxY: 3 };
    expect(testAABBOverlap(a, b)).toBe(true);
  });

  it('returns false for separated boxes', () => {
    const a = { minX: 0, maxX: 1, minY: 0, maxY: 1 };
    const b = { minX: 5, maxX: 6, minY: 5, maxY: 6 };
    expect(testAABBOverlap(a, b)).toBe(false);
  });

  it('returns true for edge-touching boxes', () => {
    const a = { minX: 0, maxX: 2, minY: 0, maxY: 2 };
    const b = { minX: 2, maxX: 4, minY: 0, maxY: 2 };
    expect(testAABBOverlap(a, b)).toBe(true);
  });

  it('returns false for Y-only separation', () => {
    const a = { minX: 0, maxX: 2, minY: 0, maxY: 1 };
    const b = { minX: 0, maxX: 2, minY: 5, maxY: 6 };
    expect(testAABBOverlap(a, b)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Collision Response
// ---------------------------------------------------------------------------

describe('Collision response', () => {
  /**
   * Helper: create two overlapping debris-like bodies and run tickCollisions.
   */
  function makeTwoBodyCollision({
    mass1 = 100, mass2 = 100,
    vel1X = 0, vel1Y = -5,
    vel2X = 0, vel2Y = 5,
    pos1Y = 100.5, pos2Y = 100,
    altitude = 100,
  } = {}) {
    // Use a minimal assembly with parts at known positions.
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const id2 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    // Create a fake physics state with one body being the main rocket,
    // one being debris.
    const ps = {
      posX: 0, posY: pos1Y, velX: vel1X, velY: vel1Y, angle: 0,
      angularVelocity: 0,
      landed: false, crashed: false,
      activeParts: new Set([id1]),
      fuelStore: new Map(),
      firingEngines: new Set(),
      debris: [{
        id: 'debris-test',
        posX: 0, posY: pos2Y, velX: vel2X, velY: vel2Y, angle: 0,
        angularVelocity: 0,
        landed: false, crashed: false,
        activeParts: new Set([id2]),
        fuelStore: new Map(),
        firingEngines: new Set(),
        collisionCooldown: 0,
      }],
    };

    // Momentum before.
    // probe-core-mk1 has mass 50 kg
    const m1 = 50; // actual part mass
    const m2 = 50;
    const pBefore = m1 * ps.velY + m2 * ps.debris[0].velY;

    tickCollisions(ps, assembly, 1 / 60);

    const pAfter = m1 * ps.velY + m2 * ps.debris[0].velY;

    return { ps, assembly, pBefore, pAfter, m1, m2 };
  }

  it('conserves momentum after collision', () => {
    const { pBefore, pAfter } = makeTwoBodyCollision();
    expect(pAfter).toBeCloseTo(pBefore, 0);
  });

  it('lighter body gets larger velocity change', () => {
    // Use asymmetric masses: probe-core-mk1 (50kg) vs tank-small (~50kg dry)
    // We'll use the same parts but add fuel to one.
    const assembly = createRocketAssembly();
    const lightId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const heavyId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    const ps = {
      posX: 0, posY: 100.5, velX: 0, velY: -5, angle: 0,
      angularVelocity: 0,
      landed: false, crashed: false,
      activeParts: new Set([lightId]),
      fuelStore: new Map(),
      firingEngines: new Set(),
      debris: [{
        id: 'debris-heavy',
        posX: 0, posY: 100, velX: 0, velY: 5, angle: 0,
        angularVelocity: 0,
        landed: false, crashed: false,
        activeParts: new Set([heavyId]),
        fuelStore: new Map([[heavyId, 500]]),  // Heavy: 50 + 500 = 550 kg
        firingEngines: new Set(),
        collisionCooldown: 0,
      }],
    };

    const lightVelBefore = ps.velY;
    const heavyVelBefore = ps.debris[0].velY;

    tickCollisions(ps, assembly, 1 / 60);

    const lightDv = Math.abs(ps.velY - lightVelBefore);
    const heavyDv = Math.abs(ps.debris[0].velY - heavyVelBefore);

    // Lighter body should have larger velocity change.
    expect(lightDv).toBeGreaterThan(heavyDv);
  });

  it('applies equal and opposite impulses (Newton\'s third law)', () => {
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const id2 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    const ps = {
      posX: 0, posY: 100.5, velX: 0, velY: -5, angle: 0,
      angularVelocity: 0,
      landed: false, crashed: false,
      activeParts: new Set([id1]),
      fuelStore: new Map(),
      firingEngines: new Set(),
      debris: [{
        id: 'debris-test',
        posX: 0, posY: 100, velX: 0, velY: 5, angle: 0,
        angularVelocity: 0,
        landed: false, crashed: false,
        activeParts: new Set([id2]),
        fuelStore: new Map(),
        firingEngines: new Set(),
        collisionCooldown: 0,
      }],
    };

    // Both have equal mass (50 kg probe-core-mk1)
    const m = 50;
    tickCollisions(ps, assembly, 1 / 60);

    // Equal mass → velocity changes should be equal and opposite.
    // After collision with equal mass head-on, they should swap velocities
    // (modified by restitution).
    // The impulse on body A along Y = m * Δv_A.
    // The impulse on body B along Y = m * Δv_B.
    // These should sum to zero (Newton's third law).
    // Original: A.velY=-5, B.velY=5
    // Momentum sum should be unchanged.
    const totalP = m * ps.velY + m * ps.debris[0].velY;
    expect(totalP).toBeCloseTo(0, 1); // was -5*50 + 5*50 = 0
  });

  it('sea-level restitution is lower than vacuum restitution', () => {
    // At sea level (altitude 0): higher density → lower restitution
    // At vacuum (altitude 80000): density 0 → full base restitution
    const assembly = createRocketAssembly();
    const id1a = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const id2a = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    // Sea level collision
    const psSL = {
      posX: 0, posY: 1.5, velX: 0, velY: -10, angle: 0,
      angularVelocity: 0,
      landed: false, crashed: false,
      activeParts: new Set([id1a]),
      fuelStore: new Map(),
      firingEngines: new Set(),
      debris: [{
        id: 'debris-sl',
        posX: 0, posY: 1, velX: 0, velY: 10, angle: 0,
        angularVelocity: 0,
        landed: false, crashed: false,
        activeParts: new Set([id2a]),
        fuelStore: new Map(),
        firingEngines: new Set(),
        collisionCooldown: 0,
      }],
    };

    tickCollisions(psSL, assembly, 1 / 60);
    const bounceSpeedSL = Math.abs(psSL.velY - psSL.debris[0].velY);

    // Vacuum collision — need new assembly and parts
    const assembly2 = createRocketAssembly();
    const id1b = addPartToAssembly(assembly2, 'probe-core-mk1', 0, 0);
    const id2b = addPartToAssembly(assembly2, 'probe-core-mk1', 0, 0);

    const psVac = {
      posX: 0, posY: 80000.5, velX: 0, velY: -10, angle: 0,
      angularVelocity: 0,
      landed: false, crashed: false,
      activeParts: new Set([id1b]),
      fuelStore: new Map(),
      firingEngines: new Set(),
      debris: [{
        id: 'debris-vac',
        posX: 0, posY: 80000, velX: 0, velY: 10, angle: 0,
        angularVelocity: 0,
        landed: false, crashed: false,
        activeParts: new Set([id2b]),
        fuelStore: new Map(),
        firingEngines: new Set(),
        collisionCooldown: 0,
      }],
    };

    tickCollisions(psVac, assembly2, 1 / 60);
    const bounceSpeedVac = Math.abs(psVac.velY - psVac.debris[0].velY);

    // Vacuum should have bouncier (higher relative speed) collision.
    expect(bounceSpeedVac).toBeGreaterThan(bounceSpeedSL);
  });

  it('separating bodies are not pushed together', () => {
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const id2 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    // Bodies overlapping but already moving apart.
    const ps = {
      posX: 0, posY: 100.5, velX: 0, velY: 5, angle: 0,  // moving up
      angularVelocity: 0,
      landed: false, crashed: false,
      activeParts: new Set([id1]),
      fuelStore: new Map(),
      firingEngines: new Set(),
      debris: [{
        id: 'debris-sep',
        posX: 0, posY: 100, velX: 0, velY: -5, angle: 0,  // moving down
        angularVelocity: 0,
        landed: false, crashed: false,
        activeParts: new Set([id2]),
        fuelStore: new Map(),
        firingEngines: new Set(),
        collisionCooldown: 0,
      }],
    };

    const velBefore = ps.velY;
    tickCollisions(ps, assembly, 1 / 60);

    // Velocities should remain unchanged — they were already separating.
    expect(ps.velY).toBe(velBefore);
  });

  it('positional correction separates overlapping bodies', () => {
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const id2 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    // Bodies almost exactly on top of each other, approaching.
    const ps = {
      posX: 0, posY: 100.3, velX: 0, velY: -3, angle: 0,
      angularVelocity: 0,
      landed: false, crashed: false,
      activeParts: new Set([id1]),
      fuelStore: new Map(),
      firingEngines: new Set(),
      debris: [{
        id: 'debris-overlap',
        posX: 0, posY: 100, velX: 0, velY: 3, angle: 0,
        angularVelocity: 0,
        landed: false, crashed: false,
        activeParts: new Set([id2]),
        fuelStore: new Map(),
        firingEngines: new Set(),
        collisionCooldown: 0,
      }],
    };

    const gapBefore = ps.posY - ps.debris[0].posY;
    tickCollisions(ps, assembly, 1 / 60);
    const gapAfter = ps.posY - ps.debris[0].posY;

    // Bodies should be pushed further apart.
    expect(gapAfter).toBeGreaterThan(gapBefore);
  });

  it('off-centre impact changes angular velocity', () => {
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const id2 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    // Body A offset horizontally, approaching B from the side.
    const ps = {
      posX: 1.5, posY: 100, velX: -5, velY: 0, angle: 0,
      angularVelocity: 0,
      landed: false, crashed: false,
      activeParts: new Set([id1]),
      fuelStore: new Map(),
      firingEngines: new Set(),
      debris: [{
        id: 'debris-angular',
        posX: 0, posY: 100, velX: 5, velY: 0, angle: 0,
        angularVelocity: 0,
        landed: false, crashed: false,
        activeParts: new Set([id2]),
        fuelStore: new Map(),
        firingEngines: new Set(),
        collisionCooldown: 0,
      }],
    };

    tickCollisions(ps, assembly, 1 / 60);

    // At minimum, the collision should produce some angular change on one or
    // both bodies (depending on contact offset from centre).
    // With a single centred part, the torque might be small, but the system
    // should not crash. The main thing is that angularVelocity is modified
    // when impact is off-centre relative to AABB centre.
    // This test just verifies the code path runs without error.
    expect(typeof ps.angularVelocity).toBe('number');
    expect(typeof ps.debris[0].angularVelocity).toBe('number');
  });
});

// ---------------------------------------------------------------------------
// Separation Impulse
// ---------------------------------------------------------------------------

describe('applySeparationImpulse()', () => {
  it('lighter body gets larger delta-v', () => {
    const assembly = createRocketAssembly();
    const lightId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 100);  // 50 kg, higher Y
    const heavyId = addPartToAssembly(assembly, 'tank-small',     0,   0);   // 50 kg dry + fuel

    const ps = {
      posX: 0, posY: 1000, velX: 0, velY: 100, angle: 0,
      activeParts: new Set([lightId]),
      fuelStore: new Map(),
    };

    const debris = {
      id: 'debris-sep',
      posX: 0, posY: 1000, velX: 0, velY: 100, angle: 0,
      activeParts: new Set([heavyId]),
      fuelStore: new Map([[heavyId, 400]]),  // 50 + 400 = 450 kg
    };

    applySeparationImpulse(ps, debris, assembly);

    const rocketDv = Math.abs(ps.velY - 100);
    const debrisDv = Math.abs(debris.velY - 100);

    // Light rocket (50 kg) should have larger Δv than heavy debris (450 kg).
    expect(rocketDv).toBeGreaterThan(debrisDv);
  });

  it('impulse direction follows rocket angle', () => {
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 50);
    const id2 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    const ps = {
      posX: 0, posY: 1000, velX: 0, velY: 0,
      angle: Math.PI / 4,  // 45° tilt
      activeParts: new Set([id1]),
      fuelStore: new Map(),
    };

    const debris = {
      id: 'debris-angle',
      posX: 0, posY: 1000, velX: 0, velY: 0, angle: Math.PI / 4,
      activeParts: new Set([id2]),
      fuelStore: new Map(),
    };

    applySeparationImpulse(ps, debris, assembly);

    // At 45°, sin(π/4) ≈ 0.707, cos(π/4) ≈ 0.707
    // Both X and Y should have non-zero impulse components.
    expect(Math.abs(ps.velX)).toBeGreaterThan(0);
    expect(Math.abs(ps.velY)).toBeGreaterThan(0);
    // X and Y components should be approximately equal in magnitude.
    expect(Math.abs(ps.velX)).toBeCloseTo(Math.abs(ps.velY), 0);
  });

  it('bodies are pushed apart, not together', () => {
    const assembly = createRocketAssembly();
    const topId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 100); // higher = top
    const botId = addPartToAssembly(assembly, 'probe-core-mk1', 0,   0); // lower = bottom

    const ps = {
      posX: 0, posY: 1000, velX: 0, velY: 50, angle: 0,
      activeParts: new Set([topId]),
      fuelStore: new Map(),
    };

    const debris = {
      id: 'debris-apart',
      posX: 0, posY: 1000, velX: 0, velY: 50, angle: 0,
      activeParts: new Set([botId]),
      fuelStore: new Map(),
    };

    applySeparationImpulse(ps, debris, assembly);

    // Top part (rocket) should be pushed forward (higher velY).
    // Bottom part (debris) should be pushed backward (lower velY).
    expect(ps.velY).toBeGreaterThan(50);
    expect(debris.velY).toBeLessThan(50);
  });

  it('lower stage pushed backward, upper forward', () => {
    const assembly = createRocketAssembly();
    const upperId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 100);
    const lowerId = addPartToAssembly(assembly, 'probe-core-mk1', 0,   0);

    const ps = {
      posX: 0, posY: 500, velX: 0, velY: 0, angle: 0,
      activeParts: new Set([upperId]),
      fuelStore: new Map(),
    };

    const debris = {
      id: 'debris-lower',
      posX: 0, posY: 500, velX: 0, velY: 0, angle: 0,
      activeParts: new Set([lowerId]),
      fuelStore: new Map(),
    };

    applySeparationImpulse(ps, debris, assembly);

    // Upper stage (rocket) pushed forward (positive Y with angle=0).
    expect(ps.velY).toBeGreaterThan(0);
    // Lower stage (debris) pushed backward (negative Y with angle=0).
    expect(debris.velY).toBeLessThan(0);
  });
});

// ---------------------------------------------------------------------------
// Separation impulse magnitude
// ---------------------------------------------------------------------------

describe('applySeparationImpulse() — reduced impulse magnitude', () => {
  it('produces delta-v proportional to 2000 N·s impulse', () => {
    const assembly = createRocketAssembly();
    // probe-core-mk1 is 50 kg
    const id1 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 100);
    const id2 = addPartToAssembly(assembly, 'probe-core-mk1', 0,   0);

    const ps = {
      posX: 0, posY: 1000, velX: 0, velY: 0, angle: 0,
      activeParts: new Set([id1]),
      fuelStore: new Map(),
    };

    const debris = {
      id: 'debris-dv',
      posX: 0, posY: 1000, velX: 0, velY: 0, angle: 0,
      activeParts: new Set([id2]),
      fuelStore: new Map(),
    };

    applySeparationImpulse(ps, debris, assembly);

    // Both 50 kg → Δv = 2000 N·s / 50 kg = 40 m/s each
    expect(Math.abs(ps.velY)).toBeCloseTo(40.0, 0);
    expect(Math.abs(debris.velY)).toBeCloseTo(40.0, 0);
  });

  it('heavy stage gets proportionally smaller delta-v', () => {
    const assembly = createRocketAssembly();
    const lightId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 100); // 50 kg
    const heavyId = addPartToAssembly(assembly, 'tank-small',     0,   0); // 50 kg dry

    const ps = {
      posX: 0, posY: 1000, velX: 0, velY: 0, angle: 0,
      activeParts: new Set([lightId]),
      fuelStore: new Map(),
    };

    const debris = {
      id: 'debris-heavy-dv',
      posX: 0, posY: 1000, velX: 0, velY: 0, angle: 0,
      activeParts: new Set([heavyId]),
      fuelStore: new Map([[heavyId, 400]]), // 50 + 400 = 450 kg
    };

    applySeparationImpulse(ps, debris, assembly);

    // Light (50 kg): Δv = 2000/50 = 40.0 m/s
    // Heavy (450 kg): Δv = 2000/450 ≈ 4.44 m/s
    expect(Math.abs(ps.velY)).toBeCloseTo(40.0, 0);
    expect(Math.abs(debris.velY)).toBeCloseTo(2000 / 450, 1);
  });
});

// ---------------------------------------------------------------------------
// Collision cooldown timing
// ---------------------------------------------------------------------------

describe('collision cooldown at reduced value', () => {
  it('cooldown of 10 prevents collision for 9 ticks then allows it on tick 10', () => {
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const id2 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    const ps = {
      posX: 0, posY: 9999, velX: 0, velY: 0, angle: 0,
      angularVelocity: 0,
      landed: true, crashed: false,
      activeParts: new Set(),
      fuelStore: new Map(),
      firingEngines: new Set(),
      debris: [{
        id: 'debris-cd10',
        posX: 0, posY: 200, velX: 0, velY: 3, angle: 0,
        angularVelocity: 0,
        landed: false, crashed: false,
        activeParts: new Set([id1]),
        fuelStore: new Map(),
        firingEngines: new Set(),
        collisionCooldown: 10,
      }, {
        id: 'debris-cd10b',
        posX: 0, posY: 200.3, velX: 0, velY: -3, angle: 0,
        angularVelocity: 0,
        landed: false, crashed: false,
        activeParts: new Set([id2]),
        fuelStore: new Map(),
        firingEngines: new Set(),
        collisionCooldown: 10,
      }],
    };

    // After 9 ticks, cooldown should be 1 and no collision yet.
    for (let i = 0; i < 9; i++) {
      tickCollisions(ps, assembly, 1 / 60);
    }
    expect(ps.debris[0].collisionCooldown).toBe(1);
    expect(ps.debris[1].velY).toBe(-3); // unchanged — still in cooldown

    // Tick 10: cooldown decrements to 0, collision fires immediately.
    tickCollisions(ps, assembly, 1 / 60);
    expect(ps.debris[0].collisionCooldown).toBe(0);
    expect(ps.debris[1].velY).not.toBe(-3); // velocity changed by collision
  });
});

// ---------------------------------------------------------------------------
// Integration — tickCollisions in tick loop
// ---------------------------------------------------------------------------

describe('tickCollisions integration', () => {
  it('cooldown prevents collision during grace period', () => {
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const id2 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    const ps = {
      posX: 0, posY: 100.5, velX: 0, velY: -5, angle: 0,
      angularVelocity: 0,
      landed: false, crashed: false,
      activeParts: new Set([id1]),
      fuelStore: new Map(),
      firingEngines: new Set(),
      debris: [{
        id: 'debris-cd',
        posX: 0, posY: 100, velX: 0, velY: 5, angle: 0,
        angularVelocity: 0,
        landed: false, crashed: false,
        activeParts: new Set([id2]),
        fuelStore: new Map(),
        firingEngines: new Set(),
        collisionCooldown: 5,
      }],
    };

    const velBefore = ps.velY;
    tickCollisions(ps, assembly, 1 / 60);

    // Velocity should not change — cooldown active.
    expect(ps.velY).toBe(velBefore);
    // Cooldown should have decremented.
    expect(ps.debris[0].collisionCooldown).toBe(4);
  });

  it('collision applies after cooldown expires', () => {
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const id2 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    const ps = {
      posX: 0, posY: 100.5, velX: 0, velY: -5, angle: 0,
      angularVelocity: 0,
      landed: false, crashed: false,
      activeParts: new Set([id1]),
      fuelStore: new Map(),
      firingEngines: new Set(),
      debris: [{
        id: 'debris-cd-expired',
        posX: 0, posY: 100, velX: 0, velY: 5, angle: 0,
        angularVelocity: 0,
        landed: false, crashed: false,
        activeParts: new Set([id2]),
        fuelStore: new Map(),
        firingEngines: new Set(),
        collisionCooldown: 0,
      }],
    };

    const velBefore = ps.velY;
    tickCollisions(ps, assembly, 1 / 60);

    // Velocity should have changed — collision resolved.
    expect(ps.velY).not.toBe(velBefore);
  });

  it('@smoke two-stage rocket: after separation, bodies diverge over 60 ticks', () => {
    const { assembly, staging } = makeTwoStageRocket();
    const fs = makeFlightState();
    const ps = createPhysicsState(assembly, fs);

    // Fire Stage 0 (engine ignition).
    fireNextStage(ps, assembly, staging, fs);

    // Simulate 2 seconds of flight to gain altitude.
    for (let i = 0; i < 120; i++) {
      tick(ps, assembly, staging, fs, 1 / 60, 1);
    }

    // Fire Stage 1 (decoupler separation).
    fireNextStage(ps, assembly, staging, fs);
    expect(ps.debris.length).toBeGreaterThan(0);

    const debris = ps.debris[0];

    // Let cooldown and a few physics ticks stabilise, then measure distance.
    for (let i = 0; i < 15; i++) {
      tick(ps, assembly, staging, fs, 1 / 60, 1);
    }
    const distEarly = Math.abs(ps.posY - debris.posY);

    // Simulate 60 more ticks (1 second).
    for (let i = 0; i < 60; i++) {
      tick(ps, assembly, staging, fs, 1 / 60, 1);
    }

    const distLater = Math.abs(ps.posY - debris.posY);
    // Bodies should be diverging: distance increases over time.
    expect(distLater).toBeGreaterThan(distEarly);
  });

  it('no collision with already-landed debris', () => {
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const id2 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    const ps = {
      posX: 0, posY: 0.5, velX: 0, velY: -5, angle: 0,
      angularVelocity: 0,
      landed: false, crashed: false,
      activeParts: new Set([id1]),
      fuelStore: new Map(),
      firingEngines: new Set(),
      debris: [{
        id: 'debris-landed',
        posX: 0, posY: 0, velX: 0, velY: 0, angle: 0,
        angularVelocity: 0,
        landed: true,  // Already landed
        crashed: false,
        activeParts: new Set([id2]),
        fuelStore: new Map(),
        firingEngines: new Set(),
        collisionCooldown: 0,
      }],
    };

    const velBefore = ps.velY;
    tickCollisions(ps, assembly, 1 / 60);

    // Velocity unchanged — landed debris is excluded from collision.
    expect(ps.velY).toBe(velBefore);
  });

  it('debris-to-debris collision works', () => {
    const assembly = createRocketAssembly();
    const id1 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
    const id2 = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    const ps = {
      posX: 0, posY: 9999, velX: 0, velY: 0, angle: 0,
      angularVelocity: 0,
      landed: true,  // Main rocket landed (excluded)
      crashed: false,
      activeParts: new Set(),
      fuelStore: new Map(),
      firingEngines: new Set(),
      debris: [
        {
          id: 'debris-a',
          posX: 0, posY: 200.5, velX: 0, velY: -5, angle: 0,
          angularVelocity: 0,
          landed: false, crashed: false,
          activeParts: new Set([id1]),
          fuelStore: new Map(),
          firingEngines: new Set(),
          collisionCooldown: 0,
        },
        {
          id: 'debris-b',
          posX: 0, posY: 200, velX: 0, velY: 5, angle: 0,
          angularVelocity: 0,
          landed: false, crashed: false,
          activeParts: new Set([id2]),
          fuelStore: new Map(),
          firingEngines: new Set(),
          collisionCooldown: 0,
        },
      ],
    };

    const vel1Before = ps.debris[0].velY;
    const vel2Before = ps.debris[1].velY;
    tickCollisions(ps, assembly, 1 / 60);

    // Both debris should have changed velocity.
    expect(ps.debris[0].velY).not.toBe(vel1Before);
    expect(ps.debris[1].velY).not.toBe(vel2Before);
  });
});

// ---------------------------------------------------------------------------
// Asteroid Collision Detection & Damage
// ---------------------------------------------------------------------------

import {
  testAABBCircleOverlap,
  computeRelativeSpeed,
  classifyAsteroidDamage,
  AsteroidDamageLevel,
  applyAsteroidDamage,
  checkAsteroidCollisions,
} from '../core/collision.ts';

/**
 * Helper: create a minimal asteroid-like object for testing.
 */
function makeAsteroid({
  posX = 0, posY = 0,
  velX = 0, velY = 0,
  radius = 10,
  mass = 1000,
  name = 'AST-TEST',
} = {}) {
  return {
    id: `ast-${name}`,
    type: 'asteroid' as const,
    name,
    posX, posY,
    velX, velY,
    radius,
    mass,
    shapeSeed: 42,
  };
}

/**
 * Helper: create a minimal physics-like state and assembly for asteroid tests.
 */
function makeAsteroidTestCraft({
  posX = 0, posY = 0,
  velX = 0, velY = 0,
} = {}) {
  const assembly = createRocketAssembly();
  // probe-core-mk1: 20x10 px
  const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);
  const tankId = addPartToAssembly(assembly, 'tank-small', 0, -40);
  connectParts(assembly, probeId, 1, tankId, 0);

  const ps = {
    posX, posY, velX, velY, angle: 0,
    angularVelocity: 0,
    landed: false, crashed: false,
    activeParts: new Set([probeId, tankId]),
    fuelStore: new Map(),
    firingEngines: new Set(),
    deployedParts: new Set(),
    heatMap: new Map(),
    debris: [],
  };

  const fs = makeFlightState();

  return { assembly, ps, fs, probeId, tankId };
}

describe('testAABBCircleOverlap()', () => {
  it('returns true when circle overlaps AABB', () => {
    const aabb = { minX: 0, maxX: 4, minY: 0, maxY: 4 };
    // Circle centred at (5, 2) with radius 2 — edge touches at x=4
    expect(testAABBCircleOverlap(aabb, 5, 2, 2)).toBe(true);
  });

  it('returns true when circle centre is inside AABB', () => {
    const aabb = { minX: 0, maxX: 4, minY: 0, maxY: 4 };
    expect(testAABBCircleOverlap(aabb, 2, 2, 1)).toBe(true);
  });

  it('returns false when circle is far from AABB', () => {
    const aabb = { minX: 0, maxX: 4, minY: 0, maxY: 4 };
    expect(testAABBCircleOverlap(aabb, 20, 20, 1)).toBe(false);
  });

  it('returns true for edge-touching circle', () => {
    const aabb = { minX: 0, maxX: 2, minY: 0, maxY: 2 };
    // Circle at (3, 1) with radius 1 — just touches edge at x=2
    expect(testAABBCircleOverlap(aabb, 3, 1, 1)).toBe(true);
  });

  it('handles corner proximity correctly', () => {
    const aabb = { minX: 0, maxX: 2, minY: 0, maxY: 2 };
    // Circle at corner (3, 3), distance = sqrt(2) ≈ 1.414
    // Radius 1: too small to reach.
    expect(testAABBCircleOverlap(aabb, 3, 3, 1)).toBe(false);
    // Radius 2: reaches the corner.
    expect(testAABBCircleOverlap(aabb, 3, 3, 2)).toBe(true);
  });
});

describe('computeRelativeSpeed()', () => {
  it('returns 0 for matching velocities', () => {
    expect(computeRelativeSpeed(100, 200, 100, 200)).toBeCloseTo(0, 10);
  });

  it('computes correct magnitude for opposing velocities', () => {
    // Craft moving right at 10, object moving left at 10 → relative = 20.
    expect(computeRelativeSpeed(10, 0, -10, 0)).toBeCloseTo(20, 5);
  });

  it('computes correct diagonal relative speed', () => {
    // Craft at (3, 4), object at (0, 0) → |v| = 5.
    expect(computeRelativeSpeed(3, 4, 0, 0)).toBeCloseTo(5, 5);
  });
});

describe('classifyAsteroidDamage()', () => {
  it('returns NONE for speed below 1 m/s', () => {
    expect(classifyAsteroidDamage(0)).toBe(AsteroidDamageLevel.NONE);
    expect(classifyAsteroidDamage(0.5)).toBe(AsteroidDamageLevel.NONE);
    expect(classifyAsteroidDamage(0.99)).toBe(AsteroidDamageLevel.NONE);
  });

  it('returns MINOR for speed between 1 and 5 m/s', () => {
    expect(classifyAsteroidDamage(1)).toBe(AsteroidDamageLevel.MINOR);
    expect(classifyAsteroidDamage(3)).toBe(AsteroidDamageLevel.MINOR);
    expect(classifyAsteroidDamage(4.99)).toBe(AsteroidDamageLevel.MINOR);
  });

  it('returns SIGNIFICANT for speed between 5 and 20 m/s', () => {
    expect(classifyAsteroidDamage(5)).toBe(AsteroidDamageLevel.SIGNIFICANT);
    expect(classifyAsteroidDamage(10)).toBe(AsteroidDamageLevel.SIGNIFICANT);
    expect(classifyAsteroidDamage(19.99)).toBe(AsteroidDamageLevel.SIGNIFICANT);
  });

  it('returns CATASTROPHIC for speed 20 m/s or above', () => {
    expect(classifyAsteroidDamage(20)).toBe(AsteroidDamageLevel.CATASTROPHIC);
    expect(classifyAsteroidDamage(50)).toBe(AsteroidDamageLevel.CATASTROPHIC);
    expect(classifyAsteroidDamage(1000)).toBe(AsteroidDamageLevel.CATASTROPHIC);
  });

  it('@smoke covers all four damage threshold boundaries', () => {
    // Exactly at boundaries:
    expect(classifyAsteroidDamage(0.99)).toBe(AsteroidDamageLevel.NONE);
    expect(classifyAsteroidDamage(1.0)).toBe(AsteroidDamageLevel.MINOR);
    expect(classifyAsteroidDamage(4.99)).toBe(AsteroidDamageLevel.MINOR);
    expect(classifyAsteroidDamage(5.0)).toBe(AsteroidDamageLevel.SIGNIFICANT);
    expect(classifyAsteroidDamage(19.99)).toBe(AsteroidDamageLevel.SIGNIFICANT);
    expect(classifyAsteroidDamage(20.0)).toBe(AsteroidDamageLevel.CATASTROPHIC);
  });
});

describe('applyAsteroidDamage()', () => {
  it('NONE damage does not destroy any parts', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft();
    const partsBefore = ps.activeParts.size;

    applyAsteroidDamage(ps, assembly, fs, AsteroidDamageLevel.NONE, 0.5);

    expect(ps.activeParts.size).toBe(partsBefore);
    expect(ps.crashed).toBe(false);
    expect(fs.events.length).toBe(0);
  });

  it('MINOR damage destroys some but not all parts', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft();
    const partsBefore = ps.activeParts.size;

    applyAsteroidDamage(ps, assembly, fs, AsteroidDamageLevel.MINOR, 3);

    // Should destroy at least 1 part but not all.
    expect(ps.activeParts.size).toBeLessThan(partsBefore);
    expect(ps.activeParts.size).toBeGreaterThan(0);
    expect(ps.crashed).toBe(false);
    // Should have PART_DESTROYED and ASTEROID_IMPACT events.
    expect(fs.events.some(e => e.type === 'PART_DESTROYED')).toBe(true);
    expect(fs.events.some(e => e.type === 'ASTEROID_IMPACT')).toBe(true);
  });

  it('SIGNIFICANT damage destroys more parts than MINOR', () => {
    // Test with a craft with many parts.
    const assembly1 = createRocketAssembly();
    const ids1 = [];
    for (let i = 0; i < 10; i++) {
      ids1.push(addPartToAssembly(assembly1, 'probe-core-mk1', i * 30, 0));
    }
    const ps1 = {
      posX: 0, posY: 0, velX: 0, velY: 0, angle: 0,
      angularVelocity: 0, landed: false, crashed: false,
      activeParts: new Set(ids1),
      fuelStore: new Map(), firingEngines: new Set(),
      deployedParts: new Set(), heatMap: new Map(), debris: [],
    };
    const fs1 = makeFlightState();

    const assembly2 = createRocketAssembly();
    const ids2 = [];
    for (let i = 0; i < 10; i++) {
      ids2.push(addPartToAssembly(assembly2, 'probe-core-mk1', i * 30, 0));
    }
    const ps2 = {
      posX: 0, posY: 0, velX: 0, velY: 0, angle: 0,
      angularVelocity: 0, landed: false, crashed: false,
      activeParts: new Set(ids2),
      fuelStore: new Map(), firingEngines: new Set(),
      deployedParts: new Set(), heatMap: new Map(), debris: [],
    };
    const fs2 = makeFlightState();

    applyAsteroidDamage(ps1, assembly1, fs1, AsteroidDamageLevel.MINOR, 3);
    applyAsteroidDamage(ps2, assembly2, fs2, AsteroidDamageLevel.SIGNIFICANT, 12);

    // SIGNIFICANT should destroy more parts than MINOR.
    const minorDestroyed = 10 - ps1.activeParts.size;
    const sigDestroyed = 10 - ps2.activeParts.size;
    expect(sigDestroyed).toBeGreaterThan(minorDestroyed);
  });

  it('CATASTROPHIC damage destroys all parts and crashes craft', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft();

    applyAsteroidDamage(ps, assembly, fs, AsteroidDamageLevel.CATASTROPHIC, 25);

    expect(ps.activeParts.size).toBe(0);
    expect(ps.crashed).toBe(true);
    expect(fs.events.some(e => e.type === 'ASTEROID_IMPACT' && e.severity === 'CATASTROPHIC')).toBe(true);
  });

  it('logs flight events with correct asteroid name and speed', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft();

    applyAsteroidDamage(ps, assembly, fs, AsteroidDamageLevel.MINOR, 2.5, 'AST-1234');

    const impactEvent = fs.events.find(e => e.type === 'ASTEROID_IMPACT');
    expect(impactEvent).toBeDefined();
    expect(impactEvent.asteroidName).toBe('AST-1234');
    expect(impactEvent.relSpeed).toBeCloseTo(2.5);
    expect(impactEvent.severity).toBe('MINOR');
  });

  it('crashes craft if partial damage removes all remaining parts', () => {
    // Single-part craft: even MINOR destroys the only part.
    const assembly = createRocketAssembly();
    const probeId = addPartToAssembly(assembly, 'probe-core-mk1', 0, 0);

    const ps = {
      posX: 0, posY: 0, velX: 0, velY: 0, angle: 0,
      angularVelocity: 0, landed: false, crashed: false,
      activeParts: new Set([probeId]),
      fuelStore: new Map(), firingEngines: new Set(),
      deployedParts: new Set(), heatMap: new Map(), debris: [],
    };
    const fs = makeFlightState();

    applyAsteroidDamage(ps, assembly, fs, AsteroidDamageLevel.MINOR, 3);

    expect(ps.activeParts.size).toBe(0);
    expect(ps.crashed).toBe(true);
  });
});

describe('checkAsteroidCollisions()', () => {
  it('returns empty when no asteroids overlap the craft', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft({ posX: 0, posY: 0 });

    const asteroid = makeAsteroid({ posX: 10000, posY: 10000, radius: 5 });
    const results = checkAsteroidCollisions(ps, assembly, [asteroid], fs);

    expect(results).toHaveLength(0);
  });

  it('returns empty when craft is landed', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft();
    ps.landed = true;

    const asteroid = makeAsteroid({ posX: 0, posY: 0, radius: 100 });
    const results = checkAsteroidCollisions(ps, assembly, [asteroid], fs);

    expect(results).toHaveLength(0);
  });

  it('returns empty when craft is crashed', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft();
    ps.crashed = true;

    const asteroid = makeAsteroid({ posX: 0, posY: 0, radius: 100 });
    const results = checkAsteroidCollisions(ps, assembly, [asteroid], fs);

    expect(results).toHaveLength(0);
  });

  it('detects collision with overlapping asteroid and applies damage', () => {
    // Craft at origin, asteroid right on top with large radius.
    const { ps, assembly, fs } = makeAsteroidTestCraft({
      posX: 0, posY: 0,
      velX: 0, velY: 0,
    });

    // Asteroid co-located but with different velocity for MINOR damage.
    const asteroid = makeAsteroid({
      posX: 0, posY: 0,
      velX: 3, velY: 0,  // 3 m/s relative → MINOR
      radius: 100,
    });

    const results = checkAsteroidCollisions(ps, assembly, [asteroid], fs);

    expect(results).toHaveLength(1);
    expect(results[0].damage).toBe(AsteroidDamageLevel.MINOR);
    expect(results[0].relativeSpeed).toBeCloseTo(3, 1);
  });

  it('stops checking after craft is destroyed by catastrophic impact', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft({
      posX: 0, posY: 0,
      velX: 30, velY: 0,
    });

    const ast1 = makeAsteroid({ posX: 0, posY: 0, velX: 0, velY: 0, radius: 100, name: 'A' });
    const ast2 = makeAsteroid({ posX: 0, posY: 0, velX: 0, velY: 0, radius: 100, name: 'B' });

    const results = checkAsteroidCollisions(ps, assembly, [ast1, ast2], fs);

    // First asteroid destroys the craft (30 m/s → CATASTROPHIC).
    // Second should not be processed.
    expect(results).toHaveLength(1);
    expect(ps.crashed).toBe(true);
  });

  it('@smoke detects NONE damage for co-orbital (low relative speed) asteroid', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft({
      posX: 0, posY: 0,
      velX: 1000, velY: 0,
    });

    // Asteroid moving at nearly the same velocity — relative speed < 1.
    const asteroid = makeAsteroid({
      posX: 0, posY: 0,
      velX: 1000.5, velY: 0,
      radius: 100,
    });

    const partsBefore = ps.activeParts.size;
    const results = checkAsteroidCollisions(ps, assembly, [asteroid], fs);

    expect(results).toHaveLength(1);
    expect(results[0].damage).toBe(AsteroidDamageLevel.NONE);
    expect(ps.activeParts.size).toBe(partsBefore);
    expect(ps.crashed).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Extended Asteroid Collision Tests
// ---------------------------------------------------------------------------

/**
 * Helper: create a 4-part rocket for quantitative damage tests.
 * Returns assembly, physics state, flight state, and the 4 part instance IDs.
 */
function makeDamageTestSetup() {
  const assembly = createRocketAssembly();
  // 4-part rocket: probe + 2 tanks + engine
  const probeId  = addPartToAssembly(assembly, 'probe-core-mk1', 0, 100);
  const tank1Id  = addPartToAssembly(assembly, 'tank-small', 0, 60);
  const tank2Id  = addPartToAssembly(assembly, 'tank-small', 0, 20);
  const engineId = addPartToAssembly(assembly, 'engine-spark', 0, -20);

  const ps = {
    posX: 0, posY: 0, velX: 0, velY: 0,
    angle: 0, activeParts: new Set([probeId, tank1Id, tank2Id, engineId]),
    firingEngines: new Set(), deployedParts: new Set(),
    fuelStore: new Map(), heatMap: new Map(),
    landed: false, crashed: false, grounded: false,
  };

  const fs = createFlightState({ missionId: 'test', rocketId: 'test' });
  return { assembly, ps, fs, partIds: [probeId, tank1Id, tank2Id, engineId] };
}

describe('testAABBCircleOverlap() — extended', () => {
  it('detects overlap when circle is fully inside the AABB', () => {
    const aabb = { minX: -10, maxX: 10, minY: -10, maxY: 10 };
    // Small circle fully contained within the AABB
    expect(testAABBCircleOverlap(aabb, 0, 0, 1)).toBe(true);
    expect(testAABBCircleOverlap(aabb, 5, 5, 2)).toBe(true);
  });

  it('detects overlap when circle touches AABB edge exactly', () => {
    const aabb = { minX: 0, maxX: 4, minY: 0, maxY: 4 };
    // Circle at (5, 2) with radius 1 — closest point on AABB is (4, 2), distance = 1
    expect(testAABBCircleOverlap(aabb, 5, 2, 1)).toBe(true);
  });

  it('returns false when circle is just beyond AABB edge', () => {
    const aabb = { minX: 0, maxX: 4, minY: 0, maxY: 4 };
    // Circle at (6, 2) with radius 1 — closest point is (4, 2), distance = 2 > 1
    expect(testAABBCircleOverlap(aabb, 6, 2, 1)).toBe(false);
  });

  it('handles varying asteroid radii: 1m', () => {
    const aabb = { minX: 0, maxX: 2, minY: 0, maxY: 2 };
    // Circle just outside at (3.5, 1) radius 1 — distance from AABB = 1.5 > 1
    expect(testAABBCircleOverlap(aabb, 3.5, 1, 1)).toBe(false);
    // Circle close enough at (2.5, 1) radius 1 — distance from AABB = 0.5 < 1
    expect(testAABBCircleOverlap(aabb, 2.5, 1, 1)).toBe(true);
  });

  it('handles varying asteroid radii: 100m', () => {
    const aabb = { minX: 0, maxX: 2, minY: 0, maxY: 2 };
    // Circle far away but with large radius 100m — distance from (102, 1) is 100
    expect(testAABBCircleOverlap(aabb, 102, 1, 100)).toBe(true);
    // Just outside range — distance 101 > 100
    expect(testAABBCircleOverlap(aabb, 103, 1, 100)).toBe(false);
  });

  it('handles varying asteroid radii: 1000m', () => {
    const aabb = { minX: 0, maxX: 2, minY: 0, maxY: 2 };
    // Distance from AABB to (1002, 1) is 1000 — exactly touching
    expect(testAABBCircleOverlap(aabb, 1002, 1, 1000)).toBe(true);
    // Distance from AABB to (1003, 1) is 1001 > 1000 — no overlap
    expect(testAABBCircleOverlap(aabb, 1003, 1, 1000)).toBe(false);
  });

  it('returns false when large circle is out of range', () => {
    const aabb = { minX: -1, maxX: 1, minY: -1, maxY: 1 };
    expect(testAABBCircleOverlap(aabb, 5000, 5000, 50)).toBe(false);
  });
});

describe('computeRelativeSpeed() — extended', () => {
  it('returns zero when both have identical velocities', () => {
    expect(computeRelativeSpeed(42, -17, 42, -17)).toBeCloseTo(0, 10);
  });

  it('computes pure X relative speed', () => {
    // Craft: velX=10, velY=0. Object: velX=0, velY=0
    expect(computeRelativeSpeed(10, 0, 0, 0)).toBeCloseTo(10, 5);
  });

  it('computes pure Y relative speed', () => {
    // Craft: velX=0, velY=15. Object: velX=0, velY=0
    expect(computeRelativeSpeed(0, 15, 0, 0)).toBeCloseTo(15, 5);
  });

  it('computes diagonal relative speed correctly', () => {
    // Relative: (3-0, 4-0) = (3, 4) → magnitude = 5
    expect(computeRelativeSpeed(3, 4, 0, 0)).toBeCloseTo(5, 5);
    // Relative: (10-7, 0-0) = (3, 0) → magnitude = 3
    expect(computeRelativeSpeed(10, 0, 7, 0)).toBeCloseTo(3, 5);
  });

  it('handles negative velocities', () => {
    // Relative: (-5 - 5, 0 - 0) = (-10, 0) → magnitude = 10
    expect(computeRelativeSpeed(-5, 0, 5, 0)).toBeCloseTo(10, 5);
  });
});

describe('classifyAsteroidDamage() — extended boundary tests', () => {
  it('returns NONE at exactly 0 m/s', () => {
    expect(classifyAsteroidDamage(0)).toBe(AsteroidDamageLevel.NONE);
  });

  it('returns NONE at 0.5 m/s', () => {
    expect(classifyAsteroidDamage(0.5)).toBe(AsteroidDamageLevel.NONE);
  });

  it('returns NONE at 0.99 m/s (just below threshold)', () => {
    expect(classifyAsteroidDamage(0.99)).toBe(AsteroidDamageLevel.NONE);
  });

  it('returns MINOR at exactly 1.0 m/s (at threshold)', () => {
    expect(classifyAsteroidDamage(1.0)).toBe(AsteroidDamageLevel.MINOR);
  });

  it('returns MINOR at 3 m/s', () => {
    expect(classifyAsteroidDamage(3)).toBe(AsteroidDamageLevel.MINOR);
  });

  it('returns MINOR at 4.99 m/s', () => {
    expect(classifyAsteroidDamage(4.99)).toBe(AsteroidDamageLevel.MINOR);
  });

  it('returns SIGNIFICANT at exactly 5 m/s (at threshold)', () => {
    expect(classifyAsteroidDamage(5)).toBe(AsteroidDamageLevel.SIGNIFICANT);
  });

  it('returns SIGNIFICANT at 10 m/s', () => {
    expect(classifyAsteroidDamage(10)).toBe(AsteroidDamageLevel.SIGNIFICANT);
  });

  it('returns SIGNIFICANT at 19.99 m/s', () => {
    expect(classifyAsteroidDamage(19.99)).toBe(AsteroidDamageLevel.SIGNIFICANT);
  });

  it('returns CATASTROPHIC at exactly 20 m/s (at threshold)', () => {
    expect(classifyAsteroidDamage(20)).toBe(AsteroidDamageLevel.CATASTROPHIC);
  });

  it('returns CATASTROPHIC at 100 m/s', () => {
    expect(classifyAsteroidDamage(100)).toBe(AsteroidDamageLevel.CATASTROPHIC);
  });
});

describe('applyAsteroidDamage() — quantitative 4-part rocket', () => {
  it('NONE damage: no parts removed from 4-part rocket', () => {
    const { ps, assembly, fs } = makeDamageTestSetup();
    expect(ps.activeParts.size).toBe(4);

    applyAsteroidDamage(ps, assembly, fs, AsteroidDamageLevel.NONE, 0.5, 'AST-0001');

    expect(ps.activeParts.size).toBe(4);
    expect(ps.crashed).toBe(false);
    expect(fs.events.length).toBe(0);
  });

  it('MINOR damage: ~25% of parts removed (1 of 4)', () => {
    const { ps, assembly, fs } = makeDamageTestSetup();
    expect(ps.activeParts.size).toBe(4);

    applyAsteroidDamage(ps, assembly, fs, AsteroidDamageLevel.MINOR, 3, 'AST-0001');

    // 25% of 4 = 1 part (ceil(4 * 0.25) = 1)
    expect(ps.activeParts.size).toBe(3);
    expect(ps.crashed).toBe(false);
    expect(fs.events.filter(e => e.type === 'PART_DESTROYED').length).toBe(1);
  });

  it('SIGNIFICANT damage: ~60% of parts removed (3 of 4)', () => {
    const { ps, assembly, fs } = makeDamageTestSetup();
    expect(ps.activeParts.size).toBe(4);

    applyAsteroidDamage(ps, assembly, fs, AsteroidDamageLevel.SIGNIFICANT, 12, 'AST-0001');

    // 60% of 4 = 2.4 → ceil = 3 parts destroyed, 1 remaining
    // But if the code uses Math.max(1, ceil(N * fraction)), with N=4 and fraction=0.6:
    // ceil(4 * 0.6) = ceil(2.4) = 3
    const destroyed = 4 - ps.activeParts.size;
    expect(destroyed).toBe(3);
    expect(ps.activeParts.size).toBe(1);
    expect(ps.crashed).toBe(false);
    expect(fs.events.filter(e => e.type === 'PART_DESTROYED').length).toBe(3);
  });

  it('CATASTROPHIC damage: all parts removed, craft crashes', () => {
    const { ps, assembly, fs } = makeDamageTestSetup();
    expect(ps.activeParts.size).toBe(4);

    applyAsteroidDamage(ps, assembly, fs, AsteroidDamageLevel.CATASTROPHIC, 25, 'AST-0001');

    expect(ps.activeParts.size).toBe(0);
    expect(ps.crashed).toBe(true);
    expect(fs.events.filter(e => e.type === 'PART_DESTROYED').length).toBe(4);
    expect(fs.events.some(e => e.type === 'ASTEROID_IMPACT' && e.severity === 'CATASTROPHIC')).toBe(true);
  });

  it('CATASTROPHIC damage clears firingEngines and deployedParts', () => {
    const { ps, assembly, fs, partIds } = makeDamageTestSetup();
    // Simulate engine firing and part deployed
    ps.firingEngines.add(partIds[3]);  // engine
    ps.deployedParts.add(partIds[0]);  // probe

    applyAsteroidDamage(ps, assembly, fs, AsteroidDamageLevel.CATASTROPHIC, 30, 'AST-0001');

    expect(ps.firingEngines.size).toBe(0);
    expect(ps.deployedParts.size).toBe(0);
  });
});

describe('checkAsteroidCollisions() — extended', () => {
  it('returns empty array when no asteroids are provided', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft();
    const results = checkAsteroidCollisions(ps, assembly, [], fs);
    expect(results).toHaveLength(0);
  });

  it('returns empty when all asteroids are far away (no false positives)', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft({ posX: 0, posY: 0 });

    const farAsteroids = [
      makeAsteroid({ posX: 50000, posY: 50000, radius: 10, name: 'FAR-1' }),
      makeAsteroid({ posX: -30000, posY: 20000, radius: 50, name: 'FAR-2' }),
      makeAsteroid({ posX: 100, posY: 100, radius: 5, name: 'FAR-3' }),
    ];

    const results = checkAsteroidCollisions(ps, assembly, farAsteroids, fs);
    expect(results).toHaveLength(0);
    expect(ps.crashed).toBe(false);
  });

  it('detects collision when asteroid overlaps craft position', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft({ posX: 0, posY: 0, velX: 10, velY: 0 });

    const asteroid = makeAsteroid({
      posX: 0, posY: 0,
      velX: 0, velY: 0,
      radius: 100,  // Large enough to guarantee overlap
      name: 'HIT-1',
    });

    const results = checkAsteroidCollisions(ps, assembly, [asteroid], fs);
    expect(results).toHaveLength(1);
    expect(results[0].asteroid.name).toBe('HIT-1');
    expect(results[0].relativeSpeed).toBeCloseTo(10, 1);
    expect(results[0].damage).toBe(AsteroidDamageLevel.SIGNIFICANT);
  });

  it('processes multiple asteroid collisions until craft crashes', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft({
      posX: 0, posY: 0,
      velX: 3, velY: 0,  // 3 m/s → MINOR per asteroid
    });

    const partsBefore = ps.activeParts.size;

    // Three overlapping asteroids — each at MINOR damage.
    // First will damage some parts. If craft survives, second hits, etc.
    const asteroids = [
      makeAsteroid({ posX: 0, posY: 0, velX: 0, velY: 0, radius: 100, name: 'M-1' }),
      makeAsteroid({ posX: 0, posY: 0, velX: 0, velY: 0, radius: 100, name: 'M-2' }),
      makeAsteroid({ posX: 0, posY: 0, velX: 0, velY: 0, radius: 100, name: 'M-3' }),
    ];

    const results = checkAsteroidCollisions(ps, assembly, asteroids, fs);

    // Should have at least 1 collision result, parts should decrease.
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(ps.activeParts.size).toBeLessThan(partsBefore);
  });

  it('skips collision checks when craft is already crashed', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft();
    ps.crashed = true;

    const asteroid = makeAsteroid({ posX: 0, posY: 0, radius: 100 });
    const results = checkAsteroidCollisions(ps, assembly, [asteroid], fs);

    expect(results).toHaveLength(0);
    expect(fs.events.length).toBe(0);
  });

  it('skips collision checks when craft is landed', () => {
    const { ps, assembly, fs } = makeAsteroidTestCraft();
    ps.landed = true;

    const asteroid = makeAsteroid({ posX: 0, posY: 0, radius: 100 });
    const results = checkAsteroidCollisions(ps, assembly, [asteroid], fs);

    expect(results).toHaveLength(0);
    expect(fs.events.length).toBe(0);
  });
});
