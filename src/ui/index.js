// HTML overlay UI.
// Renders HUD elements, menus, dialogs, and panels as DOM nodes layered
// above the PixiJS canvas.  Individual panels enable pointer-events as needed;
// the root overlay container keeps pointer-events:none so clicks pass through
// to the canvas by default.

import { initMainMenu } from './mainmenu.js';
import { initHubUI, destroyHubUI } from './hub.js';
import { initVabUI } from './vab.js';
import { showVabScene } from '../render/vab.js';

// ---------------------------------------------------------------------------
// Screen routing state
// ---------------------------------------------------------------------------

/**
 * True once the VAB HTML overlay has been initialised for this game session.
 * Prevents re-creating the overlay if the player returns to the VAB from the
 * hub later (once TASK-009/TASK-044 add back navigation).
 */
let _vabInitialized = false;

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
 * @param {HTMLElement} container  The #ui-overlay div from index.html.
 * @param {import('../core/gameState.js').GameState} state
 */
export function initUI(container, state) {
  // Reset per-session flags.
  _vabInitialized = false;

  initHubUI(container, state, (destination) => {
    _handleNavigation(container, state, destination);
  });

  console.log('[UI] Hub overlay initialized');
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
