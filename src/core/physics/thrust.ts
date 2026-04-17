// ---------------------------------------------------------------------------
// Thrust computation — engine thrust force and TWR-relative throttle conversion
// ---------------------------------------------------------------------------

import { getPartById, type PartDef } from '../../data/parts.ts';
import { PartType, MalfunctionType, REDUCED_THRUST_FACTOR } from '../constants.ts';
import { SEA_LEVEL_DENSITY } from '../atmosphere.ts';
import { gravityForBody } from './gravity.ts';

import type { PhysicsState, RocketAssembly } from '../physics.ts';

/** Result of thrust calculation. */
export interface ThrustResult {
  thrustX: number;
  thrustY: number;
}

/**
 * When in TWR throttle mode, compute the raw throttle needed to achieve
 * `ps.targetTWR` and write it to `ps.throttle`.
 */
export function updateThrottleFromTWR(
  ps: PhysicsState,
  assembly: RocketAssembly,
  bodyId: string | undefined,
): void {
  if (ps.throttleMode !== 'twr') return;

  // Infinity means "max thrust"
  if (ps.targetTWR === Infinity) {
    ps.throttle = 1;
    return;
  }
  if (ps.targetTWR <= 0) {
    ps.throttle = 0;
    return;
  }

  let totalMass        = 0;
  let maxLiquidThrustN = 0;
  let srbThrustN       = 0;

  for (const [instanceId, placed] of assembly.parts) {
    if (!ps.activeParts.has(instanceId)) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;

    totalMass += (def.mass ?? 0) + (ps.fuelStore.get(instanceId) ?? 0);

    if (ps.firingEngines.has(instanceId)) {
      const defProps = (def.properties ?? {}) as Record<string, number>;
      const thrustN: number = (defProps.thrust ?? 0) * 1_000; // kN → N
      if (def.type === PartType.SOLID_ROCKET_BOOSTER) {
        srbThrustN += thrustN;
      } else {
        maxLiquidThrustN += thrustN;
      }
    }
  }

  // Include captured body mass in TWR calculation.
  totalMass += ps.capturedBody?.mass ?? 0;

  if (maxLiquidThrustN <= 0) return; // can't throttle SRBs
  if (totalMass <= 0) return;

  const localG: number = gravityForBody(bodyId, Math.max(0, ps.posY));
  const needed: number = ps.targetTWR * totalMass * localG - srbThrustN;
  ps.throttle = Math.max(0, Math.min(1, needed / maxLiquidThrustN));
}

/**
 * Compute the thrust force vector for the current integration step.
 *
 * Thrust is treated as acting purely along the rocket's orientation axis
 * (simplified symmetric thrust — no engine placement offsets).
 */
export function computeThrust(
  ps: PhysicsState,
  assembly: RocketAssembly,
  density: number,
): ThrustResult {
  const densityRatio: number = density / SEA_LEVEL_DENSITY; // 0 in vacuum, 1 at sea level

  let totalThrustN = 0;
  const exhausted: string[]  = [];

  for (const instanceId of ps.firingEngines) {
    // Skip parts that have been jettisoned.
    if (!ps.activeParts.has(instanceId)) {
      exhausted.push(instanceId);
      continue;
    }

    const placed = assembly.parts.get(instanceId);
    if (!placed) { exhausted.push(instanceId); continue; }

    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def)   { exhausted.push(instanceId); continue; }

    const props = (def.properties ?? {}) as Record<string, number>;
    const isSRB: boolean = def.type === PartType.SOLID_ROCKET_BOOSTER;

    // Guard: SRBs that already have no fuel produce no thrust this step.
    if (isSRB) {
      const fuelLeft: number = ps.fuelStore.get(instanceId) ?? 0;
      if (fuelLeft <= 0) {
        exhausted.push(instanceId);
        continue;
      }
    }

    // Interpolate thrust between sea-level and vacuum values.
    // Weather temperature affects ISP → indirectly scales effective thrust.
    const ispMod: number     = ps.weatherIspModifier ?? 1.0;
    const thrustSL: number   = (props.thrust    ?? 0) * 1_000 * ispMod; // kN → N, ISP-adjusted
    const thrustVac: number  = (props.thrustVac ?? props.thrust ?? 0) * 1_000 * ispMod;
    const rawThrustN: number = densityRatio * thrustSL + (1 - densityRatio) * thrustVac;

    // Throttle: SRBs always at 100 %; liquid engines use current setting.
    const throttleMult: number     = isSRB ? 1.0 : ps.throttle;
    let   effectiveThrustN: number = rawThrustN * throttleMult;

    // Apply reduced thrust from ENGINE_REDUCED_THRUST malfunction.
    const malf = ps.malfunctions?.get(instanceId);
    if (malf && !malf.recovered && malf.type === MalfunctionType.ENGINE_REDUCED_THRUST) {
      effectiveThrustN *= REDUCED_THRUST_FACTOR;
    }

    totalThrustN += effectiveThrustN;
  }

  // Remove already-exhausted engines from the firing set.
  for (const id of exhausted) {
    ps.firingEngines.delete(id);
  }

  // Project thrust along the rocket's orientation axis.
  const thrustX: number = totalThrustN * Math.sin(ps.angle);
  const thrustY: number = totalThrustN * Math.cos(ps.angle);

  return { thrustX, thrustY };
}
