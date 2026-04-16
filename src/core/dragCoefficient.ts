/**
 * dragCoefficient.ts — Shared drag-area (CdA) computation for rocket and debris parts.
 *
 * Extracted from the duplicated inline math that previously lived in
 * `physics.ts::_computeDragForce` and `staging.ts::_debrisDrag`.  Both call sites
 * build per-part CdA the same way (stowed circular cross-section for most parts;
 * stowed→deployed linear interpolation, density-scaled, for parachutes).
 *
 * Malfunction scaling (e.g. PARACHUTE_PARTIAL) is the caller's responsibility —
 * pass an effective `deployProgress` already multiplied by the factor.
 *
 * @module dragCoefficient
 */

import type { PartDef } from '../data/parts.ts';
import { PartType } from './constants.ts';
import { LOW_DENSITY_THRESHOLD } from './parachute.ts';

/** Scale factor: metres per pixel at default 1× zoom.  Mirrors the constants in
 *  physics.ts and staging.ts — kept in sync deliberately. */
const SCALE_M_PER_PX = 0.05;

/**
 * Compute the drag area (Cd × A, m²) for a single part.
 *
 * For parachutes, linearly interpolates between the stowed and fully-deployed
 * CdA using `deployProgress` (0 = packed/failed, 1 = fully deployed) and scales
 * by atmospheric density so chutes are ineffective near vacuum.
 *
 * For non-parachute parts, returns the fixed stowed CdA based on the part's
 * circular cross-section and `dragCoefficient` property.  `deployProgress` and
 * `atmosphereDensity` are ignored in this branch.
 *
 * @param def               Part definition.
 * @param deployProgress    Parachute deploy progress in [0, 1].  Ignored for
 *                          non-parachute parts.  Callers that need malfunction
 *                          scaling should pre-multiply (e.g. `progress * 0.5`).
 * @param atmosphereDensity Local atmospheric density in kg/m³.  Used only for
 *                          parachute density scaling.
 * @returns Drag area (m²).
 */
export function computePartCdA(
  def: PartDef,
  deployProgress: number,
  atmosphereDensity: number,
): number {
  const props  = (def.properties ?? {}) as Record<string, number>;
  const widthM = (def.width ?? 40) * SCALE_M_PER_PX;
  const area   = Math.PI * (widthM / 2) ** 2;

  if (def.type === PartType.PARACHUTE) {
    const stowedCdA   = (props.dragCoefficient ?? 0.05) * area;
    const deployedR   = (props.deployedDiameter ?? 10) / 2;
    const deployedCd  = props.deployedCd ?? 0.75;
    const deployedCdA = deployedCd * Math.PI * deployedR * deployedR;
    const densityScale = Math.min(1, atmosphereDensity / LOW_DENSITY_THRESHOLD);
    return stowedCdA + (deployedCdA - stowedCdA) * deployProgress * densityScale;
  }

  return (props.dragCoefficient ?? 0.2) * area;
}
