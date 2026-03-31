/**
 * flightController.js — Flight scene controller.
 *
 * Manages the full lifecycle of an active flight:
 *   - Initialising and tearing down the PixiJS flight renderer.
 *   - Running the fixed-timestep physics simulation loop.
 *   - Binding keyboard handlers (throttle, steering, staging).
 *   - Mounting and destroying the in-flight HUD overlay.
 *   - Providing the in-flight menu (save, load, return to agency).
 *   - Showing the post-flight summary screen.
 *
 * Entry point: startFlightScene()
 * Clean-up:    stopFlightScene()
 *
 * @module ui/flightController
 */

import { initFlightRenderer, destroyFlightRenderer, renderFlightFrame, hideFlightScene, showFlightScene, setFlightInputEnabled, setFlightWeather } from '../render/flight.js';
import { initMapRenderer, destroyMapRenderer, renderMapFrame, showMapScene, hideMapScene, isMapVisible, cycleMapZoom, getMapZoomLevel, setMapZoomLevel, cycleMapTarget, getMapTarget, toggleMapShadow, setMapTarget, cycleTransferTarget, getSelectedTransferTarget } from '../render/map.js';
import { MapZoom, MapThrustDir, computeOrbitalThrustAngle, isMapViewAvailable, getMapTransferTargets, getTransferProgressInfo, getAllowedMapZooms, isTransferPlanningAvailable, isDebrisTrackingAvailable } from '../core/mapView.js';
import { warpToTarget } from '../core/orbit.js';
import {
  createPhysicsState,
  tick,
  handleKeyDown,
  handleKeyUp,
  fireNextStage,
} from '../core/physics.js';
import { initFlightHud, destroyFlightHud, setHudTimeWarp, lockTimeWarp, showLaunchTip, hideLaunchTip } from './flightHud.js';
import { initFlightContextMenu, destroyFlightContextMenu } from './flightContextMenu.js';
import { checkObjectiveCompletion } from '../core/missions.js';
import { checkContractObjectives } from '../core/contracts.js';
import { saveGame, listSaves } from '../core/saveload.js';
import { ATMOSPHERE_TOP, isReentryCondition } from '../core/atmosphere.js';
import { getAtmosphereTop as getBodyAtmosphereTop } from '../data/bodies.js';
import { getPartById } from '../data/parts.js';
import { PartType, DEATH_FINE_PER_ASTRONAUT } from '../core/constants.js';
import { processFlightReturn } from '../core/flightReturn.js';
import { setTopBarFlightItems, clearTopBarFlightItems, setTopBarDropdownToggleCallback, refreshTopBar } from './topbar.js';
import { FlightPhase, ControlMode } from '../core/constants.js';
import { evaluateAutoTransitions, canReturnToAgency, isPlayerLocked, getPhaseLabel, transitionPhase, getDeorbitWarningMessage } from '../core/flightPhase.js';
import { checkOrbitStatus, getMinOrbitAltitude, getOrbitEntryLabel } from '../core/orbit.js';
import {
  enterDockingMode,
  exitDockingMode,
  toggleRcsMode,
  resetControlModeIfNeeded,
  hasRcsThrusters,
  getControlModeLabel,
  CONTROL_MODE_TIPS,
  checkBandLimitWarning,
  getDockingThrustDirections,
} from '../core/controlMode.js';
import { setMalfunctionMode, getMalfunctionMode } from '../core/malfunction.js';
import {
  recalculateOrbit,
  isOrbitalBurnActive,
  checkSOITransition,
  isEscapeTrajectory,
} from '../core/manoeuvre.js';
import {
  createDockingState,
  tickDocking,
  getDockingGuidance,
  getTargetsInVisualRange,
  selectDockingTarget,
  clearDockingTarget,
  hasDockingPort,
  canDockWith,
  undock,
  transferFuel,
} from '../core/docking.js';
import { DockingState } from '../core/constants.js';
import { getVabInventoryUsedParts } from './vab.js';
import {
  plantFlag,
  collectSurfaceSample,
  deploySurfaceInstrument,
  deployBeacon,
  getSurfaceItemsAtBody,
} from '../core/surfaceOps.js';

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** requestAnimationFrame handle. @type {number|null} */
let _rafId = null;

/** Live physics state. @type {import('../core/physics.js').PhysicsState|null} */
let _ps = null;

/** Rocket assembly (part graph). @type {import('../core/rocketbuilder.js').RocketAssembly|null} */
let _assembly = null;

/** Staging configuration. @type {import('../core/rocketbuilder.js').StagingConfig|null} */
let _stagingConfig = null;

/** Flight state (altitude, events, etc.). @type {import('../core/gameState.js').FlightState|null} */
let _flightState = null;

/** Top-level game state. @type {import('../core/gameState.js').GameState|null} */
let _state = null;

/** The #ui-overlay container. @type {HTMLElement|null} */
let _container = null;

/** Called when the flight ends (Return to Space Agency). @type {((state: any) => void)|null} */
let _onFlightEnd = null;

/** Timestamp of the previous animation frame (ms). @type {number|null} */
let _lastTs = null;

/** keydown handler bound reference for removal. @type {((e: KeyboardEvent) => void)|null} */
let _keydownHandler = null;

/** keyup handler bound reference for removal. @type {((e: KeyboardEvent) => void)|null} */
let _keyupHandler = null;

/** The in-flight control overlay DOM element. @type {HTMLElement|null} */
let _flightOverlay = null;

/** Pristine deep-clone of the assembly at launch time (for restart). @type {import('../core/rocketbuilder.js').RocketAssembly|null} */
let _originalAssembly = null;

/** Pristine deep-clone of the staging config at launch time (for restart). @type {import('../core/rocketbuilder.js').StagingConfig|null} */
let _originalStagingConfig = null;

/**
 * True while the post-flight summary overlay is visible.
 * Prevents the overlay from being shown twice (e.g. crash auto-trigger
 * firing on the same frame that the player clicks "Return to Agency").
 */
let _summaryShown = false;

// ---------------------------------------------------------------------------
// Map view state
// ---------------------------------------------------------------------------

/** True when the map view is the active scene. */
let _mapActive = false;

/**
 * Set of orbital-relative thrust keys currently held while the map view
 * is active (e.g. 'w', 's', 'a', 'd').  Separate from the physics held-key
 * set because WASD are not forwarded to `handleKeyDown` in map mode.
 */
let _mapHeldKeys = new Set();

/** True while the craft is thrusting due to map-view orbital controls. */
let _mapThrusting = false;

/**
 * Set of orbital-relative thrust keys held in NORMAL orbit mode in flight view
 * (WASD = prograde/retrograde/radial-in/radial-out).
 */
let _normalOrbitHeldKeys = new Set();

/** True while the craft is thrusting due to normal-orbit WASD controls. */
let _normalOrbitThrusting = false;

/** The DOM element for the map-view HUD overlay. @type {HTMLElement|null} */
let _mapHud = null;

// ---------------------------------------------------------------------------
// Docking state
// ---------------------------------------------------------------------------

/** DOM element for the docking guidance overlay. @type {HTMLElement|null} */
let _dockingHud = null;

// ---------------------------------------------------------------------------
// Time-warp state
// ---------------------------------------------------------------------------

/**
 * Current time-warp multiplier applied to the physics dt each frame.
 * 1 = real-time; 2 = 2× speed; up to 50×.
 */
let _timeWarp = 1;

/** Time-warp value saved when the hamburger menu opens, restored on close. */
let _preMenuTimeWarp = 1;

/**
 * Performance.now() timestamp (ms) at which the staging lockout expires.
 * While performance.now() < _stagingLockoutUntil the warp buttons are disabled
 * and the warp level is forced to 1×.
 */
let _stagingLockoutUntil = 0;

/** Altitude (m) at the previous frame — used to detect atmosphere re-entry. */
let _prevAltitude = 0;

