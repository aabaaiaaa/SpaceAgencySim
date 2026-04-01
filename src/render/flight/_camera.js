/**
 * _camera.js — Camera follow logic and coordinate transforms.
 *
 * Provides worldToScreen(), ppm(), centre-of-mass computation,
 * command module finder, and camera update logic.
 *
 * @module render/flight/_camera
 */

import { getPartById } from '../../data/parts.js';
import { PartType } from '../../core/constants.js';
import { getFlightRenderState } from './_state.js';
import {
  FLIGHT_PIXELS_PER_METRE,
  SCALE_M_PER_PX,
  CAM_OFFSET_DECAY_RATE,
} from './_constants.js';

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

/**
 * Return the effective pixels-per-metre for the current zoom level.
 * @returns {number}
 */
export function ppm() {
  const s = getFlightRenderState();
  return FLIGHT_PIXELS_PER_METRE * s.zoomLevel;
}

/**
 * Convert a world-space position (metres, Y-up) to canvas pixels (Y-down).
 *
 * @param {number} worldX   World X in metres.
 * @param {number} worldY   World Y in metres (positive = up).
 * @param {number} screenW  Canvas width in pixels.
 * @param {number} screenH  Canvas height in pixels.
 * @returns {{ sx: number, sy: number }}  Canvas pixel coordinates.
 */
export function worldToScreen(worldX, worldY, screenW, screenH) {
  const s = getFlightRenderState();
  const p = FLIGHT_PIXELS_PER_METRE * s.zoomLevel;
  return {
    sx: screenW / 2 + (worldX - s.camWorldX) * p,
    sy: screenH / 2 - (worldY - s.camWorldY) * p,
  };
}

// ---------------------------------------------------------------------------
// CoM and command module helpers
// ---------------------------------------------------------------------------

/**
 * Return true if the given part set contains at least one COMMAND_MODULE or
 * COMPUTER_MODULE.
 *
 * @param {Set<string>}                                         partSet
 * @param {import('../../core/rocketbuilder.js').RocketAssembly} assembly
 * @returns {boolean}
 */
export function hasCommandModule(partSet, assembly) {
  for (const instanceId of partSet) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (
      def &&
      (def.type === PartType.COMMAND_MODULE ||
       def.type === PartType.COMPUTER_MODULE)
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Compute the mass-weighted centre of mass for a set of parts.
 *
 * @param {Map<string, number>}                                 fuelStore
 * @param {import('../../core/rocketbuilder.js').RocketAssembly} assembly
 * @param {Set<string>}                                        partSet
 * @param {number}                                             originX  World X (m).
 * @param {number}                                             originY  World Y (m).
 * @returns {{ x: number, y: number }}  CoM world position in metres.
 */
export function computeCoM(fuelStore, assembly, partSet, originX, originY) {
  let totalMass = 0;
  let comX      = 0;
  let comY      = 0;

  for (const instanceId of partSet) {
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;

    const fuelMass = fuelStore?.get(instanceId) ?? 0;
    const mass     = (def.mass ?? 1) + fuelMass;

    const partWorldX = originX + placed.x * SCALE_M_PER_PX;
    const partWorldY = originY + placed.y * SCALE_M_PER_PX;

    comX      += partWorldX * mass;
    comY      += partWorldY * mass;
    totalMass += mass;
  }

  if (totalMass > 0) {
    return { x: comX / totalMass, y: comY / totalMass };
  }
  return { x: originX, y: originY };
}

// ---------------------------------------------------------------------------
// Camera logic
// ---------------------------------------------------------------------------

/**
 * Update the camera to follow the rocket's centre of mass.
 *
 * @param {import('../../core/physics.js').PhysicsState}           ps
 * @param {import('../../core/rocketbuilder.js').RocketAssembly}   assembly
 */
export function updateCamera(ps, assembly) {
  const s = getFlightRenderState();

  let targetX, targetY;
  let refX, refY;

  if (hasCommandModule(ps.activeParts, assembly)) {
    const com = computeCoM(ps.fuelStore, assembly, ps.activeParts, ps.posX, ps.posY);
    targetX = com.x;
    targetY = com.y;
    refX = ps.posX;
    refY = ps.posY;
  } else {
    let found = false;
    for (const debris of ps.debris) {
      if (hasCommandModule(debris.activeParts, assembly)) {
        const com = computeCoM(debris.fuelStore, assembly, debris.activeParts, debris.posX, debris.posY);
        targetX = com.x;
        targetY = com.y;
        refX = debris.posX;
        refY = debris.posY;
        found = true;
        break;
      }
    }
    if (!found) {
      targetX = ps.posX;
      targetY = ps.posY;
      refX = ps.posX;
      refY = ps.posY;
    }
  }

  // Detect CoM jumps relative to the rocket body.
  const relX = targetX - refX;
  const relY = targetY - refY;
  if (s.prevTargetX !== null) {
    const jumpX = relX - s.prevTargetX;
    const jumpY = relY - s.prevTargetY;
    if (Math.abs(jumpX) > 0.05 || Math.abs(jumpY) > 0.05) {
      s.camOffsetX -= jumpX;
      s.camOffsetY -= jumpY;
    }
  }

  s.prevTargetX = relX;
  s.prevTargetY = relY;

  // Compute dt from wall-clock time.
  const now = performance.now();
  const dt  = s.lastCamTime !== null ? (now - s.lastCamTime) / 1000 : 0;
  s.lastCamTime = now;

  // Decay the offset toward zero at a fixed rate (metres/s).
  if (s.camOffsetX !== 0 || s.camOffsetY !== 0) {
    const decay = CAM_OFFSET_DECAY_RATE * dt;
    const dist  = Math.sqrt(s.camOffsetX * s.camOffsetX + s.camOffsetY * s.camOffsetY);
    if (dist <= decay) {
      s.camOffsetX = 0;
      s.camOffsetY = 0;
    } else {
      const ratio = decay / dist;
      s.camOffsetX -= s.camOffsetX * ratio;
      s.camOffsetY -= s.camOffsetY * ratio;
    }
  }

  if (s.camSnap || dt === 0) {
    s.camWorldX  = targetX;
    s.camWorldY  = targetY;
    s.camSnap    = false;
    s.camOffsetX = 0;
    s.camOffsetY = 0;
  } else {
    s.camWorldX = targetX + s.camOffsetX;
    s.camWorldY = targetY + s.camOffsetY;
  }
}
