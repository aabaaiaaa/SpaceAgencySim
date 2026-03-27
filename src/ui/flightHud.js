/**
 * flightHud.js — In-flight HTML overlay HUD.
 *
 * Renders a heads-up display on top of the PixiJS flight canvas showing
 * real-time telemetry and mission status:
 *
 *   LEFT EDGE
 *     - Throttle bar: vertical bar showing 0–100 %, updated live.
 *       Keyboard: W / ArrowUp   +5 %  (handled by physics.js handleKeyDown)
 *                 S / ArrowDown -5 %  (handled by physics.js handleKeyDown)
 *                 X             → 0 % (handled here via direct ps.throttle write)
 *                 Z             → 100 %(handled here via direct ps.throttle write)
 *
 *   TOP LEFT (beside throttle bar)
 *     - Altitude (m, thousands separator)
 *     - Vertical speed (m/s, signed positive = ascending)
 *     - Horizontal speed (m/s, unsigned magnitude)
 *     - Current stage (N / total)
 *     - Apoapsis estimate (ballistic peak; ignores ongoing thrust/drag)
 *
 *   TOP RIGHT
 *     - Mission objectives from the accepted mission, each with a completion
 *       indicator (✓ when met, ○ while pending).
 *
 *   BOTTOM RIGHT
 *     - Per-tank fuel remaining (active tanks only, mass in kg).
 *
 * USAGE
 *   initFlightHud(container, ps, assembly, stagingConfig, flightState, state)
 *   destroyFlightHud()
 *
 * The HUD starts an internal requestAnimationFrame loop on init and cancels
 * it on destroy.  It holds live references to the mutable physics/flight
 * objects, so it always reflects the current sim state.
 *
 * @module ui/flightHud
 */

import { getPartById } from '../data/parts.js';
import { PartType } from '../core/constants.js';
import { ObjectiveType } from '../data/missions.js';
import { countDeployedLegs } from '../core/legs.js';

// ---------------------------------------------------------------------------
// Physics constant
// ---------------------------------------------------------------------------

