// ---------------------------------------------------------------------------
// Drag force + parachute torque helpers. Extracted from physics.ts.
// ---------------------------------------------------------------------------

import { getPartById } from '../../data/parts.ts';
import { MalfunctionType, PARTIAL_CHUTE_FACTOR } from '../constants.ts';
import { DEPLOY_DURATION, LOW_DENSITY_THRESHOLD } from '../parachute.ts';
import { computePartCdA } from '../dragCoefficient.ts';
import { CHUTE_TORQUE_SCALE, SCALE_M_PER_PX } from './constants.ts';
import type { PartDef, PhysicsState, Point2D, RocketAssembly } from './types.ts';

/**
 * Return the deployment progress for a parachute: 0 = packed/failed,
 * 0→1 during the deploying animation, 1 = fully deployed.
 */
function _getChuteDeployProgress(ps: PhysicsState, instanceId: string): number {
  const entry = ps.parachuteStates?.get(instanceId);
  if (!entry) return 0;
  switch (entry.state) {
    case 'deployed':  return 1;
    case 'deploying': {
      const linear: number = Math.max(0, Math.min(1, 1 - entry.deployTimer / DEPLOY_DURATION));
      return linear;
    }
    default:          return 0;
  }
}

/**
 * Compute the aerodynamic drag force magnitude (Newtons).
 *
 * dragForce = 0.5 × rho × v² × Cd × A  (summed over all active parts)
 */
export function _computeDragForce(ps: PhysicsState, assembly: RocketAssembly, density: number, speed: number): number {
  if (density <= 0 || speed <= 0) return 0;

  let totalCdA = 0;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;

    let progress: number = _getChuteDeployProgress(ps, instanceId);
    const cMalf = ps.malfunctions?.get(instanceId);
    if (cMalf && !cMalf.recovered && cMalf.type === MalfunctionType.PARACHUTE_PARTIAL) {
      progress *= PARTIAL_CHUTE_FACTOR;
    }

    totalCdA += computePartCdA(def, progress, density);
  }

  return 0.5 * density * speed * speed * totalCdA;
}

/**
 * Compute the restoring torque (N·m) from deployed parachutes.
 *
 * Each parachute's drag acts at an offset from the CoM — the canopy trails
 * behind on lines, so the effective application point is *opposite* to the
 * part's VAB position relative to CoM.  This creates a pendulum-like restoring
 * torque that naturally orients the rocket with the parachute on top.
 */
export function _computeParachuteTorque(
  ps: PhysicsState,
  assembly: RocketAssembly,
  com: Point2D,
  density: number,
  speed: number,
): number {
  if (density <= 0 || speed <= 0 || !ps.parachuteStates) return 0;

  const q: number = 0.5 * density * speed * speed;
  const sinA: number = Math.sin(ps.angle);

  let totalTorque = 0;

  for (const [instanceId, entry] of ps.parachuteStates) {
    if (entry.state !== 'deploying' && entry.state !== 'deployed') continue;

    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;

    const props     = def.properties ?? {};
    const widthM: number    = (def.width ?? 40) * SCALE_M_PER_PX;
    const stowedA: number   = Math.PI * (widthM / 2) ** 2;
    const stowedCdA: number = (props.dragCoefficient ?? 0.05) * stowedA;
    const deployedR: number   = (props.deployedDiameter ?? 10) / 2;
    const deployedCd: number  = props.deployedCd ?? 0.75;
    const deployedCdA: number = deployedCd * Math.PI * deployedR * deployedR;
    const progress: number     = _getChuteDeployProgress(ps, instanceId);
    const densityScale: number = Math.min(1, density / LOW_DENSITY_THRESHOLD);
    const chuteCdA: number = stowedCdA + (deployedCdA - stowedCdA) * progress * densityScale;

    const dragMag: number = q * chuteCdA;

    const dx: number = (placed.x - com.x) * SCALE_M_PER_PX;
    const dy: number = (placed.y - com.y) * SCALE_M_PER_PX;
    const lineLen: number = Math.sqrt(dx * dx + dy * dy);

    totalTorque -= dragMag * lineLen * sinA;
  }

  return totalTorque * CHUTE_TORQUE_SCALE;
}
