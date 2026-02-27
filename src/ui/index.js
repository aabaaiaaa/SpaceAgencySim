// HTML overlay UI.
// Renders HUD elements, menus, dialogs, and panels as DOM nodes layered
// above the PixiJS canvas.  Individual panels enable pointer-events as needed;
// the root overlay container keeps pointer-events:none so clicks pass through
// to the canvas by default.

import { initVabUI } from './vab.js';

/**
 * Initialize the UI overlay container.
 * @param {HTMLElement} container  The #ui-overlay div from index.html.
 * @param {import('../core/gameState.js').GameState} state
 */
export function initUI(container, state) {
  initVabUI(container, state);
  console.log('[UI] Overlay initialized');
}
