/**
 * flightPhase.ts — Flight phase state machine.
 *
 * Manages the current phase of a flight and enforces valid transitions
 * between phases.  Each transition can carry a reason string and optional
 * metadata, and the module maintains a log of all transitions for the
 * flight event record.
 *
 * PHASE GRAPH
 *   PRELAUNCH -> LAUNCH          (engine ignition)
 *   LAUNCH    -> FLIGHT          (cleared the pad)
 *   FLIGHT    -> ORBIT           (stable orbit achieved)
 *   FLIGHT    -> (landed/crash)  (terminal -- no phase change, physics handles it)
 *   ORBIT     -> MANOEUVRE       (burn started)
 *   MANOEUVRE -> ORBIT           (burn completed)
 *   ORBIT     -> REENTRY        (de-orbit initiated)
 *   REENTRY   -> FLIGHT         (atmospheric flight / landing approach)
 *   ORBIT     -> TRANSFER       (interplanetary injection)
 *   TRANSFER  -> CAPTURE        (SOI arrival)
 *   CAPTURE   -> ORBIT          (stable orbit at destination)
 *
 * Docking mode is a control mode within ORBIT (TASK-005), not a phase.
 *
 * @module core/flightPhase
 */

import { FlightPhase, MIN_ORBIT_ALTITUDE, ControlMode } from './constants.ts';
import type { CelestialBody } from './constants.ts';
import {
  isOrbitalBurnActive, shouldEnterManoeuvre, shouldExitManoeuvre,
  shouldEnterTransfer, isEscapeTrajectory, checkSOITransition,
  getTransferTargets, computeTransferDeltaV, BODY_PARENT,
} from './manoeuvre.ts';
import { checkOrbitStatus, computeOrbitalElements } from './orbit.ts';
import type { FlightState, PhaseTransition, OrbitalElements } from './gameState.ts';
import type { PhysicsState } from './physics.ts';

// ---------------------------------------------------------------------------
// Local types
// ---------------------------------------------------------------------------

interface OrbitStatus {
  valid: boolean;
  elements?: OrbitalElements | null;
  periapsisAlt?: number;
  apoapsisAlt?: number;
  altitudeBand?: { id: string; name: string } | null;
}

interface TransitionResult {
  success: boolean;
  from: string;
  to: string;
  reason?: string;
  meta?: Record<string, unknown> | null;
}

