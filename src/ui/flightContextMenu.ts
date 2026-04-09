/**
 * flightContextMenu.ts — Right-click context menu for rocket parts in flight.
 *
 * Provides a context menu that appears when the player right-clicks a part
 * that belongs to the active rocket (not debris) during flight.  The menu
 * items shown depend on the part type:
 *
 *   ALL activatable parts  -> "Activate [Part Name]" / "Already Activated"
 *   FUEL_TANK              -> "Fuel: X kg remaining" (read-only)
 *   SERVICE_MODULE         -> "Activate Experiment" / "Experiment Status: Complete"
 *   LANDING_LEGS           -> "Deploy Legs" (retracted) / "Retract Legs" (deployed)
 *   PARACHUTE              -> "Deploy Parachute" / status label
 *   COMMAND_MODULE (crewed)-> "Activate Ejector Seat" / "Ejector Seat: Activated"
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

import { hitTestFlightPart }                                  from '../render/flight.ts';
import { PartType }                                           from '../core/constants.ts';
import { getPartById }                                        from '../data/parts.ts';
import type { PartDef }                                       from '../data/parts.ts';
import { deployParachute, getParachuteStatus, ParachuteState } from '../core/parachute.ts';
import { deployLandingLeg, getLegStatus, LegState, retractLandingLeg } from '../core/legs.ts';
import { getMirrorPartId } from '../core/rocketbuilder.ts';
import { activateEjectorSeat, getEjectorSeatStatus, EjectorState } from '../core/ejector.ts';
import { activatePartDirect }                                 from '../core/staging.ts';
import {
  getScienceModuleStatus,
  getScienceModuleTimer,
  ScienceModuleState,
  getModuleInstrumentKeys,
  getInstrumentStatus,
  getInstrumentTimer,
  activateInstrument,
  transmitInstrument,
}                                                             from '../core/sciencemodule.ts';
import { getInstrumentById }                                  from '../data/instruments.ts';
import { ScienceDataType }                                    from '../core/constants.ts';
import {
  hasMalfunction,
  getMalfunction,
  attemptRecovery,
  MALFUNCTION_RECOVERY_TIPS,
  MALFUNCTION_LABELS,
}                                                             from '../core/malfunction.ts';
import { MalfunctionType }                                    from '../core/constants.ts';
import './flightContextMenu.css';
import type { PhysicsState }                                  from '../core/physics.ts';
import type { RocketAssembly }                                from '../core/rocketbuilder.ts';
import type { FlightState, FlightEvent }                        from '../core/gameState.ts';
import { getFCState }                                          from './flightController/_state.ts';
import { resyncWorkerState }                                   from './flightController/_workerBridge.ts';


// ---------------------------------------------------------------------------
// Worker resync helper
// ---------------------------------------------------------------------------

/**
 * Push the current main-thread physics/flight state to the worker after a
 * context menu action (deploy parachute, deploy legs, eject, etc.).  Without
 * this the next worker snapshot would overwrite the action.
 */
