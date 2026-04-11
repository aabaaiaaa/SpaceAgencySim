// HTML overlay UI.
// Renders HUD elements, menus, dialogs, and panels as DOM nodes layered
// above the PixiJS canvas.  Individual panels enable pointer-events as needed;
// the root overlay container keeps pointer-events:none so clicks pass through
// to the canvas by default.

import type { GameState } from '../core/gameState.ts';
import type { FlightReturnSummary } from '../core/flightReturn.ts';
import { initMainMenu } from './mainmenu.ts';
import { initHubUI, destroyHubUI, showWelcomeModal, showReturnResultsOverlay } from './hub.ts';
import { initVabUI, resetVabUI } from './vab.ts';
import { initCrewAdminUI, destroyCrewAdminUI } from './crewAdmin.ts';
import { initMissionControlUI, destroyMissionControlUI } from './missionControl.ts';
import { initLaunchPadUI, destroyLaunchPadUI } from './launchPad.ts';
import { initSatelliteOpsUI, destroySatelliteOpsUI } from './satelliteOps.ts';
import { initTrackingStationUI, destroyTrackingStationUI } from './trackingStation.ts';
import { initLibraryUI, destroyLibraryUI } from './library.ts';
import { initRdLabUI, destroyRdLabUI } from './rdLab.ts';
import { openLogisticsPanel, closeLogisticsPanel } from './logistics.ts';
import { stopFlightScene } from './flightController.ts';
import { initTopBar, destroyTopBar, refreshTopBar, setCurrentScreen } from './topbar.ts';
import { showVabScene, hideVabScene } from '../render/vab.ts';
import { showHubScene } from '../render/hub.ts';
import { hasFacility } from '../core/construction.ts';
import { GameMode } from '../core/constants.ts';
import './design-tokens.css';
import { triggerAutoSave } from './autoSaveToast.ts';

export { initFlightHud, destroyFlightHud } from './flightHud.ts';
export { showReturnResultsOverlay } from './hub.ts';

// ---------------------------------------------------------------------------
// Screen routing state
// ---------------------------------------------------------------------------

/**
 * True once the VAB HTML overlay has been initialised for this game session.
 * Prevents re-creating the overlay if the player returns to the VAB from the
 * hub later.
 */
let _vabInitialized: boolean = false;

/**
 * True while the Crew Admin screen is open.
 * Used to guard against double-mounting.
 */
let _crewAdminOpen: boolean = false;

/**
 * True while the Mission Control screen is open.
 * Used to guard against double-mounting.
 */
let _missionControlOpen: boolean = false;

/**
 * True while the Launch Pad screen is open.
 * Used to guard against double-mounting.
 */
let _launchPadOpen: boolean = false;

/**
 * True while the Satellite Ops screen is open.
 * Used to guard against double-mounting.
 */
let _satelliteOpsOpen: boolean = false;

/**
 * True while the Tracking Station screen is open.
 * Used to guard against double-mounting.
 */
let _trackingStationOpen: boolean = false;

/**
 * True while the Library screen is open.
 * Used to guard against double-mounting.
 */
let _libraryOpen: boolean = false;

/**
 * True while the R&D Lab screen is open.
 * Used to guard against double-mounting.
 */
let _rdLabOpen: boolean = false;

/**
 * True while the Logistics Center screen is open.
 * Used to guard against double-mounting.
 */
let _logisticsOpen: boolean = false;

/**
 * The #ui-overlay container, stored so _handleExitToMenu can re-mount the
 * main menu without needing it passed through every callback.
 */
let _container: HTMLElement | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Shows the main menu / load screen.
 *
 * When the player selects or starts a game the menu fades out and
 * `onGameReady` is called with the initialised game state.  The caller
 * should then invoke `initUI` to boot the in-game overlay.
 */
