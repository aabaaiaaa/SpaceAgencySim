/**
 * flightHud.ts — In-flight HTML overlay HUD.
 *
 * Renders a heads-up display on top of the PixiJS flight canvas showing
 * real-time telemetry and mission status:
 *
 *   LEFT EDGE
 *     - Throttle bar: vertical bar showing 0-100 %, updated live.
 *       Keyboard: W / ArrowUp   +5 %  (handled by physics.js handleKeyDown)
 *                 S / ArrowDown -5 %  (handled by physics.js handleKeyDown)
 *                 X             -> 0 % (handled here via direct ps.throttle write)
 *                 Z             -> 100 %(handled here via direct ps.throttle write)
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
 *       indicator (checkmark when met, circle while pending).
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

import { getPartById } from '../data/parts.ts';
import { PartType, ControlMode } from '../core/constants.ts';
import { logger } from '../core/logger.ts';
import { getControlModeLabel, checkBandLimitWarning } from '../core/controlMode.ts';
import { ObjectiveType } from '../data/missions.ts';
import { countDeployedLegs } from '../core/legs.ts';
import { getBiome } from '../core/biomes.ts';
import { getAvailableSurfaceActions } from '../core/surfaceOps.ts';
import './flightHud.css';
import { markThrottleDirty } from './flightController/_loop.ts';
import type { PhysicsState } from '../core/physics.ts';
import type { RocketAssembly, StagingConfig } from '../core/rocketbuilder.ts';
import type { FlightState, GameState } from '../core/gameState.ts';

// ---------------------------------------------------------------------------
// Physics constant
// ---------------------------------------------------------------------------

/** Standard gravity (m/s^2) — used for ballistic apoapsis estimate. */
const G0: number = 9.81;


// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** Root overlay element. */
let _hud: HTMLElement | null = null;

/** requestAnimationFrame handle. */
let _rafId: number | null = null;

/** Live references to sim objects (set on init, cleared on destroy). */
let _ps: PhysicsState | null = null;
let _assembly: RocketAssembly | null = null;
let _stagingConfig: StagingConfig | null = null;
let _flightState: FlightState | null = null;
let _state: GameState | null = null;

/** Keyboard handler for X/Z throttle cut/full. */
let _keyHandler: ((e: KeyboardEvent) => void) | null = null;

/** Callback invoked with the chosen warp level when a warp button is clicked. */
let _onTimeWarpChange: ((level: number) => void) | null = null;

/** Callback invoked when the player clicks "Abort to Hub" after repeated HUD errors. */
let _onAbort: (() => void) | null = null;

/** Count of consecutive _tick errors (reset to 0 on each successful frame). */
let _consecutiveErrors: number = 0;

/** Whether the error banner is currently visible. */
let _errorBanner: HTMLElement | null = null;

/** Current active time warp level (1, 2, 5, 10, or 50). */
let _timeWarp: number = 1;

/** Whether the warp buttons are locked out (e.g. during a staging sequence). */
let _warpLocked: boolean = false;

/** Surface operations panel. */
let _elSurfacePanel: HTMLElement | null = null;

/** Callback invoked with the surface action id when a surface button is clicked. */
let _onSurfaceAction: ((actionId: string) => void) | null = null;

/** Array of warp-level button DOM elements (kept for highlight updates). */
let _warpButtons: HTMLButtonElement[] = [];

// DOM nodes updated on every frame:
let _elThrottleFill: HTMLElement | null = null;   // left-panel throttle bar fill
let _elThrottlePct: HTMLElement | null = null;    // left-panel throttle % (id: flight-hud-throttle-pct)
let _elTWR: HTMLElement | null = null;            // left-panel TWR value
let _elAlt: HTMLElement | null = null;            // left-panel altitude (id: hud-alt)
let _elVelY: HTMLElement | null = null;           // left-panel vertical speed (id: hud-vely)
let _elVelX: HTMLElement | null = null;           // left-panel horizontal speed (id: hud-velx)
let _elApo: HTMLElement | null = null;            // left-panel apoapsis (id: hud-apo)
let _elStagingList: HTMLElement | null = null;    // left-panel staging container
let _elFuelList: HTMLElement | null = null;       // left-panel fuel list
let _elObjList: HTMLElement | null = null;        // objectives panel (top-right, unchanged)
let _elLaunchTip: HTMLElement | null = null;      // launch pad "press space" tip
let _launchTipHidden: boolean = false;            // once hidden, stays hidden

// Altitude tape elements:
let _elAltTape: HTMLElement | null = null;        // altitude tape container
let _elAltTapeTicks: HTMLElement | null = null;   // altitude tape ticks container

// TWR bar elements:
let _elModeToggle: HTMLButtonElement | null = null;   // TWR/ABS mode toggle button
let _elTwrBarFillUp: HTMLElement | null = null;       // TWR bar green fill (>1)
let _elTwrBarFillDn: HTMLElement | null = null;       // TWR bar orange fill (<1)
let _elTwrBarValue: HTMLElement | null = null;        // TWR bar centered value text
let _elTargetTwrRow: HTMLElement | null = null;       // "Target" info row (visible only in TWR mode)
let _elTargetTwrVal: HTMLElement | null = null;       // Target TWR value text

