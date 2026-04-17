// ---------------------------------------------------------------------------
// Grounded-steering (tipping) physics. Extracted from physics.ts.
// ---------------------------------------------------------------------------

import { getPartById } from '../../data/parts.ts';
import { PartType } from '../constants.ts';
import { getDeployedLegFootOffset, LegState } from '../legs.ts';
import { ParachuteState } from '../parachute.ts';
import {
  ANGULAR_VEL_SNAP_THRESHOLD,
  MAX_PLAYER_TIP_ACCEL,
  PLAYER_TIP_TORQUE,
  SCALE_M_PER_PX,
  TILT_SNAP_THRESHOLD,
} from './constants.ts';
import { gravityForBody as _gravityForBody } from './gravity.ts';
import { _computeCoMLocal, _computeMomentOfInertia, _computeTotalMass } from './mass.ts';
import type { CornerEntry, PartDef, PhysicsState, Point2D, RocketAssembly } from './types.ts';

/** Returns true if any parachute is currently deploying or deployed. */
export function _hasActiveParachutes(ps: PhysicsState): boolean {
  if (!ps.parachuteStates) return false;
  for (const [, entry] of ps.parachuteStates) {
    if (entry.state === ParachuteState.DEPLOYING || entry.state === ParachuteState.DEPLOYED) return true;
  }
  return false;
}

function _hasAsymmetricLegs(ps: PhysicsState, _assembly: RocketAssembly): boolean {
  if (!ps.legStates || ps.legStates.size === 0) return false;
  let hasDeployed = false;
  let hasRetracted = false;
  for (const instanceId of ps.activeParts) {
    const entry = ps.legStates.get(instanceId);
    if (!entry) continue;
    if (entry.state === LegState.DEPLOYED || entry.state === LegState.DEPLOYING) {
      hasDeployed = true;
    } else {
      hasRetracted = true;
    }
    if (hasDeployed && hasRetracted) return true;
  }
  return false;
}

/**
 * Apply ground-contact tipping physics.
 *
 * When the rocket is on the ground (grounded or landed), rotation happens
 * around the base contact corner, not the centre of mass.  Gravity produces
 * a restoring or toppling torque depending on how far the CoM has moved past
 * the support base.  Player A/D input adds an additional torque.
 */
export function _applyGroundedSteering(
  ps: PhysicsState,
  assembly: RocketAssembly,
  left: boolean,
  right: boolean,
  dt: number,
  bodyId?: string,
): void {
  const surfaceG: number = _gravityForBody(bodyId, 0);
  if (
    !left && !right &&
    ps.angle === 0 && ps.angularVelocity === 0 &&
    !_hasAsymmetricLegs(ps, assembly)
  ) {
    ps.isTipping = false;
    ps._contactCX = undefined;
    ps._contactCY = undefined;
    return;
  }

  const cosA: number = Math.cos(ps.angle);
  const sinA: number = Math.sin(ps.angle);

  const allCorners: CornerEntry[] = [];
  let maxGP = -Infinity;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    const hw: number = (def.width  ?? 40) / 2;
    const hh: number = (def.height ?? 40) / 2;

    let halfW: number = hw;
    let bottomHH: number = hh;
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      const { dx, dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
      if (dy > 0) {
        halfW = Math.max(halfW, dx);
        bottomHH = Math.max(hh, dy);
      }
    }

    const corners: [number, number][] = [
      [placed.x - halfW, placed.y - bottomHH],
      [placed.x + halfW, placed.y - bottomHH],
      [placed.x - hw, placed.y + hh],
      [placed.x + hw, placed.y + hh],
    ];
    for (const [cx, cy] of corners) {
      const gp: number = cx * sinA - cy * cosA;
      allCorners.push({ cx, cy, gp });
      if (gp > maxGP) maxGP = gp;
    }
  }

  const CONTACT_SHARPNESS = 2.0;
  let sumW = 0, sumWX = 0, sumWY = 0;
  for (const c of allCorners) {
    const w: number = Math.exp(CONTACT_SHARPNESS * (c.gp - maxGP));
    sumW  += w;
    sumWX += w * c.cx;
    sumWY += w * c.cy;
  }
  const contactLX: number = sumWX / sumW;
  const contactLY: number = sumWY / sumW;

  const contact: Point2D = { x: contactLX, y: contactLY };

  const contactWorldX: number = ps.posX + (contactLX * cosA + contactLY * sinA) * SCALE_M_PER_PX;

  const I: number = _computeMomentOfInertia(ps, assembly, contact);

  const com: Point2D = _computeCoMLocal(ps, assembly);
  const relX: number = (com.x - contactLX) * SCALE_M_PER_PX;
  const relY: number = (com.y - contactLY) * SCALE_M_PER_PX;
  const rotatedX: number = relX * cosA + relY * sinA;

  const totalMass: number = _computeTotalMass(ps, assembly);
  const gravityTorque: number = totalMass * surfaceG * rotatedX;

  let inputAccel = 0;
  if (right) inputAccel += PLAYER_TIP_TORQUE / I;
  if (left)  inputAccel -= PLAYER_TIP_TORQUE / I;
  inputAccel = Math.max(-MAX_PLAYER_TIP_ACCEL, Math.min(MAX_PLAYER_TIP_ACCEL, inputAccel));

  const gravAccel: number = gravityTorque / I;
  const angAccel: number = gravAccel + inputAccel;

  ps.angularVelocity += angAccel * dt;

  const effectiveDamping: number = (left || right) ? 0.85 : 0.99;
  ps.angularVelocity *= effectiveDamping;

  ps.angle += ps.angularVelocity * dt;

  const cosB: number = Math.cos(ps.angle);
  const sinB: number = Math.sin(ps.angle);
  ps.posX = contactWorldX - (contactLX * cosB + contactLY * sinB) * SCALE_M_PER_PX;
  ps.posY = 0;

  ps.isTipping = Math.abs(ps.angle) > TILT_SNAP_THRESHOLD;
  ps.tippingContactX = contactLX;
  ps.tippingContactY = contactLY;

  if (!left && !right && Math.abs(ps.angularVelocity) < ANGULAR_VEL_SNAP_THRESHOLD) {
    const comSnap: Point2D  = _computeCoMLocal(ps, assembly);
    const sRelX: number    = (comSnap.x - contactLX) * SCALE_M_PER_PX;
    const sRelY: number    = (comSnap.y - contactLY) * SCALE_M_PER_PX;
    const sRotX: number    = sRelX * cosB + sRelY * sinB;
    const snapGrav: number = totalMass * surfaceG * sRotX;
    const snapAccel: number = Math.abs(snapGrav / I);

    if (snapAccel < 0.5) {
      ps.angularVelocity *= 0.85;
      if (Math.abs(ps.angle) < TILT_SNAP_THRESHOLD) {
        ps.angle *= 0.9;
      }
      if (Math.abs(ps.angularVelocity) < 1e-4) {
        ps.angularVelocity = 0;
      }
      if (Math.abs(ps.angle) < 1e-4) {
        ps.angle = 0;
        ps.isTipping = false;
        ps._contactCX = undefined;
        ps._contactCY = undefined;
      }
    }
  }
}
