// ---------------------------------------------------------------------------
// Debris ground tipping — simplified tipping physics for landed debris
// fragments. A stripped-down version of `_applyGroundedSteering` with no
// player input: debris rocks under gravity, settles if balanced, and crashes
// if it topples too fast.
// ---------------------------------------------------------------------------

import { getPartById } from '../../data/parts.ts';
import { PartType } from '../constants.ts';
import { getDeployedLegFootOffset } from '../legs.ts';
import type { PartDef } from '../../data/parts.ts';
import type {
  DebrisState,
  RocketAssembly,
  Point2D,
  CornerEntry,
} from '../physics.ts';
import {
  _computeCoMLocal,
  _computeMomentOfInertia,
  _computeTotalMass,
  SCALE_M_PER_PX,
  DEFAULT_CRASH_THRESHOLD,
  TOPPLE_CRASH_ANGLE,
  TILT_SNAP_THRESHOLD,
  ANGULAR_VEL_SNAP_THRESHOLD,
} from '../physics.ts';
import { gravityForBody } from './gravity.ts';

/**
 * Apply simplified ground tipping physics to a landed debris fragment.
 *
 * This is a stripped-down version of `_applyGroundedSteering` with no player
 * input — debris just rocks under gravity, settles if balanced, and crashes
 * if it topples too fast.
 */
