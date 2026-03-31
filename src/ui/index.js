// HTML overlay UI.
// Renders HUD elements, menus, dialogs, and panels as DOM nodes layered
// above the PixiJS canvas.  Individual panels enable pointer-events as needed;
// the root overlay container keeps pointer-events:none so clicks pass through
// to the canvas by default.

import { initMainMenu } from './mainmenu.js';
import { initHubUI, destroyHubUI } from './hub.js';
import { initVabUI, resetVabUI } from './vab.js';
import { initCrewAdminUI, destroyCrewAdminUI } from './crewAdmin.js';
import { initMissionControlUI, destroyMissionControlUI } from './missionControl.js';
import { initLaunchPadUI, destroyLaunchPadUI } from './launchPad.js';
import { initSatelliteOpsUI, destroySatelliteOpsUI } from './satelliteOps.js';
import { initTrackingStationUI, destroyTrackingStationUI } from './trackingStation.js';
import { stopFlightScene } from './flightController.js';
import { initTopBar, destroyTopBar, refreshTopBar } from './topbar.js';
import { showVabScene, hideVabScene } from '../render/vab.js';
import { showHubScene } from '../render/hub.js';

export { initFlightHud, destroyFlightHud } from './flightHud.js';

// ---------------------------------------------------------------------------
// Screen routing state
// ---------------------------------------------------------------------------

/**
 * True once the VAB HTML overlay has been initialised for this game session.
 * Prevents re-creating the overlay if the player returns to the VAB from the
 * hub later.
 */
let _vabInitialized = false;

/**
 * True while the Crew Admin screen is open.
 * Used to guard against double-mounting.
 */
let _crewAdminOpen = false;

/**
 * True while the Mission Control screen is open.
 * Used to guard against double-mounting.
 */
let _missionControlOpen = false;

/**
 * True while the Launch Pad screen is open.
 * Used to guard against double-mounting.
 */
let _launchPadOpen = false;

/**
 * True while the Satellite Ops screen is open.
 * Used to guard against double-mounting.
 */
let _satelliteOpsOpen = false;

/**
 * True while the Tracking Station screen is open.
 * Used to guard against double-mounting.
 */
let _trackingStationOpen = false;

/**
 * The #ui-overlay container, stored so _handleExitToMenu can re-mount the
 * main menu without needing it passed through every callback.
 * @type {HTMLElement | null}
 */
let _container = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Shows the main menu / load screen.
 *
 * When the player selects or starts a game the menu fades out and
 * `onGameReady` is called with the initialised game state.  The caller
 * should then invoke `initUI` to boot the in-game overlay.
 *
 * @param {HTMLElement} container  The #ui-overlay div from index.html.
 * @param {(state: import('../core/gameState.js').GameState) => void} onGameReady
 */
export function showMainMenu(container, onGameReady) {
  // Reset VAB state so a new game gets a fresh VAB session.
  _vabInitialized = false;
  resetVabUI();
  initMainMenu(container, onGameReady);
  console.log('[UI] Main menu displayed');
}

/**
 * Initialize the in-game UI overlay, starting with the hub screen.
 * Called after the player has chosen a game via the main menu.
 *
 * Mounts the persistent top bar (visible on all screens), then the hub.
 *
 * @param {HTMLElement} container  The #ui-overlay div from index.html.
 * @param {import('../core/gameState.js').GameState} state
 */
export function initUI(container, state) {
  _container = container;
  _vabInitialized     = false;
  _crewAdminOpen      = false;
  _missionControlOpen = false;
  _launchPadOpen      = false;
  // Ensure a fresh VAB assembly for each new game session.
  resetVabUI();
  hideVabScene(); // ensure VAB PixiJS is hidden when starting a new session

  // Mount the persistent top bar — visible on all in-game screens.
  initTopBar(container, state, {
    onExitToMenu: () => _handleExitToMenu(),
  });

  initHubUI(container, state, (destination) => {
    _handleNavigation(container, state, destination);
  });

  console.log('[UI] Hub overlay initialized');
}

// ---------------------------------------------------------------------------
// Private — exit to menu handler
// ---------------------------------------------------------------------------

/**
 * Tear down all in-game UI and re-show the main menu.
 * Called when the player chooses "Exit to Menu" or "Load Game" from the
 * hamburger dropdown in the top bar.
 */
function _handleExitToMenu() {
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

  // Wipe any remaining screen overlays from the container.
  if (_container) {
    _container.innerHTML = '';
  }
  _vabInitialized = false;

  // Re-show the main menu.  onGameReady wires up a fresh game session.
  if (_container) {
    showMainMenu(_container, (newState) => {
      // Keep window.__gameState in sync for e2e test access.
      if (typeof window !== 'undefined') {
        window.__gameState = newState;
      }
      initUI(_container, newState);
    });
  }

  console.log('[UI] Exited to main menu');
}

