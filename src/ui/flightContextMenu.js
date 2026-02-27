/**
 * flightContextMenu.js — Right-click context menu for rocket parts in flight.
 *
 * Provides a context menu that appears when the player right-clicks a part
 * that belongs to the active rocket (not debris) during flight.  The menu
 * items shown depend on the part type:
 *
 *   ALL activatable parts  → "Activate [Part Name]" / "Already Activated"
 *   FUEL_TANK              → "Fuel: X kg remaining" (read-only)
 *   SERVICE_MODULE         → "Activate Experiment" / "Experiment Status: Complete"
 *   LANDING_LEGS           → "Deploy Legs" (retracted) / "Retract Legs" (deployed)
 *   PARACHUTE              → "Deploy Parachute" / status label
 *   COMMAND_MODULE (crewed)→ "Activate Ejector Seat" / "Ejector Seat: Activated"
 *
 * The menu closes on any click outside it.
 * Parts already activated (one-time only) show "Already Activated" greyed out.
 *
 * Entry points:
 *   initFlightContextMenu(getPs, getAssembly, getFlightState)
 *   destroyFlightContextMenu()
 *
 * @module ui/flightContextMenu
 */

import { hitTestFlightPart }                                  from '../render/flight.js';
import { PartType }                                           from '../core/constants.js';
import { getPartById }                                        from '../data/parts.js';
import { deployParachute, getParachuteStatus, ParachuteState } from '../core/parachute.js';
import { deployLandingLeg, getLegStatus, LegState, retractLandingLeg } from '../core/legs.js';
import { activateEjectorSeat, getEjectorSeatStatus, EjectorState } from '../core/ejector.js';
import { activatePartDirect }                                 from '../core/staging.js';
import {
  getScienceModuleStatus,
  getScienceModuleTimer,
  ScienceModuleState,
}                                                             from '../core/sciencemodule.js';

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const CTX_MENU_CSS = `
/* ── Flight part context menu ──────────────────────────────────────────── */
#flight-part-ctx-menu {
  position: fixed;
  background: rgba(10, 14, 24, 0.96);
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  padding: 4px 0;
  min-width: 210px;
  max-width: 280px;
  z-index: 350;
  font-family: 'Segoe UI', system-ui, sans-serif;
}

#flight-part-ctx-menu[hidden] {
  display: none;
}

.fctx-header {
  color: #5888a8;
  font-size: 11px;
  padding: 7px 14px 4px;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  font-weight: 600;
}

.fctx-divider {
  height: 1px;
  background: rgba(255, 255, 255, 0.1);
  margin: 3px 0;
}

.fctx-item {
  display: block;
  width: 100%;
  padding: 9px 14px;
  text-align: left;
  background: none;
  border: none;
  color: #d8e0f0;
  font-size: 13px;
  cursor: pointer;
  transition: background 0.1s;
  box-sizing: border-box;
}

.fctx-item:hover {
  background: rgba(255, 255, 255, 0.08);
}

.fctx-item-disabled {
  color: #4a6070 !important;
  cursor: default !important;
}

.fctx-item-disabled:hover {
  background: none !important;
}

.fctx-readonly {
  color: #7898b0;
  font-size: 13px;
  padding: 8px 14px;
}
`;

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The context menu DOM element. @type {HTMLElement|null} */
let _menu = null;

/** contextmenu event handler reference. @type {((e: MouseEvent) => void)|null} */
let _contextMenuHandler = null;

/** document click handler for closing the menu. @type {((e: MouseEvent) => void)|null} */
let _outsideClickHandler = null;

/** Getter for the current physics state. @type {(() => import('../core/physics.js').PhysicsState|null)|null} */
let _getPs = null;

/** Getter for the rocket assembly. @type {(() => import('../core/rocketbuilder.js').RocketAssembly|null)|null} */
let _getAssembly = null;

