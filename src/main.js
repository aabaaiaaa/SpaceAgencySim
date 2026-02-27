// Space Agency Simulation Game — entry point
// Bootstraps the renderer and UI overlay on top of the canvas element.
// Core game logic (src/core/) is kept free of DOM/canvas dependencies so it
// can be exercised by headless Vitest tests without a browser environment.

import { initRenderer } from './render/index.js';
import { initVabRenderer } from './render/vab.js';
import { showMainMenu, initUI } from './ui/index.js';

async function main() {
  console.log('[SpaceAgencySim] Starting...');

  const canvas    = document.getElementById('game-canvas');
  const uiOverlay = document.getElementById('ui-overlay');

  // ── Rendering ──────────────────────────────────────────────────────────
  // Initialize PixiJS (async — creates WebGL context).
  await initRenderer(canvas);

  // Initialize the VAB scene (grid, camera) — canvas is ready but hidden
  // behind the main menu until the player starts or loads a game.
  initVabRenderer();

  // ── Main menu ──────────────────────────────────────────────────────────
  // Show the load screen / new-game screen.  The menu calls onGameReady
  // once the player has chosen a game to play.
  showMainMenu(uiOverlay, (state) => {
    // Expose for e2e testing (Playwright can read/verify game state).
    window.__gameState = state;

    // Boot the in-game UI overlay (VAB chrome, toolbar, panels, etc.).
    initUI(uiOverlay, state);

    console.log('[SpaceAgencySim] Ready. Agency:', state.agencyName || '(unnamed)');
  });
}

main().catch((err) => {
  console.error('[SpaceAgencySim] Fatal startup error:', err);
});
