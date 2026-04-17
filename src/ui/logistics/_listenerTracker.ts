/**
 * _listenerTracker.ts — Module-scoped listenerTracker for the Logistics Center.
 *
 * Logistics sub-modules (_miningSites.ts, _routeBuilder.ts, _routeMap.ts,
 * _routeTable.ts, index.ts) register DOM listeners on overlay elements and
 * on document that must be cleaned up when the Logistics panel is closed.
 * Rather than threading a tracker through each function parameter, the
 * panel holds a single module-scoped tracker (mirroring the VAB's
 * `_listenerTracker`).
 *
 * Lifecycle:
 *   - `initLogisticsListenerTracker()`    — called from `openLogisticsPanel`.
 *   - `getLogisticsListenerTracker()`     — called by sub-modules at each registration.
 *   - `destroyLogisticsListenerTracker()` — called from `closeLogisticsPanel`.
 */

import { createListenerTracker, type ListenerTracker } from '../listenerTracker.ts';

let _tracker: ListenerTracker | null = null;

/**
 * Create a new tracker for the current Logistics session. If one already
 * exists (init called twice without a destroy), the previous tracker is
 * cleared first so no listeners leak across sessions.
 */
export function initLogisticsListenerTracker(): ListenerTracker {
  if (_tracker) _tracker.removeAll();
  _tracker = createListenerTracker();
  return _tracker;
}

/**
 * Return the current Logistics tracker, or null if the panel is not open.
 */
export function getLogisticsListenerTracker(): ListenerTracker | null {
  return _tracker;
}

/**
 * Remove every tracked listener and discard the tracker instance.
 */
export function destroyLogisticsListenerTracker(): void {
  if (_tracker) {
    _tracker.removeAll();
    _tracker = null;
  }
}