/** Whether the rocket was in space (above ATMOSPHERE_TOP) on the previous frame. */
let _prevInSpace = false;

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const FLIGHT_CTRL_CSS = `
/* ── Flight control overlay ─────────────────────────────────────────────── */
#flight-overlay {
  position: fixed;
  inset: 44px 0 0;
  pointer-events: none;
  z-index: 200;
  font-family: system-ui, sans-serif;
}

/* ── Hamburger / menu button — centred at the top ──────────────────────── */
#flight-menu-btn {
  position: absolute;
  top: 10px;
  left: 50%;
  transform: translateX(-50%);
  height: 32px;
  padding: 0 14px;
  border: 1px solid rgba(255, 255, 255, 0.25);
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.65);
  color: #d8e8f0;
  font-size: 13px;
  cursor: pointer;
  pointer-events: auto;
  display: flex;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
  transition: background 0.15s;
  z-index: 202;
}

#flight-menu-btn:hover {
  background: rgba(0, 0, 0, 0.88);
}

/* ── Dropdown menu ─────────────────────────────────────────────────────── */
#flight-menu {
  position: absolute;
  top: 48px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(10, 14, 24, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  padding: 4px 0;
  min-width: 210px;
  pointer-events: auto;
  z-index: 201;
}

#flight-menu.hidden {
  display: none;
}

.flight-menu-item {
  display: block;
  width: 100%;
  padding: 10px 18px;
  text-align: left;
  background: none;
  border: none;
  color: #d8e0f0;
  font-size: 14px;
  cursor: pointer;
  transition: background 0.1s;
  box-sizing: border-box;
}

.flight-menu-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.flight-menu-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 4px 0;
}

/* ── Post-flight summary screen ────────────────────────────────────────── */
#post-flight-summary {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.62);
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: system-ui, sans-serif;
  color: #d0e0f0;
  pointer-events: auto;
}

.pf-content {
  background: #0d1520;
  border: 1px solid rgba(100, 160, 220, 0.28);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
  width: 600px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  padding: 26px 30px 22px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
}

#post-flight-summary h1 {
  font-size: 2rem;
  font-weight: 700;
  margin: 0 0 28px;
  letter-spacing: 0.04em;
}

.pf-section {
  width: 100%;
  margin-bottom: 28px;
}

.pf-section h2 {
  font-size: 0.8rem;
  font-weight: 700;
  color: #5880a0;
  margin: 0 0 10px;
  padding-bottom: 6px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.pf-section-danger h2 {
  color: #b06060;
}

/* Mission objectives */
.pf-obj-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.pf-obj-list li {
  padding: 5px 0;
  font-size: 0.95rem;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  line-height: 1.4;
}

.pf-obj-check {
  flex-shrink: 0;
  font-size: 0.9rem;
}

.pf-obj-complete {
  color: #50d870;
}

.pf-obj-incomplete {
  color: #907070;
}

/* Recovery table */
.pf-recovery-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.9rem;
}

.pf-recovery-table th {
  text-align: left;
  padding: 6px 10px;
  color: #5880a0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.12);
  font-weight: 600;
  font-size: 0.8rem;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.pf-recovery-table th:last-child {
  text-align: right;
}

.pf-recovery-table td {
  padding: 5px 10px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.05);
  color: #c0d8f0;
}

.pf-recovery-table td:last-child {
  text-align: right;
  color: #60d890;
  font-variant-numeric: tabular-nums;
}

.pf-recovery-total td {
  padding-top: 8px;
  color: #80e0a0 !important;
  font-weight: 700;
  border-top: 1px solid rgba(255, 255, 255, 0.15);
  border-bottom: none;
}

/* KIA list */
.pf-kia-list {
  list-style: none;
  padding: 0;
  margin: 0 0 6px;
}

.pf-kia-list li {
  padding: 5px 0;
  font-size: 0.95rem;
  color: #e08888;
  display: flex;
  justify-content: space-between;
}

.pf-kia-fine {
  color: #ff9999;
  font-variant-numeric: tabular-nums;
}

.pf-kia-total {
  font-size: 0.9rem;
  font-weight: 700;
  color: #ff8080;
  text-align: right;
  margin-top: 4px;
  padding-top: 6px;
  border-top: 1px solid rgba(255, 100, 100, 0.2);
}

/* Action buttons */
.pf-buttons {
  display: flex;
  flex-direction: column;
  gap: 10px;
  margin-top: 16px;
  width: 100%;
}

.pf-btn-row {
  display: flex;
  gap: 10px;
  width: 100%;
}

.pf-btn-row > .pf-btn { flex: 1; }

.pf-btn {
  padding: 11px 16px;
  border-radius: 6px;
  font-size: 0.85rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
  text-align: center;
}

.pf-btn-primary {
  background: #1a4070;
  border-color: #4080b0;
  color: #c8e8ff;
  width: 100%;
}

.pf-btn-primary:hover {
  background: #235a90;
}

.pf-btn-secondary {
  background: rgba(255, 255, 255, 0.07);
  border-color: rgba(255, 255, 255, 0.18);
  color: #b0c8e0;
}

.pf-btn-secondary:hover {
  background: rgba(255, 255, 255, 0.13);
}

.pf-btn .pf-btn-cost {
  display: block;
  font-size: 0.75rem;
  opacity: 0.7;
  margin-top: 2px;
}

/* Keep old stat-row styles for backward compatibility */
.pf-stat-row {
  display: flex;
  gap: 14px;
  margin-bottom: 10px;
  font-size: 1rem;
  align-items: baseline;
}

.pf-stat-label {
  color: #5880a0;
  min-width: 180px;
  text-align: right;
}

.pf-stat-value {
  color: #c8e8ff;
  font-weight: 600;
}

/* Legacy single-button style kept for tests that may target it */
#post-flight-return-btn {
  margin-top: 36px;
  padding: 12px 36px;
  background: #1a4070;
  border: 1px solid #4080b0;
  border-radius: 6px;
  color: #c8e8ff;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.15s;
  letter-spacing: 0.02em;
}

#post-flight-return-btn:hover {
  background: #235a90;
}

/* ── Flight Log overlay ───────────────────────────────────────────────── */
#flight-log-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.62);
  z-index: 400;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: system-ui, sans-serif;
  color: #d0e0f0;
  pointer-events: auto;
}

.fl-content {
  background: #0d1520;
  border: 1px solid rgba(100, 160, 220, 0.28);
  border-radius: 10px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.7);
  width: 500px;
  max-width: calc(100vw - 32px);
  max-height: calc(100vh - 64px);
  overflow-y: auto;
  padding: 26px 30px 22px;
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  align-items: center;
}

#flight-log-overlay h1 {
  font-size: 1.6rem;
  font-weight: 700;
  margin: 0 0 20px;
  letter-spacing: 0.04em;
}

.fl-empty {
  color: #607080;
  font-style: italic;
  margin-top: 24px;
}

.fl-list {
  width: 100%;
  list-style: none;
  padding: 0;
  margin: 0;
}

.fl-event {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.fl-event-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  margin-top: 6px;
  flex-shrink: 0;
}

.fl-event-time {
  font-family: 'Courier New', monospace;
  font-size: 0.82rem;
  color: #8090a0;
  flex-shrink: 0;
  min-width: 62px;
}

.fl-event-desc {
  font-size: 0.88rem;
  color: #c0d0e0;
}

.fl-close-btn {
  margin-top: 24px;
  padding: 10px 36px;
  background: #1a4878;
  border: none;
  border-radius: 6px;
  color: #c8e8ff;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.15s;
  letter-spacing: 0.02em;
}

.fl-close-btn:hover {
  background: #235a90;
}

/* ── Phase notification banner ─────────────────────────────────────────── */
.phase-notification {
  position: fixed;
  top: 80px;
  left: 50%;
  transform: translateX(-50%);
  padding: 10px 32px;
  background: rgba(10, 60, 120, 0.85);
  border: 1px solid rgba(100, 180, 255, 0.5);
  border-radius: 6px;
  color: #e0f0ff;
  font-family: system-ui, sans-serif;
  font-size: 18px;
  font-weight: 600;
  letter-spacing: 0.04em;
  pointer-events: none;
  z-index: 500;
  opacity: 1;
  transition: opacity 1s ease-out;
}

.phase-notification-warning {
  background: rgba(120, 80, 10, 0.9);
  border: 1px solid rgba(255, 180, 50, 0.6);
  color: #ffe0a0;
}

.phase-notification-fade {
  opacity: 0;
}

/* ── Map view HUD overlay ─────────────────────────────────────────────── */
#map-hud {
  position: fixed;
  inset: 44px 0 0;
  pointer-events: none;
  z-index: 200;
  font-family: system-ui, sans-serif;
}

#map-hud-info {
  position: absolute;
  top: 10px;
  left: 14px;
  color: #90b8d0;
  font-size: 12px;
  line-height: 1.6;
  background: rgba(5, 5, 16, 0.7);
  padding: 8px 14px;
  border-radius: 6px;
  border: 1px solid rgba(100, 160, 220, 0.2);
}

#map-hud-info .map-label {
  color: #60d890;
  font-weight: 600;
  font-size: 13px;
  letter-spacing: 0.08em;
}

#map-hud-info .map-zoom {
  color: #70a8c8;
}

#map-hud-info .map-target {
  color: #ff8844;
}

#map-hud-controls {
  position: absolute;
  bottom: 18px;
  left: 50%;
  transform: translateX(-50%);
  color: #607888;
  font-size: 11px;
  text-align: center;
  background: rgba(5, 5, 16, 0.65);
  padding: 6px 18px;
  border-radius: 4px;
  white-space: nowrap;
}

#map-hud-controls kbd {
  display: inline-block;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-radius: 3px;
  padding: 1px 5px;
  font-family: monospace;
  font-size: 11px;
  color: #90b0c0;
  margin: 0 1px;
}

#map-warp-btn {
  position: absolute;
  top: 10px;
  right: 14px;
  pointer-events: auto;
  padding: 8px 16px;
  background: rgba(80, 50, 10, 0.8);
  border: 1px solid rgba(255, 136, 68, 0.4);
  border-radius: 5px;
  color: #ffaa66;
  font-size: 12px;
  cursor: pointer;
  transition: background 0.15s;
}

#map-warp-btn:hover {
  background: rgba(120, 70, 20, 0.9);
}

#map-warp-btn.hidden {
  display: none;
}
`;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns a shallow copy of `assembly` where every part's Y position is shifted
 * so the lowest part's bottom edge sits exactly at world Y = 0 (the launch pad).
 *
 * In the VAB, parts can be placed anywhere in world space.  Physics assumes
 * posY = 0 means the rocket's reference origin is at ground level; if parts are
 * assembled above Y = 0, posY = 0 would show the rocket floating.  Normalising
 * here ensures `posY = 0` always places the rocket bottom on the ground.
 *
 * The original assembly passed in from the VAB is never mutated.
 *
 * @param {import('../core/rocketbuilder.js').RocketAssembly} assembly
 * @returns {import('../core/rocketbuilder.js').RocketAssembly}
 */
function _normalizeAssemblyToGround(assembly) {
  // Find the world-Y of the lowest part's bottom edge (20 VAB px = 1 m, Y-up).
  let lowestBottom = Infinity;
  for (const placed of assembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (!def) continue;
    lowestBottom = Math.min(lowestBottom, placed.y - def.height / 2);
  }

  // Nothing to shift (empty assembly or already at ground).
  if (!isFinite(lowestBottom) || lowestBottom === 0) return assembly;

  // Shift every part so the lowest bottom is exactly at Y = 0.
  const normalizedParts = new Map();
  for (const [id, placed] of assembly.parts) {
    normalizedParts.set(id, { ...placed, y: placed.y - lowestBottom });
  }
  return { ...assembly, parts: normalizedParts };
}

/**
 * Start the flight scene.
 *
 * Initialises the PixiJS renderer, creates the physics state, mounts the HUD
 * overlay, builds the in-flight control overlay, and starts the game loop.
 *
 * @param {HTMLElement}                                              container    #ui-overlay div.
 * @param {import('../core/gameState.js').GameState}                 state
 * @param {import('../core/rocketbuilder.js').RocketAssembly}        assembly
 * @param {import('../core/rocketbuilder.js').StagingConfig}         stagingConfig
 * @param {import('../core/gameState.js').FlightState}               flightState
 * @param {(state: import('../core/gameState.js').GameState) => void} onFlightEnd
 *   Called with the game state when the player dismisses the post-flight summary.
 */
export function startFlightScene(
  container,
  state,
  assembly,
  stagingConfig,
  flightState,
  onFlightEnd,
) {
  _container     = container;
  _state         = state;
  // Normalise the assembly so the rocket's lowest part bottom is exactly at
  // world Y = 0 (launch-pad level), matching the physics ground plane.
  _assembly      = _normalizeAssemblyToGround(assembly);
  _stagingConfig = stagingConfig;
  _flightState   = flightState;
  _onFlightEnd   = onFlightEnd;

  // Guarantee staging starts at Stage 1 regardless of prior flight state.
  _stagingConfig.currentStageIdx = 0;

  // Deep-clone the pre-normalisation assembly and staging config so "Restart
  // from Launch" can re-create a pristine flight without returning to the VAB.
  _originalAssembly = {
    parts:         new Map([...assembly.parts].map(([id, p]) => [id, { ...p, ...(p.instruments ? { instruments: [...p.instruments] } : {}) }])),
    connections:   assembly.connections.map(c => ({ ...c })),
    symmetryPairs: assembly.symmetryPairs.map(sp => [...sp]),
    _nextId:       assembly._nextId,
  };
  _originalStagingConfig = {
    stages:          stagingConfig.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
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
  _timeWarp            = 1;
  _stagingLockoutUntil = 0;
  _prevAltitude        = 0;
  _prevInSpace         = false;
  _summaryShown        = false;

  // Create the physics state from the (normalised) assembly and initial flight state.
  _ps = createPhysicsState(_assembly, flightState);

  // Store a reference to the top-level game state so the malfunction system
  // can look up crew engineering skills during reliability checks.
  _ps._gameState = _state;

  // Apply weather effects (temperature → ISP, visibility → fog/haze).
  if (_state.weather?.current) {
    const w = _state.weather.current;
    if (w.temperature != null) _ps.weatherIspModifier = w.temperature;
    setFlightWeather(w.visibility ?? 0);
  }

  // Attach inventory-sourced part data for wear tracking on recovery.
  _ps._usedInventoryParts = getVabInventoryUsedParts();

  // Expose for E2E testing — Playwright reads live physics values here.
  if (typeof window !== 'undefined') {
    window.__flightPs       = _ps;
    window.__flightAssembly = _assembly;
    window.__flightState    = flightState;
    // Malfunction mode control for E2E testing:
    //   window.__setMalfunctionMode('off')    — disable all malfunctions
    //   window.__setMalfunctionMode('forced') — force all malfunctions to 100%
    //   window.__setMalfunctionMode('normal') — standard reliability rolls
    window.__setMalfunctionMode = setMalfunctionMode;
    window.__getMalfunctionMode = getMalfunctionMode;
  }

  // Boot the PixiJS flight renderer (clears whatever scene was on stage).
  initFlightRenderer();

  // Mount the HUD overlay.
  initFlightHud(container, _ps, _assembly, stagingConfig, flightState, state, _onTimeWarpButtonClick, _onSurfaceAction);

  // Build the in-flight control overlay (save notice only — no hamburger).
  _buildFlightOverlay(container);

  // Inject flight-action items into the topbar hamburger dropdown.
  setTopBarFlightItems([
    {
      label: 'Restart from Launch',
      title: 'Restart this flight from the launch pad with the same rocket and staging.',
      onClick: _handleMenuRestart,
    },
    {
      label: 'Adjust Build',
      title: 'Return to the Vehicle Assembly Building with this rocket loaded so you can tweak and re-launch.',
      onClick: _handleMenuAdjustBuild,
    },
    {
      label: 'Return to Space Agency',
      title: 'End this flight and return to your Space Agency hub.',
      onClick: _handleMenuReturnToAgency,
    },
    {
      label: 'Flight Log',
      title: 'View a log of all flight events.',
      onClick: _handleMenuFlightLog,
    },
  ]);

  // Pause physics while the hamburger dropdown is open.
  setTopBarDropdownToggleCallback((isOpen) => {
    if (isOpen) {
      _preMenuTimeWarp = _timeWarp;
      _timeWarp = 0;
    } else {
      _timeWarp = _preMenuTimeWarp ?? 1;
    }
  });

  // Show the launch pad tip if the rocket hasn't launched yet.
  showLaunchTip();

  // Initialise the map renderer (hidden by default).
  _mapActive    = false;
  _mapHeldKeys  = new Set();
  _mapThrusting = false;
  _mapHud       = null;
  _normalOrbitHeldKeys  = new Set();
  _normalOrbitThrusting = false;
  initMapRenderer();

  // Initialise the docking system state on the flight state.
  if (!_flightState.dockingState) {
    _flightState.dockingState = createDockingState();
  }
  _dockingHud = null;

  // Initialise the right-click part context menu.
  initFlightContextMenu(
    () => _ps,
    () => _assembly,
    () => _flightState,
  );

  // Bind keyboard handlers.
  _keydownHandler = _onKeyDown;
  _keyupHandler   = _onKeyUp;
  window.addEventListener('keydown', _keydownHandler);
  window.addEventListener('keyup',   _keyupHandler);

  // Start the render + physics loop.
  _lastTs = performance.now();
  _rafId  = requestAnimationFrame(_loop);

  console.log('[Flight Controller] Flight scene started');
}

/**
 * Tear down the flight scene: stops the loop, destroys the HUD and renderer,
 * removes the control overlay, and clears all module state.
 *
 * Safe to call even if startFlightScene was never called.
 */
export function stopFlightScene() {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }

  if (_keydownHandler) {
    window.removeEventListener('keydown', _keydownHandler);
    _keydownHandler = null;
  }
  if (_keyupHandler) {
    window.removeEventListener('keyup', _keyupHandler);
    _keyupHandler = null;
  }

  destroyFlightHud();
  destroyFlightContextMenu();
  _destroyDockingHud();
  _destroyMapHud();
  destroyMapRenderer();
  destroyFlightRenderer();
  clearTopBarFlightItems();

  if (_flightOverlay) {
    _flightOverlay.remove();
    _flightOverlay = null;
  }

  if (typeof window !== 'undefined') {
    window.__flightPs       = null;
    window.__flightAssembly = null;
    window.__flightState    = null;
  }

  _ps                    = null;
  _assembly              = null;
  _stagingConfig         = null;
  _flightState           = null;
  _state                 = null;
  _container             = null;
  _onFlightEnd           = null;
  _lastTs                = null;
  _originalAssembly      = null;
  _originalStagingConfig = null;
  _mapActive             = false;
  _mapHeldKeys           = new Set();
  _mapThrusting          = false;
  _mapHud                = null;
  _normalOrbitHeldKeys   = new Set();
  _normalOrbitThrusting  = false;

  // Reset time-warp state.
  _timeWarp            = 1;
  _stagingLockoutUntil = 0;
  _prevAltitude        = 0;
  _prevInSpace         = false;

  _summaryShown = false;
  _deorbitWarningActive = false;

  console.log('[Flight Controller] Flight scene stopped');
}

