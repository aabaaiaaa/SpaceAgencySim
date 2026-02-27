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
  inset: 0;
  pointer-events: none;
  z-index: 100;
  font-family: 'Courier New', Courier, monospace;
  color: #a8e8c0;
  user-select: none;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Throttle bar — left edge, vertically centred
   ═══════════════════════════════════════════════════════════════════════════ */
#flight-hud-throttle {
  position: absolute;
  left: 10px;
  top: 50%;
  transform: translateY(-50%);
  width: 34px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
}

#flight-hud-throttle-label-top,
#flight-hud-throttle-label-bot {
  font-size: 8px;
  color: #507860;
  letter-spacing: 0.02em;
}

#flight-hud-throttle-track {
  width: 14px;
  height: 180px;
  border: 1px solid #305030;
  border-radius: 2px;
  background: rgba(0, 0, 0, 0.55);
  position: relative;
  overflow: hidden;
  flex-shrink: 0;
}

#flight-hud-throttle-fill {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: linear-gradient(to top, #20c040, #60ff80);
  transition: height 0.06s linear;
  border-radius: 0 0 2px 2px;
}

#flight-hud-throttle-pct {
  font-size: 10px;
  color: #c0ffd8;
  text-align: center;
  width: 100%;
  letter-spacing: 0.02em;
}

/* ═══════════════════════════════════════════════════════════════════════════
   Telemetry panel — top-left, beside the throttle bar
   ═══════════════════════════════════════════════════════════════════════════ */
#flight-hud-telem {
  position: absolute;
  left: 54px;
  top: 10px;
  background: rgba(0, 8, 0, 0.68);
  border: 1px solid #284828;
  border-radius: 4px;
  padding: 8px 12px 6px;
  min-width: 190px;
}

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

/* ═══════════════════════════════════════════════════════════════════════════
   Fuel panel — bottom-right
   ═══════════════════════════════════════════════════════════════════════════ */
#flight-hud-fuel {
  position: absolute;
  right: 10px;
  bottom: 10px;
  background: rgba(0, 8, 0, 0.68);
  border: 1px solid #284828;
  border-radius: 4px;
  padding: 8px 12px 6px;
  min-width: 160px;
  max-width: 240px;
}

.hud-fuel-row {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  gap: 10px;
  margin-bottom: 4px;
  font-size: 10px;
}

.hud-fuel-row:last-child {
  margin-bottom: 0;
}

.hud-fuel-name {
  color: #80c090;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 130px;
}

.hud-fuel-kg {
  color: #c0ffd8;
  white-space: nowrap;
  flex-shrink: 0;
  text-align: right;
}