/** Getter for the flight state. @type {(() => import('../core/gameState.js').FlightState|null)|null} */
let _getFlightState = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the flight part context menu.
 *
 * Injects the required CSS, creates the menu DOM element, and registers
 * event listeners for right-click and outside-click handling.
 *
 * @param {() => import('../core/physics.js').PhysicsState|null}           getPs
 * @param {() => import('../core/rocketbuilder.js').RocketAssembly|null}   getAssembly
 * @param {() => import('../core/gameState.js').FlightState|null}          getFlightState
 */
export function initFlightContextMenu(getPs, getAssembly, getFlightState) {
  _getPs          = getPs;
  _getAssembly    = getAssembly;
  _getFlightState = getFlightState;

  // Inject CSS once per page load.
  if (!document.getElementById('flight-ctx-css')) {
    const style = document.createElement('style');
    style.id = 'flight-ctx-css';
    style.textContent = CTX_MENU_CSS;
    document.head.appendChild(style);
  }

  // Create the menu DOM element.
  _menu = document.createElement('div');
  _menu.id = 'flight-part-ctx-menu';
  _menu.setAttribute('hidden', '');
  document.body.appendChild(_menu);

  // Right-click → show menu.
  _contextMenuHandler = _onContextMenu;
  window.addEventListener('contextmenu', _contextMenuHandler);

  // Click anywhere outside → close menu.
  _outsideClickHandler = _onOutsideClick;
  document.addEventListener('click', _outsideClickHandler, true);

  console.log('[Flight Context Menu] Initialized');
}

/**
 * Tear down the flight part context menu.
 *
 * Removes the menu DOM element and all event listeners.
 */
export function destroyFlightContextMenu() {
  if (_contextMenuHandler) {
    window.removeEventListener('contextmenu', _contextMenuHandler);
    _contextMenuHandler = null;
  }
  if (_outsideClickHandler) {
    document.removeEventListener('click', _outsideClickHandler, true);
    _outsideClickHandler = null;
  }
  if (_menu) {
    _menu.remove();
    _menu = null;
  }

  _getPs          = null;
  _getAssembly    = null;
  _getFlightState = null;

  console.log('[Flight Context Menu] Destroyed');
}

// ---------------------------------------------------------------------------
// Private — event handlers
// ---------------------------------------------------------------------------

/** @param {MouseEvent} e */
function _onOutsideClick(e) {
  if (_menu && !_menu.hasAttribute('hidden') && !_menu.contains(/** @type {Node} */ (e.target))) {
    _hideMenu();
  }
}

/** @param {MouseEvent} e */
function _onContextMenu(e) {
  const ps          = _getPs?.();
  const assembly    = _getAssembly?.();
  const flightState = _getFlightState?.();
  if (!ps || !assembly || !flightState) return;

  // Hit-test against the active rocket's parts only.
  const instanceId = hitTestFlightPart(e.clientX, e.clientY, ps, assembly);
  if (!instanceId) {
    _hideMenu();
    return;
  }

  // Suppress the browser's native context menu only when a part was hit.
  e.preventDefault();

  const placed = assembly.parts.get(instanceId);
  const def    = placed ? getPartById(placed.partId) : null;
  if (!def) { _hideMenu(); return; }

  _showMenu(instanceId, def, ps, assembly, flightState, e.clientX, e.clientY);
}

// ---------------------------------------------------------------------------
// Private — menu display
// ---------------------------------------------------------------------------

/**
 * @param {string}   instanceId
 * @param {object}   def           Part definition.
 * @param {object}   ps            PhysicsState.
 * @param {object}   assembly      RocketAssembly.
 * @param {object}   flightState   FlightState.
 * @param {number}   clientX
 * @param {number}   clientY
 */
