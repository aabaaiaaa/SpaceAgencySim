/**
 * controlMode.ts — Control mode state machine for orbital flight.
 *
 * Three control modes exist during the ORBIT phase:
 *
 *   NORMAL (default)
 *     - A/D rotates craft, W/S throttle, Space stages.
 *     - Engines affect the orbit directly.
 *     - RCS outside docking: WASD = prograde/retrograde/radial-in/radial-out.
 *
 *   DOCKING (toggled)
 *     - Engines affect local position within the orbit slot.
 *     - Current orbit is frozen as a reference frame.
 *     - A/D = along track, W/S = radial.
 *     - Restricted to current altitude band (warning at limits).
 *     - Thrust cuts to zero on toggle.
 *
 *   RCS (sub-mode of docking)
 *     - WASD = directional translation (craft-relative).
 *     - No rotation.
 *     - RCS plumes visible around centre of mass.
 *     - Small thrust for precision manoeuvres.
 *
 * ARCHITECTURE RULE: this module is pure game logic — no DOM, no canvas.
 * It reads/mutates PhysicsState and FlightState only.
 *
 * @module core/controlMode
 */

import { ControlMode, FlightPhase } from './constants.ts';
import { getAltitudeBand } from './orbit.ts';
import { computeOrbitalElements } from './orbit.ts';
import { getPartById } from '../data/parts.ts';
import { PartType, BODY_RADIUS, ALTITUDE_BANDS } from './constants.ts';

import type { ControlMode as ControlModeType, AltitudeBand } from './constants.ts';
import type { PhysicsState, RocketAssembly } from './physics.ts';
import type { FlightState } from './gameState.ts';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** RCS translation thrust (N) — small for precision. */
export const RCS_TRANSLATION_THRUST: number = 500;

/** Docking mode translation thrust (N) — moderate for slot positioning. */
export const DOCKING_THRUST: number = 2000;

/**
 * Distance (m) from altitude band edge at which a warning fires.
 * Used for band-limit warnings in docking mode.
 */
export const BAND_WARNING_MARGIN: number = 5000;

// ---------------------------------------------------------------------------
// Control mode tips — shown on every mode switch
// ---------------------------------------------------------------------------

export const CONTROL_MODE_TIPS: Readonly<Record<string, string>> = Object.freeze({
  [ControlMode.NORMAL]:  'Orbit Mode: W/S throttle, A/D rotate, Space stage',
  [ControlMode.DOCKING]: 'Docking Mode: A/D along-track, W/S radial — orbit frozen',
  [ControlMode.RCS]:     'RCS Mode: WASD translate — no rotation',
});

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/** Result from a mode transition attempt. */
export interface ModeTransitionResult {
  success: boolean;
  reason?: string;
}

/** Result from a band-limit warning check. */
export interface BandWarningResult {
  warning: boolean;
  message: string;
}

/** Docking thrust direction vectors. */
export interface DockingThrustDirections {
  alongTrackAngle: number;
  radialOutAngle: number;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Check whether the craft can enter docking mode.
 * Requires ORBIT phase.
 */
export function canEnterDockingMode(phase: string): boolean {
  return phase === FlightPhase.ORBIT;
}

/**
 * Check whether the assembly has at least one active RCS thruster part.
 */
export function hasRcsThrusters(ps: PhysicsState, assembly: RocketAssembly): boolean {
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    if (def.type === PartType.RCS_THRUSTER) return true;
    if (def.properties?.hasRcs === true) return true;
  }
  return false;
}

/**
 * Check whether the craft can enter RCS mode.
 * Requires being in DOCKING mode and having RCS thrusters.
 */
export function canEnterRcsMode(ps: PhysicsState, assembly: RocketAssembly): boolean {
  return ps.controlMode === ControlMode.DOCKING && hasRcsThrusters(ps, assembly);
}

/**
 * Return a human-readable label for a control mode.
 */
export function getControlModeLabel(mode: string): string {
  switch (mode) {
    case ControlMode.NORMAL:  return 'Orbit';
    case ControlMode.DOCKING: return 'Docking';
    case ControlMode.RCS:     return 'RCS';
    default:                  return mode;
  }
}

// ---------------------------------------------------------------------------
// Mode transitions
// ---------------------------------------------------------------------------

/**
 * Enter docking mode from NORMAL.
 * Freezes the current orbit, cuts thrust to zero.
 */
export function enterDockingMode(ps: PhysicsState, flightState: FlightState, bodyId: string): ModeTransitionResult {
  if (!canEnterDockingMode(flightState.phase)) {
    return { success: false, reason: 'Must be in ORBIT phase' };
  }
  if (ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS) {
    return { success: false, reason: 'Already in docking mode' };
  }

  // Freeze current orbit as reference.
  const elements = computeOrbitalElements(ps.posX, ps.posY, ps.velX, ps.velY, bodyId);
  ps.baseOrbit = elements;

  // Record the current altitude band.
  const altitude = Math.max(0, ps.posY);
  ps.dockingAltitudeBand = getAltitudeBand(altitude, bodyId);

  // Store docking-local offset (starts at zero).
  ps.dockingOffsetAlongTrack = 0;
  ps.dockingOffsetRadial = 0;

  // Cut thrust to zero on toggle.
  ps.throttle = 0;
  if (ps.throttleMode === 'twr') {
    ps.targetTWR = 0;
  }

  ps.controlMode = ControlMode.DOCKING;
  return { success: true };
}

