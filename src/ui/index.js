// HTML overlay UI.
// Renders HUD elements, menus, dialogs, and panels as DOM nodes layered
// above the PixiJS canvas.  Individual panels enable pointer-events as needed;
// the root overlay container keeps pointer-events:none so clicks pass through
// to the canvas by default.

import { initMainMenu } from './mainmenu.js';
import { initVabUI } from './vab.js';

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
  initMainMenu(container, onGameReady);
  console.log('[UI] Main menu displayed');
}

/**
 * Initialize the in-game UI overlay (VAB, HUD, etc.).
 * Called after the player has chosen a game via the main menu.
 *
 * @param {HTMLElement} container  The #ui-overlay div from index.html.
 * @param {import('../core/gameState.js').GameState} state
 */
export function initUI(container, state) {
  initVabUI(container, state);
  console.log('[UI] Overlay initialized');
}