// ---------------------------------------------------------------------------
// Private — game loop
// ---------------------------------------------------------------------------

/**
 * One animation frame: advance physics, render scene, re-schedule.
 * @param {number} timestamp  Performance.now() value from rAF.
 */
function _loop(timestamp) {
  // Guard against stale callbacks after stopFlightScene().
  if (!_ps || !_assembly || !_stagingConfig || !_flightState) return;

  const realDt = Math.min((timestamp - _lastTs) / 1000, 0.1);
  _lastTs = timestamp;

  // Evaluate time-warp reset conditions before advancing physics.
  _checkTimeWarpResets(timestamp);

  // When the map is active during non-ORBIT phases, force 1× warp —
  // EXCEPT during TRANSFER and CAPTURE phases where time warp is allowed
  // from the map view (transfer time warping does NOT advance the period counter).
  if (_mapActive &&
      _flightState.phase !== FlightPhase.ORBIT &&
      _flightState.phase !== FlightPhase.TRANSFER &&
      _flightState.phase !== FlightPhase.CAPTURE) {
    if (_timeWarp !== 1) _applyTimeWarp(1);
  }

  // Apply orbital-relative thrust when the map view is active and the
  // player is holding WASD keys (only effective during ORBIT phase).
  _applyMapThrust();

  // Apply orbital-relative thrust from WASD in NORMAL orbit mode (flight view).
  _applyNormalOrbitRcs();

  // Reset per-frame science flag before sub-steps; tickScienceModules will
  // set it to true if any experiment was running during ANY sub-step.
  _flightState.scienceModuleRunning = false;

  // Advance physics simulation with the current warp multiplier.
  tick(_ps, _assembly, _stagingConfig, _flightState, realDt, _timeWarp);

  // --- Flight phase state machine: auto-detect transitions each frame ---
  _evaluateFlightPhase();

  // --- Docking system tick ---
  _tickDockingSystem(realDt);

  // Check mission and contract objective completion against live flight state.
  checkObjectiveCompletion(_state, _flightState);
  checkContractObjectives(_state, _flightState);

  // Render the active scene.
  if (_mapActive) {
    const mapBodyId = (_flightState && _flightState.bodyId) || 'EARTH';
    renderMapFrame(_ps, _flightState, _state, mapBodyId, {
      showDebris: isDebrisTrackingAvailable(_state),
    });
  } else {
    const _surfItems = _state ? getSurfaceItemsAtBody(_state, _flightState.bodyId) : [];
    renderFlightFrame(_ps, _assembly, _flightState, _surfItems);
  }

  // Update the map HUD readouts if visible.
  if (_mapActive) _updateMapHud();

  // Update the docking guidance HUD if active.
  _updateDockingHud();

  // Auto-trigger the post-flight summary when the rocket crashes or all
  // command modules are destroyed (the rocket becomes uncontrollable).
  if (!_summaryShown && (!_ps.grounded || _ps.crashed)) {
    const shouldAutoTrigger = _ps.crashed || _allCommandModulesDestroyed();
    if (shouldAutoTrigger) {
      _summaryShown = true;
      _showPostFlightSummary(
        _ps, _assembly, _flightState, _state, _onFlightEnd,
      );
    }
  }

  // Reschedule unless the loop was cancelled.
  if (_rafId !== null) {
    _rafId = requestAnimationFrame(_loop);
  }
}

// ---------------------------------------------------------------------------
// Private — auto-trigger helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the assembly contains at least one COMMAND_MODULE part
 * and ALL of them have been removed from `_ps.activeParts` (destroyed or
 * separated).  Returns false while the rocket is still on the launch pad
 * or if no command modules were ever present.
 *
 * @returns {boolean}
 */
function _allCommandModulesDestroyed() {
  if (!_assembly || !_ps) return false;

  let hadCommandModule = false;

  for (const [instanceId, placed] of _assembly.parts) {
    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.COMMAND_MODULE) continue;

    hadCommandModule = true;
    if (_ps.activeParts.has(instanceId)) {
      // At least one command module is still active — not all destroyed.
      return false;
    }
  }

  // Return true only if we had at least one command module and none remain.
  return hadCommandModule;
}

// ---------------------------------------------------------------------------
// Private — time-warp helpers
// ---------------------------------------------------------------------------

/**
 * Called once per frame to check whether any automatic time-warp reset
 * condition has been triggered (landing, reentry) and whether the staging
 * lockout has expired.
 *
 * @param {number} timestamp  Current performance.now() value from rAF.
 */
function _checkTimeWarpResets(timestamp) {
  if (!_ps || !_flightState) return;

  // Manage staging lockout expiry.
  if (_stagingLockoutUntil > 0 && timestamp >= _stagingLockoutUntil) {
    _stagingLockoutUntil = 0;
    lockTimeWarp(false);
  }

  // Body-aware atmosphere top for space detection.
  const _twBodyId = (_flightState && _flightState.bodyId) || 'EARTH';
  const _twAtmoTop = getBodyAtmosphereTop(_twBodyId) || ATMOSPHERE_TOP;

  // No automatic resets needed if we're already at 1×.
  if (_timeWarp === 1) {
    _prevAltitude = Math.max(0, _ps.posY);
    _prevInSpace  = _prevAltitude >= _twAtmoTop;
    return;
  }

  const altitude = Math.max(0, _ps.posY);
  const speed    = Math.hypot(_ps.velX, _ps.velY);
  const inSpace  = altitude >= _twAtmoTop;

  // Reset on successful landing or crash.
  if (_ps.landed || _ps.crashed) {
    _applyTimeWarp(1);
  }
  // Reset on reentry: rocket was in space last frame, now below atmosphere
  // top AND travelling at high speed (> 500 m/s indicates ballistic descent).
  else if (_prevInSpace && !inSpace && speed > 500) {
    _applyTimeWarp(1);
  }

  _prevAltitude = altitude;
  _prevInSpace  = inSpace;
}

/**
 * Apply a new time-warp multiplier: update internal state and synchronise the
 * HUD button highlight.
 *
 * @param {number} level  Desired warp multiplier (1, 2, 5, 10, or 50).
 */
function _applyTimeWarp(level) {
  _timeWarp = level;
  setHudTimeWarp(level);
}

/**
 * Callback passed to `initFlightHud`: invoked when the player clicks a
 * time-warp button in the HUD.
 *
 * @param {number} level  Requested warp level.
 */
function _onTimeWarpButtonClick(level) {
  // Prevent warp changes during the staging lockout window.
  if (_stagingLockoutUntil > 0 && performance.now() < _stagingLockoutUntil) return;
  _applyTimeWarp(level);
}

// ---------------------------------------------------------------------------
// Private — surface operations callback
// ---------------------------------------------------------------------------

/**
 * Callback invoked by the surface operations panel when the player clicks
 * an action button.
 *
 * @param {string} actionId  Surface action identifier.
 */
function _onSurfaceAction(actionId) {
  if (!_state || !_flightState || !_ps) return;

  let result;
  switch (actionId) {
    case 'plant-flag':
      result = plantFlag(_state, _flightState, _ps);
      break;
    case 'collect-sample':
      result = collectSurfaceSample(_state, _flightState, _ps);
      break;
    case 'deploy-instrument':
      result = deploySurfaceInstrument(_state, _flightState, _ps, _assembly);
      break;
    case 'deploy-beacon':
      result = deployBeacon(_state, _flightState, _ps);
      break;
    default:
      return;
  }

  if (!result.success) {
    console.warn(`[Surface Ops] ${actionId} failed: ${result.reason}`);
  }
}

// ---------------------------------------------------------------------------
// Private — flight phase evaluation
// ---------------------------------------------------------------------------

/**
 * Run flight-phase auto-detection once per frame.  Checks orbit status when
 * the craft is above the minimum orbit altitude for the current body and passes
 * the result to the state machine.
 * Shows a notification label on phase transitions, including the named altitude
 * band on orbit entry (e.g. "Low Earth Orbit" instead of "Orbit").
 */
function _evaluateFlightPhase() {
  if (!_ps || !_flightState) return;

  const bodyId = _flightState.bodyId || 'EARTH';
  const minOrbitAlt = getMinOrbitAltitude(bodyId);

  // Only compute orbit status when above the minimum orbit altitude.
  let orbitStatus = null;
  if (_ps.posY >= minOrbitAlt && !_ps.landed && !_ps.crashed) {
    orbitStatus = checkOrbitStatus(_ps.posX, _ps.posY, _ps.velX, _ps.velY, bodyId);
  }

  // --- Continuous orbit recalculation during MANOEUVRE / TRANSFER / CAPTURE ---
  // When the player is burning or in transfer, continuously update orbital
  // elements from state vectors so the map view orbit path updates in real-time.
  const phase = _flightState.phase;
  if (phase === FlightPhase.MANOEUVRE ||
      phase === FlightPhase.TRANSFER ||
      phase === FlightPhase.CAPTURE ||
      (phase === FlightPhase.ORBIT && isOrbitalBurnActive(_ps))) {
    const newElements = recalculateOrbit(_ps, bodyId, _flightState.timeElapsed);
    if (newElements) {
      _flightState.orbitalElements = newElements;
    } else {
      // Orbit is no longer valid (escape trajectory) — clear elements
      // but keep the phase for now (auto-transition will handle it).
      _flightState.orbitalElements = null;
    }
  }

  // Detect REENTRY: if we're in ORBIT and periapsis drops below the minimum
  // orbit altitude, the player has initiated a de-orbit burn.
  // Show a brief warning before transitioning.
  if (_flightState.phase === FlightPhase.ORBIT && orbitStatus && !orbitStatus.valid) {
    // Check if this is an escape trajectory (should go to TRANSFER, not REENTRY).
    if (!isEscapeTrajectory(_ps, bodyId)) {
      _showDeorbitWarning(bodyId);
      return;
    }
  }

  const transition = evaluateAutoTransitions(_flightState, _ps, orbitStatus);

  if (transition) {
    // On orbit entry, show the named altitude band (e.g. "Low Earth Orbit").
    if (transition.to === FlightPhase.ORBIT && orbitStatus) {
      const label = getOrbitEntryLabel(orbitStatus);
      _showPhaseNotification(label);

      _flightState.inOrbit = true;
      _flightState.orbitalElements = orbitStatus.elements;
      _flightState.orbitBandId = orbitStatus.altitudeBand ? orbitStatus.altitudeBand.id : null;
    } else if (transition.to === FlightPhase.MANOEUVRE) {
      _showPhaseNotification('Manoeuvre');
      // Force warp to 1× during burns.
      _applyTimeWarp(1);
    } else if (transition.to === FlightPhase.TRANSFER) {
      _showPhaseNotification('Transfer Injection');
      _applyTimeWarp(1);

      // Auto-open map view during transfer — player needs the orbital map.
      if (!_mapActive) {
        _toggleMapView();
      }
    } else if (transition.to === FlightPhase.CAPTURE) {
      _showPhaseNotification(`Entering ${_flightState.bodyId || 'destination'} SOI`);
      _applyTimeWarp(1);
    } else {
      _showPhaseNotification(getPhaseLabel(transition.to));
    }
  }

  // Reset control mode when flight phase leaves ORBIT (but allow MANOEUVRE).
  if (_ps.controlMode !== ControlMode.NORMAL &&
      _flightState.phase !== FlightPhase.ORBIT &&
      _flightState.phase !== FlightPhase.MANOEUVRE) {
    const wasReset = resetControlModeIfNeeded(_ps, _flightState, bodyId);
    if (wasReset) {
      _showPhaseNotification(CONTROL_MODE_TIPS[ControlMode.NORMAL]);
    }
  }
}

/**
 * True while the deorbit warning banner is visible, preventing re-triggering.
 */
let _deorbitWarningActive = false;

/**
 * Show a brief deorbit warning notification before transitioning from ORBIT
 * to REENTRY.  The warning stays visible for 2 seconds, then the phase
 * transitions automatically.  Player retains engine control throughout.
 *
 * @param {string} bodyId  Celestial body ID.
 */
