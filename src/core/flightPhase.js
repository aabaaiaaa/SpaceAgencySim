/**
 * flightPhase.js — Flight phase state machine.
 *
 * Manages the current phase of a flight and enforces valid transitions
 * between phases.  Each transition can carry a reason string and optional
 * metadata, and the module maintains a log of all transitions for the
 * flight event record.
 *
 * PHASE GRAPH
 *   PRELAUNCH → LAUNCH          (engine ignition)
 *   LAUNCH    → FLIGHT          (cleared the pad)
 *   FLIGHT    → ORBIT           (stable orbit achieved)
 *   FLIGHT    → (landed/crash)  (terminal — no phase change, physics handles it)
 *   ORBIT     → MANOEUVRE       (burn started)
 *   MANOEUVRE → ORBIT           (burn completed)
 *   ORBIT     → REENTRY        (de-orbit initiated)
 *   REENTRY   → FLIGHT         (atmospheric flight / landing approach)
 *   ORBIT     → TRANSFER       (interplanetary injection)
 *   TRANSFER  → CAPTURE        (SOI arrival)
 *   CAPTURE   → ORBIT          (stable orbit at destination)
 *
 * Docking mode is a control mode within ORBIT (TASK-005), not a phase.
 *
 * @module core/flightPhase
 */

import { FlightPhase } from './constants.js';

// ---------------------------------------------------------------------------
// Valid transition map
// ---------------------------------------------------------------------------

/**
 * Set of valid (from → to) transitions.
 * Any transition not listed here will be rejected.
 * @type {ReadonlyMap<string, ReadonlySet<string>>}
 */
const VALID_TRANSITIONS = new Map([
  [FlightPhase.PRELAUNCH, new Set([FlightPhase.LAUNCH])],
  [FlightPhase.LAUNCH,    new Set([FlightPhase.FLIGHT])],
  [FlightPhase.FLIGHT,    new Set([FlightPhase.ORBIT])],
  [FlightPhase.ORBIT,     new Set([FlightPhase.MANOEUVRE, FlightPhase.REENTRY, FlightPhase.TRANSFER])],
  [FlightPhase.MANOEUVRE,  new Set([FlightPhase.ORBIT])],
  [FlightPhase.REENTRY,   new Set([FlightPhase.FLIGHT])],
  [FlightPhase.TRANSFER,  new Set([FlightPhase.CAPTURE])],
  [FlightPhase.CAPTURE,   new Set([FlightPhase.ORBIT])],
]);

// ---------------------------------------------------------------------------
// Transition log entry
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PhaseTransition
 * @property {string} from       - Previous phase.
 * @property {string} to         - New phase.
 * @property {number} time       - Flight elapsed time (seconds) when the transition occurred.
 * @property {string} reason     - Human-readable reason for the transition.
 */

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Returns true if the given transition is allowed by the state machine.
 *
 * @param {string} from  Current phase (FlightPhase value).
 * @param {string} to    Desired phase (FlightPhase value).
 * @returns {boolean}
 */
export function isValidTransition(from, to) {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed ? allowed.has(to) : false;
}

/**
 * Attempt a phase transition on the flight state.
 *
 * If the transition is valid, updates `flightState.phase`, appends a
 * PhaseTransition to `flightState.phaseLog`, and pushes a flight event.
 *
 * @param {import('./gameState.js').FlightState} flightState
 * @param {string} newPhase     Target FlightPhase value.
 * @param {string} [reason='']  Human-readable reason for the transition.
 * @returns {{ success: boolean, from: string, to: string, reason?: string }}
 */
export function transitionPhase(flightState, newPhase, reason = '') {
  const from = flightState.phase;

  if (from === newPhase) {
    return { success: false, from, to: newPhase, reason: 'Already in this phase' };
  }

  if (!isValidTransition(from, newPhase)) {
    return {
      success: false,
      from,
      to: newPhase,
      reason: `Invalid transition: ${from} → ${newPhase}`,
    };
  }

  // Apply the transition.
  flightState.phase = newPhase;

  /** @type {PhaseTransition} */
  const entry = {
    from,
    to: newPhase,
    time: flightState.timeElapsed,
    reason: reason || `${from} → ${newPhase}`,
  };
  flightState.phaseLog.push(entry);

  // Also append to the flight event log for the HUD timeline.
  flightState.events.push({
    time: flightState.timeElapsed,
    type: 'PHASE_CHANGE',
    description: reason || `Phase: ${_phaseLabel(newPhase)}`,
  });

  return { success: true, from, to: newPhase };
}

/**
 * Evaluate the current physics / flight state and trigger any automatic
 * phase transitions.  Called once per physics frame from the game loop.
 *
 * Automatic transitions detected:
 *   - PRELAUNCH → LAUNCH:  engines are firing and craft is lifting off.
 *   - LAUNCH → FLIGHT:     craft has cleared the ground (posY > 0 and not grounded).
 *   - FLIGHT → ORBIT:      orbit check passes (periapsis > 70 km, bound ellipse).
 *   - REENTRY → FLIGHT:    craft descends below atmosphere top during reentry.
 *   - CAPTURE → ORBIT:     orbit check passes at destination body.
 *
 * Manual transitions (not auto-detected here, triggered by player actions):
 *   - ORBIT → MANOEUVRE:   player starts a burn.
 *   - MANOEUVRE → ORBIT:   burn completes.
 *   - ORBIT → REENTRY:     player initiates de-orbit.
 *   - ORBIT → TRANSFER:    player initiates interplanetary transfer.
 *   - TRANSFER → CAPTURE:  SOI change detected.
 *
 * @param {import('./gameState.js').FlightState}       flightState
 * @param {import('./physics.js').PhysicsState}        ps
 * @param {object}                                     [orbitStatus]
 *   Result of `checkOrbitStatus()` — `{ valid, elements, periapsisAlt, apoapsisAlt }`.
 *   Pass null/undefined if orbit checks are not applicable this frame.
 * @returns {PhaseTransition|null}  The transition that occurred, or null.
 */