/** Standard gravity (m/s²) — used for ballistic apoapsis estimate. */
const G0 = 9.81;

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const FLIGHT_HUD_STYLES = `
/* ═══════════════════════════════════════════════════════════════════════════
   Flight HUD — root overlay
   ═══════════════════════════════════════════════════════════════════════════ */
#flight-hud {
  position: fixed;
  inset: 44px 0 0;
  pointer-events: none;
  z-index: 100;
  font-family: system-ui, sans-serif;
  color: #a8e8c0;
  user-select: none;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Left panel — throttle + staging + fuel (replaces old throttle + telem + fuel)
   ═══════════════════════════════════════════════════════════════════════════ */
#flight-left-panel {
  position: absolute;
  left: 58px;
  bottom: 60px;
  width: 230px;
  background: rgba(0, 8, 0, 0.78);
  border: 1px solid #284828;
  border-radius: 4px;
  display: flex;
  flex-direction: column;
  pointer-events: auto;
  max-height: calc(100% - 120px);
  overflow-y: auto;
  overflow-x: hidden;
}

.flight-lp-section {
  padding: 8px 10px 7px;
  border-bottom: 1px solid rgba(40, 72, 40, 0.5);
  flex-shrink: 0;
}

.flight-lp-section:last-child {
  border-bottom: none;
}

.flight-lp-title {
  font-size: 8px;
  color: #507860;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: 7px;
}

/* Throttle subsection */
.flight-lp-throttle-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.flight-lp-throttle-track {
  width: 10px;
  height: 80px;
  border: 1px solid #305030;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.55);
  position: relative;
  flex-shrink: 0;
}

.flight-lp-throttle-fill {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, #20c040, #60ff80);
  transition: height 0.06s linear;
}

.flight-lp-throttle-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.flight-lp-pct {
  font-size: 14px;
  color: #c0ffd8;
  letter-spacing: 0.02em;
}

.flight-lp-twr-row {
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.flight-lp-lbl {
  font-size: 8px;
  color: #507860;
  text-transform: uppercase;
  letter-spacing: 0.06em;
}

.flight-lp-val {
  font-size: 11px;
  color: #a0d8b0;
}

.flight-lp-btn-row {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 5px;
}

.flight-lp-btn {
  padding: 2px 7px;
  background: rgba(0, 16, 0, 0.8);
  border: 1px solid #305030;
  border-radius: 3px;
  color: #70a880;
  font-size: 9px;
  font-family: system-ui, sans-serif;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s;
}

.flight-lp-btn:hover {
  background: rgba(0, 36, 0, 0.9);
  border-color: #407840;
  color: #a0d8b0;
}

/* Staging subsection — stages stacked bottom-to-top (rendered top-to-bottom,
   but visually labeled in reverse so Stage 1 appears at the bottom of the list) */
.flight-lp-stage-item {
  padding: 4px 6px;
  border: 1px solid #1a3020;
  border-radius: 3px;
  margin-bottom: 4px;
}

.flight-lp-stage-item:last-child {
  margin-bottom: 0;
}

.flight-lp-stage-item.active {
  border-color: #40c060;
  background: rgba(16, 48, 16, 0.4);
}

.flight-lp-stage-item.spent {
  opacity: 0.35;
}

.flight-lp-stage-label {
  font-size: 8px;
  color: #507860;
  margin-bottom: 2px;
}

.flight-lp-stage-item.active .flight-lp-stage-label {
  color: #60c070;
}

.flight-lp-stage-parts {
  font-size: 8px;
  color: #88c8a0;
  margin-bottom: 1px;
  word-break: break-word;
}

.flight-lp-stage-dv {
  font-size: 9px;
  color: #c0ffd8;
}

/* Fuel subsection */
.flight-lp-fuel-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 3px;
  font-size: 10px;
}

.flight-lp-fuel-row:last-child {
  margin-bottom: 0;
}

.flight-lp-fuel-name {
  color: #80c090;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 140px;
}

.flight-lp-fuel-kg {
  color: #c0ffd8;
  white-space: nowrap;
  flex-shrink: 0;
  margin-left: 6px;
}

/* ─── Launch tip ─────────────────────────────────────────────────────────── */
#flight-launch-tip {
  position: absolute;
  bottom: 120px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(4, 20, 8, 0.90);
  border: 1px solid #407840;
  border-radius: 6px;
  padding: 10px 22px;
  color: #a0e8a0;
  font-size: 13px;
  pointer-events: none;
  white-space: nowrap;
  animation: flight-tip-pulse 1.5s ease-in-out infinite;
}

@keyframes flight-tip-pulse {
  0%, 100% { opacity: 1; }
  50%       { opacity: 0.45; }
}

/* Shared row/val helpers (kept for objectives panel) */
.hud-row {
  margin-bottom: 5px;
}

.hud-row:last-child {
  margin-bottom: 0;
}

.hud-lbl {
  font-size: 9px;
  color: #507860;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  line-height: 1.2;
}

.hud-val {
  font-size: 14px;
  color: #d0ffd8;
  line-height: 1.25;
  letter-spacing: 0.02em;
}

.hud-val-sm {
  font-size: 11px;
  color: #a0d8b0;
  line-height: 1.25;
  letter-spacing: 0.02em;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Mission objectives panel — top-right
   ═══════════════════════════════════════════════════════════════════════════ */
#flight-hud-objectives {
  position: absolute;
  right: 10px;
  top: 10px;
  background: rgba(0, 8, 0, 0.68);
  border: 1px solid #284828;
  border-radius: 4px;
  padding: 8px 12px 6px;
  min-width: 180px;
  max-width: 280px;
  max-height: 50vh;
  overflow-y: auto;
}

.hud-obj-mission-title {
  font-size: 9px;
  color: #40c070;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 5px;
}

.hud-obj-mission-group:not(:first-child) {
  border-top: 1px solid rgba(40, 72, 40, 0.5);
  margin-top: 6px;
  padding-top: 6px;
}

.hud-panel-title {
  font-size: 9px;
  color: #507860;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-bottom: 7px;
}

.hud-obj-item {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  margin-bottom: 5px;
}

.hud-obj-item:last-child {
  margin-bottom: 0;
}

.hud-obj-icon {
  flex-shrink: 0;
  font-size: 11px;
  line-height: 1.2;
  margin-top: 1px;
}

.hud-obj-icon.met     { color: #40ff70; }
.hud-obj-icon.pending { color: #405840; }

.hud-obj-desc {
  font-size: 10px;
  color: #88c8a0;
  line-height: 1.4;
}

.hud-obj-desc.met {
  color: #60d080;
}

.hud-obj-timer {
  font-size: 9px;
  color: #60c0ff;
  font-variant-numeric: tabular-nums;
  margin-top: 1px;
}

.hud-obj-timer.inactive {
  color: #506060;
}

.hud-empty {
  color: #405840;
  font-size: 10px;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Time warp panel — bottom-centre
   ═══════════════════════════════════════════════════════════════════════════ */
#flight-hud-timewarp {
  position: absolute;
  bottom: 10px;
  left: 50%;
  transform: translateX(-50%);
  background: rgba(0, 8, 0, 0.68);
  border: 1px solid #284828;
  border-radius: 4px;
  padding: 5px 10px;
  display: flex;
  align-items: center;
  gap: 6px;
  pointer-events: auto;
  white-space: nowrap;
}

.hud-warp-label {
  font-size: 9px;
  color: #507860;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  margin-right: 2px;
}

.hud-warp-btn {
  padding: 3px 7px;
  background: rgba(0, 16, 0, 0.8);
  border: 1px solid #305030;
  border-radius: 3px;
  color: #70a880;
  font-size: 10px;
  font-family: system-ui, sans-serif;
  cursor: pointer;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
  min-width: 30px;
  text-align: center;
}

.hud-warp-btn:hover:not(:disabled) {
  background: rgba(0, 36, 0, 0.9);
  border-color: #407840;
  color: #a0d8b0;
}

.hud-warp-btn.active {
  background: rgba(16, 72, 16, 0.9);
  border-color: #60c060;
  color: #c0ffd8;
  font-weight: bold;
}

.hud-warp-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

/* ═══════════════════════════════════════════════════════════════════════════
   TWR bar + mode toggle
   ═══════════════════════════════════════════════════════════════════════════ */
.flight-lp-mode-toggle {
  padding: 1px 5px;
  background: rgba(0, 16, 0, 0.8);
  border: 1px solid #305030;
  border-radius: 3px;
  color: #507860;
  font-size: 8px;
  font-family: system-ui, sans-serif;
  cursor: pointer;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  transition: background 0.1s, border-color 0.1s, color 0.1s;
  line-height: 1.4;
}

.flight-lp-mode-toggle.active {
  background: rgba(16, 72, 16, 0.7);
  border-color: #40a050;
  color: #a0ffc0;
}

.flight-lp-twr-bar {
  width: 10px;
  height: 80px;
  border: 1px solid #305030;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.55);
  position: relative;
  flex-shrink: 0;
  overflow: hidden;
}

.flight-lp-twr-bar-center {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  height: 1px;
  background: #507860;
  pointer-events: none;
}

.flight-lp-twr-bar-fill-up {
  position: absolute;
  bottom: 50%;
  left: 0;
  right: 0;
  background: linear-gradient(to top, #20c040, #60ff80);
  transition: height 0.06s linear;
}

.flight-lp-twr-bar-fill-dn {
  position: absolute;
  top: 50%;
  left: 0;
  right: 0;
  background: linear-gradient(to bottom, #c08020, #ff9040);
  transition: height 0.06s linear;
}

.flight-lp-twr-bar-value {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 7px;
  color: #fff;
  text-shadow: 0 0 3px #000, 0 0 3px #000;
  pointer-events: none;
  writing-mode: vertical-lr;
  text-orientation: mixed;
  letter-spacing: 0.02em;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Altitude tape — vertical scrolling scale beside the rocket
   ═══════════════════════════════════════════════════════════════════════════ */
#flight-alt-tape {
  position: absolute;
  left: 6px;
  bottom: 60px;
  width: 48px;
  height: calc(100% - 120px);
  background: rgba(0, 8, 0, 0.78);
  border: 1px solid #284828;
  border-radius: 4px;
  overflow: hidden;
  pointer-events: none;
}

.alt-tape-ticks {
  position: absolute;
  inset: 0;
}

.alt-tape-tick-minor {
  position: absolute;
  right: 0;
  width: 8px;
  height: 1px;
  background: #406040;
}

.alt-tape-tick-major {
  position: absolute;
  right: 0;
  width: 16px;
  height: 1px;
  background: #70b080;
}

.alt-tape-tick-label {
  position: absolute;
  right: 18px;
  font-size: 8px;
  color: #90c8a0;
  white-space: nowrap;
  transform: translateY(-50%);
}

.alt-tape-indicator {
  position: absolute;
  left: 0;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  pointer-events: none;
  z-index: 1;
}

.alt-tape-indicator-line {
  width: 100%;
  height: 2px;
  background: #40ff80;
  box-shadow: 0 0 6px #40ff80;
}

.alt-tape-indicator-val {
  position: absolute;
  right: 2px;
  top: 3px;
  font-size: 9px;
  font-weight: bold;
  color: #40ff80;
  text-shadow: 0 0 4px #000;
  white-space: nowrap;
}

.alt-tape-ground {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  background: repeating-linear-gradient(
    45deg,
    rgba(80, 60, 20, 0.5) 0px,
    rgba(80, 60, 20, 0.5) 3px,
    rgba(40, 30, 10, 0.5) 3px,
    rgba(40, 30, 10, 0.5) 6px
  );
  border-top: 1px solid #806020;
}
`;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** Root overlay element. @type {HTMLElement|null} */
let _hud = null;

/** requestAnimationFrame handle. @type {number|null} */
let _rafId = null;

/** Live references to sim objects (set on init, cleared on destroy). */
let _ps            = null;
let _assembly      = null;
let _stagingConfig = null;
let _flightState   = null;
let _state         = null;

