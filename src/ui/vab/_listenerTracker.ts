/**
 * _listenerTracker.ts — Module-scoped listenerTracker for the VAB UI.
 *
 * VAB sub-modules (_panels.ts, _canvasInteraction.ts) register DOM listeners
 * on window/document that must be cleaned up when the VAB is destroyed.
 * Rather than threading a tracker through each function parameter, the VAB
 * holds a single module-scoped tracker (mirroring the `_tracker` variable
 * in `crewAdmin.ts`). Sub-modules access it via `getVabListenerTracker()`.
 *
 * Lifecycle:
 *   - `initVabListenerTracker()` — called once from `initVabUI`.
 *   - `getVabListenerTracker()`  — called by sub-modules at each registration.
 *   - `destroyVabListenerTracker()` — called from `destroyVabUI` / `resetVabUI`.
 */

import { createListenerTracker, type ListenerTracker } from '../listenerTracker.ts';

let _tracker: ListenerTracker | null = null;

/**
 * Create a new tracker for the current VAB session. If one already exists
 * (init called twice without a destroy), the previous tracker is cleared
 * first so no listeners leak across sessions.
 */
export function initVabListenerTracker(): ListenerTracker {
  if (_tracker) _tracker.removeAll();
  _tracker = createListenerTracker();
  return _tracker;
}

/**
 * Return the current VAB tracker, or null if the VAB is not initialised.
 */
export function getVabListenerTracker(): ListenerTracker | null {
  return _tracker;
}

/**
 * Remove every tracked listener and discard the tracker instance.
 */
export function destroyVabListenerTracker(): void {
  if (_tracker) {
    _tracker.removeAll();
    _tracker = null;
  }
}