export function tickDebrisGround(debris: DebrisState, assembly: RocketAssembly, dt: number, bodyId?: string): void {
  if (debris.crashed) return;
  const debrisG: number = gravityForBody(bodyId, 0);

  // Check if tipping is needed
  const needsTipping: boolean = debris.isTipping ||
    Math.abs(debris.angle) > TILT_SNAP_THRESHOLD ||
    Math.abs(debris.angularVelocity) > ANGULAR_VEL_SNAP_THRESHOLD;

  if (!needsTipping) {
    // Smooth settle residuals
    if (debris.angle !== 0 || debris.angularVelocity !== 0) {
      debris.angle *= 0.9;
      debris.angularVelocity *= 0.85;
      debris.isTipping = false;
      if (Math.abs(debris.angle) < 1e-4 && Math.abs(debris.angularVelocity) < 1e-4) {
        debris.angle = 0;
        debris.angularVelocity = 0;
      }
    }
    return;
  }

  // Reuse the same tipping math as _applyGroundedSteering but with no player input
  const cosA: number = Math.cos(debris.angle);
  const sinA: number = Math.sin(debris.angle);

  // Find ground contact point via softmax (same as rocket)
  const allCorners: CornerEntry[] = [];
  let maxGP = -Infinity;
  for (const instanceId of debris.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    let halfW: number = (def.width ?? 40) / 2;
    let bottomHH: number = (def.height ?? 40) / 2;
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      const { dx, dy } = getDeployedLegFootOffset(instanceId, def, debris.legStates);
      if (dy > 0) { halfW = Math.max(halfW, dx); bottomHH = Math.max(bottomHH, dy); }
    }
    const hw: number = (def.width ?? 40) / 2;
    const hh: number = (def.height ?? 40) / 2;
    for (const [cx, cy] of [
      [placed.x - halfW, placed.y - bottomHH],
      [placed.x + halfW, placed.y - bottomHH],
      [placed.x - hw, placed.y + hh],
      [placed.x + hw, placed.y + hh],
    ] as [number, number][]) {
      const gp: number = cx * sinA - cy * cosA;
      allCorners.push({ cx, cy, gp });
      if (gp > maxGP) maxGP = gp;
    }
  }

  if (allCorners.length === 0) return;

  const CONTACT_SHARPNESS = 2.0;
  let sumW = 0, sumWX = 0, sumWY = 0;
  for (const c of allCorners) {
    const w: number = Math.exp(CONTACT_SHARPNESS * (c.gp - maxGP));
    sumW += w; sumWX += w * c.cx; sumWY += w * c.cy;
  }
  const contactLX: number = sumWX / sumW;
  const contactLY: number = sumWY / sumW;
  const contact: Point2D = { x: contactLX, y: contactLY };

  const contactWorldX: number = debris.posX + (contactLX * cosA + contactLY * sinA) * SCALE_M_PER_PX;

  // Moment of inertia, CoM, gravity torque
  const I: number = _computeMomentOfInertia(debris, assembly, contact);
  const com: Point2D = _computeCoMLocal(debris, assembly);
  const relX: number = (com.x - contactLX) * SCALE_M_PER_PX;
  const relY: number = (com.y - contactLY) * SCALE_M_PER_PX;
  const rotatedX: number = relX * cosA + relY * sinA;
  const totalMass: number = _computeTotalMass(debris, assembly);
  const gravityTorque: number = totalMass * debrisG * rotatedX;

  // Angular integration (no player input)
  const angAccel: number = gravityTorque / I;
  debris.angularVelocity += angAccel * dt;
  debris.angularVelocity *= 0.99; // light damping
  debris.angle += debris.angularVelocity * dt;

  // Reposition to keep contact on ground
  const cosB: number = Math.cos(debris.angle);
  const sinB: number = Math.sin(debris.angle);
  debris.posX = contactWorldX - (contactLX * cosB + contactLY * sinB) * SCALE_M_PER_PX;
  debris.posY = 0;

  debris.isTipping = Math.abs(debris.angle) > TILT_SNAP_THRESHOLD;
  debris.tippingContactX = contactLX;
  debris.tippingContactY = contactLY;

  // Smooth settle
  if (Math.abs(debris.angularVelocity) < ANGULAR_VEL_SNAP_THRESHOLD) {
    const sRelX: number = (com.x - contactLX) * SCALE_M_PER_PX;
    const sRelY: number = (com.y - contactLY) * SCALE_M_PER_PX;
    const sRotX: number = sRelX * cosB + sRelY * sinB;
    const snapGrav: number = totalMass * debrisG * sRotX;
    if (Math.abs(snapGrav / I) < 0.5) {
      debris.angularVelocity *= 0.85;
      if (Math.abs(debris.angle) < TILT_SNAP_THRESHOLD) debris.angle *= 0.9;
      if (Math.abs(debris.angularVelocity) < 1e-4) debris.angularVelocity = 0;
      if (Math.abs(debris.angle) < 1e-4) { debris.angle = 0; debris.isTipping = false; }
    }
  }

  // Topple crash — simplified (no flight events, just set crashed)
  if (Math.abs(debris.angle) > TOPPLE_CRASH_ANGLE) {
    const dcx: number = debris.tippingContactX ?? 0;
    const dcy: number = debris.tippingContactY ?? 0;
    let maxDist = 0;
    let minThreshold = Infinity;
    for (const instanceId of debris.activeParts) {
      const placed = assembly.parts.get(instanceId);
      if (!placed) continue;
      const def: PartDef | undefined = getPartById(placed.partId);
      if (!def) continue;
      const hw: number = (def.width ?? 40) / 2;
      const hh: number = (def.height ?? 40) / 2;
      for (const [px, py] of [
        [placed.x - hw, placed.y - hh], [placed.x + hw, placed.y - hh],
        [placed.x - hw, placed.y + hh], [placed.x + hw, placed.y + hh],
      ] as [number, number][]) {
        const ddx: number = (px - dcx) * SCALE_M_PER_PX;
        const ddy: number = (py - dcy) * SCALE_M_PER_PX;
        const dist: number = Math.sqrt(ddx * ddx + ddy * ddy);
        if (dist > maxDist) maxDist = dist;
      }
      const threshold: number = (def.properties?.crashThreshold as number | undefined) ?? DEFAULT_CRASH_THRESHOLD;
      if (threshold < minThreshold) minThreshold = threshold;
    }
    const tipSpeed: number = Math.abs(debris.angularVelocity) * maxDist;
    if (tipSpeed > minThreshold) {
      debris.crashed = true;
      debris.angularVelocity = 0;
    }
  }
}