export function showMainMenu(
  container: HTMLElement,
  onGameReady: (state: GameState) => void,
): void {
  // Reset VAB state so a new game gets a fresh VAB session.
  _vabInitialized = false;
  resetVabUI();
  initMainMenu(container, onGameReady);
}

/**
 * Initialize the in-game UI overlay, starting with the hub screen.
 * Called after the player has chosen a game via the main menu.
 *
 * Mounts the persistent top bar (visible on all screens), then the hub.
 */
export function initUI(container: HTMLElement, state: GameState): void {
  _container = container;
  _vabInitialized     = false;
  _crewAdminOpen      = false;
  _missionControlOpen = false;
  _launchPadOpen      = false;
  _libraryOpen        = false;
  _logisticsOpen      = false;
  // Ensure a fresh VAB assembly for each new game session.
  resetVabUI();
  hideVabScene(); // ensure VAB PixiJS is hidden when starting a new session

  // Mount the persistent top bar — visible on all in-game screens.
  initTopBar(container, state, {
    onExitToMenu: () => _handleExitToMenu(),
    onLoadGame: (loadedState: GameState) => _handleLoadGame(loadedState),
  });

  setCurrentScreen('hub');
  initHubUI(container, state, (destination: string) => {
    _handleNavigation(container, state, destination);
  });

  // Show welcome modal on first hub visit for a new game.
  if (!state.welcomeShown) {
    showWelcomeModal(container, state);
  }
}

/**
 * Re-show the hub after a flight ends (used by the E2E test flight API).
 * Assumes the flight scene has already been stopped and the topbar is still
 * mounted.
 */
export function returnToHubFromFlight(
  container: HTMLElement,
  state: GameState,
  returnResults: unknown,
): void {
  showHubScene();
  setCurrentScreen('hub');
  refreshTopBar();
  initHubUI(container, state, (destination: string) => {
    _handleNavigation(container, state, destination);
  });
  if (returnResults) {
    showReturnResultsOverlay(container, returnResults as FlightReturnSummary);
  }

  // Trigger auto-save on return to hub from flight.
  if (state) {
    triggerAutoSave(state, 'hub-return');
  }
}

// ---------------------------------------------------------------------------
// Private — exit to menu handler
// ---------------------------------------------------------------------------

/**
 * Tear down all in-game UI and re-show the main menu.
 * Called when the player chooses "Exit to Menu" or "Load Game" from the
 * hamburger dropdown in the top bar.
 */
function _handleExitToMenu(): void {
  stopFlightScene(); // safe to call even if no flight is active
  hideVabScene();    // hide VAB PixiJS container (no-op if already hidden)
  destroyTopBar();
  destroyHubUI(); // no-op if hub is not the current screen
  if (_crewAdminOpen) {
    destroyCrewAdminUI();
    _crewAdminOpen = false;
  }
  if (_missionControlOpen) {
    destroyMissionControlUI();
    _missionControlOpen = false;
  }
  if (_launchPadOpen) {
    destroyLaunchPadUI();
    _launchPadOpen = false;
  }
  if (_satelliteOpsOpen) {
    destroySatelliteOpsUI();
    _satelliteOpsOpen = false;
  }
  if (_trackingStationOpen) {
    destroyTrackingStationUI();
    _trackingStationOpen = false;
  }
  if (_libraryOpen) {
    destroyLibraryUI();
    _libraryOpen = false;
  }
  if (_rdLabOpen) {
    destroyRdLabUI();
    _rdLabOpen = false;
  }
  if (_logisticsOpen) {
    closeLogisticsPanel();
    _logisticsOpen = false;
  }

  // Wipe any remaining screen overlays from the container.
  if (_container) {
    _container.innerHTML = '';
  }
  _vabInitialized = false;

  // Re-show the main menu.  onGameReady wires up a fresh game session.
  if (_container) {
    showMainMenu(_container, (newState: GameState) => {
      // Keep window.__gameState in sync for e2e test access.
      if (typeof window !== 'undefined') {
        window.__gameState =newState;
      }
      initUI(_container!, newState);
    });
  }
}