/** Keyboard handler for X/Z throttle cut/full. @type {((e: KeyboardEvent) => void)|null} */
let _keyHandler = null;

/** Callback invoked with the chosen warp level when a warp button is clicked. @type {((level: number) => void)|null} */
let _onTimeWarpChange = null;

/** Current active time warp level (1, 2, 5, 10, or 50). */
let _timeWarp = 1;

/** Whether the warp buttons are locked out (e.g. during a staging sequence). */
let _warpLocked = false;

/** Array of warp-level button DOM elements (kept for highlight updates). @type {HTMLButtonElement[]} */
let _warpButtons = [];

// DOM nodes updated on every frame:
let _elThrottleFill  = null;   // left-panel throttle bar fill
let _elThrottlePct   = null;   // left-panel throttle % (id: flight-hud-throttle-pct)
let _elTWR           = null;   // left-panel TWR value
let _elAlt           = null;   // left-panel altitude (id: hud-alt)
let _elVelY          = null;   // left-panel vertical speed (id: hud-vely)
let _elVelX          = null;   // left-panel horizontal speed (id: hud-velx)
let _elStagingList   = null;   // left-panel staging container
let _elFuelList      = null;   // left-panel fuel list
let _elObjList       = null;   // objectives panel (top-right, unchanged)
let _elLaunchTip     = null;   // launch pad "press space" tip
let _launchTipHidden = false;  // once hidden, stays hidden

// Altitude tape elements:
let _elAltTape       = null;   // altitude tape container
let _elAltTapeTicks  = null;   // altitude tape ticks container

// TWR bar elements:
let _elModeToggle    = null;   // TWR/ABS mode toggle button
let _elTwrBarFillUp  = null;   // TWR bar green fill (>1)
let _elTwrBarFillDn  = null;   // TWR bar orange fill (<1)
let _elTwrBarValue   = null;   // TWR bar centered value text
let _elTargetTwrRow  = null;   // "Target" info row (visible only in TWR mode)
let _elTargetTwrVal  = null;   // Target TWR value text

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the flight HUD overlay and start the update loop.
 *
 * Holds live references to the mutable sim objects — no data is copied.
 * All DOM updates read the live object state on each animation frame.
 *
 * @param {HTMLElement}                                             container       #ui-overlay div.
 * @param {import('../core/physics.js').PhysicsState}               ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly}       assembly
 * @param {import('../core/rocketbuilder.js').StagingConfig}        stagingConfig
 * @param {import('../core/gameState.js').FlightState}              flightState
 * @param {import('../core/gameState.js').GameState}                state
 * @param {((level: number) => void)|null}                          [onTimeWarpChange]
 *   Called with the new warp level whenever the player clicks a time-warp button.
 */
export function initFlightHud(container, ps, assembly, stagingConfig, flightState, state, onTimeWarpChange) {
  _ps               = ps;
  _assembly         = assembly;
  _stagingConfig    = stagingConfig;
  _flightState      = flightState;
  _state            = state;
  _onTimeWarpChange = onTimeWarpChange ?? null;
  _timeWarp         = 1;
  _warpLocked       = false;
  _warpButtons      = [];
  _launchTipHidden  = false;

  // Inject stylesheet once per page load.
  if (!document.getElementById('flight-hud-styles')) {
    const styleEl = document.createElement('style');
    styleEl.id = 'flight-hud-styles';
    styleEl.textContent = FLIGHT_HUD_STYLES;
    document.head.appendChild(styleEl);
  }

  // Root container.
  _hud = document.createElement('div');
  _hud.id = 'flight-hud';
  container.appendChild(_hud);

  _buildLeftPanel();
  _buildObjectivesPanel();
  _buildTimeWarpPanel();
  _buildAltTape();

  // X → throttle 0 %, Z → throttle 100 %.
  // W/S/ArrowUp/ArrowDown are handled by physics.js handleKeyDown when the
  // flight loop calls it; X/Z are handled here to keep the HUD self-contained.
  _keyHandler = (e) => {
    if (!_ps) return;
    const k = e.key;
    const twrMode = _ps.throttleMode === 'twr';
    if (k === 'x' || k === 'X') {
      if (twrMode) {
        _ps.targetTWR = 0;
      }
      _ps.throttle = 0;
    } else if (k === 'z' || k === 'Z') {
      if (twrMode) {
        _ps.targetTWR = Infinity;
      }
      _ps.throttle = 1;
    }
  };
  window.addEventListener('keydown', _keyHandler);

  // Start the update loop.
  _rafId = requestAnimationFrame(_tick);

  console.log('[Flight HUD] Initialized');
}

/**
 * Tear down the flight HUD — removes the DOM overlay and cancels the loop.
 * Safe to call even if initFlightHud was never called.
 */
export function destroyFlightHud() {
  if (_rafId !== null) {
    cancelAnimationFrame(_rafId);
    _rafId = null;
  }

  if (_keyHandler) {
    window.removeEventListener('keydown', _keyHandler);
    _keyHandler = null;
  }

  if (_hud) {
    _hud.remove();
    _hud = null;
  }

  // Clear all refs.
  _ps               = null;
  _assembly         = null;
  _stagingConfig    = null;
  _flightState      = null;
  _state            = null;
  _onTimeWarpChange = null;
  _timeWarp         = 1;
  _warpLocked       = false;
  _warpButtons      = [];

  _elThrottleFill  = null;
  _elThrottlePct   = null;
  _elTWR           = null;
  _elAlt           = null;
  _elVelY          = null;
  _elVelX          = null;
  _elStagingList   = null;
  _elFuelList      = null;
  _elObjList       = null;
  _elLaunchTip     = null;
  _launchTipHidden = false;

  _elAltTape       = null;
  _elAltTapeTicks  = null;

  _elModeToggle    = null;
  _elTwrBarFillUp  = null;
  _elTwrBarFillDn  = null;
  _elTwrBarValue   = null;
  _elTargetTwrRow  = null;
  _elTargetTwrVal  = null;

  console.log('[Flight HUD] Destroyed');
}

// ---------------------------------------------------------------------------
// Public API — time warp control
// ---------------------------------------------------------------------------

/**
 * Update the active-button highlight and internal warp state to match `level`.
 * Call this from the flight controller when the warp level changes for any
 * reason (button click, automatic reset, etc.).
 *
 * @param {number} level  New warp multiplier (0 = pause, 0.25, 0.5, 1, 2, 5, 10, or 50).
 */
export function setHudTimeWarp(level) {
  _timeWarp = level;
  for (const btn of _warpButtons) {
    const btnLevel = parseFloat(btn.dataset.warp ?? '1');
    btn.classList.toggle('active', btnLevel === level);
  }
}

/**
 * Lock or unlock the time-warp buttons.
 *
 * While locked (e.g. during an active staging sequence) the buttons are
 * rendered as disabled so the player cannot change the warp level.
 *
 * @param {boolean} locked  true = lock; false = unlock.
 */
export function lockTimeWarp(locked) {
  _warpLocked = locked;
  for (const btn of _warpButtons) {
    btn.disabled = locked;
  }
}

