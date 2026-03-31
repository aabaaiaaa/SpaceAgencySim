// Space Agency Simulation Game — entry point
// Bootstraps the renderer and UI overlay on top of the canvas element.
// Core game logic (src/core/) is kept free of DOM/canvas dependencies so it
// can be exercised by headless Vitest tests without a browser environment.

import { initRenderer } from './render/index.js';
import { initVabRenderer } from './render/vab.js';
import { initHubRenderer } from './render/hub.js';
import { showMainMenu, initUI } from './ui/index.js';
import { buildTestRocket } from './core/testFlightBuilder.js';
import { startFlightScene, stopFlightScene } from './ui/flightController.js';
import { createFlightState } from './core/gameState.js';
import { setMalfunctionMode } from './core/malfunction.js';

async function main() {
  console.log('[SpaceAgencySim] Starting...');

  const canvas    = document.getElementById('game-canvas');
  const uiOverlay = document.getElementById('ui-overlay');

  // ── Rendering ──────────────────────────────────────────────────────────
  // Initialize PixiJS (async — creates WebGL context).
  await initRenderer(canvas);

  // Initialize the VAB scene (grid, camera) — hidden behind the hub until
  // the player navigates to the Vehicle Assembly Building.
  initVabRenderer();

  // Initialize the hub scene — shown when a game starts or is loaded.
  initHubRenderer();

  // ── Main menu ──────────────────────────────────────────────────────────
  // Show the load screen / new-game screen.  The menu calls onGameReady
  // once the player has chosen a game to play.
  showMainMenu(uiOverlay, (state) => {
    // Expose for e2e testing (Playwright can read/verify game state).
    window.__gameState = state;

    // Boot the in-game UI overlay (VAB chrome, toolbar, panels, etc.).
    initUI(uiOverlay, state);

    // ── E2E test API ──────────────────────────────────────────────────────
    // Expose a programmatic flight launcher for E2E tests.
    // Bypasses the VAB UI by building a rocket from part IDs and starting
    // the flight scene directly.
    //
    //   window.__e2eStartFlight(['probe-core-mk1', 'tank-small', 'engine-spark'])
    //
    window.__e2eStartFlight = (partIds, opts = {}) => {
      const { assembly, stagingConfig } = buildTestRocket(partIds);

      // Load instruments into science modules if specified.
      // opts.instruments is a map of part catalog ID → instrument ID array.
      // e.g. { 'science-module-mk1': ['thermometer-mk1', 'barometer'] }
      if (opts.instruments) {
        for (const [instanceId, placed] of assembly.parts) {
          const instrumentList = opts.instruments[placed.partId];
          if (instrumentList) {
            placed.instruments = [...instrumentList];
          }
        }
      }

      const missionId = opts.missionId
        ?? state.missions?.accepted?.[0]?.id
        ?? '';
      const flightState = createFlightState({
        missionId,
        rocketId:  'e2e-test-rocket',
        crewIds:   opts.crewIds ?? [],
        bodyId:    opts.bodyId ?? 'EARTH',
      });
      state.currentFlight = flightState;

      // Disable malfunctions by default for deterministic tests.
      if (opts.malfunctionMode !== undefined) {
        setMalfunctionMode(opts.malfunctionMode);
      } else {
        setMalfunctionMode('off');
      }

      startFlightScene(
        uiOverlay,
        state,
        assembly,
        stagingConfig,
        flightState,
        () => { /* no-op end callback for test flights */ },
      );
    };

    console.log('[SpaceAgencySim] Ready. Agency:', state.agencyName || '(unnamed)');
  });
}

main().catch((err) => {
  console.error('[SpaceAgencySim] Fatal startup error:', err);
});
