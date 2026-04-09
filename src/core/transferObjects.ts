/**
 * transferObjects.ts — Proximity object system for TRANSFER phase.
 *
 * Objects (asteroids, other craft, debris) appear in the flight view when
 * the player's craft is in TRANSFER phase and nearby objects enter the
 * render distance (~50km).
 *
 * Objects are rendered at different levels of detail based on relative
 * velocity:
 *   - Similar speed (< 100 m/s difference): full render with functional parts
 *   - Medium speed (100–2000 m/s): basic shape, no functional parts
 *   - Very fast (> 2000 m/s): streak/shooting star effect with trail
 *
 * If the player matches velocity with a fast object, it transitions to
 * full render.  Collision with any object is possible — fast objects use
 * a simple circular collision boundary.
 *
 * @module core/transferObjects
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Level of detail for a transfer object based on relative velocity. */
export type TransferObjectLOD = 'full' | 'basic' | 'streak';

/** A single object in the transfer proximity system. */
export interface TransferObject {
  /** Unique identifier. */
  id: string;
  /** Object type (asteroid, craft, debris). */
  type: 'asteroid' | 'craft' | 'debris';
  /** Display name. */
  name: string;
  /** Position X in metres (same frame as player craft). */
  posX: number;
  /** Position Y in metres. */
  posY: number;
  /** Velocity X in m/s. */
  velX: number;
  /** Velocity Y in m/s. */
  velY: number;
  /** Object radius in metres (for collision and rendering scale). */
  radius: number;
  /** Mass in kg (for collision impact calculation). */
  mass: number;
}

/** Object with computed proximity data for rendering. */
export interface ProximityObject extends TransferObject {
  /** Distance from player craft in metres. */
  distance: number;
  /** Relative velocity magnitude (m/s). */
  relativeSpeed: number;
  /** Current LOD level. */
  lod: TransferObjectLOD;
  /** Angle from player to object (radians, 0 = right, π/2 = up). */
  angle: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum distance for an object to appear in the flight view (metres). */
export const RENDER_DISTANCE = 50_000;

/** Relative velocity thresholds for LOD transitions. */
export const LOD_THRESHOLDS = {
  /** Below this: full render with functional parts. */
  full: 100,
  /** Below this: basic shape. Above this: streak. */
  basic: 2_000,
};

/** Collision boundary multiplier for fast objects (streak LOD). */
export const FAST_COLLISION_RADIUS_MULTIPLIER = 3;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

let _objects: TransferObject[] = [];

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Set the current transfer objects (called when entering TRANSFER or
 * when the map view generates nearby objects along the trajectory).
 */
export function setTransferObjects(objects: TransferObject[]): void {
  _objects = [...objects];
}

/**
 * Add a single object to the transfer proximity system.
 */
export function addTransferObject(obj: TransferObject): void {
  _objects.push(obj);
}

/**
 * Clear all transfer objects (called when leaving TRANSFER phase).
 */
export function clearTransferObjects(): void {
  _objects = [];
}

/**
 * Get all transfer objects (for serialization/testing).
 */
export function getTransferObjects(): readonly TransferObject[] {
  return _objects;
}

/**
 * Advance all transfer objects by dt seconds.
 * Objects move at constant velocity (no gravity in TRANSFER).
 */
export function tickTransferObjects(dt: number): void {
  for (const obj of _objects) {
    obj.posX += obj.velX * dt;
    obj.posY += obj.velY * dt;
  }
}

/**
 * Compute proximity data for objects near the player craft.
 * Returns only objects within RENDER_DISTANCE, sorted by distance.
 */
export function getProximityObjects(
  craftPosX: number,
  craftPosY: number,
  craftVelX: number,
  craftVelY: number,
): ProximityObject[] {
  const result: ProximityObject[] = [];

  for (const obj of _objects) {
    const dx = obj.posX - craftPosX;
    const dy = obj.posY - craftPosY;
    const distance = Math.hypot(dx, dy);

    if (distance > RENDER_DISTANCE) continue;

    const dvx = obj.velX - craftVelX;
    const dvy = obj.velY - craftVelY;
    const relativeSpeed = Math.hypot(dvx, dvy);

    let lod: TransferObjectLOD;
    if (relativeSpeed < LOD_THRESHOLDS.full) {
      lod = 'full';
    } else if (relativeSpeed < LOD_THRESHOLDS.basic) {
      lod = 'basic';
    } else {
      lod = 'streak';
    }

    const angle = Math.atan2(dy, dx);

    result.push({
      ...obj,
      distance,
      relativeSpeed,
      lod,
      angle,
    });
  }

  result.sort((a, b) => a.distance - b.distance);
  return result;
}

/**
 * Check for collisions between the player craft and nearby transfer objects.
 * Returns the first colliding object, or null.
 *
 * Fast objects (streak LOD) use an enlarged circular collision boundary.
 */
export function checkTransferCollision(
  craftPosX: number,
  craftPosY: number,
  craftRadius: number,
  craftVelX: number,
  craftVelY: number,
): TransferObject | null {
  for (const obj of _objects) {
    const dx = obj.posX - craftPosX;
    const dy = obj.posY - craftPosY;
    const distance = Math.hypot(dx, dy);

    // Determine collision radius based on relative speed.
    const dvx = obj.velX - craftVelX;
    const dvy = obj.velY - craftVelY;
    const relativeSpeed = Math.hypot(dvx, dvy);

    let collisionRadius = obj.radius;
    if (relativeSpeed > LOD_THRESHOLDS.basic) {
      // Fast objects use enlarged collision boundary.
      collisionRadius *= FAST_COLLISION_RADIUS_MULTIPLIER;
    }

    if (distance < craftRadius + collisionRadius) {
      return obj;
    }
  }
  return null;
}