function _showDeorbitWarning(bodyId) {
  if (_deorbitWarningActive) return;
  _deorbitWarningActive = true;

  const warningMsg = getDeorbitWarningMessage(bodyId);
  _showPhaseNotification(warningMsg, 'warning');

  // After a brief delay, execute the REENTRY transition.
  setTimeout(() => {
    if (!_flightState || !_ps) { _deorbitWarningActive = false; return; }

    const result = transitionPhase(
      _flightState, FlightPhase.REENTRY,
      'De-orbit — periapsis below minimum stable orbit altitude',
    );

    if (result.success) {
      _flightState.inOrbit = false;
      _flightState.orbitalElements = null;
      _flightState.orbitBandId = null;

      // Force-close the map view on deorbit — other orbital objects are no
      // longer visible once the craft leaves the orbital model.
      if (_mapActive) {
        _toggleMapView();
      }

      _showPhaseNotification('Re-Entry');
      _applyTimeWarp(1); // Force warp to 1× on reentry.
    }

    _deorbitWarningActive = false;
  }, 2000);
}

/**
 * Show a brief notification label at the top of the screen when the flight
 * phase changes (e.g. "Low Earth Orbit", "Re-Entry").  The label fades out
 * after 3 s.
 *
 * @param {string} label  Text to display.
 * @param {'info'|'warning'} [style='info']  Visual style — 'warning' uses an
 *   amber colour scheme for deorbit warnings.
 */
function _showPhaseNotification(label, style = 'info') {
  const host = document.getElementById('ui-overlay') ?? document.body;

  // Remove any existing notification.
  const existing = host.querySelector('.phase-notification');
  if (existing) existing.remove();

  const el = document.createElement('div');
  el.className = 'phase-notification';
  if (style === 'warning') el.classList.add('phase-notification-warning');
  el.textContent = label;
  host.appendChild(el);

  // Fade out after 3 seconds.
  setTimeout(() => {
    el.classList.add('phase-notification-fade');
  }, 2500);
  setTimeout(() => {
    el.remove();
  }, 3500);
}

// ---------------------------------------------------------------------------
// Private — keyboard handlers
// ---------------------------------------------------------------------------

/** Ordered warp levels for < / > key stepping. */
const WARP_LEVELS_ORDERED = [0, 0.25, 0.5, 1, 2, 5, 10, 50];

/** @param {KeyboardEvent} e */
function _onKeyDown(e) {
  if (!_ps || !_assembly || !_stagingConfig || !_flightState) return;

  // M — toggle map view.
  if (e.code === 'KeyM') {
    e.preventDefault();
    _toggleMapView();
    return;
  }

  // Map-specific keys when the map is active.
  if (_mapActive) {
    // Tab — cycle zoom level (filtered by Tracking Station tier).
    if (e.code === 'Tab') {
      e.preventDefault();
      const allowed = getAllowedMapZooms(_state);
      const current = getMapZoomLevel();
      const idx = allowed.indexOf(current);
      const next = allowed[(idx + 1) % allowed.length];
      setMapZoomLevel(next);
      _updateMapHud();
      return;
    }
    // N — toggle day/night shadow overlay.
    if (e.code === 'KeyN') {
      toggleMapShadow();
      return;
    }
    // T — cycle target selection.
    if (e.code === 'KeyT' && !e.ctrlKey) {
      const tBodyId = (_flightState && _flightState.bodyId) || 'EARTH';
      cycleMapTarget(_state.orbitalObjects, tBodyId);
      _updateMapHud();
      return;
    }
    // G — warp to target.
    if (e.code === 'KeyG') {
      _handleWarpToTarget();
      return;
    }
    // B — cycle transfer target (route planning, requires Tracking Station tier 3).
    if (e.code === 'KeyB') {
      if (!isTransferPlanningAvailable(_state)) {
        _showPhaseNotification('Tracking Station Tier 3 required for transfer planning');
        return;
      }
      if (_flightState) {
        const bodyId = _flightState.bodyId || 'EARTH';
        const alt = Math.max(0, _ps.posY);
        const selected = cycleTransferTarget(bodyId, alt, _flightState.phase);
        if (selected) {
          _showPhaseNotification(`Transfer target: ${selected}`);
        } else {
          _showPhaseNotification('Transfer target: none');
        }
        _updateMapHud();
      }
      return;
    }
    // WASD — orbital-relative thrust (tracked separately, applied in _loop).
    const lower = e.key.toLowerCase();
    if (lower === 'w' || lower === 's' || lower === 'a' || lower === 'd') {
      _mapHeldKeys.add(lower);
      return;
    }
  }

  // T — cycle docking target (in docking/RCS mode, flight view).
  if (e.code === 'KeyT' && !_mapActive &&
      (_ps.controlMode === ControlMode.DOCKING || _ps.controlMode === ControlMode.RCS)) {
    e.preventDefault();
    _cycleDockingTarget();
    return;
  }

  // U — undock from currently docked vessel.
  if (e.code === 'KeyU' && !_mapActive) {
    e.preventDefault();
    _handleUndock();
    return;
  }

  // F — transfer fuel from docked depot.
  if (e.code === 'KeyF' && !_mapActive && !e.ctrlKey) {
    if (_flightState?.dockingState?.state === DockingState.DOCKED) {
      e.preventDefault();
      _handleFuelTransfer();
      return;
    }
  }

  // V — toggle docking mode (only in ORBIT phase).
  if (e.code === 'KeyV') {
    e.preventDefault();
    _toggleDockingMode();
    return;
  }

  // R — toggle RCS mode.
  if (e.code === 'KeyR') {
    e.preventDefault();
    _toggleRcsMode();
    return;
  }

  // In docking/RCS mode in flight view, WASD are handled by physics
  // _applyDockingMovement via held keys — just pass through to handleKeyDown.
  // Spacebar staging is blocked in docking/RCS mode.
  if (e.code === 'Space') {
    e.preventDefault();

    // Block staging in docking/RCS mode.
    if (_ps.controlMode === ControlMode.DOCKING || _ps.controlMode === ControlMode.RCS) {
      return;
    }

    // Reset time warp to 1× and lock it out for 2 seconds so the player
    // cannot accidentally time-warp during a staging sequence.
    _applyTimeWarp(1);
    _stagingLockoutUntil = performance.now() + 2_000;
    lockTimeWarp(true);

    fireNextStage(_ps, _assembly, _stagingConfig, _flightState);
    hideLaunchTip();
    return;
  }

  // < (Comma) — decrease warp one step.
  if (e.code === 'Comma') {
    e.preventDefault();
    const idx = WARP_LEVELS_ORDERED.indexOf(_timeWarp);
    if (idx > 0) _onTimeWarpButtonClick(WARP_LEVELS_ORDERED[idx - 1]);
    return;
  }

  // > (Period) — increase warp one step.
  if (e.code === 'Period') {
    e.preventDefault();
    const idx = WARP_LEVELS_ORDERED.indexOf(_timeWarp);
    if (idx < WARP_LEVELS_ORDERED.length - 1) _onTimeWarpButtonClick(WARP_LEVELS_ORDERED[idx + 1]);
    return;
  }

  // Prevent browser defaults for Shift/Ctrl used as throttle controls.
  if (e.key === 'Shift' || e.key === 'Control') {
    e.preventDefault();
  }

  // In NORMAL orbit mode (not docking/RCS), WASD applies orbital-relative
  // thrust: W=prograde, S=retrograde, A=radial-in, D=radial-out.
  // This uses the same held-key mechanism as docking, but the
  // _applyNormalOrbitRcs function handles it in the loop.
  if (!_mapActive && _ps.controlMode === ControlMode.NORMAL &&
      (_flightState.phase === FlightPhase.ORBIT || _flightState.phase === FlightPhase.MANOEUVRE)) {
    const lower = e.key.toLowerCase();
    if (lower === 'w' || lower === 's' || lower === 'a' || lower === 'd') {
      _normalOrbitHeldKeys.add(lower);
      return;
    }
  }

  handleKeyDown(_ps, _assembly, e.key);
}

/** @param {KeyboardEvent} e */
function _onKeyUp(e) {
  if (!_ps) return;

  // Release map thrust keys.
  if (_mapActive) {
    const lower = e.key.toLowerCase();
    _mapHeldKeys.delete(lower);
  }

  // Release normal-orbit WASD keys.
  {
    const lower = e.key.toLowerCase();
    _normalOrbitHeldKeys.delete(lower);
  }

  handleKeyUp(_ps, e.key);
}

// ---------------------------------------------------------------------------
// Private — map view toggle and controls
// ---------------------------------------------------------------------------

/**
 * Toggle between the flight view and the top-down orbital map view.
 * Shows a control-tip notification each time the view is swapped.
 */
function _toggleMapView() {
  if (!_ps || !_flightState) return;

  // During TRANSFER/CAPTURE, the player cannot leave the map view.
  if (_mapActive && isPlayerLocked(_flightState.phase)) {
    _showPhaseNotification('Cannot leave map during ' + getPhaseLabel(_flightState.phase));
    return;
  }

  // Check availability (Tracking Station facility).
  if (!_mapActive && !isMapViewAvailable(_state)) {
    _showPhaseNotification('Tracking Station required');
    return;
  }

  _mapActive = !_mapActive;

  if (_mapActive) {
    // Switch to map view.
    hideFlightScene();
    setFlightInputEnabled(false);
    showMapScene();
    _buildMapHud();
    _showPhaseNotification('Map View');
  } else {
    // Switch back to flight view.
    hideMapScene();
    showFlightScene();
    setFlightInputEnabled(true);
    _destroyMapHud();

    // Cut any map thrust that was in progress.
    if (_mapThrusting) {
      _ps.throttle = 0;
      _mapThrusting = false;
    }
    _mapHeldKeys.clear();

    _showPhaseNotification('Flight View');
  }
}

/**
 * Apply orbital-relative thrust based on map-held keys.
 * Only effective during ORBIT phase when the map view is active.
 */
function _applyMapThrust() {
  if (!_mapActive || !_ps || !_flightState) return;

  // Apply orbital thrust in ORBIT, MANOEUVRE, TRANSFER, or CAPTURE phases.
  const phase = _flightState.phase;
  if (phase !== FlightPhase.ORBIT && phase !== FlightPhase.MANOEUVRE &&
      phase !== FlightPhase.TRANSFER && phase !== FlightPhase.CAPTURE) {
    if (_mapThrusting) {
      _ps.throttle = 0;
      _mapThrusting = false;
    }
    return;
  }

  // Determine thrust direction from held keys (priority order).
  let direction = null;
  if (_mapHeldKeys.has('w'))      direction = MapThrustDir.PROGRADE;
  else if (_mapHeldKeys.has('s')) direction = MapThrustDir.RETROGRADE;
  else if (_mapHeldKeys.has('a')) direction = MapThrustDir.RADIAL_IN;
  else if (_mapHeldKeys.has('d')) direction = MapThrustDir.RADIAL_OUT;

  const bodyId = _flightState.bodyId || 'EARTH';

  if (direction) {
    _ps.angle = computeOrbitalThrustAngle(_ps, bodyId, direction);
    if (_ps.throttle === 0) _ps.throttle = 1;
    _mapThrusting = true;
  } else if (_mapThrusting) {
    // No keys held — cut thrust.
    _ps.throttle = 0;
    _mapThrusting = false;
  }
}

// ---------------------------------------------------------------------------
// Private — control mode toggles
// ---------------------------------------------------------------------------

/**
 * Toggle docking mode on/off.
 * Only available in ORBIT phase. Shows a control tip on every switch.
 */
function _toggleDockingMode() {
  if (!_ps || !_flightState) return;

  if (_ps.controlMode === ControlMode.DOCKING || _ps.controlMode === ControlMode.RCS) {
    // Exit docking mode → NORMAL.
    const dockBodyId = (_flightState && _flightState.bodyId) || 'EARTH';
    const result = exitDockingMode(_ps, _flightState, dockBodyId);
    if (result.success) {
      _showPhaseNotification(CONTROL_MODE_TIPS[ControlMode.NORMAL]);
      _normalOrbitHeldKeys.clear();
      _normalOrbitThrusting = false;
    }
  } else {
    // Enter docking mode.
    const dockBodyId = (_flightState && _flightState.bodyId) || 'EARTH';
    const result = enterDockingMode(_ps, _flightState, dockBodyId);
    if (result.success) {
      _showPhaseNotification(CONTROL_MODE_TIPS[ControlMode.DOCKING]);
      // Force warp to 1× in docking mode.
      _applyTimeWarp(1);
    } else {
      _showPhaseNotification(result.reason || 'Cannot enter docking mode');
    }
  }
}

/**
 * Toggle RCS mode on/off.
 * If in docking mode, toggles RCS sub-mode.
 * If in NORMAL orbit mode, shows orbital-relative RCS tip.
 */
function _toggleRcsMode() {
  if (!_ps || !_assembly || !_flightState) return;

  if (_ps.controlMode === ControlMode.DOCKING || _ps.controlMode === ControlMode.RCS) {
    // Toggle RCS within docking mode.
    const result = toggleRcsMode(_ps, _assembly);
    if (result.success) {
      _showPhaseNotification(CONTROL_MODE_TIPS[_ps.controlMode]);
    } else {
      _showPhaseNotification(result.reason || 'Cannot toggle RCS');
    }
  } else if (_flightState.phase === FlightPhase.ORBIT) {
    // In NORMAL orbit mode, R shows the RCS orbit tip.
    _showPhaseNotification('RCS Orbit: W prograde, S retrograde, A radial-in, D radial-out');
  }
}

