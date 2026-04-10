/**
 * collision.ts — Collision detection, response, and separation impulse.
 *
 * Handles:
 *   - AABB (axis-aligned bounding box) computation for rocket/debris bodies
 *   - Overlap detection between AABBs
 *   - Collision response with atmosphere-modulated restitution
 *   - Separation impulse applied at the moment of stage decoupling
 *   - Asteroid collision detection (craft AABB vs asteroid circle)
 *   - Velocity-based damage model for asteroid impacts
 *
 * COLLISION MODEL
 *   After stage separation, each body (main rocket + each debris fragment)
 *   gets an AABB computed from its active parts.  All pairs are tested for
 *   overlap.  On collision, an impulse is applied following Newton's third
 *   law: lighter bodies receive larger velocity changes.  Atmospheric density
 *   damps the bounce (lower restitution at sea level).
 *
 * ASTEROID COLLISION MODEL
 *   Player craft AABB is tested against each asteroid's circular boundary.
 *   Damage is velocity-based:
 *     < 1 m/s:    No damage (docking/capture speed)
 *     1–5 m/s:    Minor bump — outermost parts may be damaged
 *     5–20 m/s:   Significant impact — outer parts destroyed
 *     > 20 m/s:   Catastrophic — likely total craft destruction
 *
 * SEPARATION IMPULSE
 *   When a decoupler fires, a fixed-magnitude impulse is split between the
 *   two resulting bodies inversely proportional to their mass.  The impulse
 *   direction follows the rocket's orientation axis, pushing the upper stage
 *   forward and the lower stage backward.
 *
 * PUBLIC API
 *   computeAABB(activeParts, assemblyParts, posX, posY, angle)  -> AABB
 *   testAABBOverlap(a, b)                                       -> boolean
 *   testAABBCircleOverlap(aabb, cx, cy, r)                      -> boolean
 *   tickCollisions(ps, assembly, dt)                             -> void
 *   applySeparationImpulse(ps, debris, assembly)                 -> void
 *   checkAsteroidCollisions(ps, assembly, asteroids, flightState) -> AsteroidCollisionResult[]
 *   computeRelativeSpeed(craftVelX, craftVelY, objVelX, objVelY)  -> number
 *   classifyAsteroidDamage(relSpeed)                              -> AsteroidDamageLevel
 *   applyAsteroidDamage(ps, assembly, flightState, damage, relSpeed) -> void
 *
 * @module collision
 */

import { getPartById } from '../data/parts.ts';
import { airDensity }  from './atmosphere.ts';

