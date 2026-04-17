// ---------------------------------------------------------------------------
// Topple-crash detection. Extracted from physics.ts.
// ---------------------------------------------------------------------------

import { getPartById } from '../../data/parts.ts';
import type { FlightState } from '../gameState.ts';
import {
  DEFAULT_CRASH_THRESHOLD,
  SCALE_M_PER_PX,
  TOPPLE_CRASH_ANGLE,
} from './constants.ts';
import { _emitEvent } from './flightSync.ts';
import type { PartDef, PhysicsState, RocketAssembly } from './types.ts';

/**
 * Check if the rocket has toppled past the crash angle and trigger a crash.
 */
export function _checkToppleCrash(ps: PhysicsState, assembly: RocketAssembly, flightState: FlightState): void {
  if (Math.abs(ps.angle) <= TOPPLE_CRASH_ANGLE) return;

  const cx: number = Number.isFinite(ps.tippingContactX) ? ps.tippingContactX : 0;
  const cy: number = Number.isFinite(ps.tippingContactY) ? ps.tippingContactY : 0;
  let maxDist = 0;
  let minThreshold = Infinity;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    const hw: number = (def.width  ?? 40) / 2;
    const hh: number = (def.height ?? 40) / 2;
    for (const [px, py] of [
      [placed.x - hw, placed.y - hh],
      [placed.x + hw, placed.y - hh],
      [placed.x - hw, placed.y + hh],
      [placed.x + hw, placed.y + hh],
    ] as [number, number][]) {
      const dx: number = (px - cx) * SCALE_M_PER_PX;
      const dy: number = (py - cy) * SCALE_M_PER_PX;
      const dist: number = Math.sqrt(dx * dx + dy * dy);
      if (dist > maxDist) maxDist = dist;
    }
    const threshold: number = def.properties?.crashThreshold ?? DEFAULT_CRASH_THRESHOLD;
    if (threshold < minThreshold) minThreshold = threshold;
  }

  const tipSpeed: number = Math.abs(ps.angularVelocity) * maxDist;
  if (tipSpeed <= minThreshold) return;

  ps.crashed = true;
  ps.angularVelocity = 0;
  ps.firingEngines.clear();

  const time: number = flightState.timeElapsed;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    _emitEvent(flightState, {
      type:       'PART_DESTROYED',
      time,
      instanceId,
      partId:     placed?.partId,
      speed:      tipSpeed,
      toppled:    true,
    });
  }

  ps.activeParts.clear();
  ps.deployedParts.clear();

  _emitEvent(flightState, {
    type: 'CRASH',
    time,
    speed: tipSpeed,
    toppled: true,
    description: `Rocket toppled over at ${tipSpeed.toFixed(1)} m/s and crashed!`,
  });
}
