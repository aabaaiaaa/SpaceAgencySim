/**
 * transferObjects.test.ts — Unit tests for the transfer proximity object system.
 *
 * Tests cover:
 *   - State management: set, add, clear, get round-trips
 *   - tickTransferObjects: position advancement with dt
 *   - getProximityObjects: filtering, sorting, LOD assignment, angle computation
 *   - checkTransferCollision: normal radius, enlarged radius for fast objects
 */

import { describe, it, expect, beforeEach } from 'vitest';

import {
  RENDER_DISTANCE,
  LOD_THRESHOLDS,
  FAST_COLLISION_RADIUS_MULTIPLIER,
  setTransferObjects,
  addTransferObject,
  clearTransferObjects,
  getTransferObjects,
  tickTransferObjects,
  getProximityObjects,
  checkTransferCollision,
  type TransferObject,
} from '../core/transferObjects.ts';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a minimal TransferObject with sensible defaults. */
function makeObj(overrides: Partial<TransferObject> & { id: string }): TransferObject {
  return {
    type: 'asteroid',
    name: overrides.id,
    posX: 0,
    posY: 0,
    velX: 0,
    velY: 0,
    radius: 10,
    mass: 1000,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('transferObjects', () => {
  beforeEach(() => {
    clearTransferObjects();
  });

  // =========================================================================
  // State management
  // =========================================================================

  describe('state management', () => {
    it('@smoke set, get, and clear round-trip', () => {
      const a = makeObj({ id: 'a' });
      const b = makeObj({ id: 'b' });

      setTransferObjects([a, b]);
      const list = getTransferObjects();
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe('a');
      expect(list[1].id).toBe('b');

      clearTransferObjects();
      expect(getTransferObjects()).toHaveLength(0);
    });

    it('setTransferObjects copies the array (mutations to original do not affect internal state)', () => {
      const arr = [makeObj({ id: 'x' })];
      setTransferObjects(arr);
      arr.push(makeObj({ id: 'y' }));

      expect(getTransferObjects()).toHaveLength(1);
    });

    it('addTransferObject appends to existing list', () => {
      setTransferObjects([makeObj({ id: 'a' })]);
      addTransferObject(makeObj({ id: 'b' }));

      const list = getTransferObjects();
      expect(list).toHaveLength(2);
      expect(list[1].id).toBe('b');
    });

    it('addTransferObject works on empty list', () => {
      addTransferObject(makeObj({ id: 'solo' }));
      expect(getTransferObjects()).toHaveLength(1);
      expect(getTransferObjects()[0].id).toBe('solo');
    });

    it('setTransferObjects replaces previous list', () => {
      setTransferObjects([makeObj({ id: 'old' })]);
      setTransferObjects([makeObj({ id: 'new1' }), makeObj({ id: 'new2' })]);

      const list = getTransferObjects();
      expect(list).toHaveLength(2);
      expect(list[0].id).toBe('new1');
    });

    it('clearTransferObjects on already-empty list is a no-op', () => {
      clearTransferObjects();
      expect(getTransferObjects()).toHaveLength(0);
    });
  });

  // =========================================================================
  // tickTransferObjects
  // =========================================================================

  describe('tickTransferObjects()', () => {
    it('dt = 0 does not move objects', () => {
      setTransferObjects([makeObj({ id: 'a', posX: 100, posY: 200, velX: 50, velY: -30 })]);
      tickTransferObjects(0);

      const obj = getTransferObjects()[0];
      expect(obj.posX).toBe(100);
      expect(obj.posY).toBe(200);
    });

    it('advances position by vel * dt', () => {
      setTransferObjects([makeObj({ id: 'a', posX: 0, posY: 0, velX: 100, velY: -50 })]);
      tickTransferObjects(2);

      const obj = getTransferObjects()[0];
      expect(obj.posX).toBe(200);
      expect(obj.posY).toBe(-100);
    });

    it('handles negative velocities correctly', () => {
      setTransferObjects([makeObj({ id: 'a', posX: 500, posY: 500, velX: -200, velY: -100 })]);
      tickTransferObjects(1);

      const obj = getTransferObjects()[0];
      expect(obj.posX).toBe(300);
      expect(obj.posY).toBe(400);
    });

    it('ticks multiple objects independently', () => {
      setTransferObjects([
        makeObj({ id: 'a', posX: 0, posY: 0, velX: 10, velY: 0 }),
        makeObj({ id: 'b', posX: 0, posY: 0, velX: 0, velY: 20 }),
      ]);
      tickTransferObjects(5);

      const list = getTransferObjects();
      expect(list[0].posX).toBe(50);
      expect(list[0].posY).toBe(0);
      expect(list[1].posX).toBe(0);
      expect(list[1].posY).toBe(100);
    });

    it('fractional dt produces correct positions', () => {
      setTransferObjects([makeObj({ id: 'a', posX: 0, posY: 0, velX: 1000, velY: 0 })]);
      tickTransferObjects(0.016); // ~1 frame at 60fps

      const obj = getTransferObjects()[0];
      expect(obj.posX).toBeCloseTo(16, 5);
    });
  });

  // =========================================================================
  // getProximityObjects
  // =========================================================================

  describe('getProximityObjects()', () => {
    it('returns empty array when no objects exist', () => {
      const result = getProximityObjects(0, 0, 0, 0);
      expect(result).toEqual([]);
    });

    it('filters out objects beyond RENDER_DISTANCE', () => {
      setTransferObjects([
        makeObj({ id: 'near', posX: 1000, posY: 0 }),
        makeObj({ id: 'far', posX: RENDER_DISTANCE + 1, posY: 0 }),
      ]);

      const result = getProximityObjects(0, 0, 0, 0);
      expect(result).toHaveLength(1);
      expect(result[0].id).toBe('near');
    });

    it('includes object exactly at RENDER_DISTANCE boundary', () => {
      // Object at exactly RENDER_DISTANCE: distance === RENDER_DISTANCE,
      // the condition is distance > RENDER_DISTANCE so it should be included
      setTransferObjects([makeObj({ id: 'edge', posX: RENDER_DISTANCE, posY: 0 })]);

      const result = getProximityObjects(0, 0, 0, 0);
      // distance === RENDER_DISTANCE is NOT > RENDER_DISTANCE, so included
      expect(result).toHaveLength(1);
    });

    it('@smoke sorts results by distance ascending', () => {
      setTransferObjects([
        makeObj({ id: 'far', posX: 10_000, posY: 0 }),
        makeObj({ id: 'near', posX: 100, posY: 0 }),
        makeObj({ id: 'mid', posX: 5_000, posY: 0 }),
      ]);

      const result = getProximityObjects(0, 0, 0, 0);
      expect(result).toHaveLength(3);
      expect(result[0].id).toBe('near');
      expect(result[1].id).toBe('mid');
      expect(result[2].id).toBe('far');
    });

    it('computes correct distance', () => {
      setTransferObjects([makeObj({ id: 'a', posX: 3000, posY: 4000 })]);

      const result = getProximityObjects(0, 0, 0, 0);
      expect(result[0].distance).toBeCloseTo(5000, 5);
    });

    it('computes correct relative speed', () => {
      // Object velocity (300, 400), craft velocity (0, 0) -> relative speed = 500
      setTransferObjects([makeObj({ id: 'a', posX: 100, posY: 0, velX: 300, velY: 400 })]);

      const result = getProximityObjects(0, 0, 0, 0);
      expect(result[0].relativeSpeed).toBeCloseTo(500, 5);
    });

    it('relative speed accounts for craft velocity', () => {
      // Object vel (300, 0), craft vel (200, 0) -> dv = (100, 0) -> relative speed = 100
      setTransferObjects([makeObj({ id: 'a', posX: 100, posY: 0, velX: 300, velY: 0 })]);

      const result = getProximityObjects(0, 0, 200, 0);
      expect(result[0].relativeSpeed).toBeCloseTo(100, 5);
    });

    // --- LOD thresholds ---

    it('assigns LOD "full" when relativeSpeed < LOD_THRESHOLDS.full (100)', () => {
      // Object and craft have similar velocity
      setTransferObjects([makeObj({ id: 'a', posX: 100, posY: 0, velX: 50, velY: 0 })]);

      const result = getProximityObjects(0, 0, 0, 0); // relative speed = 50
      expect(result[0].lod).toBe('full');
      expect(result[0].relativeSpeed).toBe(50);
    });

    it('assigns LOD "basic" when relativeSpeed >= 100 and < 2000', () => {
      setTransferObjects([makeObj({ id: 'a', posX: 100, posY: 0, velX: 500, velY: 0 })]);

      const result = getProximityObjects(0, 0, 0, 0); // relative speed = 500
      expect(result[0].lod).toBe('basic');
    });

    it('assigns LOD "streak" when relativeSpeed >= 2000', () => {
      setTransferObjects([makeObj({ id: 'a', posX: 100, posY: 0, velX: 3000, velY: 0 })]);

      const result = getProximityObjects(0, 0, 0, 0); // relative speed = 3000
      expect(result[0].lod).toBe('streak');
    });

    it('LOD boundary: relativeSpeed exactly at full threshold (100) is "basic"', () => {
      // relativeSpeed === 100: NOT < 100, so not "full"; < 2000, so "basic"
      setTransferObjects([makeObj({ id: 'a', posX: 100, posY: 0, velX: 100, velY: 0 })]);

      const result = getProximityObjects(0, 0, 0, 0);
      expect(result[0].relativeSpeed).toBeCloseTo(100, 5);
      expect(result[0].lod).toBe('basic');
    });

    it('LOD boundary: relativeSpeed exactly at basic threshold (2000) is "streak"', () => {
      // relativeSpeed === 2000: NOT < 2000, so "streak"
      setTransferObjects([makeObj({ id: 'a', posX: 100, posY: 0, velX: 2000, velY: 0 })]);

      const result = getProximityObjects(0, 0, 0, 0);
      expect(result[0].relativeSpeed).toBeCloseTo(2000, 5);
      expect(result[0].lod).toBe('streak');
    });

    it('LOD boundary: relativeSpeed just below full threshold is "full"', () => {
      setTransferObjects([makeObj({ id: 'a', posX: 100, posY: 0, velX: 99, velY: 0 })]);

      const result = getProximityObjects(0, 0, 0, 0);
      expect(result[0].lod).toBe('full');
    });

    it('LOD boundary: relativeSpeed just below basic threshold is "basic"', () => {
      setTransferObjects([makeObj({ id: 'a', posX: 100, posY: 0, velX: 1999, velY: 0 })]);

      const result = getProximityObjects(0, 0, 0, 0);
      expect(result[0].lod).toBe('basic');
    });

    // --- Angle ---

    it('computes angle via atan2(dy, dx) — object to the right', () => {
      setTransferObjects([makeObj({ id: 'a', posX: 100, posY: 0 })]);

      const result = getProximityObjects(0, 0, 0, 0);
      expect(result[0].angle).toBeCloseTo(0, 5); // atan2(0, 100) = 0
    });

    it('computes angle — object above (positive Y)', () => {
      setTransferObjects([makeObj({ id: 'a', posX: 0, posY: 100 })]);

      const result = getProximityObjects(0, 0, 0, 0);
      expect(result[0].angle).toBeCloseTo(Math.PI / 2, 5); // atan2(100, 0) = pi/2
    });

    it('computes angle — object to the left', () => {
      setTransferObjects([makeObj({ id: 'a', posX: -100, posY: 0 })]);

      const result = getProximityObjects(0, 0, 0, 0);
      expect(result[0].angle).toBeCloseTo(Math.PI, 5); // atan2(0, -100) = pi
    });

    it('computes angle — object below (negative Y)', () => {
      setTransferObjects([makeObj({ id: 'a', posX: 0, posY: -100 })]);

      const result = getProximityObjects(0, 0, 0, 0);
      expect(result[0].angle).toBeCloseTo(-Math.PI / 2, 5); // atan2(-100, 0) = -pi/2
    });

    it('angle is relative to craft position', () => {
      // Craft at (1000, 1000), object at (1100, 1000) -> dx=100, dy=0 -> angle=0
      setTransferObjects([makeObj({ id: 'a', posX: 1100, posY: 1000 })]);

      const result = getProximityObjects(1000, 1000, 0, 0);
      expect(result[0].angle).toBeCloseTo(0, 5);
    });

    // --- ProximityObject includes original fields ---

    it('spreads original TransferObject fields into ProximityObject', () => {
      const obj = makeObj({
        id: 'spread-test',
        type: 'debris',
        name: 'Booster Fragment',
        posX: 500,
        posY: 0,
        velX: 10,
        velY: 20,
        radius: 5,
        mass: 200,
      });
      setTransferObjects([obj]);

      const result = getProximityObjects(0, 0, 0, 0);
      expect(result[0].id).toBe('spread-test');
      expect(result[0].type).toBe('debris');
      expect(result[0].name).toBe('Booster Fragment');
      expect(result[0].radius).toBe(5);
      expect(result[0].mass).toBe(200);
    });
  });

  // =========================================================================
  // checkTransferCollision
  // =========================================================================

  describe('checkTransferCollision()', () => {
    it('returns null when no objects exist', () => {
      const result = checkTransferCollision(0, 0, 10, 0, 0);
      expect(result).toBeNull();
    });

    it('returns null when object is out of collision range', () => {
      setTransferObjects([makeObj({ id: 'far', posX: 1000, posY: 0, radius: 10 })]);

      // craftRadius=10, objRadius=10, distance=1000, threshold=20
      const result = checkTransferCollision(0, 0, 10, 0, 0);
      expect(result).toBeNull();
    });

    it('@smoke detects slow collision (normal radius)', () => {
      // Object at (15, 0) with radius=10, craft at origin with radius=10
      // distance=15, threshold=20 -> collision
      // Relative speed = 0 (both stationary) -> normal radius
      setTransferObjects([makeObj({ id: 'hit', posX: 15, posY: 0, radius: 10 })]);

      const result = checkTransferCollision(0, 0, 10, 0, 0);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('hit');
    });

    it('uses enlarged radius (3x) for fast objects (streak LOD)', () => {
      // Object radius=10, fast collision radius = 10 * 3 = 30
      // craftRadius=5, total threshold = 35
      // Place object at distance 34 (< 35 -> collision with enlarged radius,
      // but > 15 which would be normal threshold)
      setTransferObjects([
        makeObj({ id: 'fast', posX: 34, posY: 0, radius: 10, velX: 3000, velY: 0 }),
      ]);

      // Craft stationary -> relative speed = 3000 > LOD_THRESHOLDS.basic -> enlarged
      const result = checkTransferCollision(0, 0, 5, 0, 0);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('fast');
    });

    it('fast object does NOT collide when outside enlarged radius', () => {
      // Object radius=10, enlarged=30, craftRadius=5, threshold=35
      // Place at distance 36 (> 35)
      setTransferObjects([
        makeObj({ id: 'miss', posX: 36, posY: 0, radius: 10, velX: 3000, velY: 0 }),
      ]);

      const result = checkTransferCollision(0, 0, 5, 0, 0);
      expect(result).toBeNull();
    });

    it('does not enlarge radius for slow objects', () => {
      // Object radius=10, craft radius=5, normal threshold=15
      // Place at distance 16 (> 15 but < 35 if enlarged)
      // Relative speed is 0 (both stationary) -> normal radius
      setTransferObjects([makeObj({ id: 'slow', posX: 16, posY: 0, radius: 10 })]);

      const result = checkTransferCollision(0, 0, 5, 0, 0);
      expect(result).toBeNull();
    });

    it('does not enlarge radius when relative speed is at the basic threshold boundary', () => {
      // relativeSpeed exactly at LOD_THRESHOLDS.basic (2000) triggers enlarged radius
      // (the condition is > LOD_THRESHOLDS.basic, not >=)
      setTransferObjects([
        makeObj({ id: 'boundary', posX: 20, posY: 0, radius: 10, velX: 2000, velY: 0 }),
      ]);

      // Relative speed = 2000, condition is > 2000 => false => normal radius
      // craftRadius=5, objRadius=10, threshold=15, distance=20 => no collision
      const result = checkTransferCollision(0, 0, 5, 0, 0);
      expect(result).toBeNull();
    });

    it('enlarges radius when relative speed is just above basic threshold', () => {
      // relativeSpeed = 2001 > 2000 => enlarged
      setTransferObjects([
        makeObj({ id: 'just-fast', posX: 34, posY: 0, radius: 10, velX: 2001, velY: 0 }),
      ]);

      // craftRadius=5, enlarged objRadius=30, threshold=35, distance=34 => collision
      const result = checkTransferCollision(0, 0, 5, 0, 0);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('just-fast');
    });

    it('returns the FIRST colliding object, not the closest', () => {
      setTransferObjects([
        makeObj({ id: 'first', posX: 10, posY: 0, radius: 10 }),
        makeObj({ id: 'second', posX: 5, posY: 0, radius: 10 }),
      ]);

      // Both collide (distance < craftRadius + objRadius), returns first in array order
      const result = checkTransferCollision(0, 0, 10, 0, 0);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('first');
    });

    it('accounts for craft velocity when determining collision radius enlargement', () => {
      // Object stationary, craft moving fast -> relative speed is high
      // Object at (34, 0), radius=10, craftRadius=5
      // Craft velX=3000 -> relativeSpeed = |0-3000| = 3000 > 2000 -> enlarged
      // enlarged objRadius = 30, threshold = 35, distance = 34 -> collision
      setTransferObjects([
        makeObj({ id: 'craft-fast', posX: 34, posY: 0, radius: 10 }),
      ]);

      const result = checkTransferCollision(0, 0, 5, 3000, 0);
      expect(result).not.toBeNull();
      expect(result!.id).toBe('craft-fast');
    });
  });

  // =========================================================================
  // Constants exports
  // =========================================================================

  describe('exported constants', () => {
    it('RENDER_DISTANCE is 50,000 metres', () => {
      expect(RENDER_DISTANCE).toBe(50_000);
    });

    it('LOD_THRESHOLDS has expected values', () => {
      expect(LOD_THRESHOLDS.full).toBe(100);
      expect(LOD_THRESHOLDS.basic).toBe(2_000);
    });

    it('FAST_COLLISION_RADIUS_MULTIPLIER is 3', () => {
      expect(FAST_COLLISION_RADIUS_MULTIPLIER).toBe(3);
    });
  });
});