import type { PhysicsState, RocketAssembly } from './physics.ts';
import type { Asteroid } from './asteroidBelt.ts';
import type { FlightState } from './gameState.ts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Axis-aligned bounding box. */
export interface AABB {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Minimal placed-part shape needed by collision helpers. */
interface PlacedPartLike {
  x: number;
  y: number;
  partId: string;
}

/** A debris-like body with position, velocity, angular velocity, and active parts. */
interface DebrisLike {
  activeParts: Set<string>;
  fuelStore: Map<string, number>;
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  angle: number;
  angularVelocity: number;
  landed: boolean;
  crashed: boolean;
  collisionCooldown?: number;
}

/** Internal body wrapper used during collision tick. */
interface CollisionBody {
  type: string;
  ref: { posX: number; posY: number; velX: number; velY: number; angle: number; angularVelocity?: number };
  activeParts: Set<string>;
  fuelStore: Map<string, number>;
  cooldown: number;
  aabb?: AABB;
  mass?: number;
}

// ---------------------------------------------------------------------------
// Asteroid damage types
// ---------------------------------------------------------------------------

/**
 * Damage severity levels for asteroid impacts.
 * Based on relative velocity between craft and asteroid.
 */
export const AsteroidDamageLevel = {
  NONE:         'NONE',
  MINOR:        'MINOR',
  SIGNIFICANT:  'SIGNIFICANT',
  CATASTROPHIC: 'CATASTROPHIC',
} as const;

export type AsteroidDamageLevel = typeof AsteroidDamageLevel[keyof typeof AsteroidDamageLevel];

/** Result of a single asteroid collision check. */
export interface AsteroidCollisionResult {
  /** The asteroid that was hit. */
  asteroid: Asteroid;
  /** Relative speed at impact (m/s). */
  relativeSpeed: number;
  /** Damage classification. */
  damage: AsteroidDamageLevel;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** N*s impulse applied at decoupling to push stages apart. */
const SEPARATION_IMPULSE: number = 2000;

/** Bounciness coefficient (0 = inelastic, 1 = perfectly elastic). */
const BASE_RESTITUTION: number = 0.3;

/** How much atmospheric density reduces restitution. */
const DENSITY_DAMPING_COEFF: number = 0.16;

/** Minimum restitution floor to prevent fully dead collisions. */
const MIN_RESTITUTION: number = 0.05;

/** Metres of allowed overlap before positional correction kicks in. */
const POSITION_SLOP: number = 0.01;

/** Fraction of penetration corrected per tick. */
const POSITION_CORRECTION_RATE: number = 0.5;

/** Number of ticks (~1s at 60 Hz) to skip collisions after separation.
 *  Must be long enough for the separation impulse + any active thrust to
 *  physically separate the two bodies before collision detection activates. */
const SEPARATION_COOLDOWN_TICKS: number = 10;

/** Scale factor: metres per pixel at default 1x zoom. */
const SCALE_M_PER_PX: number = 0.05;

// --- Asteroid damage thresholds (m/s relative speed) ---

/** Below this speed: no damage (docking/capture speed). */
const ASTEROID_SPEED_NONE: number = 1;

/** Below this speed: minor bump, possible outermost part damage. */
const ASTEROID_SPEED_MINOR: number = 5;

/** Below this speed: significant — outer parts destroyed. */
const ASTEROID_SPEED_SIGNIFICANT: number = 20;

/** At or above ASTEROID_SPEED_SIGNIFICANT: catastrophic — total destruction. */

/** Per-asteroid collision cooldown map: asteroid id → remaining cooldown ticks. */
const _asteroidCollisionCooldowns: Map<string, number> = new Map();

/** Fraction of outermost parts to damage on a MINOR impact (0–1). */
const MINOR_DAMAGE_FRACTION: number = 0.25;

/** Fraction of outer parts to destroy on a SIGNIFICANT impact (0–1). */
const SIGNIFICANT_DAMAGE_FRACTION: number = 0.6;

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Compute total mass (dry + fuel) for a set of active parts.
 */
function _bodyMass(
  activeParts: Set<string>,
  fuelStore: Map<string, number>,
  assemblyParts: Map<string, PlacedPartLike>,
): number {
  let mass = 0;
  for (const id of activeParts) {
    const placed = assemblyParts.get(id);
    const def = placed ? getPartById(placed.partId) : null;
    if (def) mass += def.mass ?? 0;
    const fuel = fuelStore.get(id);
    if (fuel != null && fuel > 0) mass += fuel;
  }
  return Math.max(1, mass);
}

/**
 * Compute moment of inertia about CoM using point-mass approximation.
 * I = Sum(m_i * r_i^2)  where r_i is distance from part centre to CoM.
 */
function _bodyMoI(
  activeParts: Set<string>,
  fuelStore: Map<string, number>,
  assemblyParts: Map<string, PlacedPartLike>,
): number {
  // First pass: find CoM
  let totalMass = 0;
  let comX = 0;
  let comY = 0;
  for (const id of activeParts) {
    const placed = assemblyParts.get(id);
    const def = placed ? getPartById(placed.partId) : null;
    if (!placed || !def) continue;
    const m = (def.mass ?? 0) + (fuelStore.get(id) ?? 0);
    comX += placed.x * m;
    comY += placed.y * m;
    totalMass += m;
  }
  if (totalMass <= 0) return 1;
  comX /= totalMass;
  comY /= totalMass;

  // Second pass: sum I = Sum m_i * r_i^2
  let I = 0;
  for (const id of activeParts) {
    const placed = assemblyParts.get(id);
    const def = placed ? getPartById(placed.partId) : null;
    if (!placed || !def) continue;
    const m = (def.mass ?? 0) + (fuelStore.get(id) ?? 0);
    const dx = (placed.x - comX) * SCALE_M_PER_PX;
    const dy = (placed.y - comY) * SCALE_M_PER_PX;
    I += m * (dx * dx + dy * dy);
  }
  return Math.max(1, I);
}

/**
 * Average Y position (in VAB pixels) of a body's active parts.
 * Used to determine which fragment is "above" vs "below".
 */
function _averagePartY(
  activeParts: Set<string>,
  assemblyParts: Map<string, PlacedPartLike>,
): number {
  let sum = 0;
  let count = 0;
  for (const id of activeParts) {
    const placed = assemblyParts.get(id);
    if (placed) {
      sum += placed.y;
      count++;
    }
  }
  return count > 0 ? sum / count : 0;
}

// ---------------------------------------------------------------------------
// Public API — AABB computation
// ---------------------------------------------------------------------------

/**
 * Compute an axis-aligned bounding box for a body in world-space metres.
 *
 * For each active part: get 4 corners from placed.x/y +/- halfW/halfH (pixels),
 * rotate by the body's angle, scale to metres, and offset by posX/posY.
 */
export function computeAABB(
  activeParts: Set<string>,
  assemblyParts: Map<string, PlacedPartLike>,
  posX: number,
  posY: number,
  angle: number,
): AABB {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;

  const cosA = Math.cos(angle);
  const sinA = Math.sin(angle);

  for (const id of activeParts) {
    const placed = assemblyParts.get(id);
    const def = placed ? getPartById(placed.partId) : null;
    if (!placed || !def) continue;

    const halfW = ((def.width ?? 40) / 2) * SCALE_M_PER_PX;
    const halfH = ((def.height ?? 40) / 2) * SCALE_M_PER_PX;

    // Part centre in local metres (VAB Y-up -> world Y-up)
    const cx = placed.x * SCALE_M_PER_PX;
    const cy = placed.y * SCALE_M_PER_PX;

    // Four corners relative to part centre
    const corners = [
      { lx: cx - halfW, ly: cy - halfH },
      { lx: cx + halfW, ly: cy - halfH },
      { lx: cx - halfW, ly: cy + halfH },
      { lx: cx + halfW, ly: cy + halfH },
    ];

    for (const { lx, ly } of corners) {
      // Rotate around origin (body pivot), then translate to world pos.
      const wx = posX + lx * cosA + ly * sinA;
      const wy = posY - lx * sinA + ly * cosA;

      if (wx < minX) minX = wx;
      if (wx > maxX) maxX = wx;
      if (wy < minY) minY = wy;
      if (wy > maxY) maxY = wy;
    }
  }

  return { minX, maxX, minY, maxY };
}

// ---------------------------------------------------------------------------
// Public API — Overlap detection
// ---------------------------------------------------------------------------

/**
 * Test whether two AABBs overlap.
 */
export function testAABBOverlap(a: AABB, b: AABB): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX &&
         a.minY <= b.maxY && a.maxY >= b.minY;
}

// ---------------------------------------------------------------------------
// Public API — Per-tick collision detection and response
// ---------------------------------------------------------------------------

/**
 * Run collision detection and response for all active flight bodies.
 *
 * Called once per FIXED_DT from the physics tick loop.
 */
export function tickCollisions(ps: PhysicsState, assembly: RocketAssembly, dt: number): void {
  // 1. Decrement collision cooldowns on all debris.
  for (const debris of ps.debris) {
    if (debris.collisionCooldown != null && debris.collisionCooldown > 0) {
      debris.collisionCooldown--;
    }
  }

  // 2. Collect active bodies: main rocket + non-landed/crashed debris.
  const bodies: CollisionBody[] = [];

  // Main rocket (only if still flying)
  if (!ps.landed && !ps.crashed && ps.activeParts.size > 0) {
    bodies.push({
      type: 'rocket',
      ref: ps,
      activeParts: ps.activeParts,
      fuelStore: ps.fuelStore,
      cooldown: 0,  // rocket never has cooldown
    });
  }

  for (const debris of ps.debris) {
    if (debris.landed || debris.crashed) continue;
    bodies.push({
      type: 'debris',
      ref: debris,
      activeParts: debris.activeParts,
      fuelStore: debris.fuelStore,
      cooldown: debris.collisionCooldown ?? 0,
    });
  }

  // 3. Need at least 2 bodies to test collisions.
  if (bodies.length < 2) return;

  // 4. Compute AABB and mass for each body.
  for (const body of bodies) {
    body.aabb = computeAABB(
      body.activeParts,
      assembly.parts as Map<string, PlacedPartLike>,
      body.ref.posX,
      body.ref.posY,
      body.ref.angle,
    );
    body.mass = _bodyMass(body.activeParts, body.fuelStore, assembly.parts as Map<string, PlacedPartLike>);
  }

  // 5. Test all pairs.
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      const a = bodies[i];
      const b = bodies[j];

      // 6. Skip pairs where either body has cooldown.
      if (a.cooldown > 0 || b.cooldown > 0) continue;

      // 7. Test overlap.
      if (!testAABBOverlap(a.aabb!, b.aabb!)) continue;

      // Resolve collision.
      _resolveCollision(a, b, assembly, dt);
    }
  }
}