// ---------------------------------------------------------------------------
// Valid transition map
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS = new Map<string, Set<string>>([
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
// Public API
// ---------------------------------------------------------------------------

export function isValidTransition(from: string, to: string): boolean {
  const allowed = VALID_TRANSITIONS.get(from);
  return allowed ? allowed.has(to) : false;
}

export function transitionPhase(flightState: FlightState, newPhase: string, reason: string = '', meta: Record<string, unknown> | null = null): TransitionResult {
  const from = flightState.phase;
  if (from === newPhase) return { success: false, from, to: newPhase, reason: 'Already in this phase' };
  if (!isValidTransition(from, newPhase)) return { success: false, from, to: newPhase, reason: `Invalid transition: ${from} → ${newPhase}` };
  flightState.phase = newPhase as FlightPhase;
  const entry: PhaseTransition = { from, to: newPhase, time: flightState.timeElapsed, reason: reason || `${from} → ${newPhase}` };
  if (meta) entry.meta = meta;
  flightState.phaseLog.push(entry);
  flightState.events.push({ time: flightState.timeElapsed, type: 'PHASE_CHANGE', description: reason || `Phase: ${_phaseLabel(newPhase)}` });
  return { success: true, from, to: newPhase, meta };
}

export function evaluateAutoTransitions(flightState: FlightState, ps: PhysicsState, orbitStatus?: OrbitStatus | null): PhaseTransition | null {
  const phase = flightState.phase;

  // PRELAUNCH -> LAUNCH
  if (phase === FlightPhase.PRELAUNCH) {
    if (ps.firingEngines.size > 0 && ps.throttle > 0) {
      const result = transitionPhase(flightState, FlightPhase.LAUNCH, 'Engine ignition');
      return result.success ? flightState.phaseLog[flightState.phaseLog.length - 1] : null;
    }
  }

  // LAUNCH -> FLIGHT
  if (phase === FlightPhase.LAUNCH) {
    if (!ps.grounded && ps.posY > 0) {
      const result = transitionPhase(flightState, FlightPhase.FLIGHT, 'Liftoff');
      return result.success ? flightState.phaseLog[flightState.phaseLog.length - 1] : null;
    }
  }

  // FLIGHT -> ORBIT
  if (phase === FlightPhase.FLIGHT) {
    if (orbitStatus && orbitStatus.valid) {
      const bandName = orbitStatus.altitudeBand ? orbitStatus.altitudeBand.name : 'Orbit';
      const meta = orbitStatus.altitudeBand ? { altitudeBand: orbitStatus.altitudeBand } : null;
      const result = transitionPhase(flightState, FlightPhase.ORBIT, `${bandName} achieved`, meta);
      if (result.success) {
        flightState.inOrbit = true; flightState.orbitalElements = orbitStatus.elements ?? null;
        return flightState.phaseLog[flightState.phaseLog.length - 1];
      }
    }
  }

  // REENTRY -> FLIGHT
  if (phase === FlightPhase.REENTRY) {
    const bodyId = (flightState && flightState.bodyId) || 'EARTH';
    const atmosphereAlt = MIN_ORBIT_ALTITUDE[bodyId] ?? 70_000;
    if (ps.posY < atmosphereAlt) {
      const result = transitionPhase(flightState, FlightPhase.FLIGHT, 'Atmospheric entry');
      if (result.success) {
        flightState.inOrbit = false; flightState.orbitalElements = null;
        return flightState.phaseLog[flightState.phaseLog.length - 1];
      }
    }
  }

  // ORBIT -> MANOEUVRE
  if (phase === FlightPhase.ORBIT) {
    if (shouldEnterManoeuvre(ps, flightState)) {
      const result = transitionPhase(flightState, FlightPhase.MANOEUVRE, 'Orbital burn started');
      return result.success ? flightState.phaseLog[flightState.phaseLog.length - 1] : null;
    }
  }

  // MANOEUVRE -> ORBIT (or -> TRANSFER):  burn completed.
  //
  // ORDERING DEPENDENCY — the escape-trajectory check MUST come before the
  // normal shouldExitManoeuvre() check, and its success path MUST return
  // early. Both branches can be true simultaneously (an escape trajectory
  // is also a completed burn), so without the early return the craft would
  // first transition MANOEUVRE -> ORBIT -> TRANSFER, then fall through and
  // attempt a second MANOEUVRE -> ORBIT transition — double-mutating
  // flightState.orbitalElements and phaseLog. The early return inside the
  // escape-trajectory success path is therefore load-bearing; do not remove it.
  if (phase === FlightPhase.MANOEUVRE) {
    const bodyId = (flightState && flightState.bodyId) || 'EARTH';
    if (shouldEnterTransfer(ps, flightState)) {
      const result = transitionPhase(flightState, FlightPhase.ORBIT, 'Burn complete — transfer pending');
      if (result.success) {
        const transferResult = transitionPhase(flightState, FlightPhase.TRANSFER, 'Transfer injection — escape trajectory');
        if (transferResult.success) {
          flightState.inOrbit = false;
          const altitude = Math.max(0, ps.posY);
          const targets = getTransferTargets(bodyId, altitude);
          if (targets.length > 0) {
            const target = targets[0];
            const transfer = computeTransferDeltaV(bodyId, target.bodyId, altitude);
            flightState.transferState = {
              originBodyId: bodyId, destinationBodyId: target.bodyId,
              departureTime: flightState.timeElapsed,
              estimatedArrival: flightState.timeElapsed + (transfer ? transfer.transferTime : 0),
              departureDV: transfer ? transfer.departureDV : 0,
              captureDV: transfer ? transfer.captureDV : 0,
              totalDV: transfer ? transfer.totalDV : 0,
              trajectoryPath: [],
            };
          }
          return flightState.phaseLog[flightState.phaseLog.length - 1];
        }
      }
    }
    if (shouldExitManoeuvre(ps, flightState, bodyId)) {
      const newElements = computeOrbitalElements(ps.posX, ps.posY, ps.velX, ps.velY, bodyId, flightState.timeElapsed);
      const result = transitionPhase(flightState, FlightPhase.ORBIT, 'Burn complete');
      if (result.success) {
        if (newElements) flightState.orbitalElements = newElements;
        return flightState.phaseLog[flightState.phaseLog.length - 1];
      }
    }
  }

  // TRANSFER -> CAPTURE
  if (phase === FlightPhase.TRANSFER) {
    const soiCheck = checkSOITransition(ps, flightState);
    if (soiCheck.transition && soiCheck.newBodyId) {
      const result = transitionPhase(flightState, FlightPhase.CAPTURE, soiCheck.reason);
      if (result.success) {
        flightState.bodyId = soiCheck.newBodyId as CelestialBody;
        return flightState.phaseLog[flightState.phaseLog.length - 1];
      }
    }
  }

  // CAPTURE -> ORBIT (successful capture burn)
  if (phase === FlightPhase.CAPTURE) {
    if (orbitStatus && orbitStatus.valid) {
      const bandName = orbitStatus.altitudeBand ? orbitStatus.altitudeBand.name : 'Orbit';
      const meta = orbitStatus.altitudeBand ? { altitudeBand: orbitStatus.altitudeBand } : null;
      const result = transitionPhase(flightState, FlightPhase.ORBIT, `${bandName} captured`, meta);
      if (result.success) {
        flightState.inOrbit = true; flightState.orbitalElements = orbitStatus.elements ?? null;
        flightState.transferState = null;
        return flightState.phaseLog[flightState.phaseLog.length - 1];
      }
    }

    // CAPTURE -> TRANSFER (fly-by: craft exits SOI without capturing)
    const captBodyId = flightState.bodyId || 'EARTH';
    if (isEscapeTrajectory(ps, captBodyId)) {
      const parent = (BODY_PARENT as Record<string, string | null>)[captBodyId];
      if (parent) {
        const result = transitionPhase(flightState, FlightPhase.TRANSFER, `Fly-by — escaped ${captBodyId}`);
        if (result.success) {
          flightState.bodyId = parent as CelestialBody;
          flightState.transferState = null;
          return flightState.phaseLog[flightState.phaseLog.length - 1];
        }
      }
    }
  }

  return null;
}

export function canReturnToAgency(phase: string, ps: PhysicsState): boolean {
  if (ps.landed || ps.crashed) return true;
  if (phase === FlightPhase.ORBIT) return true;
  if (phase === FlightPhase.TRANSFER || phase === FlightPhase.CAPTURE) return false;
  return true;
}

export function requiresTransitionWarning(currentPhase: string, targetPhase: string): boolean {
  if (currentPhase === FlightPhase.ORBIT && targetPhase === FlightPhase.REENTRY) return true;
  return false;
}

export function isPlayerLocked(phase: string): boolean {
  return phase === FlightPhase.TRANSFER || phase === FlightPhase.CAPTURE;
}

export function getPhaseLabel(phase: string): string { return _phaseLabel(phase); }

export function getDeorbitWarningMessage(bodyId: string): string {
  switch (bodyId) {
    case 'MOON': return 'De-orbit — craft will leave lunar orbital model. Other craft will no longer be visible.';
    default: return 'De-orbit — craft will leave orbital model. Other craft will no longer be visible.';
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

function _phaseLabel(phase: string): string {
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
