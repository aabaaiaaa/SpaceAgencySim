// Space Agency Simulation Game — entry point
// Bootstraps the renderer and UI overlay on top of the canvas element.
// Core game logic (src/core/) is kept free of DOM/canvas dependencies so it
// can be exercised by headless Vitest tests without a browser environment.

import { initRenderer } from './render/index.js';
import { initVabRenderer } from './render/vab.js';
import { initUI } from './ui/index.js';
import { createGameState } from './core/gameState.js';
import { initializeMissions } from './core/missions.js';
import { getAllParts } from './data/parts.js';

async function main() {
  console.log('[SpaceAgencySim] Starting...');

  const canvas    = document.getElementById('game-canvas');
  const uiOverlay = document.getElementById('ui-overlay');

  // ── Game state ─────────────────────────────────────────────────────────
  const state = createGameState();
  // Expose for e2e testing (Playwright can read/verify game state)
  window.__gameState = state;

  // Seed the mission board with tutorial missions.
  initializeMissions(state);

  // Development: unlock all parts so the parts panel is fully populated.
  // In a shipped game this is driven incrementally by mission rewards.
  state.parts = getAllParts().map((p) => p.id);

  // ── Rendering ─────────────────────────────────────────────────────────
  // Initialize PixiJS (async — creates WebGL context).
  await initRenderer(canvas);

  // Initialize the VAB scene (grid, camera).
  initVabRenderer();

  // ── UI overlay ─────────────────────────────────────────────────────────
  initUI(uiOverlay, state);

  console.log('[SpaceAgencySim] Ready.');
}

main().catch((err) => {
  console.error('[SpaceAgencySim] Fatal startup error:', err);
});