// ---------------------------------------------------------------------------
// Public API — Separation impulse
// ---------------------------------------------------------------------------

/**
 * Apply a separation impulse to push the main rocket and a newly-created
 * debris fragment apart.
 *
 * Called from staging.js immediately after debris creation.
 */
export function applySeparationImpulse(ps: PhysicsState, debris: DebrisLike, assembly: RocketAssembly): void {
  const rocketMass = _bodyMass(ps.activeParts, ps.fuelStore, assembly.parts as Map<string, PlacedPartLike>);
  const debrisMass = _bodyMass(debris.activeParts, debris.fuelStore, assembly.parts as Map<string, PlacedPartLike>);

  // Direction: along rocket's orientation axis.
  // angle=0 means pointing up, so forward = (sin(angle), cos(angle)).
  const dirX = Math.sin(ps.angle);
  const dirY = Math.cos(ps.angle);

  // Determine which fragment is "above" (higher average Y in VAB space).
  // Higher Y = further forward along the rocket.
  const rocketAvgY = _averagePartY(ps.activeParts, assembly.parts as Map<string, PlacedPartLike>);
  const debrisAvgY = _averagePartY(debris.activeParts, assembly.parts as Map<string, PlacedPartLike>);

  // If debris is the lower stage (lower avgY), push it backward.
  // If debris is the upper stage (higher avgY), push it forward.
  const debrisIsLower = debrisAvgY < rocketAvgY;
  const debrisSign = debrisIsLower ? -1 : 1;
  const rocketSign = -debrisSign;

  // Apply impulse: dv = impulse / mass (lighter body moves more).
  const debrisDv = SEPARATION_IMPULSE / debrisMass;
  const rocketDv = SEPARATION_IMPULSE / rocketMass;

  debris.velX += debrisSign * dirX * debrisDv;
  debris.velY += debrisSign * dirY * debrisDv;
  ps.velX     += rocketSign * dirX * rocketDv;
  ps.velY     += rocketSign * dirY * rocketDv;
}

