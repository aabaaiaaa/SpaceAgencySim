// Space Agency Simulation Game — entry point
// Bootstraps the renderer and UI overlay on top of the canvas element.
// Core game logic (src/core/) is kept free of DOM/canvas dependencies so it
// can be exercised by headless Vitest tests without a browser environment.

import { initRenderer } from './render/index.js';
import { initUI } from './ui/index.js';

async function main() {
  console.log('[SpaceAgencySim] Starting...');

  const canvas = document.getElementById('game-canvas');
  const uiOverlay = document.getElementById('ui-overlay');

  // Initialize PixiJS renderer first (async — loads WebGL context)
  await initRenderer(canvas);

  // Mount HTML overlay UI on top of the canvas
  initUI(uiOverlay);

  console.log('[SpaceAgencySim] Ready.');
}

main().catch((err) => {
  console.error('[SpaceAgencySim] Fatal startup error:', err);
});