// ---------------------------------------------------------------------------
// Private — DOM construction
// ---------------------------------------------------------------------------

/**
 * Build the unified left panel containing throttle, staging, and fuel sections.
 */
function _buildLeftPanel() {
  const panel = document.createElement('div');
  panel.id = 'flight-left-panel';

  // ── Status section (altitude + vertical speed) ────────────────────────────
  const statusSec = document.createElement('div');
  statusSec.className = 'flight-lp-section';

  const statusTitle = document.createElement('div');
  statusTitle.className = 'flight-lp-title';
  statusTitle.textContent = 'Status';
  statusSec.appendChild(statusTitle);

  const altRow = document.createElement('div');
  altRow.className = 'flight-lp-twr-row';
  const altLbl = document.createElement('div');
  altLbl.className = 'flight-lp-lbl';
  altLbl.textContent = 'Alt';
  _elAlt = document.createElement('div');
  _elAlt.id = 'hud-alt';
  _elAlt.className = 'flight-lp-val';
  _elAlt.textContent = '0 m';
  altRow.appendChild(altLbl);
  altRow.appendChild(_elAlt);
  statusSec.appendChild(altRow);

  const velYRow = document.createElement('div');
  velYRow.className = 'flight-lp-twr-row';
  const velYLbl = document.createElement('div');
  velYLbl.className = 'flight-lp-lbl';
  velYLbl.textContent = 'Vert';
  _elVelY = document.createElement('div');
  _elVelY.id = 'hud-vely';
  _elVelY.className = 'flight-lp-val';
  _elVelY.textContent = '0 m/s';
  velYRow.appendChild(velYLbl);
  velYRow.appendChild(_elVelY);
  statusSec.appendChild(velYRow);

  const velXRow = document.createElement('div');
  velXRow.className = 'flight-lp-twr-row';
  const velXLbl = document.createElement('div');
  velXLbl.className = 'flight-lp-lbl';
  velXLbl.textContent = 'Horiz';
  _elVelX = document.createElement('div');
  _elVelX.id = 'hud-velx';
  _elVelX.className = 'flight-lp-val';
  _elVelX.textContent = '0 m/s';
  velXRow.appendChild(velXLbl);
  velXRow.appendChild(_elVelX);
  statusSec.appendChild(velXRow);

  panel.appendChild(statusSec);

  // ── Throttle section ──────────────────────────────────────────────────────
  const throttleSec = document.createElement('div');
  throttleSec.className = 'flight-lp-section';

  // Title row: "Throttle" + mode toggle button
  const titleRow = document.createElement('div');
  titleRow.style.cssText = 'display:flex;align-items:center;justify-content:space-between;margin-bottom:7px;';
  const throttleTitle = document.createElement('div');
  throttleTitle.className = 'flight-lp-title';
  throttleTitle.style.marginBottom = '0';
  throttleTitle.textContent = 'Throttle';
  titleRow.appendChild(throttleTitle);

  _elModeToggle = document.createElement('button');
  _elModeToggle.className = 'flight-lp-mode-toggle active';
  _elModeToggle.textContent = 'TWR';
  _elModeToggle.title = 'Toggle throttle mode: TWR (auto-adjust) / ABS (manual)';
  _elModeToggle.addEventListener('click', () => {
    if (!_ps) return;
    if (_ps.throttleMode === 'twr') {
      _ps.throttleMode = 'absolute';
      _elModeToggle.textContent = 'ABS';
      _elModeToggle.classList.remove('active');
    } else {
      // Switching to TWR mode — snapshot current TWR as target to prevent jump
      const currentTWR = _computeTWR();
      _ps.targetTWR = currentTWR > 0 ? currentTWR : 1.0;
      _ps.throttleMode = 'twr';
      _elModeToggle.textContent = 'TWR';
      _elModeToggle.classList.add('active');
    }
  });
  titleRow.appendChild(_elModeToggle);
  throttleSec.appendChild(titleRow);

  const throttleRow = document.createElement('div');
  throttleRow.className = 'flight-lp-throttle-row';

  // Vertical throttle bar
  const track = document.createElement('div');
  track.className = 'flight-lp-throttle-track';
  _elThrottleFill = document.createElement('div');
  _elThrottleFill.className = 'flight-lp-throttle-fill';
  _elThrottleFill.style.height = '100%';
  track.appendChild(_elThrottleFill);
  throttleRow.appendChild(track);

  // TWR bar (between throttle bar and info column)
  const twrBar = document.createElement('div');
  twrBar.className = 'flight-lp-twr-bar';
  const twrBarCenter = document.createElement('div');
  twrBarCenter.className = 'flight-lp-twr-bar-center';
  _elTwrBarFillUp = document.createElement('div');
  _elTwrBarFillUp.className = 'flight-lp-twr-bar-fill-up';
  _elTwrBarFillUp.style.height = '0%';
  _elTwrBarFillDn = document.createElement('div');
  _elTwrBarFillDn.className = 'flight-lp-twr-bar-fill-dn';
  _elTwrBarFillDn.style.height = '0%';
  _elTwrBarValue = document.createElement('div');
  _elTwrBarValue.className = 'flight-lp-twr-bar-value';
  _elTwrBarValue.textContent = '—';
  twrBar.appendChild(_elTwrBarFillUp);
  twrBar.appendChild(_elTwrBarFillDn);
  twrBar.appendChild(twrBarCenter);
  twrBar.appendChild(_elTwrBarValue);
  throttleRow.appendChild(twrBar);

  // Info column: pct + TWR + target
  const info = document.createElement('div');
  info.className = 'flight-lp-throttle-info';

  _elThrottlePct = document.createElement('div');
  _elThrottlePct.id = 'flight-hud-throttle-pct';
  _elThrottlePct.className = 'flight-lp-pct';
  _elThrottlePct.textContent = '100%';
  info.appendChild(_elThrottlePct);

  const twrRow = document.createElement('div');
  twrRow.className = 'flight-lp-twr-row';
  const twrLbl = document.createElement('div');
  twrLbl.className = 'flight-lp-lbl';
  twrLbl.textContent = 'TWR';
  _elTWR = document.createElement('div');
  _elTWR.className = 'flight-lp-val';
  _elTWR.textContent = '—';
  twrRow.appendChild(twrLbl);
  twrRow.appendChild(_elTWR);
  info.appendChild(twrRow);

  // Target TWR row (visible only in TWR mode)
  _elTargetTwrRow = document.createElement('div');
  _elTargetTwrRow.className = 'flight-lp-twr-row';
  const targetLbl = document.createElement('div');
  targetLbl.className = 'flight-lp-lbl';
  targetLbl.textContent = 'Target';
  _elTargetTwrVal = document.createElement('div');
  _elTargetTwrVal.className = 'flight-lp-val';
  _elTargetTwrVal.textContent = 'MAX';
  _elTargetTwrRow.appendChild(targetLbl);
  _elTargetTwrRow.appendChild(_elTargetTwrVal);
  info.appendChild(_elTargetTwrRow);

  throttleRow.appendChild(info);
  throttleSec.appendChild(throttleRow);

  // Throttle buttons
  const btnRow = document.createElement('div');
  btnRow.className = 'flight-lp-btn-row';

  const setTWR1Btn = document.createElement('button');
  setTWR1Btn.className = 'flight-lp-btn';
  setTWR1Btn.textContent = 'TWR=1';
  setTWR1Btn.title = 'Set throttle so thrust-to-weight ratio equals 1';
  setTWR1Btn.addEventListener('click', () => {
    if (!_ps) return;
    if (_ps.throttleMode === 'twr') {
      _ps.targetTWR = 1.0;
    } else {
      _setThrottleForTWR1();
    }
  });
  btnRow.appendChild(setTWR1Btn);

  const minusBtn = document.createElement('button');
  minusBtn.className = 'flight-lp-btn';
  minusBtn.textContent = '−0.1';
  minusBtn.title = 'Decrease throttle/TWR by 0.1';
  minusBtn.addEventListener('click', () => {
    if (!_ps) return;
    if (_ps.throttleMode === 'twr') {
      _ps.targetTWR = _ps.targetTWR === Infinity
        ? Math.max(0, 10 - 0.1)
        : Math.max(0, Math.round((_ps.targetTWR - 0.1) * 10) / 10);
    } else {
      _ps.throttle = Math.max(0, Math.round((_ps.throttle - 0.1) * 10) / 10);
    }
  });
  btnRow.appendChild(minusBtn);

  const plusBtn = document.createElement('button');
  plusBtn.className = 'flight-lp-btn';
  plusBtn.textContent = '+0.1';
  plusBtn.title = 'Increase throttle/TWR by 0.1';
  plusBtn.addEventListener('click', () => {
    if (!_ps) return;
    if (_ps.throttleMode === 'twr') {
      if (_ps.targetTWR !== Infinity) {
        _ps.targetTWR = Math.round((_ps.targetTWR + 0.1) * 10) / 10;
      }
    } else {
      _ps.throttle = Math.min(1, Math.round((_ps.throttle + 0.1) * 10) / 10);
    }
  });
  btnRow.appendChild(plusBtn);

  throttleSec.appendChild(btnRow);
  panel.appendChild(throttleSec);

  // ── Staging section ───────────────────────────────────────────────────────
  const stagingSec = document.createElement('div');
  stagingSec.className = 'flight-lp-section';

  const stagingTitle = document.createElement('div');
  stagingTitle.className = 'flight-lp-title';
  stagingTitle.textContent = 'Staging';
  stagingSec.appendChild(stagingTitle);

  _elStagingList = document.createElement('div');
  _elStagingList.id = 'flight-lp-staging-list';
  stagingSec.appendChild(_elStagingList);

  panel.appendChild(stagingSec);

  // ── Fuel section ──────────────────────────────────────────────────────────
  const fuelSec = document.createElement('div');
  fuelSec.className = 'flight-lp-section';

  const fuelTitle = document.createElement('div');
  fuelTitle.className = 'flight-lp-title';
  fuelTitle.textContent = 'Fuel';
  fuelSec.appendChild(fuelTitle);

  _elFuelList = document.createElement('div');
  _elFuelList.id = 'flight-lp-fuel-list';
  fuelSec.appendChild(_elFuelList);

  panel.appendChild(fuelSec);

  _hud.appendChild(panel);

  // ── Launch pad tip ────────────────────────────────────────────────────────
  _elLaunchTip = document.createElement('div');
  _elLaunchTip.id = 'flight-launch-tip';
  _elLaunchTip.textContent = 'Press [Space] to activate Stage 1';
  _hud.appendChild(_elLaunchTip);
}