function _showMenu(instanceId, def, ps, assembly, flightState, clientX, clientY) {
  if (!_menu) return;

  _menu.innerHTML = '';

  // ── Part-name header ─────────────────────────────────────────────────────
  const header = document.createElement('div');
  header.className = 'fctx-header';
  header.textContent = def.name;
  _menu.appendChild(header);

  const divider = document.createElement('div');
  divider.className = 'fctx-divider';
  _menu.appendChild(divider);

  let hasItems = false;

  // ── FUEL TANK: read-only fuel display ────────────────────────────────────
  if (def.type === PartType.FUEL_TANK || def.type === PartType.SOLID_ROCKET_BOOSTER) {
    const fuelRemaining = ps.fuelStore?.get(instanceId) ?? 0;
    _menu.appendChild(_makeReadOnly(`Fuel: ${fuelRemaining.toFixed(1)} kg remaining`));
    hasItems = true;
  }

  // ── SERVICE MODULE: experiment state machine ─────────────────────────────
  if (def.type === PartType.SERVICE_MODULE) {
    const sciState = getScienceModuleStatus(ps, instanceId);

    switch (sciState) {
      case ScienceModuleState.IDLE:
        _menu.appendChild(_makeButton('Activate Experiment', () => {
          const debris = activatePartDirect(ps, assembly, flightState, instanceId);
          for (const frag of debris) {
            ps.debris.push(frag);
          }
          _hideMenu();
        }));
        break;

      case ScienceModuleState.RUNNING: {
        const remaining = getScienceModuleTimer(ps, instanceId);
        _menu.appendChild(_makeReadOnly(
          `Experiment Running — ${remaining.toFixed(1)} s remaining`,
        ));
        break;
      }

      case ScienceModuleState.COMPLETE:
        _menu.appendChild(_makeReadOnly('Experiment Complete — data aboard'));
        break;

      case ScienceModuleState.DATA_RETURNED:
        _menu.appendChild(_makeReadOnly('Data Returned — mission success!'));
        break;

      default:
        _menu.appendChild(_makeReadOnly(`Experiment: ${sciState}`));
        break;
    }
    hasItems = true;
  }

  // ── LANDING LEGS: deploy / retract ───────────────────────────────────────
  if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
    const legStatus = getLegStatus(ps, instanceId);
    if (legStatus === LegState.RETRACTED) {
      _menu.appendChild(_makeButton('Deploy Legs', () => {
        deployLandingLeg(ps, instanceId);
        _hideMenu();
      }));
    } else if (legStatus === LegState.DEPLOYED) {
      _menu.appendChild(_makeButton('Retract Legs', () => {
        retractLandingLeg(ps, instanceId);
        _hideMenu();
      }));
    } else {
      // DEPLOYING state — show status only.
      _menu.appendChild(_makeReadOnly('Legs: Deploying…'));
    }
    hasItems = true;
  }

  // ── PARACHUTE: deploy ────────────────────────────────────────────────────
  if (def.type === PartType.PARACHUTE) {
    const chuteStatus = getParachuteStatus(ps, instanceId);
    if (chuteStatus === ParachuteState.PACKED) {
      _menu.appendChild(_makeButton('Deploy Parachute', () => {
        deployParachute(ps, instanceId);
        _hideMenu();
      }));
    } else {
      const labels = {
        [ParachuteState.DEPLOYING]: 'Parachute: Deploying…',
        [ParachuteState.DEPLOYED]:  'Parachute: Deployed',
        [ParachuteState.FAILED]:    'Parachute: Failed',
      };
      _menu.appendChild(_makeReadOnly(labels[chuteStatus] ?? `Parachute: ${chuteStatus}`));
    }
    hasItems = true;
  }

  // ── COMMAND MODULE (crewed): ejector seat ────────────────────────────────
  if (def.type === PartType.COMMAND_MODULE && def.properties?.hasEjectorSeat) {
    const ejectStatus = getEjectorSeatStatus(ps, instanceId);
    if (ejectStatus === EjectorState.ARMED) {
      _menu.appendChild(_makeButton('Activate Ejector Seat', () => {
        activateEjectorSeat(ps, assembly, flightState, instanceId);
        _hideMenu();
      }));
    } else {
      _menu.appendChild(_makeReadOnly('Ejector Seat: Activated'));
    }
    hasItems = true;
  }

  // ── General activatable parts (not handled by a specific type above) ──────
  // Covers: ENGINE, SRB (ignition), DECOUPLER (separation), SATELLITE (release),
  // and any other activatable part not already represented above.
  const SPECIFIC_TYPES = [
    PartType.FUEL_TANK,
    PartType.SOLID_ROCKET_BOOSTER,
    PartType.SERVICE_MODULE,
    PartType.LANDING_LEGS,
    PartType.LANDING_LEG,
    PartType.PARACHUTE,
    PartType.COMMAND_MODULE,
  ];

  if (def.activatable && !SPECIFIC_TYPES.includes(def.type)) {
    const alreadyActivated = _isPartAlreadyActivated(instanceId, def, ps, flightState);
    if (alreadyActivated) {
      const btn = _makeButton('Already Activated', null);
      btn.classList.add('fctx-item-disabled');
      btn.disabled = true;
      _menu.appendChild(btn);
    } else {
      _menu.appendChild(_makeButton(`Activate ${def.name}`, () => {
        const debris = activatePartDirect(ps, assembly, flightState, instanceId);
        for (const frag of debris) {
          ps.debris.push(frag);
        }
        _hideMenu();
      }));
    }
    hasItems = true;
  }

  if (!hasItems) {
    _hideMenu();
    return;
  }

  // ── Position the menu, keeping it within the viewport ───────────────────
  // Temporarily show to read actual size, then re-hide before repositioning.
  _menu.removeAttribute('hidden');
  const menuW = _menu.offsetWidth  || 210;
  const menuH = _menu.offsetHeight || 180;
  _menu.setAttribute('hidden', '');

  let left = clientX + 2;
  let top  = clientY + 2;
  if (left + menuW > window.innerWidth)  left = window.innerWidth  - menuW - 4;
  if (top  + menuH > window.innerHeight) top  = window.innerHeight - menuH - 4;
  if (left < 0) left = 0;
  if (top  < 0) top  = 0;

  _menu.style.left = `${left}px`;
  _menu.style.top  = `${top}px`;
  _menu.removeAttribute('hidden');
}