.hud-empty {
  color: #405840;
  font-size: 10px;
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

// DOM nodes updated on every frame:
let _elThrottleFill = null;
let _elThrottlePct  = null;
let _elAlt          = null;
let _elVelY         = null;
let _elVelX         = null;
let _elStage        = null;
let _elApo          = null;
let _elObjList      = null;
let _elFuelList     = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the flight HUD overlay and start the update loop.
 *
 * Holds live references to the mutable sim objects — no data is copied.
 * All DOM updates read the live object state on each animation frame.
 *
 * @param {HTMLElement}                                             container     #ui-overlay div.
 * @param {import('../core/physics.js').PhysicsState}               ps
 * @param {import('../core/rocketbuilder.js').RocketAssembly}       assembly
 * @param {import('../core/rocketbuilder.js').StagingConfig}        stagingConfig
 * @param {import('../core/gameState.js').FlightState}              flightState
 * @param {import('../core/gameState.js').GameState}                state
 */
export function initFlightHud(container, ps, assembly, stagingConfig, flightState, state) {
  _ps            = ps;
  _assembly      = assembly;
  _stagingConfig = stagingConfig;
  _flightState   = flightState;
  _state         = state;

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

  _buildThrottleBar();
  _buildTelemPanel();
  _buildObjectivesPanel();
  _buildFuelPanel();

  // X → throttle 0 %, Z → throttle 100 %.
  // W/S/ArrowUp/ArrowDown are handled by physics.js handleKeyDown when the
  // flight loop calls it; X/Z are handled here to keep the HUD self-contained.
  _keyHandler = (e) => {
    if (!_ps) return;
    const k = e.key;
    if (k === 'x' || k === 'X') {
      _ps.throttle = 0;
    } else if (k === 'z' || k === 'Z') {
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
  _ps            = null;
  _assembly      = null;
  _stagingConfig = null;
  _flightState   = null;
  _state         = null;

  _elThrottleFill = null;
  _elThrottlePct  = null;
  _elAlt          = null;
  _elVelY         = null;
  _elVelX         = null;
  _elStage        = null;
  _elApo          = null;
  _elObjList      = null;
  _elFuelList     = null;

  console.log('[Flight HUD] Destroyed');
}

// ---------------------------------------------------------------------------
// Private — DOM construction
// ---------------------------------------------------------------------------

/**
 * Build the vertical throttle bar on the left edge.
 */
function _buildThrottleBar() {
  const wrap = document.createElement('div');
  wrap.id = 'flight-hud-throttle';

  const labelTop = document.createElement('div');
  labelTop.id = 'flight-hud-throttle-label-top';
  labelTop.textContent = '100%';
  wrap.appendChild(labelTop);

  const track = document.createElement('div');
  track.id = 'flight-hud-throttle-track';

  _elThrottleFill = document.createElement('div');
  _elThrottleFill.id = 'flight-hud-throttle-fill';
  _elThrottleFill.style.height = '100%';
  track.appendChild(_elThrottleFill);

  wrap.appendChild(track);

  const labelBot = document.createElement('div');
  labelBot.id = 'flight-hud-throttle-label-bot';
  labelBot.textContent = '0%';
  wrap.appendChild(labelBot);

  _elThrottlePct = document.createElement('div');
  _elThrottlePct.id = 'flight-hud-throttle-pct';
  _elThrottlePct.textContent = '100%';
  wrap.appendChild(_elThrottlePct);

  _hud.appendChild(wrap);
}

/**
 * Build the telemetry panel (altitude, speeds, stage, apoapsis).
 */
function _buildTelemPanel() {
  const panel = document.createElement('div');
  panel.id = 'flight-hud-telem';

  /** @param {string} label @param {string} valClass @param {string} id */
  function addRow(label, valClass, id) {
    const row = document.createElement('div');
    row.className = 'hud-row';

    const lbl = document.createElement('div');
    lbl.className = 'hud-lbl';
    lbl.textContent = label;
    row.appendChild(lbl);

    const val = document.createElement('div');
    val.className = valClass;
    val.id = id;
    val.textContent = '—';
    row.appendChild(val);

    panel.appendChild(row);
    return val;
  }

  _elAlt   = addRow('Altitude',       'hud-val',    'hud-alt');
  _elVelY  = addRow('Vert Speed',     'hud-val-sm', 'hud-vely');
  _elVelX  = addRow('Horiz Speed',    'hud-val-sm', 'hud-velx');
  _elStage = addRow('Stage',          'hud-val-sm', 'hud-stage');
  _elApo   = addRow('Apoapsis (est)', 'hud-val-sm', 'hud-apo');

  _hud.appendChild(panel);
}

/**
 * Build the mission objectives panel (top-right).
 */
function _buildObjectivesPanel() {
  const panel = document.createElement('div');
  panel.id = 'flight-hud-objectives';

  const title = document.createElement('div');
  title.className = 'hud-panel-title';
  title.textContent = 'Mission Objectives';
  panel.appendChild(title);

  _elObjList = document.createElement('div');
  _elObjList.id = 'flight-hud-obj-list';
  panel.appendChild(_elObjList);

  _hud.appendChild(panel);
}

/**
 * Build the per-tank fuel panel (bottom-right).
 */
function _buildFuelPanel() {
  const panel = document.createElement('div');
  panel.id = 'flight-hud-fuel';

  const title = document.createElement('div');
  title.className = 'hud-panel-title';
  title.textContent = 'Fuel Remaining';
  panel.appendChild(title);

  _elFuelList = document.createElement('div');
  _elFuelList.id = 'flight-hud-fuel-list';
  panel.appendChild(_elFuelList);

  _hud.appendChild(panel);
}

// ---------------------------------------------------------------------------
// Private — update loop
// ---------------------------------------------------------------------------

/**
 * One animation frame: update every HUD panel, then re-schedule.
 */
function _tick() {
  if (_hud && _ps) {
    _updateThrottleBar();
    _updateTelemPanel();
    _updateObjectivesPanel();
    _updateFuelPanel();
  }
  _rafId = requestAnimationFrame(_tick);
}

// ---------------------------------------------------------------------------
// Private — per-section updates
// ---------------------------------------------------------------------------

/**
 * Update the throttle bar fill height and percentage label.
 */
function _updateThrottleBar() {
  const pct = Math.round((_ps.throttle ?? 0) * 100);
  if (_elThrottleFill) _elThrottleFill.style.height = `${pct}%`;
  if (_elThrottlePct)  _elThrottlePct.textContent   = `${pct}%`;
}

/**
 * Update the telemetry panel values.
 */
function _updateTelemPanel() {
  const altitude = Math.max(0, _ps.posY);
  const velY     = _ps.velY ?? 0;
  const velX     = _ps.velX ?? 0;

  if (_elAlt)   _elAlt.textContent  = `${_fmtAlt(altitude)} m`;
  if (_elVelY)  _elVelY.textContent = `${_fmtSigned(velY)} m/s`;
  if (_elVelX)  _elVelX.textContent = `${Math.abs(velX).toFixed(1)} m/s`;

  if (_elStage && _stagingConfig) {
    const cur   = _stagingConfig.currentStageIdx + 1;
    const total = _stagingConfig.stages.length;
    _elStage.textContent = `${cur} / ${total}`;
  }

  if (_elApo) {
    const apo = _estimateApoapsis(altitude, velY);
    _elApo.textContent = `~${_fmtAlt(apo)} m`;
  }
}

/**
 * Rebuild the objectives list.
 * Only reconstructs the inner HTML when the number of objectives has changed
 * or a completion status has changed; otherwise leaves the DOM untouched.
 */
function _updateObjectivesPanel() {
  if (!_elObjList || !_state || !_flightState) return;

  const mission = _state.missions.accepted.find(
    (m) => m.id === _flightState.missionId,
  );

  // No active mission or none accepted — show placeholder.
  if (!mission || !mission.objectives || mission.objectives.length === 0) {
    if (_elObjList.dataset.empty !== '1') {
      _elObjList.innerHTML = '';
      const ph = document.createElement('div');
      ph.className = 'hud-empty';
      ph.textContent = 'No objectives';
      _elObjList.appendChild(ph);
      _elObjList.dataset.empty = '1';
    }
    return;
  }

  // Build a compact state fingerprint (completed flags as a bit string).
  const fingerprint = mission.objectives.map((o) => o.completed ? '1' : '0').join('');
  if (_elObjList.dataset.fp === fingerprint) return; // Nothing changed — skip.
  _elObjList.dataset.fp    = fingerprint;
  _elObjList.dataset.empty = '';

  _elObjList.innerHTML = '';
  for (const obj of mission.objectives) {
    const item = document.createElement('div');
    item.className = 'hud-obj-item';

    const icon = document.createElement('span');
    icon.className = `hud-obj-icon ${obj.completed ? 'met' : 'pending'}`;
    icon.textContent = obj.completed ? '✓' : '○';

    const desc = document.createElement('span');
    desc.className = `hud-obj-desc${obj.completed ? ' met' : ''}`;
    desc.textContent = obj.description ?? obj.type;

    item.appendChild(icon);
    item.appendChild(desc);
    _elObjList.appendChild(item);
  }
}

/**
 * Rebuild the per-tank fuel list.
 * Uses a simple fingerprint to avoid thrashing the DOM every frame.
 */
function _updateFuelPanel() {
  if (!_elFuelList || !_ps || !_assembly) return;

  // Build a fingerprint: sorted list of "id:rounded_kg" for active tanks.
  const entries = [];
  for (const [instanceId, fuelKg] of _ps.fuelStore) {
    if (!_ps.activeParts.has(instanceId)) continue;
    if (fuelKg < 0.1) continue; // skip effectively empty tanks
    entries.push({ instanceId, fuelKg });
  }

  // Sort by fuelKg descending (largest tank first).
  entries.sort((a, b) => b.fuelKg - a.fuelKg);

  const fingerprint = entries.map((e) => `${e.instanceId}:${Math.round(e.fuelKg)}`).join('|');
  if (_elFuelList.dataset.fp === fingerprint) return;
  _elFuelList.dataset.fp = fingerprint;

  _elFuelList.innerHTML = '';

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
    row.className = 'hud-fuel-row';

    const nameEl = document.createElement('span');
    nameEl.className = 'hud-fuel-name';
    nameEl.textContent = name;

    const kgEl = document.createElement('span');
    kgEl.className = 'hud-fuel-kg';
    kgEl.textContent = `${_fmtAlt(fuelKg)} kg`;

    row.appendChild(nameEl);
    row.appendChild(kgEl);
    _elFuelList.appendChild(row);
  }
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