/**
 * Build the mission objectives panel (top-right).
 */
function _buildObjectivesPanel() {
  const panel = document.createElement('div');
  panel.id = 'flight-hud-objectives';

  _elObjList = document.createElement('div');
  _elObjList.id = 'flight-hud-obj-list';
  panel.appendChild(_elObjList);

  _hud.appendChild(panel);
}

/**
 * Build the time-warp control panel (bottom-centre).
 *
 * Renders a row of buttons labelled 1×, 2×, 5×, 10×, 50×.  Clicking a button
 * invokes `_onTimeWarpChange(level)` so the flight controller can apply the
 * new warp multiplier to the physics loop.
 */
function _buildTimeWarpPanel() {
  const panel = document.createElement('div');
  panel.id = 'flight-hud-timewarp';

  const label = document.createElement('span');
  label.className = 'hud-warp-label';
  label.textContent = 'Warp:';
  panel.appendChild(label);

  const WARP_LEVELS = [0, 0.25, 0.5, 1, 2, 5, 10, 50];
  for (const level of WARP_LEVELS) {
    const btn = /** @type {HTMLButtonElement} */ (document.createElement('button'));
    const label = level === 0 ? 'PAUSE' : level === 0.25 ? '¼×' : level === 0.5 ? '½×' : `${level}×`;
    btn.className       = 'hud-warp-btn' + (level === 1 ? ' active' : '');
    btn.textContent     = label;
    btn.dataset.warp    = String(level);
    btn.setAttribute('aria-label', level === 0 ? 'Pause' : `Time warp ${label}`);
    btn.addEventListener('click', () => {
      if (_warpLocked) return;
      if (_onTimeWarpChange) _onTimeWarpChange(level);
    });
    _warpButtons.push(btn);
    panel.appendChild(btn);
  }

  _hud.appendChild(panel);
}

/**
 * Show the launch pad tip ("Press [Space] to activate Stage 1").
 * Called by the flight controller after initFlightHud.
 */
export function showLaunchTip() {
  _launchTipHidden = false;
  if (_elLaunchTip) _elLaunchTip.hidden = false;
}

/**
 * Permanently hide the launch tip (e.g. after first spacebar press fires Stage 1).
 */
export function hideLaunchTip() {
  _launchTipHidden = true;
  if (_elLaunchTip) _elLaunchTip.hidden = true;
}

// ---------------------------------------------------------------------------
// Private — altitude tape
// ---------------------------------------------------------------------------

/**
 * Build the altitude tape DOM structure and append to HUD.
 */
function _buildAltTape() {
  const tape = document.createElement('div');
  tape.id = 'flight-alt-tape';

  const ticks = document.createElement('div');
  ticks.className = 'alt-tape-ticks';
  tape.appendChild(ticks);

  const indicator = document.createElement('div');
  indicator.className = 'alt-tape-indicator';
  indicator.innerHTML = '<div class="alt-tape-indicator-line"></div>'
    + '<span class="alt-tape-indicator-val"></span>';
  tape.appendChild(indicator);

  _hud.appendChild(tape);
  _elAltTape      = tape;
  _elAltTapeTicks = ticks;
}

/**
 * Return scale parameters based on current altitude.
 * @param {number} alt — current altitude in metres
 * @returns {{ range: number, minorTick: number, majorTick: number }}
 */