// ---------------------------------------------------------------------------
// Private — collision resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a collision between two overlapping bodies.
 */
function _resolveCollision(a: CollisionBody, b: CollisionBody, assembly: RocketAssembly, dt: number): void {
  const aabbA = a.aabb!;
  const aabbB = b.aabb!;

  // Find penetration on each axis.
  const overlapX1 = aabbA.maxX - aabbB.minX;
  const overlapX2 = aabbB.maxX - aabbA.minX;
  const overlapY1 = aabbA.maxY - aabbB.minY;
  const overlapY2 = aabbB.maxY - aabbA.minY;

  const minOverlapX = Math.min(overlapX1, overlapX2);
  const minOverlapY = Math.min(overlapY1, overlapY2);

  // Collision normal: axis of minimum penetration.
  let nx = 0;
  let ny = 0;
  let penetration: number;

  if (minOverlapX < minOverlapY) {
    penetration = minOverlapX;
    nx = overlapX1 < overlapX2 ? -1 : 1;
  } else {
    penetration = minOverlapY;
    ny = overlapY1 < overlapY2 ? -1 : 1;
  }

  // Relative velocity along normal.
  const relVelX = a.ref.velX - b.ref.velX;
  const relVelY = a.ref.velY - b.ref.velY;
  const relVelNormal = relVelX * nx + relVelY * ny;

  // Skip if bodies are already separating.
  if (relVelNormal > 0) return;

  // Compute restitution: damp in atmosphere.
  const avgAlt = (a.ref.posY + b.ref.posY) / 2;
  const density = airDensity(Math.max(0, avgAlt));
  const e = Math.max(MIN_RESTITUTION, BASE_RESTITUTION - DENSITY_DAMPING_COEFF * density);

  // Impulse magnitude.
  const invMassSum = 1 / a.mass! + 1 / b.mass!;
  const j = -(1 + e) * relVelNormal / invMassSum;

  // Apply velocity impulse (Newton's third law).
  a.ref.velX += (j / a.mass!) * nx;
  a.ref.velY += (j / a.mass!) * ny;
  b.ref.velX -= (j / b.mass!) * nx;
  b.ref.velY -= (j / b.mass!) * ny;

  // Angular impulse from off-centre contact.
  // Contact point at overlap centre.
  const contactX = ((Math.max(aabbA.minX, aabbB.minX) + Math.min(aabbA.maxX, aabbB.maxX)) / 2);
  const contactY = ((Math.max(aabbA.minY, aabbB.minY) + Math.min(aabbA.maxY, aabbB.maxY)) / 2);

  // Centre of each body's AABB.
  const centreAX = (aabbA.minX + aabbA.maxX) / 2;
  const centreAY = (aabbA.minY + aabbA.maxY) / 2;
  const centreBX = (aabbB.minX + aabbB.maxX) / 2;
  const centreBY = (aabbB.minY + aabbB.maxY) / 2;

  // Lever arm from body centre to contact point.
  const rAx = contactX - centreAX;
  const rAy = contactY - centreAY;
  const rBx = contactX - centreBX;
  const rBy = contactY - centreBY;

  // Torque = r x F (2D cross product: rx*Fy - ry*Fx)
  const forceX = j * nx;
  const forceY = j * ny;
  const torqueA = rAx * forceY - rAy * forceX;
  const torqueB = rBx * (-forceY) - rBy * (-forceX);

  // Apply angular impulse: dw = torque * dt / I
  if (a.ref.angularVelocity != null) {
    const Ia = _bodyMoI(a.activeParts, a.fuelStore, assembly.parts as Map<string, PlacedPartLike>);
    a.ref.angularVelocity += torqueA * dt / Ia;
  }
  if (b.ref.angularVelocity != null) {
    const Ib = _bodyMoI(b.activeParts, b.fuelStore, assembly.parts as Map<string, PlacedPartLike>);
    b.ref.angularVelocity += torqueB * dt / Ib;
  }

  // Positional correction: push bodies apart proportional to inverse mass.
  const correction = Math.max(0, penetration - POSITION_SLOP) * POSITION_CORRECTION_RATE;
  if (correction > 0) {
    const totalInvMass = invMassSum;
    a.ref.posX += (correction / totalInvMass) * (1 / a.mass!) * nx;
    a.ref.posY += (correction / totalInvMass) * (1 / a.mass!) * ny;
    b.ref.posX -= (correction / totalInvMass) * (1 / b.mass!) * nx;
    b.ref.posY -= (correction / totalInvMass) * (1 / b.mass!) * ny;
  }
}