/**
 * Exit docking mode, returning to NORMAL.
 * Applies the accumulated docking offset as a small orbit adjustment.
 */
export function exitDockingMode(ps: PhysicsState, flightState: FlightState, bodyId: string): ModeTransitionResult {
  if (ps.controlMode !== ControlMode.DOCKING && ps.controlMode !== ControlMode.RCS) {
    return { success: false, reason: 'Not in docking mode' };
  }

  // Cut thrust to zero on toggle.
  ps.throttle = 0;
  if (ps.throttleMode === 'twr') {
    ps.targetTWR = 0;
  }

  // Clear docking state.
  ps.baseOrbit = null;
  ps.dockingAltitudeBand = null;
  ps.dockingOffsetAlongTrack = 0;
  ps.dockingOffsetRadial = 0;

  ps.controlMode = ControlMode.NORMAL;
  return { success: true };
}

/**
 * Toggle RCS mode on/off within docking mode.
 */
export function toggleRcsMode(ps: PhysicsState, assembly: RocketAssembly): ModeTransitionResult {
  if (ps.controlMode === ControlMode.RCS) {
    // Exit RCS -> back to DOCKING.
    ps.controlMode = ControlMode.DOCKING;
    return { success: true };
  }

  if (!canEnterRcsMode(ps, assembly)) {
    if (ps.controlMode !== ControlMode.DOCKING) {
      return { success: false, reason: 'Must be in docking mode first' };
    }
    return { success: false, reason: 'No RCS thrusters available' };
  }

  ps.controlMode = ControlMode.RCS;
  return { success: true };
}

// ---------------------------------------------------------------------------
// Docking mode physics helpers
// ---------------------------------------------------------------------------

/**
 * Check whether the craft is near the edge of its altitude band and return
 * a warning if so.
 */
export function checkBandLimitWarning(ps: PhysicsState, bodyId: string): BandWarningResult {
  if (ps.controlMode !== ControlMode.DOCKING && ps.controlMode !== ControlMode.RCS) {
    return { warning: false, message: '' };
  }

  const band = ps.dockingAltitudeBand;
  if (!band) return { warning: false, message: '' };

  const altitude = Math.max(0, ps.posY);

  if (altitude < band.min + BAND_WARNING_MARGIN) {
    return { warning: true, message: `Near lower band limit (${band.name})` };
  }
  if (altitude > band.max - BAND_WARNING_MARGIN) {
    return { warning: true, message: `Near upper band limit (${band.name})` };
  }

  return { warning: false, message: '' };
}

/**
 * Clamp a radial velocity delta so the craft doesn't leave its altitude band
 * in docking mode.
 */
export function clampDockingRadial(ps: PhysicsState, deltaVelY: number, bodyId: string): number {
  const band = ps.dockingAltitudeBand;
  if (!band) return deltaVelY;

  const altitude = Math.max(0, ps.posY);

  // Prevent moving out of band.
  if (deltaVelY > 0 && altitude >= band.max - BAND_WARNING_MARGIN * 0.5) {
    return 0;
  }
  if (deltaVelY < 0 && altitude <= band.min + BAND_WARNING_MARGIN * 0.5) {
    return 0;
  }

  return deltaVelY;
}

/**
 * Compute the orbital-relative thrust direction vectors for docking mode.
 * Along-track = tangent to orbit (velocity direction).
 * Radial = perpendicular to orbit (toward/away from body).
 */
export function getDockingThrustDirections(ps: PhysicsState, bodyId: string): DockingThrustDirections {
  const R = BODY_RADIUS[bodyId];
  const px = ps.posX;
  const py = ps.posY + R;

  // Along-track (prograde direction).
  const alongTrackAngle = Math.atan2(ps.velX, ps.velY);

  // Radial out (away from body centre).
  const len = Math.sqrt(px * px + py * py) || 1;
  const radialOutAngle = Math.atan2(px / len, py / len);

  return { alongTrackAngle, radialOutAngle };
}

/**
 * Force the control mode back to NORMAL if the flight phase leaves ORBIT.
 * Called by the flight controller when phase changes.
 */
export function resetControlModeIfNeeded(ps: PhysicsState, flightState: FlightState, bodyId: string): boolean {
  if (ps.controlMode === ControlMode.NORMAL) return false;
  if (flightState.phase === FlightPhase.ORBIT) return false;
  // Allow docking mode to persist during MANOEUVRE (burn from docking is local only).
  if (flightState.phase === FlightPhase.MANOEUVRE) return false;

  // Phase left ORBIT / MANOEUVRE — force back to normal.
  exitDockingMode(ps, flightState, bodyId);
  ps.controlMode = ControlMode.NORMAL;
  return true;
}