function _altTapeScale(alt) {
  const a = Math.abs(alt);
  if (a < 500)    return { range: 200,    minorTick: 10,    majorTick: 50 };
  if (a < 2000)   return { range: 1000,   minorTick: 50,    majorTick: 200 };
  if (a < 10000)  return { range: 5000,   minorTick: 200,   majorTick: 1000 };
  if (a < 50000)  return { range: 20000,  minorTick: 1000,  majorTick: 5000 };
  if (a < 200000) return { range: 100000, minorTick: 5000,  majorTick: 20000 };
  return            { range: 500000, minorTick: 20000, majorTick: 100000 };
}

/**
 * Format altitude for tick labels.
 * @param {number} m — altitude in metres
 * @returns {string}
 */
function _fmtAltLabel(m) {
  const a = Math.abs(m);
  const sign = m < 0 ? '-' : '';
  if (a >= 1000) return sign + (a / 1000).toFixed(a % 1000 === 0 ? 0 : 1) + 'k';
  return sign + Math.round(a) + '';
}

/**
 * Update altitude tape every frame.
 */
function _updateAltTape() {
  if (!_elAltTape || !_ps) return;

  const alt   = _ps.posY;
  const scale = _altTapeScale(alt);
  const halfRange = scale.range / 2;
  const altMin = alt - halfRange;
  const altMax = alt + halfRange;
  const tapeH  = _elAltTape.clientHeight || 1;

  let html = '';

  // Generate tick marks
  const firstTick = Math.ceil(altMin / scale.minorTick) * scale.minorTick;
  for (let t = firstTick; t <= altMax; t += scale.minorTick) {
    const pct = ((t - altMin) / scale.range) * 100;   // 0 = bottom, 100 = top
    const bottom = pct;
    const isMajor = (Math.round(t / scale.majorTick) * scale.majorTick === Math.round(t));

    if (isMajor) {
      html += `<div class="alt-tape-tick-major" style="bottom:${bottom.toFixed(2)}%"></div>`;
      html += `<div class="alt-tape-tick-label" style="bottom:${bottom.toFixed(2)}%">${_fmtAltLabel(t)}</div>`;
    } else {
      html += `<div class="alt-tape-tick-minor" style="bottom:${bottom.toFixed(2)}%"></div>`;
    }
  }

  // Ground fill if visible
  if (altMin < 0) {
    const groundPct = Math.min(100, ((0 - altMin) / scale.range) * 100);
    html += `<div class="alt-tape-ground" style="height:${groundPct.toFixed(2)}%"></div>`;
  }

  _elAltTapeTicks.innerHTML = html;

  // Update centre indicator value
  const valEl = _elAltTape.querySelector('.alt-tape-indicator-val');
  if (valEl) {
    const a = Math.abs(alt);
    if (a >= 1000) {
      valEl.textContent = (alt / 1000).toFixed(1) + 'k';
    } else {
      valEl.textContent = Math.round(alt) + 'm';
    }
  }
}

// ---------------------------------------------------------------------------
// Private — update loop
// ---------------------------------------------------------------------------

/**
 * One animation frame: update every HUD panel, then re-schedule.
 */
function _tick() {
  if (_hud && _ps) {
    _updateLeftPanel();
    _updateObjectivesPanel();
    _updateLaunchTip();
    _updateAltTape();
  }
  _rafId = requestAnimationFrame(_tick);
}

// ---------------------------------------------------------------------------
// Private — landing speed safety indicator
// ---------------------------------------------------------------------------

const _COLOR_SAFE    = '#a0ffc0';
const _COLOR_CAUTION = '#ffc080';
const _COLOR_DANGER  = '#ff6060';
const _COLOR_DEFAULT = '#a0d8b0';

/**
 * Determine the landing-safety color for the vertical speed display
 * and whether to show total speed. Mirrors the thresholds in
 * physics.js `_handleGroundContact`.
 *
 * @returns {{ color: string, totalSpeed: number|null }}
 */
function _getLandingSpeedInfo() {
  const vy = _ps.velY ?? 0;
  const vx = _ps.velX ?? 0;

  // Not descending, or already grounded/landed/crashed → default color
  if (vy >= 0 || _ps.landed || _ps.crashed || _ps.grounded) {
    return { color: _COLOR_DEFAULT, totalSpeed: null };
  }

  const totalSpeed = Math.hypot(vx, vy);
  const legs = countDeployedLegs(_ps);

  let color;
  if (legs >= 2) {
    // With legs: safe < 10, caution 10–29, danger ≥ 30
    if (totalSpeed < 10)       color = _COLOR_SAFE;
    else if (totalSpeed < 30)  color = _COLOR_CAUTION;
    else                       color = _COLOR_DANGER;
  } else {
    // No/insufficient legs: safe ≤ 5, danger > 5
    if (totalSpeed <= 5)  color = _COLOR_SAFE;
    else                  color = _COLOR_DANGER;
  }

  // Show total speed in parens when below 500 m and there's horizontal velocity
  const alt = _ps.posY ?? 0;
  const showTotal = (alt < 500 && Math.abs(vx) > 0.1) ? totalSpeed : null;

  return { color, totalSpeed: showTotal };
}

// ---------------------------------------------------------------------------
// Private — per-section updates
// ---------------------------------------------------------------------------

/**
 * Update all sections of the unified left panel (throttle, staging, fuel).
 */
function _updateLeftPanel() {
  // ── Status (altitude + vertical speed) ───────────────────────────────────
  if (_elAlt) {
    const alt = _ps.posY ?? 0;
    _elAlt.textContent = alt >= 1000
      ? `${(alt / 1000).toFixed(1)} km`
      : `${Math.round(alt)} m`;
  }
  if (_elVelY) {
    const vy = _ps.velY ?? 0;
    const { color, totalSpeed } = _getLandingSpeedInfo();
    let text = `${vy >= 0 ? '+' : ''}${vy.toFixed(1)} m/s`;
    if (totalSpeed !== null) text += ` (${Math.round(totalSpeed)})`;
    _elVelY.textContent = text;
    _elVelY.style.color = color;
  }
  if (_elVelX) {
    const vx = _ps.velX ?? 0;
    _elVelX.textContent = `${vx >= 0 ? '+' : ''}${vx.toFixed(1)} m/s`;
  }

  // ── Throttle ──────────────────────────────────────────────────────────────
  const pct = Math.round((_ps.throttle ?? 0) * 100);
  if (_elThrottleFill) _elThrottleFill.style.height = `${pct}%`;
  if (_elThrottlePct)  _elThrottlePct.textContent   = `${pct}%`;

  // ── TWR ───────────────────────────────────────────────────────────────────
  const twr = _computeTWR();
  if (_elTWR) {
    _elTWR.textContent = twr > 0 ? twr.toFixed(2) : '—';
    _elTWR.style.color = twr >= 1 ? '#a0ffc0' : twr > 0 ? '#ffc080' : '#a0d8b0';
  }

  // ── TWR bar ──────────────────────────────────────────────────────────────
  if (_elTwrBarFillUp && _elTwrBarFillDn && _elTwrBarValue) {
    if (twr > 1) {
      // TWR 1-3 maps to 0-50% fill height above center
      const fillPct = Math.min(50, ((twr - 1) / 2) * 50);
      _elTwrBarFillUp.style.height = `${fillPct}%`;
      _elTwrBarFillDn.style.height = '0%';
    } else if (twr > 0) {
      // TWR 0-1 maps to 0-50% fill below center
      const fillPct = Math.min(50, ((1 - twr) / 1) * 50);
      _elTwrBarFillUp.style.height = '0%';
      _elTwrBarFillDn.style.height = `${fillPct}%`;
    } else {
      _elTwrBarFillUp.style.height = '0%';
      _elTwrBarFillDn.style.height = '0%';
    }
    _elTwrBarValue.textContent = twr > 0 ? twr.toFixed(1) : '—';
  }

  // ── Target TWR row (TWR mode only) ──────────────────────────────────────
  if (_elTargetTwrRow && _elTargetTwrVal) {
    const isTwrMode = _ps.throttleMode === 'twr';
    _elTargetTwrRow.style.display = isTwrMode ? '' : 'none';
    if (isTwrMode) {
      _elTargetTwrVal.textContent = _ps.targetTWR === Infinity
        ? 'MAX'
        : _ps.targetTWR.toFixed(1);
    }
  }

  // ── Staging ───────────────────────────────────────────────────────────────
  if (_elStagingList && _stagingConfig) {
    _updateStagingList();
  }

  // ── Fuel ─────────────────────────────────────────────────────────────────
  if (_elFuelList) {
    _updateFuelList();
  }
}