// ---------------------------------------------------------------------------
// Public API — AABB vs Circle overlap (for asteroid collision)
// ---------------------------------------------------------------------------

/**
 * Test whether an AABB overlaps a circle.
 *
 * Finds the closest point on the AABB to the circle centre and checks
 * whether the distance is less than or equal to the radius.
 */
export function testAABBCircleOverlap(
  aabb: AABB,
  cx: number,
  cy: number,
  radius: number,
): boolean {
  // Clamp the circle centre to the nearest point on the AABB.
  const closestX = Math.max(aabb.minX, Math.min(cx, aabb.maxX));
  const closestY = Math.max(aabb.minY, Math.min(cy, aabb.maxY));

  const dx = cx - closestX;
  const dy = cy - closestY;

  return (dx * dx + dy * dy) <= (radius * radius);
}

// ---------------------------------------------------------------------------
// Public API — Asteroid damage classification
// ---------------------------------------------------------------------------

/**
 * Compute the relative speed between the craft and another object.
 */
export function computeRelativeSpeed(
  craftVelX: number,
  craftVelY: number,
  objVelX: number,
  objVelY: number,
): number {
  const dvx = craftVelX - objVelX;
  const dvy = craftVelY - objVelY;
  return Math.sqrt(dvx * dvx + dvy * dvy);
}

/**
 * Classify damage severity based on relative impact speed (m/s).
 *
 * Thresholds:
 *   < 1 m/s:   NONE        — docking/capture speed
 *   1–5 m/s:   MINOR       — outermost parts may be damaged
 *   5–20 m/s:  SIGNIFICANT — outer parts destroyed
 *   >= 20 m/s: CATASTROPHIC — likely total craft destruction
 */