// ---------------------------------------------------------------------------
// Private — navigation handler
// ---------------------------------------------------------------------------

/**
 * Handle a navigation request from the hub.
 *
 * @param {HTMLElement} container
 * @param {import('../core/gameState.js').GameState} state
 * @param {string} destination  Building ID: 'vab' | 'mission-control' | 'crew-admin' | 'launch-pad'
 */
function _handleNavigation(container, state, destination) {
  if (destination === 'vab') {
    // Tear down the hub overlay and show the VAB.
    destroyHubUI();
    showVabScene();

    if (!_vabInitialized) {
      initVabUI(container, state, {
        onBack: () => {
          // Remove the VAB overlay and return to the hub.
          const vabRoot = document.getElementById('vab-root');
          if (vabRoot) vabRoot.remove();
          _vabInitialized = false;
          hideVabScene();
          showHubScene();
          refreshTopBar();
          initHubUI(container, state, (dest) => {
            _handleNavigation(container, state, dest);
          });
          console.log('[UI] Returned to hub from VAB');
        },
      });
      _vabInitialized = true;
    }

    console.log('[UI] Navigated to VAB');
    return;
  }

  if (destination === 'crew-admin') {
    // Tear down the hub overlay and show the Crew Admin screen.
    destroyHubUI();

    if (!_crewAdminOpen) {
      initCrewAdminUI(container, state, {
        onBack: () => {
          // Crew Admin has already destroyed itself; re-show the hub.
          _crewAdminOpen = false;
          showHubScene();
          initHubUI(container, state, (dest) => {
            _handleNavigation(container, state, dest);
          });
          console.log('[UI] Returned to hub from Crew Admin');
        },
      });
      _crewAdminOpen = true;
    }

    console.log('[UI] Navigated to Crew Admin');
    return;
  }

  if (destination === 'mission-control') {
    // Tear down the hub overlay and show the Mission Control screen.
    destroyHubUI();

    if (!_missionControlOpen) {
      initMissionControlUI(container, state, {
        onBack: () => {
          // Mission Control has already destroyed itself; re-show the hub.
          _missionControlOpen = false;
          showHubScene();
          initHubUI(container, state, (dest) => {
            _handleNavigation(container, state, dest);
          });
          console.log('[UI] Returned to hub from Mission Control');
        },
      });
      _missionControlOpen = true;
    }

    console.log('[UI] Navigated to Mission Control');
    return;
  }

  if (destination === 'launch-pad') {
    // Tear down the hub overlay and show the Launch Pad screen.
    destroyHubUI();

    if (!_launchPadOpen) {
      initLaunchPadUI(container, state, {
        onBack: () => {
          // Launch Pad has already destroyed itself; re-show the hub.
          _launchPadOpen = false;
          showHubScene();
          initHubUI(container, state, (dest) => {
            _handleNavigation(container, state, dest);
          });
          console.log('[UI] Returned to hub from Launch Pad');
        },
      });
      _launchPadOpen = true;
    }

    console.log('[UI] Navigated to Launch Pad');
    return;
  }

  if (destination === 'satellite-ops') {
    // Tear down the hub overlay and show the Satellite Ops screen.
    destroyHubUI();

    if (!_satelliteOpsOpen) {
      initSatelliteOpsUI(container, state, {
        onBack: () => {
          _satelliteOpsOpen = false;
          showHubScene();
          initHubUI(container, state, (dest) => {
            _handleNavigation(container, state, dest);
          });
          console.log('[UI] Returned to hub from Satellite Ops');
        },
      });
      _satelliteOpsOpen = true;
    }

    console.log('[UI] Navigated to Satellite Ops');
    return;
  }

  if (destination === 'tracking-station') {
    // Tear down the hub overlay and show the Tracking Station screen.
    destroyHubUI();

    if (!_trackingStationOpen) {
      initTrackingStationUI(container, state, {
        onBack: () => {
          _trackingStationOpen = false;
          showHubScene();
          initHubUI(container, state, (dest) => {
            _handleNavigation(container, state, dest);
          });
          console.log('[UI] Returned to hub from Tracking Station');
        },
      });
      _trackingStationOpen = true;
    }

    console.log('[UI] Navigated to Tracking Station');
    return;
  }

  // Other building screens are not yet implemented.
  console.log(`[UI] Navigation to '${destination}' is not yet implemented.`);
}
