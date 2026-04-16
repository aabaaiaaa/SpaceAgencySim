/**
 * throttleControl.ts — Core helpers for throttle manipulation.
 *
 * Extracted so UI key handlers can mutate throttle state through a core
 * function rather than reaching into PhysicsState directly.
 *
 * @module throttleControl
 */

import type { PhysicsState } from './physics.ts';

/**
 * Set the throttle to an instant value (typically 0 or 1).
 *
 * In 'twr' throttle mode, also set `targetTWR` to the matching extreme so the
 * TWR-relative throttle loop doesn't immediately overwrite the instant value:
 * value=0 -> targetTWR=0, value=1 -> targetTWR=Infinity. Intermediate values
 * leave targetTWR untouched.
 */
export function setThrottleInstant(ps: PhysicsState, value: number): void {
  ps.throttle = value;
  if (ps.throttleMode === 'twr') {
    if (value >= 1) {
      ps.targetTWR = Infinity;
    } else if (value <= 0) {
      ps.targetTWR = 0;
    }
  }
}