// Control mode indicator elements:
let _elControlMode: HTMLElement | null = null;    // control mode badge (shows ORBIT / DOCKING / RCS)
let _elBandWarning: HTMLElement | null = null;    // altitude band limit warning text
let _elBiome: HTMLElement | null = null;          // biome name in status section
let _elCrewList: HTMLElement | null = null;       // left-panel crew list
let _elCommsStatus: HTMLElement | null = null;    // comms status indicator in status section

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Mount the flight HUD overlay and start the update loop.
 *
 * Holds live references to the mutable sim objects — no data is copied.
 * All DOM updates read the live object state on each animation frame.
 */
export function initFlightHud(
  container: HTMLElement,
  ps: PhysicsState,
  assembly: RocketAssembly,
  stagingConfig: StagingConfig,
  flightState: FlightState,
  state: GameState,
  onTimeWarpChange?: ((level: number) => void) | null,
  onSurfaceAction?: ((actionId: string) => void) | null,
  onAbort?: (() => void) | null,
): void {
  _ps               = ps;
  _assembly         = assembly;
  _stagingConfig    = stagingConfig;
  _flightState      = flightState;
  _state            = state;
  _onTimeWarpChange = onTimeWarpChange ?? null;
  _onSurfaceAction  = onSurfaceAction ?? null;
  _onAbort          = onAbort ?? null;
  _timeWarp         = 1;
  _warpLocked       = false;
  _warpButtons      = [];
  _launchTipHidden  = false;
  _consecutiveErrors = 0;
  _errorBanner       = null;

  // Root container.
  _hud = document.createElement('div');
  _hud.id = 'flight-hud';
  container.appendChild(_hud);

  _buildLeftPanel();
  _buildObjectivesPanel();
  _buildTimeWarpPanel();
  _buildAltTape();
  _buildControlModeIndicator();
  _buildSurfacePanel();

  // X -> throttle 0 %, Z -> throttle 100 %.
  // W/S/ArrowUp/ArrowDown are handled by physics.js handleKeyDown when the
  // flight loop calls it; X/Z are handled here to keep the HUD self-contained.
  _keyHandler = (e: KeyboardEvent): void => {
    if (!_ps) return;
    const k = e.key;
    const twrMode = _ps.throttleMode === 'twr';
    if (k === 'x' || k === 'X') {
      if (twrMode) {
        _ps.targetTWR = 0;
      }
      _ps.throttle = 0;
      markThrottleDirty();
    } else if (k === 'z' || k === 'Z') {
      if (twrMode) {
        _ps.targetTWR = Infinity;
      }
      _ps.throttle = 1;
      markThrottleDirty();
    }
  };
  window.addEventListener('keydown', _keyHandler);

  // Start the update loop.
  _rafId = requestAnimationFrame(_tick);


}

/**
 * Tear down the flight HUD — removes the DOM overlay and cancels the loop.
 * Safe to call even if initFlightHud was never called.
 */
export function destroyFlightHud(): void {
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
  _onSurfaceAction  = null;
  _onAbort          = null;
  _timeWarp         = 1;
  _warpLocked       = false;
  _warpButtons      = [];
  _consecutiveErrors = 0;
  _errorBanner       = null;

  _elThrottleFill  = null;
  _elThrottlePct   = null;
  _elTWR           = null;
  _elAlt           = null;
  _elVelY          = null;
  _elVelX          = null;
  _elApo           = null;
  _elStagingList   = null;
  _elFuelList      = null;
  _elCrewList      = null;
  _elControlMode   = null;
  _elBandWarning   = null;
  _elBiome         = null;
  _elObjList       = null;
  _elLaunchTip     = null;
  _launchTipHidden = false;

  _elAltTape       = null;
  _elAltTapeTicks  = null;

  _elSurfacePanel  = null;

  _elModeToggle    = null;
  _elTwrBarFillUp  = null;
  _elTwrBarFillDn  = null;
  _elTwrBarValue   = null;
  _elTargetTwrRow  = null;
  _elTargetTwrVal  = null;


}

// ---------------------------------------------------------------------------
// Public API — time warp control
// ---------------------------------------------------------------------------

/**
 * Update the active-button highlight and internal warp state to match `level`.
 * Call this from the flight controller when the warp level changes for any
 * reason (button click, automatic reset, etc.).
 */
