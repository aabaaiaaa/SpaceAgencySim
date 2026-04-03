/**
 * collision.ts — Collision detection, response, and separation impulse.
 *
 * Handles:
 *   - AABB (axis-aligned bounding box) computation for rocket/debris bodies
 *   - Overlap detection between AABBs
 *   - Collision response with atmosphere-modulated restitution
 *   - Separation impulse applied at the moment of stage decoupling
 *
 * COLLISION MODEL
 *   After stage separation, each body (main rocket + each debris fragment)
 *   gets an AABB computed from its active parts.  All pairs are tested for
 *   overlap.  On collision, an impulse is applied following Newton's third
 *   law: lighter bodies receive larger velocity changes.  Atmospheric density
 *   damps the bounce (lower restitution at sea level).
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
 *   tickCollisions(ps, assembly, dt)                             -> void
 *   applySeparationImpulse(ps, debris, assembly)                 -> void
 *
 * @module collision
 */

import { getPartById } from '../data/parts.js';
import { airDensity }  from './atmosphere.js';

import type { PhysicsState, RocketAssembly } from './physics.js';

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
    if ((debris as any).collisionCooldown > 0) {
      (debris as any).collisionCooldown--;
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
      cooldown: (debris as any).collisionCooldown ?? 0,
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
