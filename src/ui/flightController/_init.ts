/**
 * _init.ts — Orchestrator containing startFlightScene and stopFlightScene.
 * Imports from all sub-modules and wires everything together.
 *
 * @module ui/flightController/_init
 */

import { initFlightRenderer, destroyFlightRenderer, setFlightWeather } from '../../render/flight.js';
import { hideHubScene } from '../../render/hub.js';
import { initMapRenderer, destroyMapRenderer } from '../../render/map.js';
import { createPhysicsState } from '../../core/physics.js';
import { initFlightHud, destroyFlightHud, showLaunchTip } from '../flightHud.js';
import { initFlightContextMenu, destroyFlightContextMenu } from '../flightContextMenu.js';
import { setTopBarFlightItems, clearTopBarFlightItems, clearTopBarHubItems, setTopBarDropdownToggleCallback, setCurrentScreen } from '../topbar.js';
import { setMalfunctionMode, getMalfunctionMode } from '../../core/malfunction.js';
import { createDockingState } from '../../core/docking.js';
import { getPartById } from '../../data/parts.js';
import { getVabInventoryUsedParts } from '../vab.js';
import { getFCState, resetFCState } from './_state.js';
import './flightController.css';
import { onKeyDown, onKeyUp } from './_keyboard.js';
import { onTimeWarpButtonClick } from './_timeWarp.js';
import { onSurfaceAction } from './_surfaceActions.js';
import { destroyMapHud } from './_mapView.js';
import { destroyDockingHud } from './_docking.js';
import { loop } from './_loop.js';
import { initFpsMonitor, showFpsMonitor, hideFpsMonitor, destroyFpsMonitor } from '../fpsMonitor.js';
import {
  handleMenuRestart,
  handleMenuAdjustBuild,
  handleMenuReturnToAgency,
  handleAbortReturnToAgency,
  handleMenuFlightLog,
} from './_menuActions.js';
import { logger } from '../../core/logger.js';
import { initPhysicsWorker, resyncWorkerState, terminatePhysicsWorker } from './_workerBridge.js';

import type { PhysicsState } from '../../core/physics.js';
import type { RocketAssembly, StagingConfig, PlacedPart } from '../../core/rocketbuilder.js';
import type { GameState, FlightState } from '../../core/gameState.js';

