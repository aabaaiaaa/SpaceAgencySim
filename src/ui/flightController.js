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
import { initFlightHud, destroyFlightHud, setHudTimeWarp, lockTimeWarp } from './flightHud.js';
import { saveGame, listSaves } from '../core/saveload.js';
import { ATMOSPHERE_TOP, isReentryCondition } from '../core/atmosphere.js';

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
  inset: 0;
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
  justify-content: center;
  font-family: 'Segoe UI', system-ui, sans-serif;
  color: #d0e0f0;
  pointer-events: auto;
}

#post-flight-summary h1 {
  font-size: 2rem;
  font-weight: 700;
  margin-bottom: 28px;
  color: #80c8ff;
  letter-spacing: 0.04em;
}

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

  // Reset time-warp state.
  _timeWarp           = 1;
  _stagingLockoutUntil = 0;
  _prevAltitude        = 0;
  _prevInSpace         = false;

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

  // Build the in-flight control overlay (hamburger button + dropdown menu).
  _buildFlightOverlay(container);

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
  destroyFlightRenderer();

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

  // Reschedule unless the loop was cancelled.
  if (_rafId !== null) {
    _rafId = requestAnimationFrame(_loop);
  }
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
 * Build the in-flight control overlay:
 *   - A hamburger menu button centred at the top of the screen.
 *   - A dropdown menu with Save Game, Load Game, and Return to Space Agency.
 *
 * @param {HTMLElement} container
 */
function _buildFlightOverlay(container) {
  const overlay = document.createElement('div');
  overlay.id = 'flight-overlay';

  // ── Hamburger button ──────────────────────────────────────────────────────
  const menuBtn = document.createElement('button');
  menuBtn.id = 'flight-menu-btn';
  menuBtn.setAttribute('aria-label', 'Flight menu');
  menuBtn.innerHTML = '<span aria-hidden="true">&#9776;</span> Menu';

  // ── Dropdown ──────────────────────────────────────────────────────────────
  const menu = document.createElement('div');
  menu.id = 'flight-menu';
  menu.classList.add('hidden');

  // Save Game
  const saveBtn = document.createElement('button');
  saveBtn.id        = 'flight-menu-save';
  saveBtn.className = 'flight-menu-item';
  saveBtn.textContent = 'Save Game';
  saveBtn.addEventListener('click', () => {
    _toggleMenu(false);
    _handleSaveGame();
  });
  menu.appendChild(saveBtn);

  // Load Game
  const loadBtn = document.createElement('button');
  loadBtn.id        = 'flight-menu-load';
  loadBtn.className = 'flight-menu-item';
  loadBtn.textContent = 'Load Game';
  loadBtn.addEventListener('click', () => {
    _toggleMenu(false);
    // Reload the page to reach the main-menu load screen.
    if (typeof window !== 'undefined') window.location.reload();
  });
  menu.appendChild(loadBtn);

  // Divider
  const divider = document.createElement('div');
  divider.className = 'flight-menu-divider';
  menu.appendChild(divider);

  // Return to Space Agency
  const returnBtn = document.createElement('button');
  returnBtn.id        = 'flight-menu-return';
  returnBtn.className = 'flight-menu-item';
  returnBtn.textContent = 'Return to Space Agency';
  returnBtn.addEventListener('click', () => {
    _toggleMenu(false);
    _handleReturnToAgency();
  });
  menu.appendChild(returnBtn);

  // Toggle menu visibility on button click.
  menuBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    _toggleMenu();
  });

  // Close the menu when clicking outside of it.
  document.addEventListener('click', (e) => {
    if (
      _flightOverlay &&
      !menu.contains(/** @type {Node} */ (e.target)) &&
      e.target !== menuBtn
    ) {
      _toggleMenu(false);
    }
  });

  overlay.appendChild(menuBtn);
  overlay.appendChild(menu);
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
 * End the flight and show the post-flight summary screen.
 * Called when the player chooses "Return to Space Agency" from the menu.
 */
function _handleReturnToAgency() {
  // Capture stats before tearing down (references are cleared in stopFlightScene).
  const maxAlt  = _flightState ? Math.max(0, _flightState.altitude) : 0;
  const elapsed = _flightState ? _flightState.timeElapsed           : 0;
  const state   = _state;
  const onEnd   = _onFlightEnd;

  // Tear down the active flight.
  stopFlightScene();

  // Present the post-flight summary.
  _showPostFlightSummary(maxAlt, elapsed, state, onEnd);
}

// ---------------------------------------------------------------------------
// Private — post-flight summary screen
// ---------------------------------------------------------------------------

/**
 * Build and display the post-flight summary overlay.
 *
 * @param {number}   maxAlt   Maximum altitude reached during flight (m).
 * @param {number}   elapsed  Total flight duration (s).
 * @param {object}   state    GameState.
 * @param {Function} onEnd    Callback invoked when the player returns to hub.
 */
function _showPostFlightSummary(maxAlt, elapsed, state, onEnd) {
  // Use the #ui-overlay container; fall back to document.body.
  const host = document.getElementById('ui-overlay') ?? document.body;

  const overlay = document.createElement('div');
  overlay.id = 'post-flight-summary';

  // Heading.
  const heading = document.createElement('h1');
  heading.textContent = 'Flight Complete';
  overlay.appendChild(heading);

  // Stat helper.
  function addStat(label, value) {
    const row = document.createElement('div');
    row.className = 'pf-stat-row';

    const lbl = document.createElement('span');
    lbl.className   = 'pf-stat-label';
    lbl.textContent = label;

    const val = document.createElement('span');
    val.className   = 'pf-stat-value';
    val.textContent = value;

    row.appendChild(lbl);
    row.appendChild(val);
    overlay.appendChild(row);
  }

  addStat('Max Altitude:',    `${Math.round(maxAlt).toLocaleString('en-US')} m`);
  addStat('Flight Duration:', `${elapsed.toFixed(1)} s`);
  addStat('Agency:',          state?.agencyName ?? '—');

  // Return button.
  const returnBtn = document.createElement('button');
  returnBtn.id          = 'post-flight-return-btn';
  returnBtn.textContent = '← Return to Space Agency';
  returnBtn.addEventListener('click', () => {
    overlay.remove();
    if (onEnd) onEnd(state);
  });
  overlay.appendChild(returnBtn);

  host.appendChild(overlay);
}
