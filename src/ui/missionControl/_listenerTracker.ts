/**
 * _listenerTracker.ts — Module-scoped listenerTracker for the Mission Control UI.
 *
 * Mission Control sub-modules (_shell.ts, _missionsTab.ts, _contractsTab.ts,
 * _challengesTab.ts, and the _init.ts escape-key handler) register DOM
 * listeners on buttons, overlays, and document-level targets that must be
 * cleaned up when the Mission Control panel is torn down. Rather than
 * threading a tracker through each function parameter, the Mission Control
 * module holds a single module-scoped tracker (mirroring the flight
 * controller's `_listenerTracker.ts`, the VAB's `_listenerTracker`, and
 * `crewAdmin.ts`'s `_tracker`).
 *
 * Lifecycle:
 *   - `initMissionControlListenerTracker()` — called from `initMissionControlUI`.
 *   - `getMissionControlListenerTracker()`  — called by sub-modules at each registration.
 *   - `destroyMissionControlListenerTracker()` — called from `destroyMissionControlUI`.
 */

import { createListenerTracker, type ListenerTracker } from '../listenerTracker.ts';

let _tracker: ListenerTracker | null = null;

/**
 * Create a new tracker for the current Mission Control session. If one already
 * exists (init called twice without a destroy), the previous tracker is
 * cleared first so no listeners leak across sessions.
 */
export function initMissionControlListenerTracker(): ListenerTracker {
  if (_tracker) _tracker.removeAll();
  _tracker = createListenerTracker();
  return _tracker;
}

/**
 * Return the current Mission Control tracker, or null if the Mission Control
 * panel is not active.
 */
export function getMissionControlListenerTracker(): ListenerTracker | null {
  return _tracker;
}

/**
 * Remove every tracked listener and discard the tracker instance.
 */
export function destroyMissionControlListenerTracker(): void {
  if (_tracker) {
    _tracker.removeAll();
    _tracker = null;
  }
}
