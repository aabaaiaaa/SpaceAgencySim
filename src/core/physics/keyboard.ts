// ---------------------------------------------------------------------------
// Keyboard input handling for flight physics
// ---------------------------------------------------------------------------

import { ControlMode } from '../constants.ts';
import type { PhysicsState, RocketAssembly } from '../physics.ts';

/** Throttle change per keypress (5 %). */
const THROTTLE_STEP: number = 0.05;

/** Target TWR change per keypress in TWR mode. */
const TWR_STEP: number = 0.1;

/**
 * Handle a key-down event.
 *
 * One-shot actions (throttle change) are processed immediately.
 * Continuous actions (steering) are recorded in `ps._heldKeys` and applied
 * each integration step.
 */
export function handleKeyDown(ps: PhysicsState, assembly: RocketAssembly, key: string): void {
  ps._heldKeys.add(key);

  // In docking/RCS modes, W/S/A/D are handled continuously by
  // _applyDockingMovement — skip one-shot throttle changes.
  const isDockingOrRcs = ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS;
  if (isDockingOrRcs) {
    // Only allow X (cut throttle) and Z (max throttle) as safety overrides.
    switch (key) {
      case 'x': case 'X': ps.throttle = 0; break;
      case 'z': case 'Z': ps.throttle = 0; break; // In docking, Z also cuts (no full thrust)
    }
    return;
  }

  const twrMode = ps.throttleMode === 'twr';

  switch (key) {
    case 'w':
    case 'ArrowUp':
    case 'Shift':
      if (twrMode) {
        ps.targetTWR = ps.targetTWR === Infinity
          ? Infinity
          : ps.targetTWR + TWR_STEP;
      } else {
        ps.throttle = Math.min(1, ps.throttle + THROTTLE_STEP);
      }
      break;
    case 's':
    case 'ArrowDown':
    case 'Control':
      if (twrMode) {
        ps.targetTWR = ps.targetTWR === Infinity
          ? Math.max(0, 10 - TWR_STEP) // step down from "max" to a large finite value
          : Math.max(0, ps.targetTWR - TWR_STEP);
      } else {
        ps.throttle = Math.max(0, ps.throttle - THROTTLE_STEP);
      }
      break;
    case 'x':
    case 'X':
      if (twrMode) {
        ps.targetTWR = 0;
        ps.throttle  = 0;
      } else {
        ps.throttle = 0;
      }
      break;
    case 'z':
    case 'Z':
      if (twrMode) {
        ps.targetTWR = Infinity;
        ps.throttle  = 1;
      } else {
        ps.throttle = 1;
      }
      break;
    // A/D and ArrowLeft/ArrowRight are handled continuously in _integrate.
    default:
      break;
  }
}

/**
 * Handle a key-up event.
 * Removes the key from the held-key set so continuous steering stops.
 */
export function handleKeyUp(ps: PhysicsState, key: string): void {
  ps._heldKeys.delete(key);
}