/**
 * Tear down all in-game UI and reinitialize with the loaded game state.
 * Called when the player loads a save from the in-game hamburger menu modal.
 */
function _handleLoadGame(loadedState: GameState): void {
  stopFlightScene();
  hideVabScene();
  destroyTopBar();
  destroyHubUI();
  if (_crewAdminOpen)      { destroyCrewAdminUI();      _crewAdminOpen = false; }
  if (_missionControlOpen) { destroyMissionControlUI();  _missionControlOpen = false; }
  if (_launchPadOpen)      { destroyLaunchPadUI();       _launchPadOpen = false; }
  if (_satelliteOpsOpen)   { destroySatelliteOpsUI();    _satelliteOpsOpen = false; }
  if (_trackingStationOpen){ destroyTrackingStationUI(); _trackingStationOpen = false; }
  if (_libraryOpen)        { destroyLibraryUI();         _libraryOpen = false; }
  if (_rdLabOpen)          { destroyRdLabUI();           _rdLabOpen = false; }
  if (_logisticsOpen)      { closeLogisticsPanel();      _logisticsOpen = false; }

  if (_container) {
    _container.innerHTML = '';
  }
  _vabInitialized = false;

  // Keep window.__gameState in sync for e2e test access.
  if (typeof window !== 'undefined') {
    window.__gameState =loadedState;
  }

  // Reinitialize the game UI with the loaded state.
  if (_container) {
    initUI(_container, loadedState);
  }
}

// ---------------------------------------------------------------------------
// Private — navigation handler
// ---------------------------------------------------------------------------

/**
 * Handle a navigation request from the hub.
 */
