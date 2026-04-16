/**
 * _listenerTracker.ts — Module-scoped listenerTracker for the flight controller.
 *
 * Flight-controller sub-modules (_menuActions.ts and, over time, others)
 * register DOM listeners on modal / overlay elements and on window/document
 * that must be cleaned up when the flight scene is torn down. Rather than
 * threading a tracker through each function parameter, the flight controller
 * holds a single module-scoped tracker (mirroring the VAB's `_listenerTracker`
 * and `crewAdmin.ts`'s `_tracker`).
 *
 * Lifecycle:
 *   - `initFlightControllerListenerTracker()` — called once from `startFlightScene`.
 *   - `getFlightControllerListenerTracker()`  — called by sub-modules at each registration.
 *   - `destroyFlightControllerListenerTracker()` — called from `stopFlightScene`.
 */

import { createListenerTracker, type ListenerTracker } from '../listenerTracker.ts';

let _tracker: ListenerTracker | null = null;

/**
 * Create a new tracker for the current flight session. If one already exists
 * (init called twice without a destroy), the previous tracker is cleared first
 * so no listeners leak across sessions.
 */
export function initFlightControllerListenerTracker(): ListenerTracker {
  if (_tracker) _tracker.removeAll();
  _tracker = createListenerTracker();
  return _tracker;
}

/**
 * Return the current flight-controller tracker, or null if the flight scene
 * is not active.
 */
export function getFlightControllerListenerTracker(): ListenerTracker | null {
  return _tracker;
}

/**
 * Remove every tracked listener and discard the tracker instance.
 */
export function destroyFlightControllerListenerTracker(): void {
  if (_tracker) {
    _tracker.removeAll();
    _tracker = null;
  }
}