// E2E test globals attached to window.
declare global {
  interface Window {
    __flightPs: PhysicsState | null;
    __flightAssembly: RocketAssembly | null;
    __flightState: FlightState | null;
    __setMalfunctionMode: ((mode: string) => void) | undefined;
    __getMalfunctionMode: (() => string) | undefined;
    __testSetTimeWarp: ((speedMultiplier: number) => void) | undefined;
    __testGetTimeWarp: (() => number) | undefined;
    /** Re-sync the physics worker with the current main-thread state. */
    __resyncPhysicsWorker: (() => Promise<void>) | undefined;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a shallow copy of `assembly` where every part's Y position is shifted
 * so the lowest part's bottom edge sits exactly at world Y = 0 (the launch pad).
 */
function _normalizeAssemblyToGround(assembly: RocketAssembly): RocketAssembly {
  let lowestBottom = Infinity;
  for (const placed of assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (!def) continue;
    lowestBottom = Math.min(lowestBottom, placed.y - def.height / 2);
  }

  if (!isFinite(lowestBottom) || lowestBottom === 0) return assembly;

  const normalizedParts = new Map<string, PlacedPart>();
  for (const [id, placed] of assembly.parts) {
    normalizedParts.set(id, { ...placed, y: placed.y - lowestBottom });
  }
  return { ...assembly, parts: normalizedParts };
}

/**
 * Build the in-flight control overlay.
 */
function _buildFlightOverlay(container: HTMLElement): void {
  const overlay: HTMLDivElement = document.createElement('div');
  overlay.id = 'flight-overlay';
  const s = getFCState();
  s.flightOverlay = overlay;
  container.appendChild(overlay);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Start the flight scene.
 *
 * Initialises the PixiJS renderer, creates the physics state, mounts the HUD
 * overlay, builds the in-flight control overlay, and starts the game loop.
 */
export function startFlightScene(
  container: HTMLElement,
  state: GameState,
  assembly: RocketAssembly,
  stagingConfig: StagingConfig,
  flightState: FlightState,
  onFlightEnd: (state: GameState | null, results?: unknown, dest?: string) => void,
): void {
  logger.debug('flight', 'Starting flight scene', { missionId: flightState.missionId, bodyId: flightState.bodyId });
  const s = getFCState();

  // Ensure hub overlay is fully hidden during flight. In the normal gameplay
  // flow the hub is destroyed before reaching here, but programmatic flights
  // (E2E test API) may skip that step.
  const hubOverlay = document.getElementById('hub-overlay');
  if (hubOverlay) hubOverlay.remove();
  hideHubScene();
  clearTopBarHubItems();

  s.container     = container;
  s.state         = state;
  s.assembly      = _normalizeAssemblyToGround(assembly);
  s.stagingConfig = stagingConfig;
  s.flightState   = flightState;
  s.onFlightEnd   = onFlightEnd;

  // Guarantee staging starts at Stage 1 regardless of prior flight state.
  s.stagingConfig.currentStageIdx = 0;

  // Deep-clone the pre-normalisation assembly and staging config so "Restart
  // from Launch" can re-create a pristine flight without returning to the VAB.
  s.originalAssembly = {
    parts:         new Map([...assembly.parts].map(([id, p]) => [id, { ...p, ...(p.instruments ? { instruments: [...p.instruments] } : {}) }])),
    connections:   assembly.connections.map(c => ({ ...c })),
    symmetryPairs: assembly.symmetryPairs.map(sp => [...sp] as [string, string]),
    _nextId:       assembly._nextId,
  };
  s.originalStagingConfig = {
    stages:          stagingConfig.stages.map(st => ({ instanceIds: [...st.instanceIds] })),
    unstaged:        [...stagingConfig.unstaged],
    currentStageIdx: 0,
  };

  // Reset time-warp and summary state.
  s.timeWarp            = 1;
  s.stagingLockoutUntil = 0;
  s.prevAltitude        = 0;
  s.prevInSpace         = false;
  s.summaryShown        = false;

  // Create the physics state from the (normalised) assembly and initial flight state.
  s.ps = createPhysicsState(s.assembly, flightState);

  // Store a reference to the top-level game state so the malfunction system
  // can look up crew engineering skills during reliability checks.
  s.ps._gameState = s.state;

  // Apply weather effects (temperature -> ISP, visibility -> fog/haze).
  if (s.state.weather?.current) {
    const w = s.state.weather.current;
    if (w.temperature != null) s.ps.weatherIspModifier = w.temperature;
    setFlightWeather(w.visibility ?? 0);
  }

  // Attach inventory-sourced part data for wear tracking on recovery.
  (s.ps as any)._usedInventoryParts = getVabInventoryUsedParts();

  // Expose for E2E testing -- Playwright reads live physics values here.
  if (typeof window !== 'undefined') {
    window.__flightPs       = s.ps;
    window.__flightAssembly = s.assembly;
    window.__flightState    = flightState;
    window.__setMalfunctionMode = (mode: string) => setMalfunctionMode(s.state!, mode);
    window.__getMalfunctionMode = () => getMalfunctionMode(s.state!);

    // Programmatic time warp API for E2E tests -- allows arbitrary multipliers
    // not limited to the player-facing warp level buttons.
    window.__testSetTimeWarp = (speedMultiplier: number) => {
      s.timeWarp = speedMultiplier;
    };
    window.__testGetTimeWarp = () => s.timeWarp;

    // Re-sync API: after E2E helpers directly modify __flightPs / __flightState
    // (e.g. teleportCraft), call this to push the updated state to the worker.
    window.__resyncPhysicsWorker = async () => {
      const st = getFCState();
      if (st.workerActive && st.ps && st.assembly && st.stagingConfig && st.flightState) {
        await resyncWorkerState(st.ps, st.assembly, st.stagingConfig, st.flightState);
      }
    };
  }

  // Boot the PixiJS flight renderer.
  initFlightRenderer();

  // Mount the HUD overlay.
  initFlightHud(container, s.ps, s.assembly, stagingConfig, flightState, state, onTimeWarpButtonClick, onSurfaceAction, handleAbortReturnToAgency);

  // Initialise the FPS monitor (visible only when debug mode is on).
  initFpsMonitor();
  if (state.debugMode) showFpsMonitor();
  else hideFpsMonitor();

  // Build the in-flight control overlay.
  _buildFlightOverlay(container);

  // Mark current screen as flight for help panel context.
  setCurrentScreen('flight');

  // Inject flight-action items into the topbar hamburger dropdown.
  setTopBarFlightItems([
    {
      label: 'Restart from Launch',
      title: 'Restart this flight from the launch pad with the same rocket and staging.',
      onClick: handleMenuRestart,
    },
    {
      label: 'Adjust Build',
      title: 'Return to the Vehicle Assembly Building with this rocket loaded so you can tweak and re-launch.',
      onClick: handleMenuAdjustBuild,
    },
    {
      label: 'Return to Space Agency',
      title: 'End this flight and return to your Space Agency hub.',
      onClick: handleMenuReturnToAgency,
    },
    {
      label: 'Flight Log',
      title: 'View a log of all flight events.',
      onClick: handleMenuFlightLog,
    },
  ]);

  // Pause physics while the hamburger dropdown is open.
  setTopBarDropdownToggleCallback((isOpen: boolean) => {
    const st = getFCState();
    if (isOpen) {
      st.preMenuTimeWarp = st.timeWarp;
      st.timeWarp = 0;
    } else {
      st.timeWarp = st.preMenuTimeWarp ?? 1;
    }
  });

  // Show the launch pad tip if the rocket hasn't launched yet.
  showLaunchTip();

  // Initialise the map renderer (hidden by default).
  s.mapActive    = false;
  s.mapHeldKeys  = new Set();
  s.mapThrusting = false;
  s.mapHud       = null;
  s.normalOrbitHeldKeys  = new Set();
  s.normalOrbitThrusting = false;
  initMapRenderer();

  // Initialise the docking system state on the flight state.
  if (!s.flightState.dockingState) {
    s.flightState.dockingState = createDockingState();
  }
  s.dockingHud = null;

  // Initialise the right-click part context menu.
  initFlightContextMenu(
    () => getFCState().ps,
    () => getFCState().assembly,
    () => getFCState().flightState,
  );

  // Bind keyboard handlers.
  s.keydownHandler = onKeyDown;
  s.keyupHandler   = onKeyUp;
  window.addEventListener('keydown', s.keydownHandler);
  window.addEventListener('keyup',   s.keyupHandler);

  // Start the render + physics loop.
  s.lastTs = performance.now();
  s.rafId  = requestAnimationFrame(loop);

  // Initialise the physics worker if the setting is enabled.
  if (state.useWorkerPhysics !== false && typeof Worker !== 'undefined') {
    initPhysicsWorker(s.ps, s.assembly, s.stagingConfig, flightState)
      .then(() => {
        // The worker loaded with the initial state, but the main-thread may
        // have advanced physics or processed staging while the worker was
        // loading.  Re-init the worker with the CURRENT state so it starts
        // from the exact same point as the main-thread.
        const current = getFCState();
        if (current.ps && current.assembly && current.stagingConfig && current.flightState) {
          return resyncWorkerState(current.ps, current.assembly, current.stagingConfig, current.flightState);
        }
      })
      .then(() => {
        // Mark worker as active — the loop will use it from the next frame.
        const current = getFCState();
        if (current.ps && current.assembly) {
          current.workerActive = true;
          logger.debug('flight', 'Physics worker initialised and active');
        }
      })
      .catch((err) => {
        // Worker failed to initialise — continue with main-thread physics.
        logger.warn('flight', 'Physics worker failed to initialise, using main-thread physics', { error: String(err) });
      });
  }

}

/**
 * Tear down the flight scene: stops the loop, destroys the HUD and renderer,
 * removes the control overlay, and clears all module state.
 *
 * Safe to call even if startFlightScene was never called.
 */
export function stopFlightScene(): void {
  logger.debug('flight', 'Stopping flight scene');
  const s = getFCState();

  if (s.rafId !== null) {
    cancelAnimationFrame(s.rafId);
    s.rafId = null;
  }

  // Terminate the physics worker if it was active.
  if (s.workerActive) {
    terminatePhysicsWorker();
    s.workerActive = false;
  }

  if (s.keydownHandler) {
    window.removeEventListener('keydown', s.keydownHandler);
    s.keydownHandler = null;
  }
  if (s.keyupHandler) {
    window.removeEventListener('keyup', s.keyupHandler);
    s.keyupHandler = null;
  }

  destroyFpsMonitor();
  destroyFlightHud();
  destroyFlightContextMenu();
  destroyDockingHud();
  destroyMapHud();
  destroyMapRenderer();
  destroyFlightRenderer();
  clearTopBarFlightItems();

  if (s.flightOverlay) {
    s.flightOverlay.remove();
    s.flightOverlay = null;
  }

  if (typeof window !== 'undefined') {
    window.__flightPs       = null;
    window.__flightAssembly = null;
    window.__flightState    = null;
    window.__testSetTimeWarp = undefined;
    window.__testGetTimeWarp = undefined;
    window.__resyncPhysicsWorker = undefined;
  }

  // Reset all state.
  resetFCState();


}
