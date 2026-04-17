// ---------------------------------------------------------------------------
// Ground-contact (landing/crash) physics. Extracted from physics.ts.
// ---------------------------------------------------------------------------

import { getPartById } from '../../data/parts.ts';
import { PartType } from '../constants.ts';
import { getDeployedLegFootOffset } from '../legs.ts';
import { recalcPowerState } from '../power.ts';
import { onSafeLanding } from '../sciencemodule.ts';
import type { FlightState } from '../gameState.ts';
import {
  DEFAULT_CRASH_THRESHOLD,
  DESTRUCTION_BAND,
  SCALE_M_PER_PX,
} from './constants.ts';
import { _emitEvent } from './flightSync.ts';
import type {
  BottomLayerEntry,
  PartDef,
  PhysicsState,
  RocketAssembly,
} from './types.ts';

/**
 * Return the bottom-most layer of active parts — all parts whose bottom
 * edge is within DESTRUCTION_BAND of the lowest bottom edge.
 */
function _getBottomPartLayer(ps: PhysicsState, assembly: RocketAssembly): BottomLayerEntry[] {
  const entries: BottomLayerEntry[] = [];
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    const halfH: number   = (def.height ?? 40) / 2;
    let bottomY: number = placed.y - halfH;
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      const { dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
      const footY: number = placed.y - dy;
      if (footY < bottomY) bottomY = footY;
    }
    entries.push({ instanceId, bottomY, placed, def });
  }
  if (entries.length === 0) return [];

  entries.sort((a, b) => a.bottomY - b.bottomY);
  const minY: number = entries[0].bottomY;
  return entries.filter((e) => e.bottomY <= minY + DESTRUCTION_BAND);
}

/**
 * Remove a single part from all physics state tracking sets/maps.
 */
function _removePartFromState(ps: PhysicsState, instanceId: string, assembly: RocketAssembly): void {
  ps.activeParts.delete(instanceId);
  ps.firingEngines.delete(instanceId);
  ps.deployedParts.delete(instanceId);
  ps.legStates?.delete(instanceId);
  ps.parachuteStates?.delete(instanceId);
  ps.heatMap?.delete(instanceId);

  if (ps.powerState && assembly) {
    recalcPowerState(ps.powerState, assembly, ps.activeParts);
  }
}

/**
 * Return the lowest bottom edge (VAB world Y) across all active parts.
 */
function _getLowestBottomEdge(ps: PhysicsState, assembly: RocketAssembly): number {
  let lowest = Infinity;
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    let bottomY: number = placed.y - (def.height ?? 40) / 2;
    if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
      const { dy } = getDeployedLegFootOffset(instanceId, def, ps.legStates);
      const footY: number = placed.y - dy;
      if (footY < bottomY) bottomY = footY;
    }
    if (bottomY < lowest) lowest = bottomY;
  }
  return lowest;
}

/**
 * Return true if all COMMAND_MODULE and COMPUTER_MODULE parts in the assembly
 * have been removed from activeParts.
 */
function _allCommandModulesGone(ps: PhysicsState, assembly: RocketAssembly): boolean {
  let hadCmd = false;
  for (const [instanceId, placed] of assembly.parts) {
    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def) continue;
    if (def.type === PartType.COMMAND_MODULE || def.type === PartType.COMPUTER_MODULE) {
      hadCmd = true;
      if (ps.activeParts.has(instanceId)) return false;
    }
  }
  return hadCmd;
}

/**
 * Handle the rocket touching down (or crashing into) the ground.
 *
 * Landing outcome depends on how many legs are deployed and impact speed.
 * Emits LANDING or CRASH event and sets ps.landed / ps.crashed accordingly.
 */
export function _handleGroundContact(ps: PhysicsState, assembly: RocketAssembly, flightState: FlightState): void {
  const impactSpeed: number = Math.hypot(ps.velX, ps.velY);
  const time: number        = flightState.timeElapsed;

  ps.posY = 0;
  ps.velX = 0;
  ps.velY = 0;

  let remainingSpeed: number = impactSpeed;
  let anyDestroyed = false;

  while (remainingSpeed > 0 && ps.activeParts.size > 0) {
    const layer: BottomLayerEntry[] = _getBottomPartLayer(ps, assembly);
    if (layer.length === 0) break;

    let minThreshold = Infinity;
    for (const entry of layer) {
      const threshold: number = entry.def.properties?.crashThreshold ?? DEFAULT_CRASH_THRESHOLD;
      if (threshold < minThreshold) minThreshold = threshold;
    }

    if (remainingSpeed <= minThreshold) break;

    for (const entry of layer) {
      _removePartFromState(ps, entry.instanceId, assembly);
      _emitEvent(flightState, {
        type:       'PART_DESTROYED',
        time,
        instanceId: entry.instanceId,
        partId:     entry.placed.partId,
        speed:      remainingSpeed,
      });
    }

    anyDestroyed = true;

    remainingSpeed -= minThreshold;
  }

  if (anyDestroyed && ps.activeParts.size > 0) {
    const bottomAfter: number = _getLowestBottomEdge(ps, assembly);
    if (isFinite(bottomAfter) && bottomAfter > 0) {
      const offsetM: number = bottomAfter * SCALE_M_PER_PX;
      ps.posY += offsetM;
      for (const [, placed] of assembly.parts) {
        placed.y -= bottomAfter;
      }
      for (const deb of ps.debris) {
        deb.posY += offsetM;
      }
    }
  }

  const allCmdLost: boolean = _allCommandModulesGone(ps, assembly);

  const landingBodyId: string = flightState.bodyId || 'EARTH';
  const bodyNames: Record<string, string> = {
    SUN: 'Sun', MERCURY: 'Mercury', VENUS: 'Venus', EARTH: 'Earth',
    MOON: 'Moon', MARS: 'Mars', PHOBOS: 'Phobos', DEIMOS: 'Deimos',
  };
  const bodyName: string = bodyNames[landingBodyId] || landingBodyId;

  if (allCmdLost) {
    ps.crashed = true;
    _emitEvent(flightState, {
      type:        'CRASH',
      time,
      speed:       impactSpeed,
      bodyId:      landingBodyId,
      description: `Impact on ${bodyName} at ${impactSpeed.toFixed(1)} m/s — rocket destroyed!`,
    });
  } else {
    ps.landed = true;
    const desc: string = anyDestroyed
      ? `Hard landing on ${bodyName} at ${impactSpeed.toFixed(1)} m/s — some parts destroyed.`
      : `Landed on ${bodyName} at ${impactSpeed.toFixed(1)} m/s.`;
    _emitEvent(flightState, {
      type:          'LANDING',
      time,
      speed:         impactSpeed,
      bodyId:        landingBodyId,
      partsDestroyed: anyDestroyed,
      description:   desc,
    });
    onSafeLanding(ps, assembly, flightState);
  }
}
