/**
 * stagingCalc.ts — Pure delta-v and TWR computation for rocket stages.
 *
 * Extracted from ui/vab/_staging.ts so the physics math can be unit-tested
 * without any UI or VAB state coupling.
 *
 * PUBLIC API
 *   computeStageDeltaV(stageIndex, assembly, stagingConfig, dvAltitude) -> StageDeltaVResult
 *
 * @module stagingCalc
 */

import { getPartById } from '../data/parts.ts';
import { airDensity, SEA_LEVEL_DENSITY } from './atmosphere.ts';

import type { RocketAssembly, StagingConfig } from './rocketbuilder.ts';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/** Result of computing delta-v for a single stage. */
export interface StageDeltaVResult {
  /** Estimated delta-v in m/s for this stage. */
  dv: number;
  /** Thrust-to-weight ratio at the given altitude (undefined if no engines). */
  twr?: number;
  /** Whether the stage contains any engines. */
  engines: boolean;
}

// ---------------------------------------------------------------------------
// Main computation
// ---------------------------------------------------------------------------

/**
 * Compute the delta-v and TWR for a given stage index.
 *
 * This is a pure function: it reads the assembly and staging config but
 * does not mutate anything.
 *
 * @param stageIndex   0-based stage index
 * @param assembly     The rocket assembly with all placed parts
 * @param stagingConfig  The staging configuration
 * @param dvAltitude   Altitude (metres) at which to evaluate atmospheric density
 * @returns Delta-v, TWR, and whether the stage has engines
 */
export function computeStageDeltaV(
  stageIndex: number,
  assembly: RocketAssembly,
  stagingConfig: StagingConfig,
  dvAltitude: number,
): StageDeltaVResult {
  const stage = stagingConfig.stages[stageIndex];
  if (!stage) return { dv: 0, engines: false };

  const G0 = 9.81;

  const density = airDensity(dvAltitude);
  const atmFrac = Math.min(1, density / SEA_LEVEL_DENSITY);

  const jettisoned = new Set<string>();
  for (let s = 0; s < stageIndex; s++) {
    for (const id of stagingConfig.stages[s].instanceIds) {
      jettisoned.add(id);
    }
  }

  let totalMass = 0;
  let totalFuel = 0;
  for (const [instanceId, placed] of assembly.parts) {
    if (jettisoned.has(instanceId)) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    const fuelMass = (def.properties?.fuelMass as number) ?? 0;
    totalMass += (def.mass ?? 0) + fuelMass;
    if (fuelMass > 0) totalFuel += fuelMass;
  }

  let thrustTotal    = 0;
  let ispTimesThrust = 0;
  let hasEngines     = false;
  for (const instanceId of stage.instanceIds) {
    if (jettisoned.has(instanceId)) continue;
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;
    const thrustKN = (def.properties?.thrust as number) ?? 0;
    if (thrustKN > 0) {
      hasEngines = true;
      const thrustN = thrustKN * 1000;
      const ispSL  = (def.properties?.isp as number)    ?? 300;
      const ispVac = (def.properties?.ispVac as number) ?? ispSL;
      const isp = ispSL * atmFrac + ispVac * (1 - atmFrac);
      thrustTotal    += thrustN;
      ispTimesThrust += isp * thrustN;
    }
  }

  const twr = totalMass > 0 && thrustTotal > 0
    ? thrustTotal / (totalMass * G0)
    : 0;

  if (totalFuel <= 0 || thrustTotal <= 0 || totalMass <= 0) {
    return { dv: 0, twr, engines: hasEngines };
  }

  const avgIsp = ispTimesThrust / thrustTotal;
  const dryMass = totalMass - totalFuel;
  if (dryMass <= 0) return { dv: 0, twr, engines: hasEngines };

  return { dv: avgIsp * G0 * Math.log(totalMass / dryMass), twr, engines: true };
}
