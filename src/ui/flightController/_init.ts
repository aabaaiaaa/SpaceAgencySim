/**
 * _init.ts — Orchestrator containing startFlightScene and stopFlightScene.
 * Imports from all sub-modules and wires everything together.
 *
 * @module ui/flightController/_init
 */

import { initFlightRenderer, destroyFlightRenderer, setFlightWeather } from '../../render/flight.ts';
import { hideHubScene } from '../../render/hub.ts';
import { initMapRenderer, destroyMapRenderer } from '../../render/map.ts';
import { createPhysicsState } from '../../core/physics.ts';
import { initFlightHud, destroyFlightHud, showLaunchTip } from '../flightHud.ts';
import { initFlightContextMenu, destroyFlightContextMenu } from '../flightContextMenu.ts';
import { setTopBarFlightItems, clearTopBarFlightItems, clearTopBarHubItems, setTopBarDropdownToggleCallback, setCurrentScreen } from '../topbar.ts';
import { setMalfunctionMode, getMalfunctionMode } from '../../core/malfunction.ts';
import { addTransferObject as addTransferObjectFn, getProximityObjects as getProximityObjectsFn } from '../../core/transferObjects.ts';
import type { TransferObject as TransferObjectArg } from '../../core/transferObjects.ts';
import { createDockingState } from '../../core/docking.ts';
import { getPartById } from '../../data/parts.ts';
import { getVabInventoryUsedParts } from '../vab.ts';
import { getFCState, resetFCState, getPhysicsState, setPhysicsState, getFlightState, setFlightState } from './_state.ts';
import './flightController.css';
import { onKeyDown, onKeyUp } from './_keyboard.ts';
import { onTimeWarpButtonClick } from './_timeWarp.ts';
import { onSurfaceAction } from './_surfaceActions.ts';
import { destroyMapHud } from './_mapView.ts';
import { destroyDockingHud } from './_docking.ts';
import { loop } from './_loop.ts';
import { initFpsMonitor, showFpsMonitor, hideFpsMonitor, destroyFpsMonitor } from '../fpsMonitor.ts';
import { showPerfDashboard, hidePerfDashboard, destroyPerfDashboard } from '../perfDashboard.ts';
import {
  handleMenuRestart,
  handleMenuAdjustBuild,
  handleMenuReturnToAgency,
  handleAbortReturnToAgency,
  handleMenuFlightLog,
} from './_menuActions.ts';
import { logger } from '../../core/logger.ts';
import { initPhysicsWorker, resyncWorkerState, terminatePhysicsWorker } from './_workerBridge.ts';

import type { PhysicsState } from '../../core/physics.ts';
import type { RocketAssembly, StagingConfig, PlacedPart } from '../../core/rocketbuilder.ts';
import type { GameState, FlightState } from '../../core/gameState.ts';

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
    /** Add a transfer object for E2E testing. */
    __addTransferObject: ((obj: TransferObjectArg) => void) | undefined;
    /** Get proximity objects for E2E testing. */
    __getProximityObjects: ((px: number, py: number, vx: number, vy: number) => unknown[]) | undefined;
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
  setFlightState(flightState);
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
  const ps = createPhysicsState(s.assembly, flightState);
  setPhysicsState(ps);

  // Store a reference to the top-level game state so the malfunction system
  // can look up crew engineering skills during reliability checks.
  ps._gameState = s.state;

  // Apply weather effects (temperature -> ISP, wind, visibility -> fog/haze).
  if (s.state.weather?.current) {
    const w = s.state.weather.current;
    if (w.temperature != null) ps.weatherIspModifier = w.temperature;
    ps.weatherWindSpeed = w.windSpeed ?? 0;
    ps.weatherWindAngle = w.windAngle ?? 0;
    setFlightWeather(w.visibility ?? 0);
  }

  // Attach inventory-sourced part data for wear tracking on recovery.
  ps._usedInventoryParts = getVabInventoryUsedParts();

  // Expose for E2E testing -- Playwright reads live physics values here.
  if (typeof window !== 'undefined') {
    window.__flightPs       = ps;
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
      const stPs = getPhysicsState();
      const stFs = getFlightState();
      if (st.workerReady && stPs && st.assembly && st.stagingConfig && stFs) {
        await resyncWorkerState(stPs, st.assembly, st.stagingConfig, stFs);
      }
    };

    // Transfer objects API for E2E testing.
    window.__addTransferObject = (obj: TransferObjectArg) => {
      addTransferObjectFn(obj);
    };
    window.__getProximityObjects = (px: number, py: number, vx: number, vy: number) => {
      return getProximityObjectsFn(px, py, vx, vy);
    };
  }

  // Boot the PixiJS flight renderer.
  initFlightRenderer();

  // Mount the HUD overlay.
  initFlightHud(container, ps, s.assembly, stagingConfig, flightState, state, onTimeWarpButtonClick, onSurfaceAction, handleAbortReturnToAgency);

  // Initialise the FPS monitor (visible only when debug mode is on).
  initFpsMonitor();
  if (state.debugMode) showFpsMonitor();
  else hideFpsMonitor();

  // Show the performance dashboard if the setting is enabled.
  if (state.showPerfDashboard) showPerfDashboard();
  else hidePerfDashboard();

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
  if (!flightState.dockingState) {
    flightState.dockingState = createDockingState();
  }
  s.dockingHud = null;

  // Initialise the right-click part context menu.
  initFlightContextMenu(
    () => getPhysicsState(),
    () => getFCState().assembly,
    () => getFlightState(),
  );

  // Bind keyboard handlers.
  s.keydownHandler = onKeyDown;
  s.keyupHandler   = onKeyUp;
  window.addEventListener('keydown', s.keydownHandler);
  window.addEventListener('keyup',   s.keyupHandler);

  // Start the render + physics loop.
  s.lastTs = performance.now();
  s.rafId  = requestAnimationFrame(loop);

  // Initialise the physics worker.
  initPhysicsWorker(ps, s.assembly, s.stagingConfig, flightState)
    .then(() => {
      // The worker loaded with the initial state, but the main-thread may
      // have advanced a frame while the worker was loading.  Re-init the
      // worker with the CURRENT state so it starts from the exact same point.
      const current = getFCState();
      const curPs = getPhysicsState();
      const curFs = getFlightState();
      if (curPs && current.assembly && current.stagingConfig && curFs) {
        return resyncWorkerState(curPs, current.assembly, current.stagingConfig, curFs);
      }
    })
    .then(() => {
      // Mark worker as ready — the loop will start sending tick commands.
      const current = getFCState();
      const curPs = getPhysicsState();
      if (curPs && current.assembly) {
        current.workerReady = true;
        logger.debug('flight', 'Physics worker initialised and ready');
      }
    })
    .catch((err) => {
      logger.error('flight', 'Physics worker failed to initialise', { error: String(err) });
    });

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

  // Terminate the physics worker.
  terminatePhysicsWorker();
  s.workerReady = false;

  if (s.keydownHandler) {
    window.removeEventListener('keydown', s.keydownHandler);
    s.keydownHandler = null;
  }
  if (s.keyupHandler) {
    window.removeEventListener('keyup', s.keyupHandler);
    s.keyupHandler = null;
  }

  destroyFpsMonitor();
  destroyPerfDashboard();
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
    window.__addTransferObject = undefined;
    window.__getProximityObjects = undefined;
  }

  // Reset all state.
  resetFCState();


}