export function evaluateAutoTransitions(flightState, ps, orbitStatus) {
  const phase = flightState.phase;

  // PRELAUNCH → LAUNCH:  engines are firing.
  if (phase === FlightPhase.PRELAUNCH) {
    if (ps.firingEngines.size > 0 && ps.throttle > 0) {
      const result = transitionPhase(flightState, FlightPhase.LAUNCH, 'Engine ignition');
      return result.success ? flightState.phaseLog[flightState.phaseLog.length - 1] : null;
    }
  }

  // LAUNCH → FLIGHT:  craft has left the ground.
  if (phase === FlightPhase.LAUNCH) {
    if (!ps.grounded && ps.posY > 0) {
      const result = transitionPhase(flightState, FlightPhase.FLIGHT, 'Liftoff');
      return result.success ? flightState.phaseLog[flightState.phaseLog.length - 1] : null;
    }
  }

  // FLIGHT → ORBIT:  orbit check passes.
  if (phase === FlightPhase.FLIGHT) {
    if (orbitStatus && orbitStatus.valid) {
      const result = transitionPhase(flightState, FlightPhase.ORBIT, 'Stable orbit achieved');
      if (result.success) {
        flightState.inOrbit = true;
        flightState.orbitalElements = orbitStatus.elements;
        return flightState.phaseLog[flightState.phaseLog.length - 1];
      }
    }
  }

  // REENTRY → FLIGHT:  craft has descended into the atmosphere.
  if (phase === FlightPhase.REENTRY) {
    // Atmosphere top is 70 km; once below it, the craft is in atmospheric flight.
    if (ps.posY < 70_000) {
      const result = transitionPhase(flightState, FlightPhase.FLIGHT, 'Atmospheric entry');
      if (result.success) {
        flightState.inOrbit = false;
        flightState.orbitalElements = null;
        return flightState.phaseLog[flightState.phaseLog.length - 1];
      }
    }
  }

  // CAPTURE → ORBIT:  orbit check passes at destination.
  if (phase === FlightPhase.CAPTURE) {
    if (orbitStatus && orbitStatus.valid) {
      const result = transitionPhase(flightState, FlightPhase.ORBIT, 'Orbit captured');
      if (result.success) {
        flightState.inOrbit = true;
        flightState.orbitalElements = orbitStatus.elements;
        return flightState.phaseLog[flightState.phaseLog.length - 1];
      }
    }
  }

  return null;
}

/**
 * Returns true if the player can return to the agency from the current phase.
 * The player can return from ORBIT (completing a period) or after landing/crash
 * (FLIGHT phase when landed).
 *
 * Returns false during TRANSFER (player cannot leave craft mid-transfer).
 *
 * @param {string} phase  Current FlightPhase value.
 * @param {import('./physics.js').PhysicsState} ps  Current physics state.
 * @returns {boolean}
 */
export function canReturnToAgency(phase, ps) {
  // Always allow return if landed or crashed (regardless of phase).
  if (ps.landed || ps.crashed) return true;

  // In orbit: player can return to agency (completing a period).
  if (phase === FlightPhase.ORBIT) return true;

  // TRANSFER and CAPTURE: player cannot leave craft.
  if (phase === FlightPhase.TRANSFER || phase === FlightPhase.CAPTURE) return false;

  // MANOEUVRE: player is mid-burn, return is allowed (abort).
  // FLIGHT, LAUNCH, PRELAUNCH: allow abort with warning.
  return true;
}

/**
 * Returns true if the current phase requires a warning before transitioning
 * to return/de-orbit (i.e. leaving orbit).
 *
 * @param {string} currentPhase  Current FlightPhase value.
 * @param {string} targetPhase   Target FlightPhase value.
 * @returns {boolean}
 */
export function requiresTransitionWarning(currentPhase, targetPhase) {
  // ORBIT → REENTRY / FLIGHT: warn about leaving orbit.
  if (currentPhase === FlightPhase.ORBIT && targetPhase === FlightPhase.REENTRY) {
    return true;
  }
  return false;
}

/**
 * Returns true if the player is locked into the current phase and cannot
 * leave the craft (e.g. during transfer between bodies).
 *
 * @param {string} phase  Current FlightPhase value.
 * @returns {boolean}
 */
export function isPlayerLocked(phase) {
  return phase === FlightPhase.TRANSFER || phase === FlightPhase.CAPTURE;
}

/**
 * Human-readable label for a flight phase.
 *
 * @param {string} phase  FlightPhase value.
 * @returns {string}
 */
export function getPhaseLabel(phase) {
  return _phaseLabel(phase);
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * @param {string} phase
 * @returns {string}
 */
function _phaseLabel(phase) {
  switch (phase) {
    case FlightPhase.PRELAUNCH: return 'Pre-Launch';
    case FlightPhase.LAUNCH:    return 'Launch';
    case FlightPhase.FLIGHT:    return 'Flight';
    case FlightPhase.ORBIT:     return 'Orbit';
    case FlightPhase.MANOEUVRE:  return 'Manoeuvre';
    case FlightPhase.REENTRY:   return 'Re-Entry';
    case FlightPhase.TRANSFER:  return 'Transfer';
    case FlightPhase.CAPTURE:   return 'Capture';
    default:                    return phase;
  }
}
