// @vitest-environment jsdom
/**
 * vabLifecycle.test.ts — TASK-011: Verifies that every window/document
 * listener registered during VAB init is removed on VAB destroy.
 *
 * The VAB sub-modules (`_panels.ts::bindKeyboardShortcuts`,
 * `_canvasInteraction.ts::initContextMenu` and `::startDrag`) register
 * listeners via the shared VAB listener tracker (`_listenerTracker.ts`).
 * Rather than bootstrapping the entire PixiJS-backed VAB scene, this test
 * drives the tracker lifecycle directly and mirrors the registration calls
 * each sub-module performs — spying on `window.addEventListener` /
 * `removeEventListener` and `document.addEventListener` /
 * `removeEventListener` to prove add/remove parity on destroy.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import {
  initVabListenerTracker,
  getVabListenerTracker,
  destroyVabListenerTracker,
} from '../ui/vab/_listenerTracker.ts';

describe('VAB listener lifecycle', () => {
  let winAdd:    MockInstance<typeof window.addEventListener>;
  let winRemove: MockInstance<typeof window.removeEventListener>;
  let docAdd:    MockInstance<typeof document.addEventListener>;
  let docRemove: MockInstance<typeof document.removeEventListener>;

  beforeEach(() => {
    winAdd    = vi.spyOn(window,   'addEventListener');
    winRemove = vi.spyOn(window,   'removeEventListener');
    docAdd    = vi.spyOn(document, 'addEventListener');
    docRemove = vi.spyOn(document, 'removeEventListener');
  });

  afterEach(() => {
    destroyVabListenerTracker();
    vi.restoreAllMocks();
  });

  /** Extract count of spy calls for a given event name. */
  function countCalls(spy: MockInstance<(event: string, ...rest: unknown[]) => void>, event: string): number {
    return spy.mock.calls.filter(([e]) => e === event).length;
  }

  it('registers every window/document listener at init and removes them on destroy', () => {
    initVabListenerTracker();
    const tracker = getVabListenerTracker();
    expect(tracker).not.toBeNull();

    // Mirror _panels.ts::bindKeyboardShortcuts — 3 window keydown handlers.
    const keydownDelete = (): void => {};
    const keydownUndo   = (): void => {};
    const keydownSpace  = (): void => {};
    tracker!.add(window, 'keydown', keydownDelete);
    tracker!.add(window, 'keydown', keydownUndo);
    tracker!.add(window, 'keydown', keydownSpace);

    // Mirror _canvasInteraction.ts::initContextMenu — 1 document pointerdown (capture).
    const docPointerdown = (): void => {};
    tracker!.add(document, 'pointerdown', docPointerdown, { capture: true });

    // Mirror _canvasInteraction.ts::startDrag — 3 window listeners (capture).
    // Included to prove that a drag that does not complete (modal or VAB destroy
    // fires before drag-end) still has its listeners cleaned up.
    const dragMove   = (): void => {};
    const dragEnd    = (): void => {};
    const dragCancel = (): void => {};
    tracker!.add(window, 'pointermove',   dragMove,   { capture: true });
    tracker!.add(window, 'pointerup',     dragEnd,    { capture: true });
    tracker!.add(window, 'pointercancel', dragCancel, { capture: true });

    // Verify all adds reached the underlying targets.
    expect(countCalls(winAdd, 'keydown')).toBe(3);
    expect(countCalls(winAdd, 'pointermove')).toBe(1);
    expect(countCalls(winAdd, 'pointerup')).toBe(1);
    expect(countCalls(winAdd, 'pointercancel')).toBe(1);
    expect(countCalls(docAdd, 'pointerdown')).toBe(1);

    // No removes before destroy.
    expect(winRemove).not.toHaveBeenCalled();
    expect(docRemove).not.toHaveBeenCalled();

    // Destroy: every tracked listener must be torn down.
    destroyVabListenerTracker();

    expect(countCalls(winRemove, 'keydown')).toBe(3);
    expect(countCalls(winRemove, 'pointermove')).toBe(1);
    expect(countCalls(winRemove, 'pointerup')).toBe(1);
    expect(countCalls(winRemove, 'pointercancel')).toBe(1);
    expect(countCalls(docRemove, 'pointerdown')).toBe(1);

    // Exact pairing: same handler references passed to removeEventListener.
    const removedWindowKeydownHandlers = winRemove.mock.calls
      .filter(([e]) => e === 'keydown')
      .map(([, h]) => h);
    expect(removedWindowKeydownHandlers).toEqual(
      expect.arrayContaining([keydownDelete, keydownUndo, keydownSpace]),
    );

    const removedDocPointerdownHandlers = docRemove.mock.calls
      .filter(([e]) => e === 'pointerdown')
      .map(([, h]) => h);
    expect(removedDocPointerdownHandlers).toContain(docPointerdown);

    // Capture option must be preserved so the browser matches the same
    // capture-phase slot when removing.
    const removedDragMove = winRemove.mock.calls.find(
      ([e, h]) => e === 'pointermove' && h === dragMove,
    );
    expect(removedDragMove?.[2]).toEqual({ capture: true });

    // Tracker is discarded after destroy.
    expect(getVabListenerTracker()).toBeNull();
  });

  it('clears prior listeners if initVabListenerTracker is called twice without destroy', () => {
    initVabListenerTracker();
    const first = getVabListenerTracker();
    const leakedHandler = (): void => {};
    first!.add(window, 'keydown', leakedHandler);

    // Second init must tear down the previous tracker's listeners, not leak.
    initVabListenerTracker();
    expect(countCalls(winRemove, 'keydown')).toBe(1);
    expect(winRemove.mock.calls.some(([e, h]) => e === 'keydown' && h === leakedHandler)).toBe(true);

    // A brand-new tracker instance is returned.
    const second = getVabListenerTracker();
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
  });

  it('is a no-op to destroy when no tracker is active', () => {
    destroyVabListenerTracker();
    expect(() => destroyVabListenerTracker()).not.toThrow();
    expect(winRemove).not.toHaveBeenCalled();
    expect(docRemove).not.toHaveBeenCalled();
  });
});
