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

import { initFlightRenderer, destroyFlightRenderer, renderFlightFrame } from '../render/flight.js';
import {
  createPhysicsState,
  tick,
  handleKeyDown,
  handleKeyUp,
  fireNextStage,
} from '../core/physics.js';
import { initFlightHud, destroyFlightHud, setHudTimeWarp, lockTimeWarp, showLaunchTip, hideLaunchTip } from './flightHud.js';
import { initFlightContextMenu, destroyFlightContextMenu } from './flightContextMenu.js';
import { saveGame, listSaves } from '../core/saveload.js';
import { ATMOSPHERE_TOP, isReentryCondition } from '../core/atmosphere.js';
import { getPartById } from '../data/parts.js';
import { PartType, DEATH_FINE_PER_ASTRONAUT } from '../core/constants.js';
import { processFlightReturn } from '../core/flightReturn.js';
import { setTopBarFlightItems, clearTopBarFlightItems } from './topbar.js';

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

/**
 * True while the post-flight summary overlay is visible.
 * Prevents the overlay from being shown twice (e.g. crash auto-trigger
 * firing on the same frame that the player clicks "Return to Agency").
 */
let _summaryShown = false;

// ---------------------------------------------------------------------------
// Time-warp state
// ---------------------------------------------------------------------------

/**
 * Current time-warp multiplier applied to the physics dt each frame.
 * 1 = real-time; 2 = 2× speed; up to 50×.
 */
let _timeWarp = 1;

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
  font-family: 'Segoe UI', system-ui, sans-serif;
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
  background: rgba(5, 8, 16, 0.97);
  z-index: 400;
  display: flex;
  flex-direction: column;
  align-items: center;
  font-family: 'Segoe UI', system-ui, sans-serif;
  color: #d0e0f0;
  pointer-events: auto;
  overflow: hidden;
}

.pf-content {
  width: 100%;
  max-width: 700px;
  padding: 32px 24px 40px;
  overflow-y: auto;
  flex: 1;
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
  flex-wrap: wrap;
  gap: 12px;
  justify-content: center;
  margin-top: 12px;
  width: 100%;
}

.pf-btn {
  padding: 11px 22px;
  border-radius: 6px;
  font-size: 0.9rem;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
  white-space: nowrap;
}

