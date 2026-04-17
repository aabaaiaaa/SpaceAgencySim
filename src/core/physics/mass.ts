// ---------------------------------------------------------------------------
// Mass / centre-of-mass / moment-of-inertia helpers. Extracted from physics.ts.
// ---------------------------------------------------------------------------

import { getPartById } from '../../data/parts.ts';
import { SCALE_M_PER_PX } from './constants.ts';
import type { MassQueryable, PartDef, Point2D, RocketAssembly } from './types.ts';

/**
 * Compute the current total mass (dry + remaining propellant) of all parts
 * still attached to the rocket.
 */
export function _computeTotalMass(ps: MassQueryable, assembly: RocketAssembly): number {
  let mass = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    mass += def.mass ?? 0;
  }

  for (const [instanceId, fuelRemaining] of ps.fuelStore) {
    if (ps.activeParts.has(instanceId)) {
      mass += fuelRemaining;
    }
  }

  mass += ps.capturedBody?.mass ?? 0;

  return Math.max(1, mass);
}

/**
 * Compute the centre of mass in VAB local pixel coordinates.
 */
export function _computeCoMLocal(ps: MassQueryable, assembly: RocketAssembly): Point2D {
  let totalMass = 0;
  let comX = 0;
  let comY = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    const fuelMass: number = ps.fuelStore.get(instanceId) ?? 0;
    const mass: number = (def.mass ?? 1) + fuelMass;
    comX += placed.x * mass;
    comY += placed.y * mass;
    totalMass += mass;
  }

  const cb = ps.capturedBody;
  if (cb) {
    comX += cb.offset.x * cb.mass;
    comY += cb.offset.y * cb.mass;
    totalMass += cb.mass;
  }

  if (totalMass > 0) {
    return { x: comX / totalMass, y: comY / totalMass };
  }
  return { x: 0, y: 0 };
}

/**
 * Compute the moment of inertia about a given pivot point (point-mass approx).
 *
 * I = sum(m_i × r_i²) where r_i is the distance from each part's centre to
 * the pivot, converted to metres.
 */
export function _computeMomentOfInertia(ps: MassQueryable, assembly: RocketAssembly, pivot: Point2D): number {
  let I = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    const fuelMass: number = ps.fuelStore.get(instanceId) ?? 0;
    const mass: number = (def.mass ?? 1) + fuelMass;
    const dx: number = (placed.x - pivot.x) * SCALE_M_PER_PX;
    const dy: number = (placed.y - pivot.y) * SCALE_M_PER_PX;
    const wM: number = (def.width  ?? 40) * SCALE_M_PER_PX;
    const hM: number = (def.height ?? 40) * SCALE_M_PER_PX;
    const Iself: number = mass * (wM * wM + hM * hM) / 12;
    I += Iself + mass * (dx * dx + dy * dy);
  }

  const cb = ps.capturedBody;
  if (cb) {
    const Isphere = (2 / 5) * cb.mass * cb.radius * cb.radius;
    const cdx = (cb.offset.x - pivot.x) * SCALE_M_PER_PX;
    const cdy = (cb.offset.y - pivot.y) * SCALE_M_PER_PX;
    I += Isphere + cb.mass * (cdx * cdx + cdy * cdy);
  }

  return Math.max(1, I);
}
