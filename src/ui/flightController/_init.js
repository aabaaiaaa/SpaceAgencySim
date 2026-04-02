/**
 * _init.js — Orchestrator containing startFlightScene and stopFlightScene.
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
import { getFCState, setFCState, resetFCState } from './_state.js';
import { FLIGHT_CTRL_CSS } from './_css.js';
import { onKeyDown, onKeyUp } from './_keyboard.js';
import { onTimeWarpButtonClick } from './_timeWarp.js';
import { onSurfaceAction } from './_surfaceActions.js';
import { destroyMapHud } from './_mapView.js';
import { destroyDockingHud } from './_docking.js';
import { loop } from './_loop.js';
import {
  handleMenuRestart,
  handleMenuAdjustBuild,
  handleMenuReturnToAgency,
  handleMenuFlightLog,
} from './_menuActions.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Returns a shallow copy of `assembly` where every part's Y position is shifted
 * so the lowest part's bottom edge sits exactly at world Y = 0 (the launch pad).
 *
 * @param {import('../../core/rocketbuilder.js').RocketAssembly} assembly
 * @returns {import('../../core/rocketbuilder.js').RocketAssembly}
 */
function _normalizeAssemblyToGround(assembly) {
  let lowestBottom = Infinity;
  for (const placed of assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (!def) continue;
    lowestBottom = Math.min(lowestBottom, placed.y - def.height / 2);
  }

  if (!isFinite(lowestBottom) || lowestBottom === 0) return assembly;

  const normalizedParts = new Map();
  for (const [id, placed] of assembly.parts) {
    normalizedParts.set(id, { ...placed, y: placed.y - lowestBottom });
  }
  return { ...assembly, parts: normalizedParts };
}

/**
 * Build the in-flight control overlay.
 * @param {HTMLElement} container
 */
function _buildFlightOverlay(container) {
  const overlay = document.createElement('div');
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
 *
 * @param {HTMLElement}                                              container    #ui-overlay div.
 * @param {import('../../core/gameState.js').GameState}              state
 * @param {import('../../core/rocketbuilder.js').RocketAssembly}     assembly
 * @param {import('../../core/rocketbuilder.js').StagingConfig}      stagingConfig
 * @param {import('../../core/gameState.js').FlightState}            flightState
 * @param {(state: import('../../core/gameState.js').GameState) => void} onFlightEnd
 */
export function startFlightScene(
  container,
  state,
  assembly,
  stagingConfig,
  flightState,
  onFlightEnd,
) {
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
    symmetryPairs: assembly.symmetryPairs.map(sp => [...sp]),
    _nextId:       assembly._nextId,
  };
  s.originalStagingConfig = {
    stages:          stagingConfig.stages.map(st => ({ instanceIds: [...st.instanceIds] })),
    unstaged:        [...stagingConfig.unstaged],
    currentStageIdx: 0,
  };

  // Inject CSS once per page load.
  if (!document.getElementById('flight-ctrl-css')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'flight-ctrl-css';
    styleEl.textContent = FLIGHT_CTRL_CSS;
    document.head.appendChild(styleEl);
  }

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
  s.ps._usedInventoryParts = getVabInventoryUsedParts();

  // Expose for E2E testing — Playwright reads live physics values here.
  if (typeof window !== 'undefined') {
    window.__flightPs       = s.ps;
    window.__flightAssembly = s.assembly;
    window.__flightState    = flightState;
    window.__setMalfunctionMode = setMalfunctionMode;
    window.__getMalfunctionMode = getMalfunctionMode;
  }

  // Boot the PixiJS flight renderer.
  initFlightRenderer();

  // Mount the HUD overlay.
  initFlightHud(container, s.ps, s.assembly, stagingConfig, flightState, state, onTimeWarpButtonClick, onSurfaceAction);

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
  setTopBarDropdownToggleCallback((isOpen) => {
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

  console.log('[Flight Controller] Flight scene started');
}

/**
 * Tear down the flight scene: stops the loop, destroys the HUD and renderer,
 * removes the control overlay, and clears all module state.
 *
 * Safe to call even if startFlightScene was never called.
 */
export function stopFlightScene() {
  const s = getFCState();

  if (s.rafId !== null) {
    cancelAnimationFrame(s.rafId);
    s.rafId = null;
  }

  if (s.keydownHandler) {
    window.removeEventListener('keydown', s.keydownHandler);
    s.keydownHandler = null;
  }
  if (s.keyupHandler) {
    window.removeEventListener('keyup', s.keyupHandler);
    s.keyupHandler = null;
  }

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
  }

  // Reset all state.
  resetFCState();

  console.log('[Flight Controller] Flight scene stopped');
}
