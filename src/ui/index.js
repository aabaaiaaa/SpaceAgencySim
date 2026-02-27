// HTML overlay UI.
// Renders HUD elements, menus, dialogs, and panels as DOM nodes layered
// above the PixiJS canvas.  Individual panels enable pointer-events as needed;
// the root overlay container keeps pointer-events:none so clicks pass through
// to the canvas by default.

import { initMainMenu } from './mainmenu.js';
import { initHubUI, destroyHubUI } from './hub.js';
import { initVabUI } from './vab.js';
import { initTopBar, destroyTopBar } from './topbar.js';
import { showVabScene } from '../render/vab.js';

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
  _vabInitialized = false;

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
  destroyTopBar();
  destroyHubUI(); // no-op if hub is not the current screen

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
      initVabUI(container, state);
      _vabInitialized = true;
    }

    console.log('[UI] Navigated to VAB');
    return;
  }

  // Other building screens are not yet implemented (TASK-011, TASK-014, etc.).
  console.log(`[UI] Navigation to '${destination}' is not yet implemented.`);
}