/**
 * Hide the context menu.
 */
function _hideMenu() {
  if (_menu) _menu.setAttribute('hidden', '');
}

// ---------------------------------------------------------------------------
// Private — item factories
// ---------------------------------------------------------------------------

/**
 * Create a clickable button menu item.
 *
 * @param {string}        label
 * @param {(() => void)|null} onClick  null = disabled / no-op.
 * @returns {HTMLButtonElement}
 */
function _makeButton(label, onClick) {
  const btn = document.createElement('button');
  btn.className   = 'fctx-item';
  btn.textContent = label;
  if (onClick) {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    }, { once: true });
  }
  return btn;
}

/**
 * Create a read-only (non-interactive) info row.
 *
 * @param {string} text
 * @returns {HTMLDivElement}
 */
function _makeReadOnly(text) {
  const div = document.createElement('div');
  div.className   = 'fctx-readonly';
  div.textContent = text;
  return div;
}

// ---------------------------------------------------------------------------
// Private — activation state helpers
// ---------------------------------------------------------------------------

/**
 * Return true if a generic activatable part has already been activated and
 * should be shown as "Already Activated".
 *
 * Rules:
 *   - ENGINE / SRB already in ps.firingEngines → currently firing (not re-activatable).
 *   - One-time parts activated via `activatePartDirect` will have a PART_ACTIVATED
 *     event with their instanceId recorded in flightState.events.
 *
 * @param {string} instanceId
 * @param {object} def         Part definition.
 * @param {object} ps          PhysicsState.
 * @param {object} flightState FlightState.
 * @returns {boolean}
 */
function _isPartAlreadyActivated(instanceId, def, ps, flightState) {
  // Engines / SRBs that are currently firing.
  if (
    def.type === PartType.ENGINE ||
    def.type === PartType.SOLID_ROCKET_BOOSTER
  ) {
    return ps.firingEngines?.has(instanceId) ?? false;
  }

  // Other one-time activatable parts — check the events log.
  if (!flightState?.events) return false;
  return flightState.events.some(
    (e) => e.type === 'PART_ACTIVATED' && e.instanceId === instanceId,
  );
}