/**
 * Rebuild the objectives list.
 * Only reconstructs the inner HTML when the number of objectives has changed
 * or a completion status has changed; otherwise leaves the DOM untouched.
 */
function _updateObjectivesPanel() {
  if (!_elObjList || !_state) return;

  // Gather all accepted missions that have objectives.
  const missions = (_state.missions.accepted ?? []).filter(
    (m) => Array.isArray(m.objectives) && m.objectives.length > 0,
  );

  // No accepted missions with objectives — hide the panel entirely.
  if (missions.length === 0) {
    const panel = _elObjList.parentElement;
    if (panel) panel.style.display = 'none';
    return;
  }

  // Ensure the panel is visible.
  const panel = _elObjList.parentElement;
  if (panel) panel.style.display = '';

  // Build a compact fingerprint: missionId + completion bits + hold timer state.
  const now = _flightState?.timeElapsed ?? 0;
  const fingerprint = missions.map(
    (m) => m.id + ':' + m.objectives.map((o) => {
      if (o.completed) return '1';
      if (o.type === ObjectiveType.HOLD_ALTITUDE && o._holdEnteredAt != null) {
        return 'H' + Math.floor(now - o._holdEnteredAt);
      }
      return '0';
    }).join(''),
  ).join('|');
  if (_elObjList.dataset.fp === fingerprint) return; // Nothing changed — skip.
  _elObjList.dataset.fp = fingerprint;

  _elObjList.innerHTML = '';
  for (const mission of missions) {
    const group = document.createElement('div');
    group.className = 'hud-obj-mission-group';

    const title = document.createElement('div');
    title.className = 'hud-obj-mission-title';
    title.textContent = mission.title;
    group.appendChild(title);

    for (const obj of mission.objectives) {
      const item = document.createElement('div');
      item.className = 'hud-obj-item';

      const icon = document.createElement('span');
      icon.className = `hud-obj-icon ${obj.completed ? 'met' : 'pending'}`;
      icon.textContent = obj.completed ? '✓' : '○';

      const descWrap = document.createElement('div');

      const desc = document.createElement('span');
      desc.className = `hud-obj-desc${obj.completed ? ' met' : ''}`;
      desc.textContent = obj.description ?? obj.type;
      descWrap.appendChild(desc);

      // Show countdown timer for duration-based objectives.
      if (obj.type === ObjectiveType.HOLD_ALTITUDE && !obj.completed && obj.target?.duration) {
        const timer = document.createElement('div');
        timer.className = 'hud-obj-timer';
        timer.dataset.testid = 'hud-obj-hold-timer';

        if (obj._holdEnteredAt != null) {
          const elapsed = Math.max(0, now - obj._holdEnteredAt);
          const remaining = Math.max(0, obj.target.duration - elapsed);
          timer.textContent = `${Math.ceil(remaining)}s remaining`;
        } else {
          timer.className += ' inactive';
          timer.textContent = `0 / ${obj.target.duration}s`;
        }
        descWrap.appendChild(timer);
      }

      item.appendChild(icon);
      item.appendChild(descWrap);
      group.appendChild(item);
    }

    _elObjList.appendChild(group);
  }
}

/**
 * Rebuild the staging list (stages shown bottom-to-top = stage 1 at bottom).
 */
function _updateStagingList() {
  if (!_elStagingList || !_stagingConfig || !_assembly || !_ps) return;

  const stages    = _stagingConfig.stages;
  const activeIdx = _stagingConfig.currentStageIdx;
  // Include a coarse fuel snapshot so delta-V updates as propellant burns.
  let totalFuel = 0;
  if (_ps) {
    for (const fuelKg of _ps.fuelStore.values()) totalFuel += fuelKg;
  }
  const fp = `${activeIdx}:${stages.length}:${Math.round(totalFuel)}`;
  if (_elStagingList.dataset.fp === fp) return; // avoid full rebuild every frame
  _elStagingList.dataset.fp = fp;
  _elStagingList.innerHTML  = '';

  // Render stages in reverse order so Stage 1 appears at the bottom.
  for (let i = stages.length - 1; i >= 0; i--) {
    const stage    = stages[i];
    const isActive = i === activeIdx;
    const isSpent  = i < activeIdx;

    const item = document.createElement('div');
    item.className = 'flight-lp-stage-item' +
      (isActive ? ' active' : isSpent ? ' spent' : '');

    const lbl = document.createElement('div');
    lbl.className = 'flight-lp-stage-label';
    lbl.textContent = `Stage ${i + 1}${isActive ? ' ▶' : ''}`;
    item.appendChild(lbl);

    // Part names for this stage.
    const partNames = [];
    for (const instanceId of stage.instanceIds) {
      const placed = _assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      if (def) partNames.push(def.name);
    }

    const parts = document.createElement('div');
    parts.className = 'flight-lp-stage-parts';
    parts.textContent = partNames.join(', ') || '(empty)';
    item.appendChild(parts);

    // Delta-V estimate.
    const dv    = _computeStageDeltaV(i);
    const dvEl  = document.createElement('div');
    dvEl.className = 'flight-lp-stage-dv';
    dvEl.textContent = dv > 0 ? `ΔV ~${Math.round(dv)} m/s` : '';
    item.appendChild(dvEl);

    _elStagingList.appendChild(item);
  }
}

/**
 * Rebuild the fuel list showing active tanks.
 */