/**
 * Apply orbital-relative thrust from WASD in NORMAL orbit mode (flight view).
 * Similar to map-view thrust but operates from the flight view.
 * W=prograde, S=retrograde, A=radial-in, D=radial-out.
 */
function _applyNormalOrbitRcs() {
  if (_mapActive || !_ps || !_flightState) return;
  if (_ps.controlMode !== ControlMode.NORMAL) {
    if (_normalOrbitThrusting) {
      _ps.throttle = 0;
      _normalOrbitThrusting = false;
    }
    _normalOrbitHeldKeys.clear();
    return;
  }
  if (_flightState.phase !== FlightPhase.ORBIT && _flightState.phase !== FlightPhase.MANOEUVRE) {
    if (_normalOrbitThrusting) {
      _ps.throttle = 0;
      _normalOrbitThrusting = false;
    }
    _normalOrbitHeldKeys.clear();
    return;
  }

  let direction = null;
  if (_normalOrbitHeldKeys.has('w'))      direction = MapThrustDir.PROGRADE;
  else if (_normalOrbitHeldKeys.has('s')) direction = MapThrustDir.RETROGRADE;
  else if (_normalOrbitHeldKeys.has('a')) direction = MapThrustDir.RADIAL_IN;
  else if (_normalOrbitHeldKeys.has('d')) direction = MapThrustDir.RADIAL_OUT;

  const nBodyId = (_flightState && _flightState.bodyId) || 'EARTH';

  if (direction) {
    _ps.angle = computeOrbitalThrustAngle(_ps, nBodyId, direction);
    if (_ps.throttle === 0) _ps.throttle = 1;
    _normalOrbitThrusting = true;
  } else if (_normalOrbitThrusting) {
    _ps.throttle = 0;
    _normalOrbitThrusting = false;
  }
}

// ---------------------------------------------------------------------------
// Private — warp to target
// ---------------------------------------------------------------------------

/**
 * Handle the "Warp to target" action.
 * Uses the orbit.js warpToTarget function to advance time until the
 * craft and target satisfy proximity conditions.
 */
function _handleWarpToTarget() {
  if (!_flightState || !_flightState.orbitalElements || !_state) return;

  const targetId = getMapTarget();
  if (!targetId) {
    _showPhaseNotification('No target selected — press T to select');
    return;
  }

  const targetObj = (_state.orbitalObjects || []).find(o => o.id === targetId);
  if (!targetObj) {
    _showPhaseNotification('Target not found');
    return;
  }

  const warpBodyId = (_flightState && _flightState.bodyId) || 'EARTH';
  const result = warpToTarget(
    _flightState.orbitalElements,
    targetObj.elements,
    warpBodyId,
    _flightState.timeElapsed,
  );

  if (!result.possible) {
    _showPhaseNotification('Warp impossible — orbits do not intersect');
    return;
  }

  // Advance the flight time.
  _flightState.timeElapsed = result.time;

  // Log the warp event.
  _flightState.events.push({
    time: result.time,
    type: 'TIME_WARP',
    description: `Warped ${(result.elapsed / 60).toFixed(1)} min to target "${targetObj.name}"`,
  });

  _showPhaseNotification(`Warped to ${targetObj.name}`);
}

// ---------------------------------------------------------------------------
// Private — map HUD overlay
// ---------------------------------------------------------------------------

/** Human-readable zoom level names. */
const ZOOM_LABELS = {
  [MapZoom.ORBIT_DETAIL]:    'Orbit Detail',
  [MapZoom.LOCAL_BODY]:      'Local Body',
  [MapZoom.CRAFT_TO_TARGET]: 'Craft → Target',
  [MapZoom.SOLAR_SYSTEM]:    'Solar System',
};

/**
 * Build the map-view HUD overlay: info panel, controls hint, and warp button.
 */
function _buildMapHud() {
  if (_mapHud) return;

  const hud = document.createElement('div');
  hud.id = 'map-hud';

  // Info panel (top-left).
  const info = document.createElement('div');
  info.id = 'map-hud-info';
  info.innerHTML = `
    <div class="map-label">MAP VIEW</div>
    <div>Zoom: <span class="map-zoom" data-field="zoom"></span></div>
    <div>Body: <span data-field="body">Earth</span></div>
    <div>Target: <span class="map-target" data-field="target">None</span></div>
    <div>Phase: <span data-field="phase"></span></div>
    <div data-field="transfer-info" style="color:#ffcc44;margin-top:4px;display:none"></div>
    <div data-field="transfer-progress" style="color:#ff6644;margin-top:4px;display:none"></div>
  `;
  hud.appendChild(info);

  // Controls hint (bottom-centre).
  const controls = document.createElement('div');
  controls.id = 'map-hud-controls';
  controls.innerHTML =
    '<kbd>M</kbd> Flight view · ' +
    '<kbd>Tab</kbd> Zoom · ' +
    '<kbd>T</kbd> Target · ' +
    '<kbd>B</kbd> Transfer target · ' +
    '<kbd>G</kbd> Warp to target · ' +
    '<kbd>N</kbd> Shadow · ' +
    '<kbd>&lt;/&gt;</kbd> Time warp · ' +
    '<kbd>WASD</kbd> Orbital thrust';
  hud.appendChild(controls);

  // Warp to target button (top-right).
  const warpBtn = document.createElement('button');
  warpBtn.id = 'map-warp-btn';
  warpBtn.className = 'hidden';
  warpBtn.textContent = 'Warp to Target';
  warpBtn.addEventListener('click', _handleWarpToTarget);
  hud.appendChild(warpBtn);

  _mapHud = hud;
  const host = _container || document.getElementById('ui-overlay') || document.body;
  host.appendChild(hud);

  _updateMapHud();
}

/**
 * Update the map HUD readouts to reflect current state.
 */
function _updateMapHud() {
  if (!_mapHud || !_flightState) return;

  const zoomEl       = _mapHud.querySelector('[data-field="zoom"]');
  const bodyEl       = _mapHud.querySelector('[data-field="body"]');
  const targetEl     = _mapHud.querySelector('[data-field="target"]');
  const phaseEl      = _mapHud.querySelector('[data-field="phase"]');
  const warpBtn      = _mapHud.querySelector('#map-warp-btn');
  const transferEl   = _mapHud.querySelector('[data-field="transfer-info"]');
  const progressEl   = _mapHud.querySelector('[data-field="transfer-progress"]');

  if (zoomEl)   zoomEl.textContent = ZOOM_LABELS[getMapZoomLevel()] || getMapZoomLevel();
  if (phaseEl)  phaseEl.textContent = `${getPhaseLabel(_flightState.phase)}${_timeWarp > 1 ? ` (${_timeWarp}×)` : ''}`;

  // Show current celestial body.
  const bodyId = _flightState.bodyId || 'EARTH';
  const bodyNames = {
    SUN: 'Sun', MERCURY: 'Mercury', VENUS: 'Venus', EARTH: 'Earth',
    MOON: 'Moon', MARS: 'Mars', PHOBOS: 'Phobos', DEIMOS: 'Deimos',
  };
  if (bodyEl) bodyEl.textContent = bodyNames[bodyId] || bodyId;

  const targetId = getMapTarget();
  const targetObj = targetId && _state
    ? (_state.orbitalObjects || []).find(o => o.id === targetId)
    : null;
  if (targetEl)  targetEl.textContent = targetObj ? targetObj.name : 'None';
  if (warpBtn) {
    warpBtn.classList.toggle('hidden',
      !targetObj || !_flightState.orbitalElements || _flightState.phase !== FlightPhase.ORBIT);
  }

  // Transfer target route info.
  if (transferEl) {
    const transferTarget = getSelectedTransferTarget();
    if (transferTarget && _ps) {
      const alt = Math.max(0, _ps.posY);
      const targets = getMapTransferTargets(bodyId, alt, _flightState.phase);
      const t = targets.find(tt => tt.bodyId === transferTarget);
      if (t) {
        transferEl.textContent = `Route: ${t.name} — Depart Δv ${t.departureDVStr} — ${t.transferTimeStr}`;
        transferEl.style.display = '';
      } else {
        transferEl.style.display = 'none';
      }
    } else {
      transferEl.style.display = 'none';
    }
  }

  // Transfer progress during active TRANSFER/CAPTURE phase.
  if (progressEl) {
    const info = getTransferProgressInfo(_flightState.transferState, _flightState.timeElapsed);
    if (info) {
      const pct = Math.round(info.progress * 100);
      progressEl.textContent = `Transfer: ${info.originName} → ${info.destName} — ${pct}% — ETA: ${info.etaStr}`;
      progressEl.style.display = '';
    } else {
      progressEl.style.display = 'none';
    }
  }
}

/**
 * Remove the map HUD overlay.
 */
function _destroyMapHud() {
  if (_mapHud) {
    _mapHud.remove();
    _mapHud = null;
  }
}

// ---------------------------------------------------------------------------
// Private — in-flight control overlay
// ---------------------------------------------------------------------------

/**
 * Build the in-flight control overlay.
 * The hamburger menu has been consolidated into the top-bar dropdown.
 * This overlay now serves as a pointer-events pass-through layer for any
 * future flight-specific HUD controls.
 *
 * @param {HTMLElement} container
 */
function _buildFlightOverlay(container) {
  const overlay = document.createElement('div');
  overlay.id = 'flight-overlay';
  _flightOverlay = overlay;
  container.appendChild(overlay);
}

/**
 * Show, hide, or toggle the flight menu dropdown.
 *
 * @param {boolean|undefined} [forceState]  true = show, false = hide, undefined = toggle.
 */
function _toggleMenu(forceState) {
  const menu = document.getElementById('flight-menu');
  if (!menu) return;
  if (forceState === true)       menu.classList.remove('hidden');
  else if (forceState === false) menu.classList.add('hidden');
  else                           menu.classList.toggle('hidden');
}

// ---------------------------------------------------------------------------
// Private — menu action handlers
// ---------------------------------------------------------------------------

/**
 * Save the current game to the first available (empty) slot, or slot 0 as a
 * fallback if all slots are occupied.
 */
function _handleSaveGame() {
  if (!_state) return;

  const saves      = listSaves();
  let   targetSlot = saves.findIndex((s) => s === null);
  if (targetSlot < 0) targetSlot = 0;

  const saveName = `${_state.agencyName || 'Agency'} — In-Flight`;
  saveGame(_state, targetSlot, saveName);
  console.log(`[Flight Controller] Saved to slot ${targetSlot}`);
}

// ---------------------------------------------------------------------------
// Private — direct menu action handlers (no post-flight summary)
// ---------------------------------------------------------------------------

/**
 * Menu action: restart the current flight from the launch pad with the same
 * rocket and staging. Deducts cost of lost parts, deep-clones the original
 * assembly, then calls startFlightScene.
 */
function _handleMenuRestart() {
  // Remove post-flight summary if it's showing (e.g. after a crash).
  const existingSummary = document.getElementById('post-flight-summary');
  if (existingSummary) existingSummary.remove();
  _summaryShown = false;

  // Calculate full rocket rebuild cost.
  let totalRocketCost = 0;
  if (_assembly) {
    for (const [, placed] of _assembly.parts) {
      const def = getPartById(placed.partId);
      if (def) totalRocketCost += def.cost ?? 0;
    }
  }

  // Pause physics while the confirmation modal is showing.
  _preMenuTimeWarp = _timeWarp;
  _timeWarp = 0;

  const host = document.getElementById('ui-overlay') ?? document.body;
  const backdrop = document.createElement('div');
  backdrop.id = 'restart-flight-backdrop';
  backdrop.className = 'topbar-modal-backdrop';

  const modal = document.createElement('div');
  modal.className = 'topbar-modal';
  modal.setAttribute('role', 'alertdialog');
  modal.setAttribute('aria-modal', 'true');
  modal.setAttribute('aria-label', 'Restart Flight');
  modal.addEventListener('click', (e) => e.stopPropagation());

  // Title
  const titleRow = document.createElement('div');
  titleRow.className = 'topbar-modal-title-row';
  const h2 = document.createElement('h2');
  h2.className = 'topbar-modal-title';
  h2.textContent = 'Restart from Launch?';
  titleRow.appendChild(h2);
  modal.appendChild(titleRow);

  // Message
  const msg = document.createElement('p');
  msg.className = 'confirm-msg';
  msg.textContent = 'This will end the current flight and rebuild the rocket from scratch.';
  modal.appendChild(msg);

  if (totalRocketCost > 0) {
    const costLine = document.createElement('p');
    costLine.className = 'confirm-msg';
    costLine.style.fontWeight = '600';
    costLine.style.marginTop = '-12px';
    costLine.textContent = `Rebuild cost: −$${totalRocketCost.toLocaleString('en-US')}`;
    modal.appendChild(costLine);
  }

  // Buttons
  const btnRow = document.createElement('div');
  btnRow.className = 'confirm-btn-row';

  const cancelBtn = document.createElement('button');
  cancelBtn.className = 'confirm-btn confirm-btn-cancel';
  cancelBtn.textContent = 'Cancel';
  cancelBtn.addEventListener('click', () => {
    _timeWarp = _preMenuTimeWarp ?? 1;
    backdrop.remove();
  });

  const confirmBtn = document.createElement('button');
  confirmBtn.className = 'confirm-btn confirm-btn-danger';
  confirmBtn.textContent = 'Restart';
  confirmBtn.addEventListener('click', () => {
    backdrop.remove();
    _executeRestart(totalRocketCost);
  });

  btnRow.appendChild(cancelBtn);
  btnRow.appendChild(confirmBtn);
  modal.appendChild(btnRow);

  backdrop.addEventListener('click', () => {
    _timeWarp = _preMenuTimeWarp ?? 1;
    backdrop.remove();
  });
  backdrop.appendChild(modal);
  host.appendChild(backdrop);
}