export function setHudTimeWarp(level: number): void {
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
 */
export function lockTimeWarp(locked: boolean): void {
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
function _buildLeftPanel(): void {
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

  const apoRow = document.createElement('div');
  apoRow.className = 'flight-lp-twr-row';
  const apoLbl = document.createElement('div');
  apoLbl.className = 'flight-lp-lbl';
  apoLbl.textContent = 'Apo';
  _elApo = document.createElement('div');
  _elApo.id = 'hud-apo';
  _elApo.className = 'flight-lp-val';
  _elApo.textContent = '\u2014';
  apoRow.appendChild(apoLbl);
  apoRow.appendChild(_elApo);
  statusSec.appendChild(apoRow);

  const biomeRow = document.createElement('div');
  biomeRow.className = 'flight-lp-twr-row';
  const biomeLbl = document.createElement('div');
  biomeLbl.className = 'flight-lp-lbl';
  biomeLbl.textContent = 'Biome';
  _elBiome = document.createElement('div');
  _elBiome.id = 'hud-biome';
  _elBiome.className = 'flight-lp-val flight-lp-val-sm';
  _elBiome.textContent = 'Ground';
  biomeRow.appendChild(biomeLbl);
  biomeRow.appendChild(_elBiome);
  statusSec.appendChild(biomeRow);

  const commsRow = document.createElement('div');
  commsRow.className = 'flight-lp-twr-row';
  const commsLbl = document.createElement('div');
  commsLbl.className = 'flight-lp-lbl';
  commsLbl.textContent = 'Comms';
  _elCommsStatus = document.createElement('div');
  _elCommsStatus.id = 'hud-comms';
  _elCommsStatus.className = 'flight-lp-val flight-lp-val-sm';
  _elCommsStatus.textContent = 'Direct Link';
  commsRow.appendChild(commsLbl);
  commsRow.appendChild(_elCommsStatus);
  statusSec.appendChild(commsRow);

  panel.appendChild(statusSec);

  // ── Throttle section ──────────────────────────────────────────────────────
  const throttleSec = document.createElement('div');
  throttleSec.className = 'flight-lp-section';

  // Title row: "Throttle" + mode toggle button
  const titleRow = document.createElement('div');
  titleRow.className = 'flight-throttle-title-row';
  const throttleTitle = document.createElement('div');
  throttleTitle.className = 'flight-lp-title flight-lp-title--no-mb';
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
      _elModeToggle!.textContent = 'ABS';
      _elModeToggle!.classList.remove('active');
    } else {
      // Switching to TWR mode — snapshot current TWR as target to prevent jump
      const currentTWR = _computeTWR();
      _ps.targetTWR = currentTWR > 0 ? currentTWR : 1.0;
      _ps.throttleMode = 'twr';
      _elModeToggle!.textContent = 'TWR';
      _elModeToggle!.classList.add('active');
    }
    markThrottleDirty();
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
  _elThrottleFill.style.setProperty('--throttle-pct', '100%');
  track.appendChild(_elThrottleFill);
  throttleRow.appendChild(track);

  // TWR bar (between throttle bar and info column)
  const twrBar = document.createElement('div');
  twrBar.className = 'flight-lp-twr-bar';
  const twrBarCenter = document.createElement('div');
  twrBarCenter.className = 'flight-lp-twr-bar-center';
  _elTwrBarFillUp = document.createElement('div');
  _elTwrBarFillUp.className = 'flight-lp-twr-bar-fill-up';
  _elTwrBarFillUp.style.setProperty('--twr-fill-up', '0%');
  _elTwrBarFillDn = document.createElement('div');
  _elTwrBarFillDn.className = 'flight-lp-twr-bar-fill-dn';
  _elTwrBarFillDn.style.setProperty('--twr-fill-dn', '0%');
  _elTwrBarValue = document.createElement('div');
  _elTwrBarValue.className = 'flight-lp-twr-bar-value';
  _elTwrBarValue.textContent = '\u2014';
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
  _elTWR.id = 'hud-twr';
  _elTWR.className = 'flight-lp-val';
  _elTWR.textContent = '\u2014';
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
    markThrottleDirty();
  });
  btnRow.appendChild(setTWR1Btn);

  const minusBtn = document.createElement('button');
  minusBtn.className = 'flight-lp-btn';
  minusBtn.textContent = '\u22120.1';
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
    markThrottleDirty();
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
    markThrottleDirty();
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

  // ── Crew section (visible only when crew aboard) ──────────────────────────
  const crewSec = document.createElement('div');
  crewSec.className = 'flight-lp-section';
  crewSec.id = 'flight-lp-crew-section';

  const crewTitle = document.createElement('div');
  crewTitle.className = 'flight-lp-title';
  crewTitle.textContent = 'Crew';
  crewSec.appendChild(crewTitle);

  _elCrewList = document.createElement('div');
  _elCrewList.id = 'flight-lp-crew-list';
  crewSec.appendChild(_elCrewList);

  panel.appendChild(crewSec);

  _hud!.appendChild(panel);

  // ── Launch pad tip ────────────────────────────────────────────────────────
  _elLaunchTip = document.createElement('div');
  _elLaunchTip.id = 'flight-launch-tip';
  _elLaunchTip.textContent = 'Press [Space] to activate Stage 1';
  _hud!.appendChild(_elLaunchTip);
}

/**
 * Build the mission objectives panel (top-right).
 */