export function classifyAsteroidDamage(relSpeed: number): AsteroidDamageLevel {
  if (relSpeed < ASTEROID_SPEED_NONE)        return AsteroidDamageLevel.NONE;
  if (relSpeed < ASTEROID_SPEED_MINOR)       return AsteroidDamageLevel.MINOR;
  if (relSpeed < ASTEROID_SPEED_SIGNIFICANT) return AsteroidDamageLevel.SIGNIFICANT;
  return AsteroidDamageLevel.CATASTROPHIC;
}

// ---------------------------------------------------------------------------
// Private — Identify outermost parts for damage targeting
// ---------------------------------------------------------------------------

/**
 * Rank active parts by distance from AABB centre (outermost first).
 *
 * Parts furthest from the craft's geometric centre are the most exposed
 * and take damage first in an asteroid impact.
 */
function _rankPartsByExposure(
  activeParts: Set<string>,
  assemblyParts: Map<string, PlacedPartLike>,
): string[] {
  // Compute geometric centre of all active parts (VAB pixel coords).
  let sumX = 0;
  let sumY = 0;
  let count = 0;
  for (const id of activeParts) {
    const placed = assemblyParts.get(id);
    if (placed) {
      sumX += placed.x;
      sumY += placed.y;
      count++;
    }
  }
  if (count === 0) return [];

  const centreX = sumX / count;
  const centreY = sumY / count;

  // Build array with distances.
  const items: Array<{ id: string; dist: number }> = [];
  for (const id of activeParts) {
    const placed = assemblyParts.get(id);
    if (!placed) continue;
    const dx = placed.x - centreX;
    const dy = placed.y - centreY;
    items.push({ id, dist: dx * dx + dy * dy });
  }

  // Sort descending by distance (outermost first).
  items.sort((a, b) => b.dist - a.dist);

  return items.map(i => i.id);
}

// ---------------------------------------------------------------------------
// Public API — Apply asteroid damage
// ---------------------------------------------------------------------------

/**
 * Apply asteroid impact damage to the craft.
 *
 * Damage model:
 *   NONE:         No effect.
 *   MINOR:        ~25% of outermost parts destroyed.
 *   SIGNIFICANT:  ~60% of outer parts destroyed.
 *   CATASTROPHIC: All parts destroyed, craft crashes.
 *
 * Destroyed parts are removed from activeParts and logged as FlightEvents.
 */
export function applyAsteroidDamage(
  ps: PhysicsState,
  assembly: RocketAssembly,
  flightState: FlightState,
  damage: AsteroidDamageLevel,
  relSpeed: number,
  asteroidName: string = 'asteroid',
): void {
  if (damage === AsteroidDamageLevel.NONE) return;

  if (damage === AsteroidDamageLevel.CATASTROPHIC) {
    // Destroy all parts and crash the craft.
    const partIds = [...ps.activeParts];
    for (const instanceId of partIds) {
      const placed = assembly.parts.get(instanceId);
      const def = placed ? getPartById(placed.partId) : null;
      const partName = def?.name ?? 'Unknown part';

      ps.activeParts.delete(instanceId);
      ps.firingEngines.delete(instanceId);
      ps.deployedParts.delete(instanceId);
      ps.heatMap?.delete(instanceId);

      flightState.events.push({
        type:        'PART_DESTROYED',
        time:        flightState.timeElapsed,
        instanceId,
        partName,
        description: `${partName} destroyed by catastrophic ${asteroidName} impact at ${relSpeed.toFixed(1)} m/s.`,
      });
    }
    ps.crashed = true;

    flightState.events.push({
      type:        'ASTEROID_IMPACT',
      time:        flightState.timeElapsed,
      severity:    'CATASTROPHIC',
      relSpeed,
      asteroidName,
      description: `Catastrophic collision with ${asteroidName} at ${relSpeed.toFixed(1)} m/s — craft destroyed.`,
    });
    return;
  }

  // MINOR or SIGNIFICANT: destroy a fraction of outermost parts.
  const fraction = damage === AsteroidDamageLevel.MINOR
    ? MINOR_DAMAGE_FRACTION
    : SIGNIFICANT_DAMAGE_FRACTION;

  const ranked = _rankPartsByExposure(
    ps.activeParts,
    assembly.parts as Map<string, PlacedPartLike>,
  );
  const destroyCount = Math.max(1, Math.ceil(ranked.length * fraction));
  const toDestroy = ranked.slice(0, destroyCount);

  for (const instanceId of toDestroy) {
    const placed = assembly.parts.get(instanceId);
    const def = placed ? getPartById(placed.partId) : null;
    const partName = def?.name ?? 'Unknown part';

    ps.activeParts.delete(instanceId);
    ps.firingEngines.delete(instanceId);
    ps.deployedParts.delete(instanceId);
    ps.heatMap?.delete(instanceId);

    flightState.events.push({
      type:        'PART_DESTROYED',
      time:        flightState.timeElapsed,
      instanceId,
      partName,
      description: `${partName} destroyed by ${asteroidName} impact at ${relSpeed.toFixed(1)} m/s.`,
    });
  }

  const severityLabel = damage === AsteroidDamageLevel.MINOR ? 'MINOR' : 'SIGNIFICANT';
  flightState.events.push({
    type:        'ASTEROID_IMPACT',
    time:        flightState.timeElapsed,
    severity:    severityLabel,
    relSpeed,
    asteroidName,
    partsDestroyed: toDestroy.length,
    description: `${severityLabel} collision with ${asteroidName} at ${relSpeed.toFixed(1)} m/s — ${toDestroy.length} part(s) destroyed.`,
  });

  // If all active parts are gone after partial destruction, crash.
  if (ps.activeParts.size === 0) {
    ps.crashed = true;
  }
}