function _handleNavigation(container: HTMLElement, state: GameState, destination: string): void {
  // Block navigation to unbuilt facilities (except in sandbox where all are built).
  if (state.gameMode !== GameMode.SANDBOX && !hasFacility(state, destination)) {
    // Show a brief tooltip message on the hub overlay.
    const overlay = document.getElementById('hub-overlay');
    if (overlay) {
      const existing = overlay.querySelector('.hub-locked-msg');
      if (existing) existing.remove();
      const msg = document.createElement('div');
      msg.className = 'hub-locked-msg';
      msg.textContent = 'This facility has not been built yet.';
      overlay.appendChild(msg);
      setTimeout(() => msg.remove(), 2000);
    }
    return;
  }

  if (destination === 'vab') {
    // Tear down the hub overlay and show the VAB.
    destroyHubUI();
    showVabScene();
    setCurrentScreen('vab');

    if (!_vabInitialized) {
      initVabUI(container, state, {
        onBack: () => {
          // Remove the VAB overlay and return to the hub.
          const vabRoot = document.getElementById('vab-root');
          if (vabRoot) vabRoot.remove();
          _vabInitialized = false;
          hideVabScene();
          showHubScene();
          setCurrentScreen('hub');
          refreshTopBar();
          initHubUI(container, state, (dest: string) => {
            _handleNavigation(container, state, dest);
          });
        },
      });
      _vabInitialized = true;
    }

    return;
  }

  if (destination === 'crew-admin') {
    // Tear down the hub overlay and show the Crew Admin screen.
    destroyHubUI();
    setCurrentScreen('crew-admin');

    if (!_crewAdminOpen) {
      initCrewAdminUI(container, state, {
        onBack: () => {
          // Crew Admin has already destroyed itself; re-show the hub.
          _crewAdminOpen = false;
          setCurrentScreen('hub');
          showHubScene();
          initHubUI(container, state, (dest: string) => {
            _handleNavigation(container, state, dest);
          });
        },
      });
      _crewAdminOpen = true;
    }

    return;
  }

  if (destination === 'mission-control') {
    // Tear down the hub overlay and show the Mission Control screen.
    destroyHubUI();
    setCurrentScreen('mission-control');

    if (!_missionControlOpen) {
      initMissionControlUI(container, state, {
        onBack: () => {
          // Mission Control has already destroyed itself; re-show the hub.
          _missionControlOpen = false;
          setCurrentScreen('hub');
          showHubScene();
          initHubUI(container, state, (dest: string) => {
            _handleNavigation(container, state, dest);
          });
        },
      });
      _missionControlOpen = true;
    }

    return;
  }

  if (destination === 'launch-pad') {
    // Tear down the hub overlay and show the Launch Pad screen.
    destroyHubUI();
    setCurrentScreen('launch-pad');

    if (!_launchPadOpen) {
      initLaunchPadUI(container, state, {
        onBack: () => {
          // Launch Pad has already destroyed itself; re-show the hub.
          _launchPadOpen = false;
          setCurrentScreen('hub');
          showHubScene();
          initHubUI(container, state, (dest: string) => {
            _handleNavigation(container, state, dest);
          });
        },
      });
      _launchPadOpen = true;
    }

    return;
  }

  if (destination === 'satellite-ops') {
    // Tear down the hub overlay and show the Satellite Ops screen.
    destroyHubUI();
    setCurrentScreen('satellite-ops');

    if (!_satelliteOpsOpen) {
      initSatelliteOpsUI(container, state, {
        onBack: () => {
          _satelliteOpsOpen = false;
          setCurrentScreen('hub');
          showHubScene();
          initHubUI(container, state, (dest: string) => {
            _handleNavigation(container, state, dest);
          });
        },
      });
      _satelliteOpsOpen = true;
    }

    return;
  }

  if (destination === 'tracking-station') {
    // Tear down the hub overlay and show the Tracking Station screen.
    destroyHubUI();
    setCurrentScreen('tracking-station');

    if (!_trackingStationOpen) {
      initTrackingStationUI(container, state, {
        onBack: () => {
          _trackingStationOpen = false;
          setCurrentScreen('hub');
          showHubScene();
          initHubUI(container, state, (dest: string) => {
            _handleNavigation(container, state, dest);
          });
        },
      });
      _trackingStationOpen = true;
    }

    return;
  }

  if (destination === 'library') {
    destroyHubUI();
    setCurrentScreen('library');

    if (!_libraryOpen) {
      initLibraryUI(container, state, {
        onBack: () => {
          _libraryOpen = false;
          setCurrentScreen('hub');
          showHubScene();
          initHubUI(container, state, (dest: string) => {
            _handleNavigation(container, state, dest);
          });
        },
      });
      _libraryOpen = true;
    }

    return;
  }

  if (destination === 'rd-lab') {
    destroyHubUI();
    setCurrentScreen('rd-lab');

    if (!_rdLabOpen) {
      initRdLabUI(container, state, {
        onBack: () => {
          _rdLabOpen = false;
          setCurrentScreen('hub');
          showHubScene();
          initHubUI(container, state, (dest: string) => {
            _handleNavigation(container, state, dest);
          });
        },
      });
      _rdLabOpen = true;
    }

    return;
  }

  if (destination === 'logistics-center') {
    destroyHubUI();
    setCurrentScreen('logistics-center');

    if (!_logisticsOpen) {
      openLogisticsPanel(state, container);
      _logisticsOpen = true;

      // Override back button to return to hub
      const backBtn = document.getElementById('logistics-back-btn');
      if (backBtn) {
        // Clone to remove existing listeners
        const newBtn = backBtn.cloneNode(true) as HTMLElement;
        backBtn.replaceWith(newBtn);
        newBtn.addEventListener('click', () => {
          closeLogisticsPanel();
          _logisticsOpen = false;
          setCurrentScreen('hub');
          showHubScene();
          initHubUI(container, state, (dest: string) => {
            _handleNavigation(container, state, dest);
          });
        });
      }
    }

    return;
  }

  // Other building screens are not yet implemented.
}