function _buildObjectivesPanel(): void {
  const panel = document.createElement('div');
  panel.id = 'flight-hud-objectives';

  _elObjList = document.createElement('div');
  _elObjList.id = 'flight-hud-obj-list';
  panel.appendChild(_elObjList);

  _hud!.appendChild(panel);
}

/**
 * Build the time-warp control panel (bottom-centre).
 *
 * Renders a row of buttons labelled 1x, 2x, 5x, 10x, 50x.  Clicking a button
 * invokes `_onTimeWarpChange(level)` so the flight controller can apply the
 * new warp multiplier to the physics loop.
 */
function _buildTimeWarpPanel(): void {
  const panel = document.createElement('div');
  panel.id = 'flight-hud-timewarp';

  const label = document.createElement('span');
  label.className = 'hud-warp-label';
  label.textContent = 'Warp:';
  panel.appendChild(label);

  const WARP_LEVELS: number[] = [0, 0.25, 0.5, 1, 2, 5, 10, 50];
  for (const level of WARP_LEVELS) {
    const btn = document.createElement('button') as HTMLButtonElement;
    const btnLabel = level === 0 ? 'PAUSE' : level === 0.25 ? '\u00BC\u00D7' : level === 0.5 ? '\u00BD\u00D7' : `${level}\u00D7`;
    btn.className       = 'hud-warp-btn' + (level === 1 ? ' active' : '');
    btn.textContent     = btnLabel;
    btn.dataset.warp    = String(level);
    btn.setAttribute('aria-label', level === 0 ? 'Pause' : `Time warp ${btnLabel}`);
    btn.addEventListener('click', () => {
      if (_warpLocked) return;
      if (_onTimeWarpChange) _onTimeWarpChange(level);
    });
    _warpButtons.push(btn);
    panel.appendChild(btn);
  }

  _hud!.appendChild(panel);
}

/**
 * Show the launch pad tip ("Press [Space] to activate Stage 1").
 * Called by the flight controller after initFlightHud.
 */
export function showLaunchTip(): void {
  _launchTipHidden = false;
  if (_elLaunchTip) _elLaunchTip.hidden = false;
}

/**
 * Permanently hide the launch tip (e.g. after first spacebar press fires Stage 1).
 */
export function hideLaunchTip(): void {
  _launchTipHidden = true;
  if (_elLaunchTip) _elLaunchTip.hidden = true;
}

// ---------------------------------------------------------------------------
// Private — altitude tape
// ---------------------------------------------------------------------------

/**
 * Build the altitude tape DOM structure and append to HUD.
 */
function _buildAltTape(): void {
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

  _hud!.appendChild(tape);
  _elAltTape      = tape;
  _elAltTapeTicks = ticks;
}

/**
 * Return scale parameters based on current altitude.
 */