function _updateFuelList() {
  if (!_elFuelList || !_ps || !_assembly) return;

  const entries = [];
  for (const [instanceId, fuelKg] of _ps.fuelStore) {
    if (!_ps.activeParts.has(instanceId)) continue;
    if (fuelKg < 0.1) continue;
    entries.push({ instanceId, fuelKg });
  }
  entries.sort((a, b) => b.fuelKg - a.fuelKg);

  const fingerprint = entries.map((e) => `${e.instanceId}:${Math.round(e.fuelKg)}`).join('|');
  if (_elFuelList.dataset.fp === fingerprint) return;
  _elFuelList.dataset.fp = fingerprint;
  _elFuelList.innerHTML  = '';

  if (entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'hud-empty';
    empty.textContent = 'Empty';
    _elFuelList.appendChild(empty);
    return;
  }

  for (const { instanceId, fuelKg } of entries) {
    const placed = _assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    const name   = def?.name ?? placed?.partId ?? instanceId;

    const row = document.createElement('div');
    row.className = 'flight-lp-fuel-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'flight-lp-fuel-name';
    nameEl.textContent = name;

    const kgEl = document.createElement('span');
    kgEl.className = 'flight-lp-fuel-kg';
    kgEl.textContent = `${_fmtAlt(fuelKg)} kg`;

    row.appendChild(nameEl);
    row.appendChild(kgEl);
    _elFuelList.appendChild(row);
  }
}

/**
 * Update visibility of the launch pad tip.
 * Hide it once the rocket has left the pad or a stage has been fired.
 */
function _updateLaunchTip() {
  if (_launchTipHidden || !_elLaunchTip) return;
  // Hide if rocket has moved or staging has advanced beyond stage 0.
  const launched = _ps && (!_ps.grounded || (_stagingConfig && _stagingConfig.currentStageIdx > 0));
  if (launched) {
    _launchTipHidden = true;
    _elLaunchTip.hidden = true;
  }
}

// ---------------------------------------------------------------------------
// Private — physics helpers
// ---------------------------------------------------------------------------

/**
 * Compute the current thrust-to-weight ratio.
 * Uses firing engines at current throttle; 0 if nothing is firing.
 * @returns {number}
 */
function _computeTWR() {
  if (!_ps || !_assembly) return 0;
  let totalThrust = 0;
  let totalMass   = 0;

  for (const [instanceId, placed] of _assembly.parts) {
    if (!_ps.activeParts.has(instanceId)) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    totalMass += def.mass ?? 0;
    totalMass += _ps.fuelStore.get(instanceId) ?? 0;
    if (_ps.firingEngines && _ps.firingEngines.has(instanceId)) {
      const isSRB      = def.type === PartType.SOLID_ROCKET_BOOSTER;
      const thrustN    = (def.properties?.thrust ?? 0) * 1_000; // kN → N
      const thrust     = thrustN * (isSRB ? 1 : (_ps.throttle ?? 0));
      totalThrust     += thrust;
    }
  }

  if (totalMass <= 0) return 0;
  return totalThrust / (totalMass * G0);
}

/**
 * Compute the estimated delta-V for a given stage index using the
 * Tsiolkovsky rocket equation:  ΔV = Isp × g × ln(m0 / mf)
 *
 * @param {number} stageIdx
 * @returns {number}  Delta-V in m/s; 0 if data is missing.
 */
function _computeStageDeltaV(stageIdx) {
  if (!_ps || !_assembly || !_stagingConfig) return 0;
  const stage = _stagingConfig.stages[stageIdx];
  if (!stage) return 0;

  // Total current rocket mass (active parts only) and total available fuel.
  let totalMass = 0;
  let totalFuel = 0;
  for (const [instanceId, placed] of _assembly.parts) {
    if (!_ps.activeParts.has(instanceId)) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    const fuelKg = _ps.fuelStore.get(instanceId) ?? 0;
    totalMass += (def.mass ?? 0) + fuelKg;
    // Count fuel in any part that carries propellant (tanks, SRBs, etc.)
    if (fuelKg > 0) totalFuel += fuelKg;
  }

  // Engine properties from this stage's engines.
  let thrustTotal    = 0;
  let ispTimesThrust = 0;
  for (const instanceId of stage.instanceIds) {
    if (!_ps.activeParts.has(instanceId)) continue;
    const placed = _assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def) continue;
    const thrust = def.properties?.thrust ?? 0;
    if (thrust > 0) {
      const isp = def.properties?.isp ?? 300;
      thrustTotal    += thrust;
      ispTimesThrust += isp * thrust;
    }
  }

  if (totalFuel <= 0 || thrustTotal <= 0 || totalMass <= 0) return 0;
  const avgIsp = ispTimesThrust / thrustTotal;
  const mf     = totalMass - totalFuel;
  if (mf <= 0) return 0;
  return avgIsp * G0 * Math.log(totalMass / mf);
}

/**
 * Adjust throttle so the current TWR equals 1 (if enough thrust available).
 */
function _setThrottleForTWR1() {
  if (!_ps || !_assembly) return;

  // Total dry+fuel mass (all active parts).
  let totalMass = 0;
  let maxThrust = 0; // sum of all active throttleable engine thrust
  let srbThrust = 0; // SRB thrust only counted if currently firing

  for (const [instanceId, placed] of _assembly.parts) {
    if (!_ps.activeParts.has(instanceId)) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    totalMass += def.mass ?? 0;
    totalMass += _ps.fuelStore.get(instanceId) ?? 0;

    const thrustN = (def.properties?.thrust ?? 0) * 1_000; // kN → N
    if (def.type === PartType.SOLID_ROCKET_BOOSTER) {
      // SRBs contribute fixed thrust only if actively burning.
      if (_ps.firingEngines && _ps.firingEngines.has(instanceId)) {
        srbThrust += thrustN;
      }
    } else if (def.type === PartType.ENGINE) {
      // Count ALL active throttleable engines regardless of staging.
      maxThrust += thrustN;
    }
  }

  const weightN   = totalMass * G0;
  const remaining = weightN - srbThrust; // thrust needed from throttleable engines
  if (maxThrust <= 0) return;
  _ps.throttle = Math.min(1, Math.max(0, remaining / maxThrust));
}

// ---------------------------------------------------------------------------
// Private — utilities
// ---------------------------------------------------------------------------

/**
 * Format a number with a thousands separator.
 * @param {number} n
 * @returns {string}
 */
function _fmtAlt(n) {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Format a signed speed value (+NNN.N or -NNN.N).
 * @param {number} ms  Speed in m/s.
 * @returns {string}
 */
function _fmtSigned(ms) {
  const sign = ms >= 0 ? '+' : '';
  return `${sign}${ms.toFixed(1)}`;
}

/**
 * Estimate the apoapsis altitude using the ballistic parabolic equation.
 *
 * Ignores ongoing thrust and atmospheric drag — this is an instantaneous
 * "coasting" estimate suitable for a real-time HUD readout.
 *
 * Formula:  apoapsis = altitude + velY² / (2 × g)   (when velY > 0)
 * When descending (velY ≤ 0) the current altitude IS the apoapsis.
 *
 * @param {number} altitude  Current altitude (m, ≥ 0).
 * @param {number} velY      Vertical velocity (m/s; positive = ascending).
 * @returns {number}         Estimated apoapsis altitude in metres.
 */
function _estimateApoapsis(altitude, velY) {
  if (velY <= 0) return altitude;
  return altitude + (velY * velY) / (2 * G0);
}