function _resyncAfterAction(ps: PhysicsState, assembly: RocketAssembly, flightState: FlightState): void {
  const s = getFCState();
  if (s.stagingConfig) {
    resyncWorkerState(ps, assembly, s.stagingConfig, flightState).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

/** The context menu DOM element. */
let _menu: HTMLDivElement | null = null;

/** contextmenu event handler reference. */
let _contextMenuHandler: ((e: MouseEvent) => void) | null = null;

/** document click handler for closing the menu. */
let _outsideClickHandler: ((e: MouseEvent) => void) | null = null;

/** Getter for the current physics state. */
let _getPs: (() => PhysicsState | null) | null = null;

/** Getter for the rocket assembly. */
let _getAssembly: (() => RocketAssembly | null) | null = null;

/** Getter for the flight state. */
let _getFlightState: (() => FlightState | null) | null = null;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Initialise the flight part context menu.
 *
 * Injects the required CSS, creates the menu DOM element, and registers
 * event listeners for right-click and outside-click handling.
 */
export function initFlightContextMenu(
  getPs: () => PhysicsState | null,
  getAssembly: () => RocketAssembly | null,
  getFlightState: () => FlightState | null,
): void {
  _getPs          = getPs;
  _getAssembly    = getAssembly;
  _getFlightState = getFlightState;

  // Create the menu DOM element.
  _menu = document.createElement('div');
  _menu.id = 'flight-part-ctx-menu';
  _menu.setAttribute('hidden', '');
  document.body.appendChild(_menu);

  // Right-click -> show menu.
  _contextMenuHandler = _onContextMenu;
  window.addEventListener('contextmenu', _contextMenuHandler as EventListener);

  // Click anywhere outside -> close menu.
  _outsideClickHandler = _onOutsideClick;
  document.addEventListener('click', _outsideClickHandler as EventListener, true);


}

/**
 * Tear down the flight part context menu.
 *
 * Removes the menu DOM element and all event listeners.
 */
export function destroyFlightContextMenu(): void {
  if (_contextMenuHandler) {
    window.removeEventListener('contextmenu', _contextMenuHandler as EventListener);
    _contextMenuHandler = null;
  }
  if (_outsideClickHandler) {
    document.removeEventListener('click', _outsideClickHandler as EventListener, true);
    _outsideClickHandler = null;
  }
  if (_menu) {
    _menu.remove();
    _menu = null;
  }

  _getPs          = null;
  _getAssembly    = null;
  _getFlightState = null;


}

// ---------------------------------------------------------------------------
// Private — event handlers
// ---------------------------------------------------------------------------

function _onOutsideClick(e: MouseEvent): void {
  if (_menu && !_menu.hasAttribute('hidden') && !_menu.contains(e.target as Node)) {
    _hideMenu();
  }
}

function _onContextMenu(e: MouseEvent): void {
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

function _showMenu(
  instanceId: string,
  def: PartDef,
  ps: PhysicsState,
  assembly: RocketAssembly,
  flightState: FlightState,
  clientX: number,
  clientY: number,
): void {
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

  // ── MALFUNCTION STATUS & RECOVERY ────────────────────────────────────────
  if (hasMalfunction(ps, instanceId)) {
    const malf = getMalfunction(ps, instanceId)!;
    const label = MALFUNCTION_LABELS[malf.type] ?? malf.type;
    const tip = MALFUNCTION_RECOVERY_TIPS[malf.type] ?? '';

    // Show malfunction status.
    const statusDiv = _makeReadOnly(`\u26A0 ${label}`);
    statusDiv.style.color = '#ff6644';
    statusDiv.style.fontWeight = '700';
    _menu.appendChild(statusDiv);

    if (tip) {
      const tipDiv = _makeReadOnly(tip);
      tipDiv.style.color = '#aa8855';
      tipDiv.style.fontSize = '11px';
      _menu.appendChild(tipDiv);
    }

    // Recovery actions based on type.
    const recoverable: string[] = [
      MalfunctionType.ENGINE_FLAMEOUT,
      MalfunctionType.FUEL_TANK_LEAK,
      MalfunctionType.DECOUPLER_STUCK,
      MalfunctionType.SCIENCE_INSTRUMENT_FAILURE,
      MalfunctionType.LANDING_LEGS_STUCK,
    ];

    if (recoverable.includes(malf.type)) {
      const actionLabels: Record<string, string> = {
        [MalfunctionType.ENGINE_FLAMEOUT]:           'Attempt Reignition',
        [MalfunctionType.FUEL_TANK_LEAK]:            'Attempt Seal Leak',
        [MalfunctionType.DECOUPLER_STUCK]:           'Manual Decouple',
        [MalfunctionType.SCIENCE_INSTRUMENT_FAILURE]:'Reboot Instruments',
        [MalfunctionType.LANDING_LEGS_STUCK]:        'Force Deploy Legs',
      };

      _menu.appendChild(_makeButton(actionLabels[malf.type] ?? 'Attempt Recovery', () => {
        const result = attemptRecovery(ps, instanceId, ps._gameState);
        // If decoupler recovery succeeded, actually fire the separation.
        if (result.success && malf.type === MalfunctionType.DECOUPLER_STUCK) {
          const currentAssembly = _getAssembly?.();
          const currentFlightState = _getFlightState?.();
          if (currentAssembly && currentFlightState) {
            const debris = activatePartDirect(ps, currentAssembly, currentFlightState, instanceId);
            for (const frag of debris) {
              ps.debris.push(frag);
            }
          }
        }
        // If landing legs recovery succeeded, deploy them.
        if (result.success && malf.type === MalfunctionType.LANDING_LEGS_STUCK) {
          deployLandingLeg(ps, instanceId);
        }
        _resyncAfterAction(ps, assembly, flightState);
        _hideMenu();
      }));
    } else {
      // Non-recoverable — show info only.
      const noFixDiv = _makeReadOnly('No recovery available');
      noFixDiv.style.color = '#665544';
      _menu.appendChild(noFixDiv);
    }

    const malfDivider = document.createElement('div');
    malfDivider.className = 'fctx-divider';
    _menu.appendChild(malfDivider);

    hasItems = true;
  }

  // ── FUEL TANK: read-only fuel display ────────────────────────────────────
  if (def.type === PartType.FUEL_TANK || def.type === PartType.SOLID_ROCKET_BOOSTER) {
    const fuelRemaining = ps.fuelStore?.get(instanceId) ?? 0;
    _menu.appendChild(_makeReadOnly(`Fuel: ${fuelRemaining.toFixed(1)} kg remaining`));
    hasItems = true;
  }

  // ── SERVICE MODULE: per-instrument experiment state ───────────────────────
  if (def.type === PartType.SERVICE_MODULE) {
    const instrumentKeys = getModuleInstrumentKeys(ps, instanceId);

    if (instrumentKeys.length > 0) {
      // Show each loaded instrument with its current state.
      for (const key of instrumentKeys) {
        const entry = ps.instrumentStates?.get(key);
        if (!entry) continue;

        const instrDef = getInstrumentById(entry.instrumentId);
        const instrName = instrDef?.name ?? entry.instrumentId;
        const instrState = getInstrumentStatus(ps, key);
        const dataLabel = entry.dataType === ScienceDataType.SAMPLE ? '[Sample]' : '[Analysis]';

        // Check for instrument failure malfunction on this module.
        const sciMalf = getMalfunction(ps, instanceId);
        const instrFailed = sciMalf && !sciMalf.recovered &&
          sciMalf.type === MalfunctionType.SCIENCE_INSTRUMENT_FAILURE;

        switch (instrState) {
          case ScienceModuleState.IDLE:
            if (instrFailed) {
              const failBtn = _makeButton(`${instrName}: Instruments Failed`, null);
              failBtn.classList.add('fctx-item-disabled');
              failBtn.disabled = true;
              _menu.appendChild(failBtn);
            } else {
              _menu.appendChild(_makeButton(`Activate ${instrName} ${dataLabel}`, () => {
                activateInstrument(ps, assembly, flightState, key);
                _resyncAfterAction(ps, assembly, flightState);
                _hideMenu();
              }));
            }
            break;

          case ScienceModuleState.RUNNING: {
            const remaining = getInstrumentTimer(ps, key);
            _menu.appendChild(_makeReadOnly(
              `${instrName}: Running — ${remaining.toFixed(1)} s`,
            ));
            break;
          }

          case ScienceModuleState.COMPLETE:
            if (entry.dataType === ScienceDataType.ANALYSIS) {
              _menu.appendChild(_makeReadOnly(`${instrName}: Complete ${dataLabel}`));
              _menu.appendChild(_makeButton(`Transmit ${instrName} (40-60% yield)`, () => {
                transmitInstrument(ps, assembly, flightState, key, null);
                _resyncAfterAction(ps, assembly, flightState);
                _hideMenu();
              }));
            } else {
              _menu.appendChild(_makeReadOnly(`${instrName}: Sample collected — return to ground`));
            }
            break;

          case ScienceModuleState.DATA_RETURNED:
            _menu.appendChild(_makeReadOnly(`${instrName}: Data Returned \u2713`));
            break;

          case ScienceModuleState.TRANSMITTED:
            _menu.appendChild(_makeReadOnly(`${instrName}: Transmitted \u2713`));
            break;

          default:
            _menu.appendChild(_makeReadOnly(`${instrName}: ${instrState}`));
            break;
        }
      }
    } else {
      // Legacy: module with no instruments loaded.
      const sciState = getScienceModuleStatus(ps, instanceId);

      switch (sciState) {
        case ScienceModuleState.IDLE:
          _menu.appendChild(_makeButton('Activate Experiment', () => {
            const debris = activatePartDirect(ps, assembly, flightState, instanceId);
            for (const frag of debris) {
              ps.debris.push(frag);
            }
            _resyncAfterAction(ps, assembly, flightState);
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
    }
    hasItems = true;
  }

  // ── LANDING LEGS: deploy / retract ───────────────────────────────────────
  if (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG) {
    const legStatus = getLegStatus(ps, instanceId);
    const mirrorId = getMirrorPartId(assembly, instanceId);
    const mirrorStatus = mirrorId ? getLegStatus(ps, mirrorId) : null;
    const hasMirror = mirrorId && mirrorStatus != null;

    // Block normal deployment if legs are stuck (recovery handles it above).
    const legMalf = getMalfunction(ps, instanceId);
    const legsStuck = legMalf && !legMalf.recovered &&
      legMalf.type === MalfunctionType.LANDING_LEGS_STUCK;

    const _emitLegActivated = (id: string): void => {
      if (flightState?.events) {
        flightState.events.push({
          type: 'PART_ACTIVATED',
          time: flightState.timeElapsed,
          instanceId: id,
          partType: def.type,
          description: `${def.name} manually deployed.`,
        } as FlightEvent & { instanceId: string; partType: string });
      }
    };

    if (legsStuck && legStatus === LegState.RETRACTED) {
      // Shown as stuck — recovery button is in the malfunction section above.
      _menu.appendChild(_makeReadOnly('Legs: Stuck (see recovery above)'));
    } else if (legStatus === LegState.RETRACTED) {
      if (hasMirror && mirrorStatus === LegState.RETRACTED) {
        _menu.appendChild(_makeButton('Deploy Both Legs', () => {
          deployLandingLeg(ps, instanceId);
          deployLandingLeg(ps, mirrorId!);
          _emitLegActivated(instanceId);
          _emitLegActivated(mirrorId!);
          _resyncAfterAction(ps, assembly, flightState);
          _hideMenu();
        }));
        _menu.appendChild(_makeButton('Deploy This Leg Only', () => {
          deployLandingLeg(ps, instanceId);
          _emitLegActivated(instanceId);
          _resyncAfterAction(ps, assembly, flightState);
          _hideMenu();
        }));
      } else {
        _menu.appendChild(_makeButton('Deploy Legs', () => {
          deployLandingLeg(ps, instanceId);
          _emitLegActivated(instanceId);
          _resyncAfterAction(ps, assembly, flightState);
          _hideMenu();
        }));
      }
    } else if (legStatus === LegState.DEPLOYED) {
      if (hasMirror && mirrorStatus === LegState.DEPLOYED) {
        _menu.appendChild(_makeButton('Retract Both Legs', () => {
          retractLandingLeg(ps, instanceId);
          retractLandingLeg(ps, mirrorId!);
          _resyncAfterAction(ps, assembly, flightState);
          _hideMenu();
        }));
        _menu.appendChild(_makeButton('Retract This Leg Only', () => {
          retractLandingLeg(ps, instanceId);
          _resyncAfterAction(ps, assembly, flightState);
          _hideMenu();
        }));
      } else {
        _menu.appendChild(_makeButton('Retract Legs', () => {
          retractLandingLeg(ps, instanceId);
          _resyncAfterAction(ps, assembly, flightState);
          _hideMenu();
        }));
      }
    } else {
      // DEPLOYING state — show status only.
      _menu.appendChild(_makeReadOnly('Legs: Deploying\u2026'));
    }
    hasItems = true;
  }

  // ── PARACHUTE: deploy ────────────────────────────────────────────────────
  if (def.type === PartType.PARACHUTE) {
    const chuteStatus = getParachuteStatus(ps, instanceId);
    if (chuteStatus === ParachuteState.PACKED) {
      _menu.appendChild(_makeButton('Deploy Parachute', () => {
        deployParachute(ps, instanceId);
        _resyncAfterAction(ps, assembly, flightState);
        _hideMenu();
      }));
    } else {
      const labels: Record<string, string> = {
        [ParachuteState.DEPLOYING]: 'Parachute: Deploying\u2026',
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
        (activateEjectorSeat as Function)(ps, assembly, flightState, instanceId);
        _resyncAfterAction(ps, assembly, flightState);
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
  const SPECIFIC_TYPES: string[] = [
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
        _resyncAfterAction(ps, assembly, flightState);
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
function _hideMenu(): void {
  if (_menu) _menu.setAttribute('hidden', '');
}

// ---------------------------------------------------------------------------
// Private — item factories
// ---------------------------------------------------------------------------

/**
 * Create a clickable button menu item.
 *
 * @param label
 * @param onClick  null = disabled / no-op.
 */
function _makeButton(label: string, onClick: (() => void) | null): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.className   = 'fctx-item';
  btn.textContent = label;
  if (onClick) {
    btn.addEventListener('click', (e: MouseEvent) => {
      e.stopPropagation();
      onClick();
    }, { once: true });
  }
  return btn;
}

/**
 * Create a read-only (non-interactive) info row.
 */
function _makeReadOnly(text: string): HTMLDivElement {
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
 *   - ENGINE / SRB already in ps.firingEngines -> currently firing (not re-activatable).
 *   - One-time parts activated via `activatePartDirect` will have a PART_ACTIVATED
 *     event with their instanceId recorded in flightState.events.
 */
function _isPartAlreadyActivated(instanceId: string, def: PartDef, ps: PhysicsState, flightState: FlightState): boolean {
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
    (e) => e.type === 'PART_ACTIVATED' && (e as FlightEvent & { instanceId?: string }).instanceId === instanceId,
  );
}