function _altTapeScale(alt: number): { range: number; minorTick: number; majorTick: number } {
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
 */
function _fmtAltLabel(m: number): string {
  const a = Math.abs(m);
  const sign = m < 0 ? '-' : '';
  if (a >= 1000) return sign + (a / 1000).toFixed(a % 1000 === 0 ? 0 : 1) + 'k';
  return sign + Math.round(a) + '';
}

/**
 * Update altitude tape every frame.
 */
function _updateAltTape(): void {
  if (!_elAltTape || !_ps) return;

  const alt   = _ps.posY;
  const scale = _altTapeScale(alt);
  const halfRange = scale.range / 2;
  const altMin = alt - halfRange;
  const altMax = alt + halfRange;

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

  _elAltTapeTicks!.innerHTML = html;

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
// Private — control mode indicator
// ---------------------------------------------------------------------------

/**
 * Build the control mode indicator badge and band warning overlay.
 */
function _buildControlModeIndicator(): void {
  _elControlMode = document.createElement('div');
  _elControlMode.id = 'hud-control-mode';
  _elControlMode.dataset.mode = 'NORMAL';
  _elControlMode.textContent = 'Orbit';
  _hud!.appendChild(_elControlMode);

  _elBandWarning = document.createElement('div');
  _elBandWarning.id = 'hud-band-warning';
  _elBandWarning.className = 'hidden';
  _elBandWarning.textContent = '';
  _hud!.appendChild(_elBandWarning);
}

/**
 * Update the control mode indicator badge every frame.
 * Only visible when in ORBIT phase (or docking/RCS sub-modes).
 */
function _updateControlModeIndicator(): void {
  if (!_elControlMode || !_ps || !_flightState) return;

  const mode = _ps.controlMode ?? ControlMode.NORMAL;
  const label = getControlModeLabel(mode);

  _elControlMode.dataset.mode = mode;
  _elControlMode.textContent = label;

  // Only show the indicator during ORBIT (and its sub-modes).
  const inOrbitPhase = _flightState.phase === 'ORBIT' || _flightState.phase === 'MANOEUVRE';
  _elControlMode.style.display = inOrbitPhase ? '' : 'none';

  // Band warning (only in docking/RCS mode).
  if (_elBandWarning) {
    if (mode === ControlMode.DOCKING || mode === ControlMode.RCS) {
      const warn = checkBandLimitWarning(_ps, 'EARTH');
      if (warn.warning) {
        _elBandWarning.textContent = warn.message;
        _elBandWarning.classList.remove('hidden');
      } else {
        _elBandWarning.classList.add('hidden');
      }
    } else {
      _elBandWarning.classList.add('hidden');
    }
  }
}

// ---------------------------------------------------------------------------
// Surface operations panel
// ---------------------------------------------------------------------------

/**
 * Build the surface operations panel (bottom-left, hidden by default).
 * Shows action buttons when the rocket is landed.
 */
function _buildSurfacePanel(): void {
  const panel = document.createElement('div');
  panel.id = 'flight-hud-surface';
  panel.classList.add('hidden');

  const title = document.createElement('div');
  title.className = 'surface-title';
  title.textContent = 'Surface Ops';
  panel.appendChild(title);

  _elSurfacePanel = panel;
  _hud!.appendChild(panel);
}

/**
 * Update the surface operations panel: show/hide based on landed state,
 * rebuild action buttons to reflect current availability.
 */
function _updateSurfacePanel(): void {
  if (!_elSurfacePanel || !_ps || !_flightState || !_state) return;

  // Only show when landed.
  if (!_ps.landed) {
    _elSurfacePanel.classList.add('hidden');
    return;
  }

  _elSurfacePanel.classList.remove('hidden');

  const actions = getAvailableSurfaceActions(_state, _flightState, _ps, _assembly!);

  // Rebuild buttons only when the action list changes (avoid constant DOM churn).
  const key = actions.map((a: { id: string; enabled: boolean }) => `${a.id}:${a.enabled}`).join('|');
  if (_elSurfacePanel.dataset.key === key) return;
  _elSurfacePanel.dataset.key = key;

  // Remove old buttons (keep the title).
  while (_elSurfacePanel.children.length > 1) {
    _elSurfacePanel.removeChild(_elSurfacePanel.lastChild!);
  }

  for (const action of actions) {
    const btn = document.createElement('button');
    btn.className = 'surface-btn';
    btn.disabled = !action.enabled;

    if (!action.enabled && action.reason) {
      const reason = document.createElement('span');
      reason.className = 'surface-btn-reason';
      reason.textContent = `(${action.reason})`;
      btn.textContent = action.label;
      btn.appendChild(reason);
    } else {
      btn.textContent = action.label;
    }

    if (action.enabled) {
      btn.addEventListener('click', () => {
        if (_onSurfaceAction) _onSurfaceAction(action.id);
      });
    }

    _elSurfacePanel.appendChild(btn);
  }
}

// ---------------------------------------------------------------------------

/** Maximum consecutive errors before showing the abort banner. */
const _MAX_CONSECUTIVE_ERRORS: number = 5;

/**
 * One animation frame: update every HUD panel, then re-schedule.
 */
function _tick(): void {
  if (_hud && _ps) {
    try {
      _updateLeftPanel();
      _updateObjectivesPanel();
      _updateLaunchTip();
      _updateAltTape();
      _updateControlModeIndicator();
      _updateSurfacePanel();
      _consecutiveErrors = 0;
    } catch (err) {
      _consecutiveErrors++;
      logger.error('flightHud', `Tick error (${_consecutiveErrors} consecutive)`, { error: String(err) });
      if (_consecutiveErrors >= _MAX_CONSECUTIVE_ERRORS && !_errorBanner) {
        _showErrorBanner();
      }
    }
  }
  _rafId = requestAnimationFrame(_tick);
}

/**
 * Show an error banner offering the player a way to abort to the hub.
 * Only shown after repeated consecutive errors.
 */
function _showErrorBanner(): void {
  if (!_hud || _errorBanner) return;

  _errorBanner = document.createElement('div');
  _errorBanner.className = 'error-banner';

  const msg = document.createElement('p');
  msg.className = 'error-banner-msg';
  msg.textContent = 'The flight display encountered repeated errors. You can try to continue or abort to the hub.';
  _errorBanner.appendChild(msg);

  const btnRow = document.createElement('div');
  btnRow.className = 'error-banner-buttons';

  const continueBtn = document.createElement('button');
  continueBtn.textContent = 'Try to Continue';
  continueBtn.className = 'error-banner-btn-continue';
  continueBtn.addEventListener('click', () => {
    _consecutiveErrors = 0;
    if (_errorBanner) { _errorBanner.remove(); _errorBanner = null; }
  });

  const abortBtn = document.createElement('button');
  abortBtn.textContent = 'Abort to Hub';
  abortBtn.dataset.testid = 'hud-error-abort-btn';
  abortBtn.className = 'error-banner-btn-abort';
  abortBtn.addEventListener('click', () => {
    if (_errorBanner) { _errorBanner.remove(); _errorBanner = null; }
    if (_onAbort) _onAbort();
  });

  btnRow.appendChild(continueBtn);
  btnRow.appendChild(abortBtn);
  _errorBanner.appendChild(btnRow);
  _hud.appendChild(_errorBanner);
}

// ---------------------------------------------------------------------------
// Private — comms link label
// ---------------------------------------------------------------------------

function _getCommsLinkLabel(linkType: string): string {
  switch (linkType) {
    case 'DIRECT':            return 'Direct Link';
    case 'TRACKING_STATION':  return 'Tracking Station';
    case 'LOCAL_NETWORK':     return 'Comm-Sat Network';
    case 'RELAY':             return 'Relay Chain';
    case 'ONBOARD_RELAY':     return 'Onboard Relay';
    case 'NONE':              return 'No Signal';
    default:                  return 'Unknown';
  }
}

// ---------------------------------------------------------------------------
// Private — landing speed safety indicator
// ---------------------------------------------------------------------------

const _COLOR_SAFE: string    = '#a0ffc0';
const _COLOR_CAUTION: string = '#ffc080';
const _COLOR_DANGER: string  = '#ff6060';
const _COLOR_DEFAULT: string = '#a0d8b0';

/**
 * Determine the landing-safety color for the vertical speed display
 * and whether to show total speed. Mirrors the thresholds in
 * physics.js `_handleGroundContact`.
 */
function _getLandingSpeedInfo(): { color: string; totalSpeed: number | null } {
  const vy = _ps!.velY ?? 0;
  const vx = _ps!.velX ?? 0;

  // Not descending, or already grounded/landed/crashed -> default color
  if (vy >= 0 || _ps!.landed || _ps!.crashed || _ps!.grounded) {
    return { color: _COLOR_DEFAULT, totalSpeed: null };
  }

  const totalSpeed = Math.hypot(vx, vy);
  const legs = countDeployedLegs(_ps!);

  let color: string;
  if (legs >= 2) {
    // With legs: safe < 10, caution 10-29, danger >= 30
    if (totalSpeed < 10)       color = _COLOR_SAFE;
    else if (totalSpeed < 30)  color = _COLOR_CAUTION;
    else                       color = _COLOR_DANGER;
  } else {
    // No/insufficient legs: safe <= 5, danger > 5
    if (totalSpeed <= 5)  color = _COLOR_SAFE;
    else                  color = _COLOR_DANGER;
  }

  // Show total speed in parens when below 500 m and there's horizontal velocity
  const alt = _ps!.posY ?? 0;
  const showTotal = (alt < 500 && Math.abs(vx) > 0.1) ? totalSpeed : null;

  return { color, totalSpeed: showTotal };
}

// ---------------------------------------------------------------------------
// Private — per-section updates
// ---------------------------------------------------------------------------

/**
 * Update all sections of the unified left panel (throttle, staging, fuel).
 */
function _updateLeftPanel(): void {
  // ── Status (altitude + vertical speed) ───────────────────────────────────
  if (_elAlt) {
    const alt = _ps!.posY ?? 0;
    _elAlt.textContent = alt >= 1000
      ? `${(alt / 1000).toFixed(1)} km`
      : `${Math.round(alt)} m`;
  }
  if (_elVelY) {
    const vy = _ps!.velY ?? 0;
    const { color, totalSpeed } = _getLandingSpeedInfo();
    let text = `${vy >= 0 ? '+' : ''}${vy.toFixed(1)} m/s`;
    if (totalSpeed !== null) text += ` (${Math.round(totalSpeed)})`;
    _elVelY.textContent = text;
    _elVelY.style.setProperty('--vel-y-color', color);
  }
  if (_elVelX) {
    const vx = _ps!.velX ?? 0;
    _elVelX.textContent = `${vx >= 0 ? '+' : ''}${vx.toFixed(1)} m/s`;
  }
  if (_elApo) {
    const alt = Math.max(0, _ps!.posY ?? 0);
    const vy  = _ps!.velY ?? 0;
    const apo = _estimateApoapsis(alt, vy);
    if (apo > alt + 10) {
      _elApo.textContent = apo >= 1000
        ? `${(apo / 1000).toFixed(1)} km`
        : `${Math.round(apo)} m`;
    } else {
      _elApo.textContent = '\u2014';
    }
  }
  if (_elBiome) {
    const alt = Math.max(0, _ps!.posY ?? 0);
    const biome = getBiome(alt, 'EARTH');
    _elBiome.textContent = biome ? biome.name : '\u2014';
  }
  if (_elCommsStatus && _flightState) {
    const comms = _flightState.commsState;
    if (comms) {
      const isConnected = comms.status === 'CONNECTED';
      _elCommsStatus.textContent = comms.controlLocked
        ? 'NO SIGNAL'
        : isConnected
          ? _getCommsLinkLabel(comms.linkType)
          : 'No Signal';
      _elCommsStatus.style.setProperty('--comms-color', isConnected ? '#a0ffc0' : '#ff6060');
    }
  }

  // ── Throttle ──────────────────────────────────────────────────────────────
  const pct = Math.round((_ps!.throttle ?? 0) * 100);
  if (_elThrottleFill) _elThrottleFill.style.setProperty('--throttle-pct', `${pct}%`);
  if (_elThrottlePct)  _elThrottlePct.textContent   = `${pct}%`;

  // ── TWR ───────────────────────────────────────────────────────────────────
  const twr = _computeTWR();
  if (_elTWR) {
    _elTWR.textContent = twr > 0 ? twr.toFixed(2) : '\u2014';
    _elTWR.style.setProperty('--twr-color', twr >= 1 ? '#a0ffc0' : twr > 0 ? '#ffc080' : '#a0d8b0');
  }

  // ── TWR bar ──────────────────────────────────────────────────────────────
  if (_elTwrBarFillUp && _elTwrBarFillDn && _elTwrBarValue) {
    if (twr > 1) {
      // TWR 1-3 maps to 0-50% fill height above center
      const fillPct = Math.min(50, ((twr - 1) / 2) * 50);
      _elTwrBarFillUp.style.setProperty('--twr-fill-up', `${fillPct}%`);
      _elTwrBarFillDn.style.setProperty('--twr-fill-dn', '0%');
    } else if (twr > 0) {
      // TWR 0-1 maps to 0-50% fill below center
      const fillPct = Math.min(50, ((1 - twr) / 1) * 50);
      _elTwrBarFillUp.style.setProperty('--twr-fill-up', '0%');
      _elTwrBarFillDn.style.setProperty('--twr-fill-dn', `${fillPct}%`);
    } else {
      _elTwrBarFillUp.style.setProperty('--twr-fill-up', '0%');
      _elTwrBarFillDn.style.setProperty('--twr-fill-dn', '0%');
    }
    _elTwrBarValue.textContent = twr > 0 ? twr.toFixed(1) : '\u2014';
  }

  // ── Target TWR row (TWR mode only) ──────────────────────────────────────
  if (_elTargetTwrRow && _elTargetTwrVal) {
    const isTwrMode = _ps!.throttleMode === 'twr';
    _elTargetTwrRow.style.display = isTwrMode ? '' : 'none';
    if (isTwrMode) {
      _elTargetTwrVal.textContent = _ps!.targetTWR === Infinity
        ? 'MAX'
        : _ps!.targetTWR.toFixed(1);
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

  // ── Crew ──────────────────────────────────────────────────────────────────
  if (_elCrewList) {
    _updateCrewList();
  }
}

/**
 * Rebuild the objectives list.
 * Only reconstructs the inner HTML when the number of objectives has changed
 * or a completion status has changed; otherwise leaves the DOM untouched.
 */
function _updateObjectivesPanel(): void {
  if (!_elObjList || !_state) return;

  // Gather all accepted missions that have objectives.
  // Use `any` for dynamic mission shape — the Mission interface doesn't include runtime `objectives` array.
  const allAccepted = (_state.missions.accepted ?? []) as unknown as Array<Record<string, unknown>>;
  const missions = allAccepted.filter(
    (m) => Array.isArray(m.objectives) && (m.objectives as unknown[]).length > 0,
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
    (m) => {
      const objectives = m.objectives as Array<Record<string, unknown>>;
      return (m.id as string) + ':' + objectives.map((o) => {
        if (o.completed) return '1';
        if (o.type === ObjectiveType.HOLD_ALTITUDE && o._holdEnteredAt != null) {
          return 'H' + Math.floor(now - (o._holdEnteredAt as number));
        }
        return '0';
      }).join('');
    },
  ).join('|');
  if (_elObjList.dataset.fp === fingerprint) return; // Nothing changed — skip.
  _elObjList.dataset.fp = fingerprint;

  _elObjList.innerHTML = '';
  for (const mission of missions) {
    const group = document.createElement('div');
    group.className = 'hud-obj-mission-group';

    const title = document.createElement('div');
    title.className = 'hud-obj-mission-title';
    title.textContent = mission.title as string;
    group.appendChild(title);

    for (const obj of mission.objectives as Array<Record<string, unknown>>) {
      const item = document.createElement('div');
      item.className = 'hud-obj-item';

      const icon = document.createElement('span');
      icon.className = `hud-obj-icon ${obj.completed ? 'met' : 'pending'}`;
      icon.textContent = obj.completed ? '\u2713' : '\u25CB';

      const descWrap = document.createElement('div');

      const desc = document.createElement('span');
      desc.className = `hud-obj-desc${obj.completed ? ' met' : ''}`;
      desc.textContent = (obj.description as string | undefined) ?? (obj.type as string);
      descWrap.appendChild(desc);

      // Show countdown timer for duration-based objectives.
      const objTarget = obj.target as Record<string, unknown> | undefined;
      if (obj.type === ObjectiveType.HOLD_ALTITUDE && !obj.completed && objTarget?.duration) {
        const timer = document.createElement('div');
        timer.className = 'hud-obj-timer';
        timer.dataset.testid = 'hud-obj-hold-timer';

        if (obj._holdEnteredAt != null) {
          const elapsed = Math.max(0, now - (obj._holdEnteredAt as number));
          const remaining = Math.max(0, (objTarget.duration as number) - elapsed);
          timer.textContent = `${Math.ceil(remaining)}s remaining`;
        } else {
          timer.className += ' inactive';
          timer.textContent = `0 / ${objTarget.duration as number}s`;
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
function _updateStagingList(): void {
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
    lbl.textContent = `Stage ${i + 1}${isActive ? ' \u25B6' : ''}`;
    item.appendChild(lbl);

    // Part names for this stage.
    const partNames: string[] = [];
    for (const instanceId of stage.instanceIds) {
      const placed = _assembly!.parts.get(instanceId);
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
    dvEl.textContent = dv > 0 ? `\u0394V ~${Math.round(dv)} m/s` : '';
    item.appendChild(dvEl);

    _elStagingList.appendChild(item);
  }
}

/**
 * Rebuild the fuel list showing active tanks.
 */
function _updateFuelList(): void {
  if (!_elFuelList || !_ps || !_assembly) return;

  const entries: { instanceId: string; fuelKg: number }[] = [];
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
    const placed = _assembly!.parts.get(instanceId);
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
 * Update crew list in the left panel.
 * Shows names and status of crew aboard the flight.
 */
function _updateCrewList(): void {
  if (!_elCrewList || !_flightState || !_state) return;

  const crewIds: string[] = _flightState.crewIds ?? [];
  const crewSection = _elCrewList.parentElement;

  if (crewIds.length === 0) {
    if (crewSection) crewSection.style.display = 'none';
    return;
  }
  if (crewSection) crewSection.style.display = '';

  // Only rebuild if crew changed (stable during flight, so build once).
  const fingerprint = crewIds.join(',');
  if (_elCrewList.dataset.fp === fingerprint) return;
  _elCrewList.dataset.fp = fingerprint;
  _elCrewList.innerHTML = '';

  const ejectedIds: Set<string> = _ps?.ejectedCrewIds ?? new Set<string>();

  for (const crewId of crewIds) {
    const member = _state.crew?.find((c: { id: string }) => c.id === crewId);
    if (!member) continue;

    const row = document.createElement('div');
    row.className = 'flight-crew-row';

    const ejected = ejectedIds.has(crewId);
    const statusDot = document.createElement('span');
    statusDot.className = 'flight-crew-status-dot' + (ejected ? ' ejected' : '');
    statusDot.title = ejected ? 'Ejected' : 'Aboard';
    row.appendChild(statusDot);

    const nameEl = document.createElement('span');
    nameEl.className = 'flight-crew-name';
    nameEl.textContent = member.name;
    row.appendChild(nameEl);

    // Compact skill display.
    const skills = member.skills ?? { piloting: 0, engineering: 0, science: 0 };
    const skillEl = document.createElement('span');
    skillEl.className = 'flight-crew-skills';
    skillEl.textContent = `P${Math.round(skills.piloting)} E${Math.round(skills.engineering)} S${Math.round(skills.science)}`;
    skillEl.title = `Piloting ${Math.round(skills.piloting)}, Engineering ${Math.round(skills.engineering)}, Science ${Math.round(skills.science)}`;
    row.appendChild(skillEl);

    _elCrewList.appendChild(row);
  }
}

/**
 * Update visibility of the launch pad tip.
 * Hide it once the rocket has left the pad or a stage has been fired.
 */
function _updateLaunchTip(): void {
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
 */
function _computeTWR(): number {
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
      const thrustN    = ((def.properties?.thrust as number) ?? 0) * 1_000; // kN -> N
      const thrust     = thrustN * (isSRB ? 1 : (_ps.throttle ?? 0));
      totalThrust     += thrust;
    }
  }

  if (totalMass <= 0) return 0;
  return totalThrust / (totalMass * G0);
}

/**
 * Compute the estimated delta-V for a given stage index using the
 * Tsiolkovsky rocket equation:  dV = Isp x g x ln(m0 / mf)
 */
function _computeStageDeltaV(stageIdx: number): number {
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
    const thrust = (def.properties?.thrust as number) ?? 0;
    if (thrust > 0) {
      const isp = (def.properties?.isp as number) ?? 300;
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
function _setThrottleForTWR1(): void {
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

    const thrustN = ((def.properties?.thrust as number) ?? 0) * 1_000; // kN -> N
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
 */
function _fmtAlt(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

/**
 * Format a signed speed value (+NNN.N or -NNN.N).
 */
function _fmtSigned(ms: number): string {
  const sign = ms >= 0 ? '+' : '';
  return `${sign}${ms.toFixed(1)}`;
}

/**
 * Estimate the apoapsis altitude using the ballistic parabolic equation.
 *
 * Ignores ongoing thrust and atmospheric drag — this is an instantaneous
 * "coasting" estimate suitable for a real-time HUD readout.
 *
 * Formula:  apoapsis = altitude + velY^2 / (2 x g)   (when velY > 0)
 * When descending (velY <= 0) the current altitude IS the apoapsis.
 */
function _estimateApoapsis(altitude: number, velY: number): number {
  if (velY <= 0) return altitude;
  return altitude + (velY * velY) / (2 * G0);
}
