/**
 * listenerTracker.ts — Lightweight event listener tracking utility.
 *
 * UI panel modules (help, settings, debugSaves, topbar) create DOM elements
 * with event listeners that must be cleaned up when the panel closes.
 * Rather than relying solely on `.remove()` and garbage collection (which
 * isn't reliable for document-level listeners or closure-retained elements),
 * modules use a tracker to register listeners and bulk-remove them on teardown.
 *
 * Usage:
 *   const tracker = createListenerTracker();
 *   tracker.add(btn, 'click', handler);
 *   // ... later, on panel close:
 *   tracker.removeAll();
 *
 * @module ui/listenerTracker
 */

/** A single tracked listener entry. */
interface TrackedListener {
  target: EventTarget;
  event: string;
  handler: EventListenerOrEventListenerObject;
  options?: boolean | AddEventListenerOptions;
}

/** The object returned by {@link createListenerTracker}. */
export interface ListenerTracker {
  /** Register and attach an event listener, tracking it for later removal. */
  add(
    target: EventTarget,
    event: string,
    handler: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ): void;
  /** Remove all tracked listeners and clear the internal list. */
  removeAll(): void;
}

/**
 * Create a new listener tracker instance.
 */
export function createListenerTracker(): ListenerTracker {
  const _listeners: TrackedListener[] = [];

  return {
    /**
     * Register and attach an event listener. The listener is tracked so it
     * can be removed later via `removeAll()`.
     */
    add(
      target: EventTarget,
      event: string,
      handler: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void {
      target.addEventListener(event, handler, options);
      _listeners.push({ target, event, handler, options });
    },

    /**
     * Remove all tracked listeners and clear the internal list.
     */
    removeAll(): void {
      for (const { target, event, handler, options } of _listeners) {
        target.removeEventListener(event, handler, options);
      }
      _listeners.length = 0;
    },
  };
}