// ---------------------------------------------------------------------------
// Public API — Check asteroid collisions (called from flight loop)
// ---------------------------------------------------------------------------

/**
 * Test the player craft against all provided asteroids and apply damage.
 *
 * Returns an array of collision results (empty if no collisions).
 * Only checks if the craft is flying (not landed/crashed) and has active parts.
 */
export function checkAsteroidCollisions(
  ps: PhysicsState,
  assembly: RocketAssembly,
  asteroids: readonly Asteroid[],
  flightState: FlightState,
): AsteroidCollisionResult[] {
  // Decrement active asteroid collision cooldowns and remove expired entries
  // every tick, even if there are no asteroids or the craft is inactive.
  for (const [id, ticks] of _asteroidCollisionCooldowns) {
    if (ticks <= 1) {
      _asteroidCollisionCooldowns.delete(id);
    } else {
      _asteroidCollisionCooldowns.set(id, ticks - 1);
    }
  }

  // Skip if craft is not flying.
  if (ps.landed || ps.crashed || ps.activeParts.size === 0) return [];
  if (asteroids.length === 0) return [];

  // Compute craft AABB once.
  const craftAABB = computeAABB(
    ps.activeParts,
    assembly.parts as Map<string, PlacedPartLike>,
    ps.posX,
    ps.posY,
    ps.angle,
  );

  const results: AsteroidCollisionResult[] = [];

  for (const asteroid of asteroids) {
    // Skip asteroids still on cooldown from a recent collision.
    if (_asteroidCollisionCooldowns.has(asteroid.id)) continue;

    // AABB vs circle overlap test.
    if (!testAABBCircleOverlap(craftAABB, asteroid.posX, asteroid.posY, asteroid.radius)) {
      continue;
    }

    // Compute relative speed.
    const relSpeed = computeRelativeSpeed(
      ps.velX, ps.velY,
      asteroid.velX, asteroid.velY,
    );

    // Classify damage.
    const damage = classifyAsteroidDamage(relSpeed);

    // Apply damage to the craft.
    applyAsteroidDamage(ps, assembly, flightState, damage, relSpeed, asteroid.name);

    // Set cooldown to prevent repeated damage during multi-frame overlap.
    _asteroidCollisionCooldowns.set(asteroid.id, SEPARATION_COOLDOWN_TICKS);

    results.push({ asteroid, relativeSpeed: relSpeed, damage });

    // If craft is destroyed, stop checking further asteroids.
    if (ps.crashed) break;
  }

  return results;
}

// ---------------------------------------------------------------------------
// Public API — Reset asteroid collision cooldowns
// ---------------------------------------------------------------------------

/**
 * Clear all asteroid collision cooldowns.
 *
 * Call when leaving flight (returning to hub) or in tests to reset state.
 */
export function resetAsteroidCollisionCooldowns(): void {
  _asteroidCollisionCooldowns.clear();
}
