// @vitest-environment jsdom
/**
 * ui-listenerLifecycle.test.ts — TASK-040: Verifies that the three modules
 * migrated onto the shared `ListenerTracker` pattern in iter-19 (§6.1-6.3)
 * register and tear down DOM listeners with add/remove parity:
 *
 *   - `flightController/_menuActions.ts` (module-scoped tracker exposed via
 *     `_listenerTracker.ts`)
 *   - `launchPad.ts`                    (private tracker; lifecycle is
 *                                        `initLaunchPadUI` / `destroyLaunchPadUI`)
 *   - `library.ts`                      (private tracker; lifecycle is
 *                                        `initLibraryUI`  / `destroyLibraryUI`)
 *
 * Each suite spies on `EventTarget.prototype.addEventListener` and
 * `removeEventListener` — every DOM element inherits these — then counts
 * add-vs-remove calls across the init→destroy window. Any future drift where
 * a new listener is attached outside the tracker will fail the parity check.
 */

import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';

// ---------------------------------------------------------------------------
// Stub CSS and PixiJS-backed modules so the UI modules can load under jsdom.
// ---------------------------------------------------------------------------

vi.mock('../ui/launchPad.css', () => ({}));
vi.mock('../ui/library.css', () => ({}));

vi.mock('../ui/flightController/_init.ts', () => ({
  startFlightScene: vi.fn(),
  stopFlightScene: vi.fn(),
}));

vi.mock('../ui/hub.ts', () => ({
  showReturnResultsOverlay: vi.fn(),
}));

import { initLaunchPadUI, destroyLaunchPadUI } from '../ui/launchPad.ts';
import { initLibraryUI, destroyLibraryUI } from '../ui/library.ts';
import { createGameState } from '../core/gameState.ts';
import {
  initFlightControllerListenerTracker,
  getFlightControllerListenerTracker,
  destroyFlightControllerListenerTracker,
} from '../ui/flightController/_listenerTracker.ts';

type AddSignature    = typeof EventTarget.prototype.addEventListener;
type RemoveSignature = typeof EventTarget.prototype.removeEventListener;

describe('UI listener lifecycle — migrated modules', () => {
  let addSpy:    MockInstance<AddSignature>;
  let removeSpy: MockInstance<RemoveSignature>;

  beforeEach(() => {
    document.body.innerHTML = '';
    addSpy    = vi.spyOn(EventTarget.prototype, 'addEventListener');
    removeSpy = vi.spyOn(EventTarget.prototype, 'removeEventListener');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -------------------------------------------------------------------------
  // _menuActions — the module-scoped tracker is initialised by startFlightScene
  // and destroyed by stopFlightScene. Each menu action (restart, adjust-build,
  // return-to-agency, flight-log) registers its modal/button handlers through
  // `_addTracked()`, which delegates to this tracker.
  // -------------------------------------------------------------------------

  describe('flightController/_menuActions (shared module tracker)', () => {
    afterEach(() => {
      // Ensure we never leave a live tracker between tests.
      destroyFlightControllerListenerTracker();
    });

    it('removes every listener added through the tracker on destroy', () => {
      initFlightControllerListenerTracker();
      const tracker = getFlightControllerListenerTracker();
      expect(tracker).not.toBeNull();

      // Mirror the registrations performed by `_menuActions::handleMenuRestart`:
      // modal (stop-propagation), cancel button, confirm button, backdrop.
      const modal      = document.createElement('div');
      const cancelBtn  = document.createElement('button');
      const confirmBtn = document.createElement('button');
      const backdrop   = document.createElement('div');

      const addsBefore = addSpy.mock.calls.length;
      tracker!.add(modal,      'click', () => {});
      tracker!.add(cancelBtn,  'click', () => {});
      tracker!.add(confirmBtn, 'click', () => {});
      tracker!.add(backdrop,   'click', () => {});
      const addsDuring = addSpy.mock.calls.length - addsBefore;
      expect(addsDuring).toBe(4);

      // No removes yet.
      const removesBefore = removeSpy.mock.calls.length;
      destroyFlightControllerListenerTracker();
      const removesDuring = removeSpy.mock.calls.length - removesBefore;

      expect(removesDuring).toBe(4);
      expect(getFlightControllerListenerTracker()).toBeNull();
    });

    it('clears prior listeners if init is called twice without destroy', () => {
      initFlightControllerListenerTracker();
      const first = getFlightControllerListenerTracker();
      const leaked = document.createElement('button');
      first!.add(leaked, 'click', () => {});

      const removesBefore = removeSpy.mock.calls.length;
      initFlightControllerListenerTracker();
      // Re-init must tear down the previous tracker's listeners.
      expect(removeSpy.mock.calls.length - removesBefore).toBe(1);

      const second = getFlightControllerListenerTracker();
      expect(second).not.toBeNull();
      expect(second).not.toBe(first);
    });
  });

  // -------------------------------------------------------------------------
  // launchPad — `initLaunchPadUI` creates a fresh tracker and renders the shell,
  // which registers the back button and the weather-skip button. Destroy must
  // remove both.
  // -------------------------------------------------------------------------

  describe('launchPad', () => {
    it('removes every listener registered during init on destroy', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const state = createGameState();

      const addsBefore = addSpy.mock.calls.length;
      initLaunchPadUI(container, state, { onBack: () => {} });
      const addsDuringInit = addSpy.mock.calls.length - addsBefore;

      // At minimum: back button + weather skip button.
      expect(addsDuringInit).toBeGreaterThan(0);

      const removesBefore = removeSpy.mock.calls.length;
      destroyLaunchPadUI();
      const removesDuringDestroy = removeSpy.mock.calls.length - removesBefore;

      expect(removesDuringDestroy).toBe(addsDuringInit);
    });

    it('is safe to destroy twice (second call is a no-op for listener removal)', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const state = createGameState();

      initLaunchPadUI(container, state, { onBack: () => {} });
      destroyLaunchPadUI();

      const removesBefore = removeSpy.mock.calls.length;
      expect(() => destroyLaunchPadUI()).not.toThrow();
      expect(removeSpy.mock.calls.length - removesBefore).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // library — `initLibraryUI` creates a fresh tracker and renders the shell,
  // which registers the back button and tab buttons. Destroy must remove every
  // one.
  // -------------------------------------------------------------------------

  describe('library', () => {
    it('removes every listener registered during init on destroy', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const state = createGameState();

      const addsBefore = addSpy.mock.calls.length;
      initLibraryUI(container, state, { onBack: () => {} });
      const addsDuringInit = addSpy.mock.calls.length - addsBefore;

      // At minimum: back button + three tab buttons.
      expect(addsDuringInit).toBeGreaterThanOrEqual(4);

      const removesBefore = removeSpy.mock.calls.length;
      destroyLibraryUI();
      const removesDuringDestroy = removeSpy.mock.calls.length - removesBefore;

      expect(removesDuringDestroy).toBe(addsDuringInit);
    });

    it('is safe to destroy twice (second call is a no-op for listener removal)', () => {
      const container = document.createElement('div');
      document.body.appendChild(container);
      const state = createGameState();

      initLibraryUI(container, state, { onBack: () => {} });
      destroyLibraryUI();

      const removesBefore = removeSpy.mock.calls.length;
      expect(() => destroyLibraryUI()).not.toThrow();
      expect(removeSpy.mock.calls.length - removesBefore).toBe(0);
    });
  });
});