/**
 * Execute the restart-from-launch action after confirmation.
 * @param {number} rebuildCost  Total rocket cost to deduct.
 */
function _executeRestart(rebuildCost) {
  if (rebuildCost > 0 && _state) {
    _state.money = (_state.money ?? 0) - rebuildCost;
  }

  // Capture references before stopFlightScene nulls them.
  const origAssembly = _originalAssembly;
  const origStaging  = _originalStagingConfig;
  const ctr          = _container;
  const gs           = _state;
  const endCb        = _onFlightEnd;
  const missionId    = _flightState?.missionId ?? '';
  const rocketId     = _flightState?.rocketId  ?? '';
  const crewIds      = _flightState?.crewIds   ?? [];

  stopFlightScene();

  // If originals are missing, fall back to returning to hub.
  if (!origAssembly || !origStaging || !ctr || !gs) {
    if (endCb) endCb(gs);
    return;
  }

  // Recompute total fuel from the original (unmodified) assembly.
  let totalFuel = 0;
  for (const placed of origAssembly.parts.values()) {
    const def = getPartById(placed.partId);
    if (def) totalFuel += def.properties?.fuelMass ?? 0;
  }

  // Reset ALL accepted mission objectives so they re-evaluate on the fresh flight.
  if (gs.missions?.accepted) {
    for (const mission of gs.missions.accepted) {
      if (!mission.objectives) continue;
      for (const obj of mission.objectives) {
        obj.completed = false;
        delete obj._holdEnteredAt;
      }
    }
  }

  // Fresh flight state.
  gs.currentFlight = {
    missionId,
    rocketId,
    crewIds,
    timeElapsed:     0,
    altitude:        0,
    velocity:        0,
    fuelRemaining:   totalFuel,
    deltaVRemaining: 0,
    events:          [],
    aborted:         false,
  };

  // Deep-clone the originals so the new flight gets pristine copies.
  const freshAssembly = {
    parts:         new Map([...origAssembly.parts].map(([id, p]) => [id, { ...p, ...(p.instruments ? { instruments: [...p.instruments] } : {}) }])),
    connections:   origAssembly.connections.map(c => ({ ...c })),
    symmetryPairs: origAssembly.symmetryPairs.map(sp => [...sp]),
    _nextId:       origAssembly._nextId,
  };
  const freshStaging = {
    stages:          origStaging.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
    unstaged:        [...origStaging.unstaged],
    currentStageIdx: 0,
  };

  startFlightScene(ctr, gs, freshAssembly, freshStaging, gs.currentFlight, endCb);
}

/**
 * Menu action: return to the VAB with the current rocket design loaded so the
 * player can tweak parts/staging and re-launch.
 */
function _handleMenuAdjustBuild() {
  // Remove post-flight summary if it's showing.
  const summary = document.getElementById('post-flight-summary');
  if (summary) summary.remove();
  _summaryShown = false;

  const origAssembly = _originalAssembly;
  const origStaging  = _originalStagingConfig;
  const gs           = _state;
  const endCb        = _onFlightEnd;

  // Store the pristine assembly on gameState so the VAB can restore it.
  if (origAssembly && gs) {
    gs.vabAssembly = {
      parts:         [...origAssembly.parts.values()],
      connections:   origAssembly.connections,
      symmetryPairs: origAssembly.symmetryPairs,
      _nextId:       origAssembly._nextId,
    };
    gs.vabStagingConfig = origStaging ? {
      stages:          origStaging.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
      unstaged:        [...origStaging.unstaged],
      currentStageIdx: 0,
    } : null;
  }

  stopFlightScene();
  if (endCb) endCb(gs, null, 'vab');
}

// ---------------------------------------------------------------------------
// Flight Log
// ---------------------------------------------------------------------------

