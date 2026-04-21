// @vitest-environment jsdom
/**
 * ui-handleFlightEndReturnToHub.test.ts — Unit tests for the shared
 * flight-end → hub return tail helper.
 *
 * The helper is called by the launchPad, VAB launch, and E2E-test flight
 * paths after the player returns to the hub. It is responsible for
 * displaying the financial summary overlay (when present) and triggering
 * the auto-save toast.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { createGameState, type GameState } from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// Hoisted spies for the two collaborators the helper interacts with.
// ---------------------------------------------------------------------------

const mocks = vi.hoisted(() => ({
  showReturnResultsOverlay: vi.fn(),
  triggerAutoSave: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Mock the real modules so jsdom can load ui/index.ts without PixiJS/CSS deps
// and so we can assert on the helper's collaborators.
// ---------------------------------------------------------------------------

vi.mock('../ui/design-tokens.css', () => ({}));
vi.mock('../render/hub.ts', () => ({ showHubScene: vi.fn(), hideHubScene: vi.fn() }));
vi.mock('../render/vab.ts', () => ({ showVabScene: vi.fn(), hideVabScene: vi.fn() }));
vi.mock('../ui/mainmenu.ts', () => ({ initMainMenu: vi.fn() }));
vi.mock('../ui/hub.ts', () => ({
  initHubUI: vi.fn(),
  destroyHubUI: vi.fn(),
  showWelcomeModal: vi.fn(),
  showReturnResultsOverlay: mocks.showReturnResultsOverlay,
}));
vi.mock('../ui/topbar.ts', () => ({
  initTopBar: vi.fn(),
  destroyTopBar: vi.fn(),
  refreshTopBar: vi.fn(),
  setCurrentScreen: vi.fn(),
}));
vi.mock('../ui/flightController.ts', () => ({ stopFlightScene: vi.fn() }));
vi.mock('../ui/flightHud.ts', () => ({ initFlightHud: vi.fn(), destroyFlightHud: vi.fn() }));
vi.mock('../ui/autoSaveToast.ts', () => ({ triggerAutoSave: mocks.triggerAutoSave }));
vi.mock('../ui/loadingIndicator.ts', () => ({
  showLoadingIndicator: vi.fn(),
  hideLoadingIndicator: vi.fn(),
}));
vi.mock('../ui/notification.ts', () => ({ showNotification: vi.fn() }));

import { handleFlightEndReturnToHub } from '../ui/index.ts';

function freshState(): GameState {
  return createGameState();
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
});

describe('handleFlightEndReturnToHub', () => {
  it('triggers an auto-save when state is provided @smoke', () => {
    const container = document.createElement('div');
    const state = freshState();

    handleFlightEndReturnToHub(container, state, null);

    expect(mocks.triggerAutoSave).toHaveBeenCalledTimes(1);
    expect(mocks.triggerAutoSave).toHaveBeenCalledWith(state, 'hub-return');
  });

  it('shows the return-results overlay when returnResults is provided', () => {
    const container = document.createElement('div');
    const state = freshState();
    const summary = { completedMissions: [], money: 1234 };

    handleFlightEndReturnToHub(container, state, summary);

    expect(mocks.showReturnResultsOverlay).toHaveBeenCalledTimes(1);
    expect(mocks.showReturnResultsOverlay).toHaveBeenCalledWith(container, summary);
  });

  it('skips the return-results overlay when returnResults is null', () => {
    const container = document.createElement('div');
    const state = freshState();

    handleFlightEndReturnToHub(container, state, null);

    expect(mocks.showReturnResultsOverlay).not.toHaveBeenCalled();
  });

  it('skips the return-results overlay when returnResults is undefined', () => {
    const container = document.createElement('div');
    const state = freshState();

    handleFlightEndReturnToHub(container, state, undefined);

    expect(mocks.showReturnResultsOverlay).not.toHaveBeenCalled();
  });

  it('is a no-op when state is null — no overlay, no auto-save @smoke', () => {
    const container = document.createElement('div');

    handleFlightEndReturnToHub(container, null, { completedMissions: [] });

    expect(mocks.showReturnResultsOverlay).not.toHaveBeenCalled();
    expect(mocks.triggerAutoSave).not.toHaveBeenCalled();
  });

  it('is a no-op when state is undefined', () => {
    const container = document.createElement('div');

    handleFlightEndReturnToHub(container, undefined, { completedMissions: [] });

    expect(mocks.showReturnResultsOverlay).not.toHaveBeenCalled();
    expect(mocks.triggerAutoSave).not.toHaveBeenCalled();
  });

  it('triggers auto-save AFTER showing the results overlay so both are queued in order', () => {
    const container = document.createElement('div');
    const state = freshState();
    const calls: string[] = [];
    mocks.showReturnResultsOverlay.mockImplementationOnce(() => { calls.push('overlay'); });
    mocks.triggerAutoSave.mockImplementationOnce(() => { calls.push('autosave'); });

    handleFlightEndReturnToHub(container, state, { completedMissions: [] });

    expect(calls).toEqual(['overlay', 'autosave']);
  });
});
