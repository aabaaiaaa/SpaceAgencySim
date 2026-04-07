// Space Agency Simulation Game — entry point
// Bootstraps the renderer and UI overlay on top of the canvas element.
// Core game logic (src/core/) is kept free of DOM/canvas dependencies so it
// can be exercised by headless Vitest tests without a browser environment.

import { initRenderer } from './render/index.ts';
import { initVabRenderer } from './render/vab.ts';
import { initHubRenderer } from './render/hub.ts';
import { showMainMenu, initUI, returnToHubFromFlight } from './ui/index.ts';
import { buildTestRocket } from './core/testFlightBuilder.ts';
import { startFlightScene, stopFlightScene } from './ui/flightController.ts';
import { createFlightState } from './core/gameState.ts';
import type { GameState, FlightState } from './core/gameState.ts';
import type { RocketAssembly } from './core/rocketbuilder.ts';
import type { PhysicsState } from './core/physics.ts';
import type { CelestialBodyDef } from './data/bodies.ts';
import type { CelestialBody } from './core/constants.ts';
import { setMalfunctionMode } from './core/malfunction.ts';
import { plantFlag, collectSurfaceSample, deploySurfaceInstrument, deployBeacon, processSurfaceOps, processSampleReturns, areSurfaceItemsVisible } from './core/surfaceOps.ts';
import { checkAchievements } from './core/achievements.ts';
import type { AchievementCheckContext } from './core/achievements.ts';
import { computeTransferDeltaV } from './core/manoeuvre.ts';
import { CELESTIAL_BODIES, isLandable } from './data/bodies.ts';
import { getPartById } from './data/parts.ts';
import { autoSaveImmediate } from './ui/autoSaveToast.ts';
import { isAutoSaveEnabled, AUTO_SAVE_KEY } from './core/autoSave.ts';
import { logger } from './core/logger.ts';

// E2E test API options for programmatic flight launches.
interface E2eFlightOpts {
  instruments?: Record<string, string[]>;
  staging?: Array<{ partIds: string[] }>;
  missionId?: string;
  crewIds?: string[];
  bodyId?: string;
  malfunctionMode?: string;
}

// Window augmentation for E2E test globals exposed by main.ts.
declare global {
  interface Window {
    __gameState: GameState;
    __e2eStartFlight: (partIds: string[], opts?: E2eFlightOpts) => void;
    __plantFlag: () => ReturnType<typeof plantFlag>;
    __collectSample: () => ReturnType<typeof collectSurfaceSample>;
    __deployInstrument: () => ReturnType<typeof deploySurfaceInstrument>;
    __deployBeacon: (name: string) => ReturnType<typeof deployBeacon>;
    __processSurfaceOps: () => { scienceEarned: number };
    __processSampleReturns: (bodyId: string) => ReturnType<typeof processSampleReturns>;
    __areSurfaceItemsVisible: (bodyId: string) => boolean;
    __checkAchievements: (ctx: unknown) => ReturnType<typeof checkAchievements>;
    __computeTransferDeltaV: (from: string, to: string, alt: number) => ReturnType<typeof computeTransferDeltaV>;
    __celestialBodies: Readonly<Record<string, Readonly<CelestialBodyDef>>>;
    __isLandable: (bodyId: string) => boolean;
    __getPartById: (id: string) => unknown;
    __autoSaveImmediate: () => Promise<{ success: boolean; error?: string }>;
    __isAutoSaveEnabled: () => boolean;
    __autoSaveKey: string;
    __enableDebugMode: () => void;
  }
}

async function main() {
  logger.debug('app', 'Game starting');
  const canvas    = document.getElementById('game-canvas') as HTMLCanvasElement;
  const uiOverlay = document.getElementById('ui-overlay')!;

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
    window.__e2eStartFlight = (partIds: string[], opts: E2eFlightOpts = {}) => {
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

      // Custom staging override: opts.staging is an array of { partIds: string[] }.
      // Each entry becomes a stage (fired in order by Space key).
      // Parts not listed in any stage go to unstaged.
      // e.g. [{ partIds: ['engine-spark'] }, { partIds: ['parachute-mk1'] }]
      if (opts.staging) {
        stagingConfig.stages = [];
        stagingConfig.unstaged = [];
        const staged = new Set<string>();
        for (const stageSpec of opts.staging) {
          const instanceIds: string[] = [];
          for (const partId of stageSpec.partIds) {
            for (const [instanceId, placed] of assembly.parts) {
              if (placed.partId === partId && !staged.has(instanceId)) {
                instanceIds.push(instanceId);
                staged.add(instanceId);
                break;
              }
            }
          }
          stagingConfig.stages.push({ instanceIds });
        }
        for (const [instanceId] of assembly.parts) {
          if (!staged.has(instanceId)) {
            stagingConfig.unstaged.push(instanceId);
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
        bodyId:    (opts.bodyId ?? 'EARTH') as CelestialBody,
      });
      state.currentFlight = flightState;

      // Disable malfunctions by default for deterministic tests.
      if (opts.malfunctionMode !== undefined) {
        setMalfunctionMode(state, opts.malfunctionMode);
      } else {
        setMalfunctionMode(state, 'off');
      }

      startFlightScene(
        uiOverlay,
        state,
        assembly,
        stagingConfig,
        flightState,
        (_s, returnResults) => {
          returnToHubFromFlight(uiOverlay, state, returnResults);
        },
      );
    };

    // ── Phase 6 E2E test APIs ──────────────────────────────────────────────
    // Surface operations.
    window.__plantFlag = () => {
      const fs = state.currentFlight!;
      const ps = window.__flightPs!;
      return plantFlag(state, fs, ps);
    };
    window.__collectSample = () => {
      const fs = state.currentFlight!;
      const ps = window.__flightPs!;
      return collectSurfaceSample(state, fs, ps);
    };
    window.__deployInstrument = () => {
      const fs = state.currentFlight!;
      const ps = window.__flightPs!;
      const assembly = window.__flightAssembly!;
      return deploySurfaceInstrument(state, fs, ps, assembly);
    };
    window.__deployBeacon = (name: string) => {
      const fs = state.currentFlight!;
      const ps = window.__flightPs!;
      return deployBeacon(state, fs, ps, name);
    };
    window.__processSurfaceOps = () => processSurfaceOps(state);
    window.__processSampleReturns = (bodyId: string) => processSampleReturns(state, bodyId);
    window.__areSurfaceItemsVisible = (bodyId: string) => areSurfaceItemsVisible(state, bodyId);

    // Achievements.
    window.__checkAchievements = (ctx: unknown) => checkAchievements(state, ctx as AchievementCheckContext);

    // Transfer delta-v.
    window.__computeTransferDeltaV = (from: string, to: string, alt: number) => computeTransferDeltaV(from, to, alt);

    // Celestial body data.
    window.__celestialBodies = CELESTIAL_BODIES;
    window.__isLandable = isLandable;

    // Part lookup.
    window.__getPartById = (id: string) => {
      const p = getPartById(id);
      return p ? JSON.parse(JSON.stringify(p)) : null;
    };

    // Auto-save E2E helpers.
    window.__autoSaveImmediate = () => autoSaveImmediate(state);
    window.__isAutoSaveEnabled = () => isAutoSaveEnabled(state);
    window.__autoSaveKey = AUTO_SAVE_KEY;

    // Debug mode E2E helper.
    window.__enableDebugMode = () => { state.debugMode = true; };

  });
}

main().catch((err) => {
  logger.error('app', 'Fatal startup error', { error: String(err) });
});