/** Format elapsed flight seconds as `T+MM:SS`. */
function _formatFlightTime(seconds) {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `T+${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** Colour for the event-type dot in the flight log. */
function _eventDotColor(type) {
  switch (type) {
    case 'PART_ACTIVATED':
    case 'LEG_DEPLOYED':
    case 'PARACHUTE_DEPLOYED':
    case 'LANDING':
      return '#40e060';
    case 'PART_DESTROYED':
    case 'CRASH':
    case 'PARACHUTE_FAILED':
      return '#ff5040';
    case 'CREW_EJECTED':
      return '#60a0ff';
    case 'SATELLITE_RELEASED':
    case 'SCIENCE_COLLECTED':
    case 'SCIENCE_DATA_RETURNED':
      return '#f0d040';
    case 'PHASE_CHANGE':
      return '#80c0ff';
    default:
      return '#8090a0';
  }
}

/**
 * Build the flight event list DOM element from an array of events.
 * @param {Array<object>} events
 * @returns {HTMLElement}  A <ul> or <p> element.
 */
function _buildFlightEventList(events) {
  if (!events || events.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'fl-empty';
    empty.textContent = 'No events recorded.';
    return empty;
  }

  const list = document.createElement('ul');
  list.className = 'fl-list';

  for (const evt of events) {
    const li = document.createElement('li');
    li.className = 'fl-event';

    const dot = document.createElement('span');
    dot.className = 'fl-event-dot';
    dot.style.background = _eventDotColor(evt.type);

    const time = document.createElement('span');
    time.className = 'fl-event-time';
    time.textContent = _formatFlightTime(evt.time ?? 0);

    const desc = document.createElement('span');
    desc.className = 'fl-event-desc';
    desc.textContent = evt.description ?? evt.type;

    li.appendChild(dot);
    li.appendChild(time);
    li.appendChild(desc);
    list.appendChild(li);
  }

  return list;
}

/** Menu action: show the flight log overlay. */
function _handleMenuFlightLog() {
  const host = document.getElementById('ui-overlay') ?? document.body;

  // Remove any existing log overlay.
  const existing = document.getElementById('flight-log-overlay');
  if (existing) existing.remove();

  // Ensure game stays paused (dropdown toggle callback already set _timeWarp=0).
  const savedWarp = _preMenuTimeWarp;
  _timeWarp = 0;

  // ── Root overlay ─────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'flight-log-overlay';

  const content = document.createElement('div');
  content.className = 'fl-content';
  overlay.appendChild(content);

  // Heading
  const heading = document.createElement('h1');
  heading.textContent = 'Flight Log';
  content.appendChild(heading);

  // Event list
  const events = _flightState ? _flightState.events : [];
  content.appendChild(_buildFlightEventList(events));

  // Close button
  const closeBtn = document.createElement('button');
  closeBtn.className = 'fl-close-btn';
  closeBtn.textContent = 'Close';
  closeBtn.addEventListener('click', () => {
    overlay.remove();
    _timeWarp = savedWarp || 1;
  });
  content.appendChild(closeBtn);

  // Backdrop click closes the log (matching abort modal pattern).
  overlay.addEventListener('click', () => {
    overlay.remove();
    _timeWarp = savedWarp || 1;
  });
  content.addEventListener('click', (e) => e.stopPropagation());

  host.appendChild(overlay);
}

/**
 * Menu action: process end-of-flight results (mission completion, part
 * recovery, etc.) and return to the Space Agency hub.
 *
 * Phase-aware behaviour:
 *   - TRANSFER / CAPTURE: blocked entirely (player is locked).
 *   - ORBIT: allowed with a brief confirmation warning.
 *   - FLIGHT / LAUNCH / PRELAUNCH: abort warning (parts at risk).
 *   - Landed / Crashed: go straight to summary.
 */
function _handleMenuReturnToAgency() {
  const phase = _flightState ? _flightState.phase : null;

  // --- Block return during TRANSFER / CAPTURE (player locked) ---
  if (_ps && phase && isPlayerLocked(phase)) {
    // Show a brief locked notification — no modal needed.
    _showPhaseNotification('Cannot leave during ' + getPhaseLabel(phase));
    return;
  }

  // --- ORBIT: direct return with a brief warning ---
  if (_ps && phase === FlightPhase.ORBIT && !_ps.landed && !_ps.crashed) {
    _preMenuTimeWarp = _timeWarp;
    _timeWarp = 0;

    const host = document.getElementById('ui-overlay') ?? document.body;
    const backdrop = document.createElement('div');
    backdrop.id = 'abort-flight-backdrop';
    backdrop.className = 'topbar-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'topbar-modal';
    modal.setAttribute('role', 'alertdialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Return from Orbit');
    modal.addEventListener('click', (e) => e.stopPropagation());

    const titleRow = document.createElement('div');
    titleRow.className = 'topbar-modal-title-row';
    const h2 = document.createElement('h2');
    h2.className = 'topbar-modal-title';
    h2.textContent = 'Return from Orbit?';
    titleRow.appendChild(h2);
    modal.appendChild(titleRow);

    const msg = document.createElement('p');
    msg.className = 'confirm-msg';
    msg.textContent =
      'Your craft is in a stable orbit. Returning to the agency will complete this flight period. The craft will remain in orbit.';
    modal.appendChild(msg);

    const btnRow = document.createElement('div');
    btnRow.className = 'confirm-btn-row';

    const continueBtn = document.createElement('button');
    continueBtn.className = 'confirm-btn confirm-btn-cancel';
    continueBtn.textContent = 'Stay in Orbit';
    continueBtn.dataset.testid = 'abort-continue-btn';
    continueBtn.addEventListener('click', () => {
      _timeWarp = _preMenuTimeWarp ?? 1;
      backdrop.remove();
    });

    const returnBtn = document.createElement('button');
    returnBtn.className = 'confirm-btn confirm-btn-primary';
    returnBtn.textContent = 'Return to Agency';
    returnBtn.dataset.testid = 'orbit-return-btn';
    returnBtn.addEventListener('click', () => {
      backdrop.remove();
      _handleReturnToAgency();
    });

    btnRow.appendChild(continueBtn);
    btnRow.appendChild(returnBtn);
    modal.appendChild(btnRow);

    backdrop.addEventListener('click', () => {
      _timeWarp = _preMenuTimeWarp ?? 1;
      backdrop.remove();
    });
    backdrop.appendChild(modal);
    host.appendChild(backdrop);
    return;
  }

  // --- Mid-flight abort: warn about lost parts ---
  if (_ps && !_ps.landed && !_ps.crashed) {
    // Pause physics while the abort confirmation modal is showing.
    _preMenuTimeWarp = _timeWarp;
    _timeWarp = 0;

    // Calculate total cost of active parts at risk.
    let totalCost = 0;
    if (_assembly) {
      for (const [instanceId, placed] of _assembly.parts) {
        if (!_ps.activeParts.has(instanceId)) continue;
        const def = getPartById(placed.partId);
        if (def) totalCost += def.cost ?? 0;
      }
    }

    const host = document.getElementById('ui-overlay') ?? document.body;
    const backdrop = document.createElement('div');
    backdrop.id = 'abort-flight-backdrop';
    backdrop.className = 'topbar-modal-backdrop';

    const modal = document.createElement('div');
    modal.className = 'topbar-modal';
    modal.setAttribute('role', 'alertdialog');
    modal.setAttribute('aria-modal', 'true');
    modal.setAttribute('aria-label', 'Abort Flight');
    modal.addEventListener('click', (e) => e.stopPropagation());

    // Title
    const titleRow = document.createElement('div');
    titleRow.className = 'topbar-modal-title-row';
    const h2 = document.createElement('h2');
    h2.className = 'topbar-modal-title';
    h2.textContent = 'Abort Flight?';
    titleRow.appendChild(h2);
    modal.appendChild(titleRow);

    // Message
    const msg = document.createElement('p');
    msg.className = 'confirm-msg';
    const costStr = '$' + Math.round(totalCost).toLocaleString('en-US');
    msg.textContent =
      'Your rocket is still in flight. Returning now means no parts will be recovered.';
    modal.appendChild(msg);

    const costLine = document.createElement('p');
    costLine.className = 'confirm-msg';
    costLine.style.fontWeight = '600';
    costLine.style.marginTop = '-12px';
    costLine.textContent = `Parts at risk: ${costStr}`;
    modal.appendChild(costLine);

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.className = 'confirm-btn-row';

    const continueBtn = document.createElement('button');
    continueBtn.className = 'confirm-btn confirm-btn-cancel';
    continueBtn.textContent = 'Continue Flying';
    continueBtn.dataset.testid = 'abort-continue-btn';
    continueBtn.addEventListener('click', () => {
      _timeWarp = _preMenuTimeWarp ?? 1;
      backdrop.remove();
    });

    const abortBtn = document.createElement('button');
    abortBtn.className = 'confirm-btn confirm-btn-danger';
    abortBtn.textContent = 'Abort & Return';
    abortBtn.dataset.testid = 'abort-confirm-btn';
    abortBtn.addEventListener('click', () => {
      backdrop.remove();
      _handleAbortReturnToAgency();
    });

    btnRow.appendChild(continueBtn);
    btnRow.appendChild(abortBtn);
    modal.appendChild(btnRow);

    backdrop.addEventListener('click', () => {
      _timeWarp = _preMenuTimeWarp ?? 1;
      backdrop.remove();
    });
    backdrop.appendChild(modal);
    host.appendChild(backdrop);
    return;
  }

  // Already landed or crashed — go straight to the summary.
  _handleReturnToAgency();
}

/**
 * Show the post-flight summary screen.
 * Auto-triggered when the rocket crashes or all command modules are destroyed.
 * Does NOT tear down the flight scene immediately — the summary's action
 * buttons handle that so the player can choose "Continue Flying" if landed.
 */
function _handleReturnToAgency() {
  if (_summaryShown) return; // Already showing — ignore duplicate calls.
  _summaryShown = true;
  _showPostFlightSummary(_ps, _assembly, _flightState, _state, _onFlightEnd);
}

/**
 * Handle abort: skip the post-flight summary and return directly to the hub.
 * The player already confirmed the abort in the modal, so we process the
 * flight return immediately and call onFlightEnd.
 */
function _handleAbortReturnToAgency() {
  if (_summaryShown) return;
  _summaryShown = true;

  // Capture references before stopFlightScene nulls them.
  const state       = _state;
  const flightState = _flightState;
  const ps          = _ps;
  const assembly    = _assembly;
  const onFlightEnd = _onFlightEnd;

  let returnResults = null;
  if (state && flightState) {
    returnResults = processFlightReturn(state, flightState, ps, assembly);
  }

  refreshTopBar();
  stopFlightScene();
  if (onFlightEnd) onFlightEnd(state, returnResults);
}

// ---------------------------------------------------------------------------
// Private — post-flight summary screen
// ---------------------------------------------------------------------------

/**
 * Build and display the post-flight summary overlay.
 *
 * Shows:
 *  1. Flight outcome (destroyed / landed safely / mission in progress).
 *  2. Mission objectives completed this flight.
 *  3. Part recovery table (landed safely only).
 *  4. Crew KIA with fines.
 *  5. Action buttons: Restart from Launch (crash only), Continue Flying
 *     (landed only), Adjust Build, Return to Space Agency.
 *
 * The flight scene is NOT torn down before this is called — the action
 * buttons handle teardown so the player may choose "Continue Flying".
 *
 * @param {import('../core/physics.js').PhysicsState|null}           ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly|null}   assembly
 * @param {import('../core/gameState.js').FlightState|null}          flightState
 * @param {import('../core/gameState.js').GameState|null}            state
 * @param {((state: any) => void)|null}                              onFlightEnd
 */
function _showPostFlightSummary(ps, assembly, flightState, state, onFlightEnd) {
  // Use the #ui-overlay container; fall back to document.body.
  const host = document.getElementById('ui-overlay') ?? document.body;

  // Remove any stale summary overlay.
  const existing = document.getElementById('post-flight-summary');
  if (existing) existing.remove();

  // Hide the flight HUD while the summary is displayed.
  const hudEl = document.getElementById('flight-hud');
  if (hudEl) hudEl.style.display = 'none';

  // ── Determine outcome ────────────────────────────────────────────────────
  const isLanded    = !!(ps && ps.landed && !ps.crashed);
  const isCrashed   = !!(ps && ps.crashed);
  // "Mission in progress" covers mid-flight abort and launch-pad exit.

  // ── Root overlay ─────────────────────────────────────────────────────────
  const overlay = document.createElement('div');
  overlay.id = 'post-flight-summary';

  // Scrollable content wrapper.
  const content = document.createElement('div');
  content.className = 'pf-content';
  overlay.appendChild(content);

  // ── 1. Flight outcome heading ─────────────────────────────────────────────
  const heading = document.createElement('h1');
  if (isCrashed) {
    heading.textContent  = 'Rocket Destroyed';
    heading.style.color  = '#ff6040';
  } else if (isLanded) {
    heading.textContent  = 'Landed Safely';
    heading.style.color  = '#40e060';
  } else {
    heading.textContent  = 'Mission In Progress';
    heading.style.color  = '#80c8ff';
  }
  content.appendChild(heading);

  // ── 2. Mission objectives (all accepted + just-completed missions) ────────
  if (state) {
    const allMissions = [...(state.missions?.accepted ?? [])];
    const missionsWithObjectives = allMissions.filter(
      (m) => Array.isArray(m.objectives) && m.objectives.length > 0,
    );

    for (const mission of missionsWithObjectives) {
      const section = document.createElement('div');
      section.className = 'pf-section';

      const sectionTitle = document.createElement('h2');
      sectionTitle.textContent = `Mission: ${mission.title}`;
      section.appendChild(sectionTitle);

      const objList = document.createElement('ul');
      objList.className = 'pf-obj-list';

      for (const obj of mission.objectives) {
        const li = document.createElement('li');
        li.className = obj.completed ? 'pf-obj-complete' : 'pf-obj-incomplete';

        const check = document.createElement('span');
        check.className = 'pf-obj-check';
        check.textContent = obj.completed ? '✓' : '✗';

        const desc = document.createElement('span');
        desc.textContent = obj.description ?? String(obj.type);

        li.appendChild(check);
        li.appendChild(desc);
        objList.appendChild(li);
      }

      section.appendChild(objList);
      content.appendChild(section);
    }
  }

  // ── 3. Part recovery table (landed safely only) ───────────────────────────
  if (isLanded && assembly && ps) {
    const section = document.createElement('div');
    section.className = 'pf-section';

    const sectionTitle = document.createElement('h2');
    sectionTitle.textContent = 'Part Recovery (60 % of cost)';
    section.appendChild(sectionTitle);

    const table = document.createElement('table');
    table.className = 'pf-recovery-table';

    // Header row.
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Part', 'Recovery Value'].forEach((text) => {
      const th = document.createElement('th');
      th.textContent = text;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Body rows.
    const tbody = document.createElement('tbody');
    let totalRecovery = 0;

    for (const [instanceId, placed] of assembly.parts) {
      if (!ps.activeParts.has(instanceId)) continue;
      const def = getPartById(placed.partId);
      if (!def) continue;

      const recoveryValue = Math.round((def.cost ?? 0) * 0.6);
      totalRecovery += recoveryValue;

      const row = document.createElement('tr');

      const nameTd = document.createElement('td');
      nameTd.textContent = def.name;

      const valueTd = document.createElement('td');
      valueTd.textContent = `$${recoveryValue.toLocaleString('en-US')}`;

      row.appendChild(nameTd);
      row.appendChild(valueTd);
      tbody.appendChild(row);
    }

    // Total row.
    const totalRow = document.createElement('tr');
    totalRow.className = 'pf-recovery-total';

    const totalLabelTd = document.createElement('td');
    totalLabelTd.textContent = 'Total Recovery';

    const totalValueTd = document.createElement('td');
    totalValueTd.textContent = `$${totalRecovery.toLocaleString('en-US')}`;

    totalRow.appendChild(totalLabelTd);
    totalRow.appendChild(totalValueTd);
    tbody.appendChild(totalRow);

    table.appendChild(tbody);
    section.appendChild(table);
    content.appendChild(section);
  }

  // ── 4. Crew KIA with fines ────────────────────────────────────────────────
  if (flightState && Array.isArray(flightState.crewIds) && flightState.crewIds.length > 0 && state) {
    // Crew are KIA if the rocket crashed and they did not safely eject.
    const ejectedIds = ps?.ejectedCrewIds ?? new Set();
    const kiaMembers = [];

    if (isCrashed || _allCommandModulesDestroyedFor(ps, assembly)) {
      for (const crewId of flightState.crewIds) {
        if (ejectedIds.has(crewId)) continue; // Ejected safely — not KIA.
        const member = (state.crew ?? []).find((c) => c.id === crewId);
        if (member) kiaMembers.push(member);
      }
    }

    if (kiaMembers.length > 0) {
      const section = document.createElement('div');
      section.className = 'pf-section pf-section-danger';

      const sectionTitle = document.createElement('h2');
      sectionTitle.textContent = 'Crew KIA';
      section.appendChild(sectionTitle);

      const kiaList = document.createElement('ul');
      kiaList.className = 'pf-kia-list';

      for (const member of kiaMembers) {
        const li = document.createElement('li');

        const nameSp = document.createElement('span');
        nameSp.textContent = member.name;

        const fineSp = document.createElement('span');
        fineSp.className = 'pf-kia-fine';
        fineSp.textContent = `−$${DEATH_FINE_PER_ASTRONAUT.toLocaleString('en-US')} fine`;

        li.appendChild(nameSp);
        li.appendChild(fineSp);
        kiaList.appendChild(li);
      }

      section.appendChild(kiaList);

      const totalFine = kiaMembers.length * DEATH_FINE_PER_ASTRONAUT;
      const totalEl = document.createElement('div');
      totalEl.className = 'pf-kia-total';
      totalEl.textContent = `Total fines: −$${totalFine.toLocaleString('en-US')}`;
      section.appendChild(totalEl);

      content.appendChild(section);
    }
  }

  // ── 4b. Flight log ────────────────────────────────────────────────────────
  if (flightState?.events?.length > 0) {
    const logSection = document.createElement('div');
    logSection.className = 'pf-section';
    const logTitle = document.createElement('h2');
    logTitle.textContent = 'Flight Log';
    logSection.appendChild(logTitle);
    logSection.appendChild(_buildFlightEventList(flightState.events));
    content.appendChild(logSection);
  }

  // ── 5. Action buttons ─────────────────────────────────────────────────────

  // Calculate the total rocket build cost (for restart / adjust build)
  // and the recovery value of surviving parts (60% of cost, landed only).
  let totalRocketCost = 0;
  let recoveryValue = 0;
  if (assembly) {
    for (const [instanceId, placed] of assembly.parts) {
      const def = getPartById(placed.partId);
      if (!def) continue;
      totalRocketCost += def.cost ?? 0;
      if (isLanded && ps && ps.activeParts.has(instanceId)) {
        recoveryValue += Math.round((def.cost ?? 0) * 0.6);
      }
    }
  }

  const buttonsEl = document.createElement('div');
  buttonsEl.className = 'pf-buttons';

  // Helper: create a button with an optional cost subtitle line.
  function _pfBtn(label, costText, cls) {
    const btn = document.createElement('button');
    btn.className = `pf-btn ${cls}`;
    const labelSpan = document.createElement('span');
    labelSpan.textContent = label;
    btn.appendChild(labelSpan);
    if (costText) {
      const costSpan = document.createElement('span');
      costSpan.className = 'pf-btn-cost';
      costSpan.textContent = costText;
      btn.appendChild(costSpan);
    }
    return btn;
  }

  const costStr = totalRocketCost > 0
    ? `−$${totalRocketCost.toLocaleString('en-US')}`
    : null;

  // ── Row of secondary actions (side by side) ────────────────────────────────
  const secondaryRow = document.createElement('div');
  secondaryRow.className = 'pf-btn-row';

  if (isCrashed) {
    // ── "Restart from Launch" ──────────────────────────────────────────────
    const restartBtn = _pfBtn('Restart from Launch', costStr, 'pf-btn-secondary');
    restartBtn.id    = 'post-flight-restart-btn';
    restartBtn.title = 'Rebuild the rocket and restart this flight from the launch pad.';

    restartBtn.addEventListener('click', () => {
      if (totalRocketCost > 0 && state) {
        state.money = (state.money ?? 0) - totalRocketCost;
      }

      const origAssembly = _originalAssembly;
      const origStaging  = _originalStagingConfig;
      const ctr          = _container;
      const gs           = _state;
      const endCb        = _onFlightEnd;
      const missionId    = flightState?.missionId ?? '';
      const rocketId     = flightState?.rocketId  ?? '';
      const crewIds      = flightState?.crewIds   ?? [];

      overlay.remove();
      stopFlightScene();

      if (!origAssembly || !origStaging || !ctr || !gs) {
        if (endCb) endCb(gs);
        return;
      }

      let totalFuel = 0;
      for (const placed of origAssembly.parts.values()) {
        const def = getPartById(placed.partId);
        if (def) totalFuel += def.properties?.fuelMass ?? 0;
      }

      // Reset ALL accepted mission objectives so they re-evaluate on the fresh flight.
      if (gs.missions?.accepted) {
        for (const mission of gs.missions.accepted) {
          if (!mission.objectives) continue;
          for (const obj of mission.objectives) {
            obj.completed = false;
            delete obj._holdEnteredAt;
          }
        }
      }

      gs.currentFlight = {
        missionId, rocketId, crewIds,
        timeElapsed: 0, altitude: 0, velocity: 0,
        fuelRemaining: totalFuel, deltaVRemaining: 0,
        events: [], aborted: false,
      };

      const freshAssembly = {
        parts:         new Map([...origAssembly.parts].map(([id, p]) => [id, { ...p, ...(p.instruments ? { instruments: [...p.instruments] } : {}) }])),
        connections:   origAssembly.connections.map(c => ({ ...c })),
        symmetryPairs: origAssembly.symmetryPairs.map(sp => [...sp]),
        _nextId:       origAssembly._nextId,
      };
      const freshStaging = {
        stages:          origStaging.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
        unstaged:        [...origStaging.unstaged],
        currentStageIdx: 0,
      };

      startFlightScene(ctr, gs, freshAssembly, freshStaging, gs.currentFlight, endCb);
    });
    secondaryRow.appendChild(restartBtn);
  }

  if (!isCrashed) {
    // ── "Continue Flying" ─────────────────────────────────────────────────
    const continueBtn = _pfBtn('Continue Flying', null, 'pf-btn-secondary');
    continueBtn.id    = 'post-flight-continue-btn';
    continueBtn.title = 'Close this summary and continue controlling the landed rocket.';
    continueBtn.addEventListener('click', () => {
      _summaryShown = false;
      overlay.remove();
      const hud = document.getElementById('flight-hud');
      if (hud) hud.style.display = '';
    });
    secondaryRow.appendChild(continueBtn);
  }

  // ── "Adjust Build" ────────────────────────────────────────────────────────
  {
    const adjustBtn = _pfBtn('Adjust Build', costStr, 'pf-btn-secondary');
    adjustBtn.id    = 'post-flight-adjust-btn';
    adjustBtn.title = 'Return to the Vehicle Assembly Building with this rocket loaded so you can tweak and re-launch.';
    adjustBtn.addEventListener('click', () => {
      if (totalRocketCost > 0 && state) {
        state.money = (state.money ?? 0) - totalRocketCost;
      }

      const origAssembly = _originalAssembly;
      const origStaging  = _originalStagingConfig;
      if (origAssembly && state) {
        state.vabAssembly = {
          parts:         [...origAssembly.parts.values()],
          connections:   origAssembly.connections,
          symmetryPairs: origAssembly.symmetryPairs,
          _nextId:       origAssembly._nextId,
        };
        state.vabStagingConfig = origStaging ? {
          stages:          origStaging.stages.map(s => ({ instanceIds: [...s.instanceIds] })),
          unstaged:        [...origStaging.unstaged],
          currentStageIdx: 0,
        } : null;
      }

      overlay.remove();
      stopFlightScene();
      if (onFlightEnd) onFlightEnd(state, null, 'vab');
    });
    secondaryRow.appendChild(adjustBtn);
  }

  buttonsEl.appendChild(secondaryRow);

  // ── "Return to Space Agency" button (full width, primary) ─────────────────
  const recoveryCostStr = recoveryValue > 0
    ? `+$${recoveryValue.toLocaleString('en-US')} part recovery`
    : null;
  const returnBtn = _pfBtn('Return to Space Agency', recoveryCostStr, 'pf-btn-primary');
  returnBtn.id    = 'post-flight-return-btn';
  returnBtn.title = 'End this flight, process mission results and part recovery, and return to your Space Agency hub.';
  returnBtn.addEventListener('click', () => {
    // Process all end-of-flight game-state changes (mission completion,
    // part recovery, loan interest, death fines, flight history) and collect
    // the summary for the "Return Results" overlay shown on the hub.
    let returnResults = null;
    if (state && flightState) {
      returnResults = processFlightReturn(state, flightState, ps, assembly);
    }

    refreshTopBar();
    overlay.remove();
    stopFlightScene();
    if (onFlightEnd) onFlightEnd(state, returnResults);
  });
  buttonsEl.appendChild(returnBtn);

  content.appendChild(buttonsEl);

  // Backdrop-click handling (matching abort modal pattern).
  content.addEventListener('click', (e) => e.stopPropagation());
  if (!isCrashed) {
    overlay.addEventListener('click', () => {
      _summaryShown = false;
      overlay.remove();
      const hud = document.getElementById('flight-hud');
      if (hud) hud.style.display = '';
    });
  }

  host.appendChild(overlay);
}

/**
 * Pure helper (no module state): returns true when all COMMAND_MODULE parts
 * in the given assembly are absent from `ps.activeParts`.
 *
 * Separated from `_allCommandModulesDestroyed()` so `_showPostFlightSummary`
 * can call it without touching module-level state.
 *
 * @param {import('../core/physics.js').PhysicsState|null} ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly|null} assembly
 * @returns {boolean}
 */
function _allCommandModulesDestroyedFor(ps, assembly) {
  if (!assembly || !ps) return false;

  let hadCommandModule = false;
  for (const [instanceId, placed] of assembly.parts) {
    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.COMMAND_MODULE) continue;
    hadCommandModule = true;
    if (ps.activeParts.has(instanceId)) return false;
  }
  return hadCommandModule;
}

// ---------------------------------------------------------------------------
// Docking system helpers
// ---------------------------------------------------------------------------

/**
 * Tick the docking system each frame.
 * @param {number} dt  Real delta time (seconds).
 */
function _tickDockingSystem(dt) {
  if (!_ps || !_assembly || !_flightState || !_state) return;

  const dockingState = _flightState.dockingState;
  if (!dockingState) return;

  // Only tick docking when in ORBIT phase.
  if (_flightState.phase !== FlightPhase.ORBIT) {
    if (dockingState.state !== DockingState.IDLE && dockingState.state !== DockingState.DOCKED) {
      clearDockingTarget(dockingState);
    }
    return;
  }

  // Update combined mass on physics state for thrust calculations.
  _ps._dockedCombinedMass = dockingState.combinedMass;

  const result = tickDocking(dockingState, _ps, _assembly, _flightState, _state, dt);

  if (result.docked) {
    _showPhaseNotification('Docking Complete!');
    // Set all docking ports to 'docked' state.
    for (const [instanceId, portState] of _ps.dockingPortStates) {
      if (portState === 'extended') {
        _ps.dockingPortStates.set(instanceId, 'docked');
      }
    }
  }

  if (result.event === 'AUTO_DOCK_ABORT') {
    _showPhaseNotification('Auto-dock aborted — moved too far', 'warning');
  }
}

/**
 * Cycle through available docking targets in visual range.
 */
function _cycleDockingTarget() {
  if (!_ps || !_assembly || !_flightState || !_state) return;

  const dockingState = _flightState.dockingState;
  if (!dockingState) return;

  // If already docked, can't select new target.
  if (dockingState.state === DockingState.DOCKED) {
    _showPhaseNotification('Already docked — press U to undock');
    return;
  }

  if (!hasDockingPort(_ps, _assembly)) {
    _showPhaseNotification('No docking port on craft');
    return;
  }

  const targets = getTargetsInVisualRange(_ps, _flightState, _state);
  const dockable = targets.filter(t => canDockWith(t.object));

  if (dockable.length === 0) {
    _showPhaseNotification('No docking targets in range');
    clearDockingTarget(dockingState);
    return;
  }

  // Find current target index and cycle to next.
  const currentIdx = dockable.findIndex(t => t.object.id === dockingState.targetId);
  const nextIdx = (currentIdx + 1) % dockable.length;
  const nextTarget = dockable[nextIdx];

  const result = selectDockingTarget(dockingState, nextTarget.object.id, _ps, _assembly);
  if (result.success) {
    _showPhaseNotification(`Docking target: ${nextTarget.object.name} (${Math.round(nextTarget.distance)} m)`);
    // Extend docking ports.
    for (const [instanceId, portState] of _ps.dockingPortStates) {
      if (portState === 'retracted') {
        _ps.dockingPortStates.set(instanceId, 'extended');
      }
    }
    // Also set this as the map target for visibility.
    setMapTarget(nextTarget.object.id);
  } else {
    _showPhaseNotification(result.reason || 'Cannot select target');
  }
}

/**
 * Handle undocking from the current docked vessel.
 */
function _handleUndock() {
  if (!_ps || !_assembly || !_flightState || !_state) return;

  const dockingState = _flightState.dockingState;
  if (!dockingState || dockingState.state !== DockingState.DOCKED) {
    return;
  }

  const result = undock(dockingState, _ps, _assembly, _flightState, _state);
  if (result.success) {
    _showPhaseNotification('Undocked');
    // Reset docking port states.
    for (const [instanceId] of _ps.dockingPortStates) {
      _ps.dockingPortStates.set(instanceId, 'retracted');
    }
    _ps._dockedCombinedMass = 0;
  }
}

/**
 * Handle fuel transfer from docked depot.
 */
function _handleFuelTransfer() {
  if (!_ps || !_assembly || !_flightState) return;

  const dockingState = _flightState.dockingState;
  if (!dockingState) return;

  // Transfer up to 500 kg at a time.
  const result = transferFuel(dockingState, _ps, _assembly, _flightState, 500);
  if (result.success && result.transferred > 0) {
    _showPhaseNotification(`Transferred ${Math.round(result.transferred)} kg fuel`);
  } else if (result.transferred === 0) {
    _showPhaseNotification('Tanks are full');
  }
}

/**
 * Build or update the docking guidance HUD overlay.
 */
function _updateDockingHud() {
  if (!_flightState || !_flightState.dockingState) {
    _destroyDockingHud();
    return;
  }

  const guidance = getDockingGuidance(_flightState.dockingState);

  if (!guidance.active) {
    _destroyDockingHud();
    return;
  }

  // Create the HUD element if it doesn't exist.
  if (!_dockingHud && _container) {
    _dockingHud = document.createElement('div');
    _dockingHud.id = 'docking-guidance-hud';
    _dockingHud.style.cssText = `
      position: fixed; top: 80px; right: 16px; z-index: 500;
      background: rgba(0, 0, 0, 0.85); border: 1px solid #444;
      border-radius: 6px; padding: 12px 16px; min-width: 220px;
      font-family: monospace; font-size: 13px; color: #ccc;
      pointer-events: none;
    `;
    _container.appendChild(_dockingHud);
  }

  if (!_dockingHud) return;

  // Color helpers.
  const greenStyle = 'color: #4f4; font-weight: bold;';
  const redStyle   = 'color: #f44; font-weight: bold;';
  const whiteStyle = 'color: #fff;';

  let stateLabel;
  switch (guidance.state) {
    case DockingState.APPROACHING:   stateLabel = 'APPROACHING'; break;
    case DockingState.ALIGNING:      stateLabel = 'ALIGNING'; break;
    case DockingState.FINAL_APPROACH:stateLabel = 'AUTO-DOCK'; break;
    case DockingState.DOCKED:        stateLabel = 'DOCKED'; break;
    default:                         stateLabel = guidance.state;
  }

  const distStr = guidance.distance < 1000
    ? `${guidance.distance.toFixed(1)} m`
    : `${(guidance.distance / 1000).toFixed(2)} km`;

  const speedColor = guidance.speedOk ? greenStyle : redStyle;
  const oriColor   = guidance.orientationOk ? greenStyle : redStyle;
  const latColor   = guidance.lateralOk ? greenStyle : redStyle;

  let html = `<div style="${whiteStyle}; margin-bottom: 6px; font-size: 14px; border-bottom: 1px solid #555; padding-bottom: 4px;">
    DOCKING — ${stateLabel}
  </div>`;

  if (guidance.isDocked) {
    html += `<div style="${greenStyle}">DOCKED (${guidance.dockedCount} vessel${guidance.dockedCount !== 1 ? 's' : ''})</div>`;
    html += `<div style="color: #888; margin-top: 6px; font-size: 11px;">U = Undock &nbsp; F = Transfer fuel</div>`;
  } else {
    html += `<div>Distance: ${distStr}</div>`;
    html += `<div style="${speedColor}">Rel. Speed: ${guidance.relativeSpeed.toFixed(2)} m/s ${guidance.speedOk ? '✓' : '✗'}</div>`;
    html += `<div style="${oriColor}">Orientation: ${(guidance.orientationDiff * 180 / Math.PI).toFixed(1)}° ${guidance.orientationOk ? '✓' : '✗'}</div>`;
    html += `<div style="${latColor}">Lateral: ${guidance.lateralOffset.toFixed(1)} m ${guidance.lateralOk ? '✓' : '✗'}</div>`;

    if (guidance.state === DockingState.FINAL_APPROACH) {
      html += `<div style="${greenStyle}; margin-top: 6px;">Auto-dock engaged...</div>`;
    } else if (guidance.allGreen && guidance.distance <= 500) {
      html += `<div style="color: #ff0; margin-top: 6px;">Close to ${Math.round(15)} m for auto-dock</div>`;
    }

    html += `<div style="color: #888; margin-top: 6px; font-size: 11px;">T = Cycle target</div>`;
  }

  _dockingHud.innerHTML = html;
}

/**
 * Remove the docking guidance HUD.
 */
function _destroyDockingHud() {
  if (_dockingHud) {
    _dockingHud.remove();
    _dockingHud = null;
  }
}