.pf-btn-primary {
  background: #1a4070;
  border-color: #4080b0;
  color: #c8e8ff;
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
`;

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
  _assembly      = assembly;
  _stagingConfig = stagingConfig;
  _flightState   = flightState;
  _onFlightEnd   = onFlightEnd;

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

  // Create the physics state from the assembly and initial flight state.
  _ps = createPhysicsState(assembly, flightState);

  // Expose for E2E testing — Playwright reads live physics values here.
  if (typeof window !== 'undefined') {
    window.__flightPs = _ps;
  }

  // Boot the PixiJS flight renderer (clears whatever scene was on stage).
  initFlightRenderer();

  // Mount the HUD overlay.
  initFlightHud(container, _ps, assembly, stagingConfig, flightState, state, _onTimeWarpButtonClick);

  // Build the in-flight control overlay (save notice only — no hamburger).
  _buildFlightOverlay(container);

  // Inject "Return to Space Agency" into the topbar hamburger dropdown.
  setTopBarFlightItems([
    {
      label: 'Return to Space Agency',
      title: 'End this flight and return to your Space Agency hub to review results and plan your next launch.',
      onClick: _handleReturnToAgency,
    },
  ]);

  // Show the launch pad tip if the rocket hasn't launched yet.
  showLaunchTip();

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
  destroyFlightRenderer();
  clearTopBarFlightItems();

  if (_flightOverlay) {
    _flightOverlay.remove();
    _flightOverlay = null;
  }

  if (typeof window !== 'undefined') {
    window.__flightPs = null;
  }

  _ps            = null;
  _assembly      = null;
  _stagingConfig = null;
  _flightState   = null;
  _state         = null;
  _container     = null;
  _onFlightEnd   = null;
  _lastTs        = null;

  // Reset time-warp state.
  _timeWarp            = 1;
  _stagingLockoutUntil = 0;
  _prevAltitude        = 0;
  _prevInSpace         = false;

  _summaryShown = false;

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

  // Advance physics simulation with the current warp multiplier.
  tick(_ps, _assembly, _stagingConfig, _flightState, realDt, _timeWarp);

  // Render the flight scene.
  renderFlightFrame(_ps, _assembly);

  // Auto-trigger the post-flight summary when the rocket crashes or all
  // command modules are destroyed (the rocket becomes uncontrollable).
  if (!_summaryShown && !_ps.grounded) {
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

  // No automatic resets needed if we're already at 1×.
  if (_timeWarp === 1) {
    _prevAltitude = Math.max(0, _ps.posY);
    _prevInSpace  = _prevAltitude >= ATMOSPHERE_TOP;
    return;
  }

  const altitude = Math.max(0, _ps.posY);
  const speed    = Math.hypot(_ps.velX, _ps.velY);
  const inSpace  = altitude >= ATMOSPHERE_TOP;

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
// Private — keyboard handlers
// ---------------------------------------------------------------------------

/** Ordered warp levels for < / > key stepping. */
const WARP_LEVELS_ORDERED = [0, 0.25, 0.5, 1, 2, 5, 10, 50];

/** @param {KeyboardEvent} e */
function _onKeyDown(e) {
  if (!_ps || !_assembly || !_stagingConfig || !_flightState) return;

  if (e.code === 'Space') {
    e.preventDefault();

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

  handleKeyDown(_ps, _assembly, e.key);
}

/** @param {KeyboardEvent} e */
function _onKeyUp(e) {
  if (!_ps) return;
  handleKeyUp(_ps, e.key);
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

/**
 * Show the post-flight summary screen.
 * Called when the player chooses "Return to Space Agency" from the menu.
 * Does NOT tear down the flight scene immediately — the summary's action
 * buttons handle that so the player can choose "Continue Flying" if landed.
 */
function _handleReturnToAgency() {
  if (_summaryShown) return; // Already showing — ignore duplicate calls.
  _summaryShown = true;
  _showPostFlightSummary(_ps, _assembly, _flightState, _state, _onFlightEnd);
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
 *  5. Action buttons: Restart from Launch, Continue Flying (if landed),
 *     Return to Space Agency.
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

  // ── 2. Mission objectives ─────────────────────────────────────────────────
  if (flightState && flightState.missionId && state) {
    const missionId = flightState.missionId;
    const allMissions = [
      ...(state.missions?.accepted  ?? []),
      ...(state.missions?.completed ?? []),
    ];
    const mission = allMissions.find((m) => m.id === missionId);

    if (mission && Array.isArray(mission.objectives) && mission.objectives.length > 0) {
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

  // ── 5. Action buttons ─────────────────────────────────────────────────────

  // Calculate the replacement cost of parts that were lost (not in activeParts).
  let lostPartsCost = 0;
  if (assembly && ps) {
    for (const [instanceId, placed] of assembly.parts) {
      if (!ps.activeParts.has(instanceId)) {
        const def = getPartById(placed.partId);
        if (def) lostPartsCost += def.cost ?? 0;
      }
    }
  }

  const buttonsEl = document.createElement('div');
  buttonsEl.className = 'pf-buttons';

  // ── "Restart from Launch" button ──────────────────────────────────────────
  const restartBtn = document.createElement('button');
  restartBtn.id        = 'post-flight-restart-btn';
  restartBtn.className = 'pf-btn pf-btn-secondary';
  restartBtn.textContent = lostPartsCost > 0
    ? `↩ Restart from Launch  (−$${lostPartsCost.toLocaleString('en-US')})`
    : '↩ Restart from Launch';
  restartBtn.title = 'Return to your Space Agency hub. Parts that were lost during this flight will be deducted from your budget.';

  restartBtn.addEventListener('click', () => {
    // Deduct the cost of lost parts immediately.
    if (lostPartsCost > 0 && state) {
      state.money = (state.money ?? 0) - lostPartsCost;
    }
    overlay.remove();
    stopFlightScene();
    if (onFlightEnd) onFlightEnd(state);
  });
  buttonsEl.appendChild(restartBtn);

  // ── "Continue Flying" button — only if the rocket landed intact ───────────
  if (isLanded) {
    const continueBtn = document.createElement('button');
    continueBtn.id        = 'post-flight-continue-btn';
    continueBtn.className = 'pf-btn pf-btn-primary';
    continueBtn.textContent = '▶ Continue Flying';
    continueBtn.title = 'Close this summary and continue controlling the landed rocket.';
    continueBtn.addEventListener('click', () => {
      // The flight scene is still running — close the summary and restore HUD.
      _summaryShown = false;
      overlay.remove();
      const hud = document.getElementById('flight-hud');
      if (hud) hud.style.display = '';
    });
    buttonsEl.appendChild(continueBtn);
  }

  // ── "Return to Space Agency" button ───────────────────────────────────────
  const returnBtn = document.createElement('button');
  returnBtn.id          = 'post-flight-return-btn';
  returnBtn.className   = 'pf-btn pf-btn-primary';
  returnBtn.textContent = '← Return to Space Agency';
  returnBtn.title = 'End this flight, process mission results and part recovery, and return to your Space Agency hub.';
  returnBtn.addEventListener('click', () => {
    // Process all end-of-flight game-state changes (mission completion,
    // part recovery, loan interest, death fines, flight history) and collect
    // the summary for the "Return Results" overlay shown on the hub.
    let returnResults = null;
    if (state && flightState) {
      returnResults = processFlightReturn(state, flightState, ps, assembly);
    }

    overlay.remove();
    stopFlightScene();
    if (onFlightEnd) onFlightEnd(state, returnResults);
  });
  buttonsEl.appendChild(returnBtn);

  // ── "Retry with same design" button ───────────────────────────────────────
  // Only shown when a saved design exists (auto-saved at launch in D2).
  if (state && state.rockets && state.rockets.length > 0 && flightState) {
    const savedDesign = state.rockets.find(r => r.id === flightState.rocketId)
      ?? state.rockets[state.rockets.length - 1];
    if (savedDesign) {
      const retryBtn = document.createElement('button');
      retryBtn.id          = 'post-flight-retry-btn';
      retryBtn.className   = 'pf-btn pf-btn-secondary';
      retryBtn.textContent = '↺ Retry with Same Design';
      retryBtn.title = 'Reload the same rocket design back onto the launch pad and start a new flight immediately.';
      retryBtn.addEventListener('click', () => {
        overlay.remove();
        stopFlightScene();
        // Return to hub so the player can re-launch.
        if (onFlightEnd) onFlightEnd(state);
      });
      buttonsEl.appendChild(retryBtn);
    }
  }

  content.appendChild(buttonsEl);
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
