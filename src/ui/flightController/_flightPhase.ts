/**
 * _flightPhase.ts — Flight phase transition evaluation, deorbit warning,
 * phase notification display.
 *
 * @module ui/flightController/_flightPhase
 */

import { FlightPhase, ControlMode } from '../../core/constants.ts';
import {
  evaluateAutoTransitions,
  getPhaseLabel,
  transitionPhase,
  getDeorbitWarningMessage,
} from '../../core/flightPhase.ts';
import { checkOrbitStatus, getMinOrbitAltitude, getOrbitEntryLabel } from '../../core/orbit.ts';
import {
  recalculateOrbit,
  isOrbitalBurnActive,
  isEscapeTrajectory,
} from '../../core/manoeuvre.ts';
import { resetControlModeIfNeeded, CONTROL_MODE_TIPS } from '../../core/controlMode.ts';
import { getFCState, getPhysicsState, getFlightState } from './_state.ts';
import { applyTimeWarp } from './_timeWarp.ts';
import { toggleMapView } from './_mapView.ts';
import { resyncWorkerState } from './_workerBridge.ts';

/**
 * Show a brief notification label at the top of the screen when the flight
 * phase changes (e.g. "Low Earth Orbit", "Re-Entry").  The label fades out
 * after 3 s.
 *
 * @param label  Text to display.
 * @param style  Visual style -- 'warning' uses an amber colour scheme for
 *   deorbit warnings; 'status' uses a subtle passive text style for view
 *   indicators.
 */
export function showPhaseNotification(label: string, style: 'info' | 'warning' | 'status' = 'info'): void {
  const host: HTMLElement = document.getElementById('ui-overlay') ?? document.body;

  // Remove any existing notification.
  const existing = host.querySelector('.phase-notification');
  if (existing) existing.remove();

  const el: HTMLDivElement = document.createElement('div');
  el.className = 'phase-notification';
  if (style === 'warning') el.classList.add('phase-notification-warning');
  if (style === 'status') el.classList.add('phase-notification-status');
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

/**
 * Show a brief deorbit warning notification before transitioning from ORBIT
 * to REENTRY.  The warning stays visible for 2 seconds, then the phase
 * transitions automatically.  Player retains engine control throughout.
 */
function _showDeorbitWarning(bodyId: string): void {
  const s = getFCState();
  if (s.deorbitWarningActive) return;
  s.deorbitWarningActive = true;

  const warningMsg: string = getDeorbitWarningMessage(bodyId);
  showPhaseNotification(warningMsg, 'warning');

  // After a brief delay, execute the REENTRY transition.
  setTimeout(() => {
    const s2 = getFCState();
    const s2Fs = getFlightState();
    const s2Ps = getPhysicsState();
    if (!s2Fs || !s2Ps) { s2.deorbitWarningActive = false; return; }

    const result = transitionPhase(
      s2Fs, FlightPhase.REENTRY,
      'De-orbit — periapsis below minimum stable orbit altitude',
    );

    if (result.success) {
      s2Fs.inOrbit = false;
      s2Fs.orbitalElements = null;
      s2Fs.orbitBandId = null;

      // Force-close the map view on deorbit — other orbital objects are no
      // longer visible once the craft leaves the orbital model.
      if (s2.mapActive) {
        toggleMapView();
      }

      showPhaseNotification('Re-Entry');
      applyTimeWarp(1); // Force warp to 1x on reentry.

      // Push the phase change to the worker so it doesn't overwrite
      // the transition on the next snapshot sync.
      if (s2Ps && s2.assembly && s2.stagingConfig) {
        resyncWorkerState(s2Ps, s2.assembly, s2.stagingConfig, s2Fs).catch(() => {});
      }
    }

    s2.deorbitWarningActive = false;
  }, 2000);
}

/**
 * Run flight-phase auto-detection once per frame.  Checks orbit status when
 * the craft is above the minimum orbit altitude for the current body and passes
 * the result to the state machine.
 * Shows a notification label on phase transitions, including the named altitude
 * band on orbit entry (e.g. "Low Earth Orbit" instead of "Orbit").
 *
 * @param skipAutoTransitions  When true, skip the `evaluateAutoTransitions()`
 *   call and the associated notification logic.  Used in worker-physics mode
 *   where the worker already handles phase transitions and the main thread
 *   detects them from snapshot diffs.  Orbit recalculation and control mode
 *   resets still run.
 */
export function evaluateFlightPhase(skipAutoTransitions = false): void {
  const s = getFCState();
  const ps = getPhysicsState();
  const flightState = getFlightState();
  if (!ps || !flightState) return;

  const bodyId: string = flightState.bodyId || 'EARTH';
  const minOrbitAlt: number = getMinOrbitAltitude(bodyId);

  // Only compute orbit status when above the minimum orbit altitude.
  let orbitStatus = null;
  if (ps.posY >= minOrbitAlt && !ps.landed && !ps.crashed) {
    orbitStatus = checkOrbitStatus(ps.posX, ps.posY, ps.velX, ps.velY, bodyId);
  }

  // --- Continuous orbit recalculation during MANOEUVRE / TRANSFER / CAPTURE ---
  // Skip recalculation during stable Keplerian propagation (no engines firing
  // in ORBIT) — the frozen elements are authoritative and the game-frame
  // coordinates are not meaningful for orbit recalculation.
  const phase: string = flightState.phase;
  const skipRecalc = phase === FlightPhase.ORBIT && flightState.orbitalElements && ps.firingEngines.size === 0;
  if (!skipRecalc && (
      phase === FlightPhase.MANOEUVRE ||
      phase === FlightPhase.TRANSFER ||
      phase === FlightPhase.CAPTURE ||
      (phase === FlightPhase.ORBIT && isOrbitalBurnActive(ps)))) {
    const newElements = recalculateOrbit(ps, bodyId, flightState.timeElapsed);
    if (newElements) {
      flightState.orbitalElements = newElements;
    } else {
      flightState.orbitalElements = null;
    }
  }

  // Detect REENTRY: if we're in ORBIT and periapsis drops below the minimum
  // orbit altitude, the player has initiated a de-orbit burn.  This check runs
  // even in worker-physics mode because the deorbit warning UI is main-thread-only.
  // Skip this check when the craft has frozen orbital elements and no engines
  // firing — Keplerian propagation mode keeps the orbit analytically stable,
  // and the game-frame coordinates are not meaningful for orbit validation.
  const isKeplerianMode = flightState.phase === FlightPhase.ORBIT &&
    flightState.orbitalElements && ps.firingEngines.size === 0;
  if (flightState.phase === FlightPhase.ORBIT && orbitStatus && !orbitStatus.valid && !isKeplerianMode) {
    if (!isEscapeTrajectory(ps, bodyId)) {
      _showDeorbitWarning(bodyId);
      return;
    }
  }

  if (!skipAutoTransitions) {
    const transition = evaluateAutoTransitions(flightState, ps, orbitStatus);

    if (transition) {
      if (transition.to === FlightPhase.ORBIT && orbitStatus) {
        const label: string = getOrbitEntryLabel(orbitStatus);
        showPhaseNotification(label);

        flightState.inOrbit = true;
        flightState.orbitalElements = orbitStatus.elements;
        flightState.orbitBandId = orbitStatus.altitudeBand ? orbitStatus.altitudeBand.id : null;
      } else if (transition.to === FlightPhase.MANOEUVRE) {
        showPhaseNotification('Manoeuvre');
        applyTimeWarp(1);
      } else if (transition.to === FlightPhase.TRANSFER) {
        showPhaseNotification('Transfer Injection');
        applyTimeWarp(1);

        // Auto-open map view during transfer.
        if (!s.mapActive) {
          toggleMapView();
        }
      } else if (transition.to === FlightPhase.CAPTURE) {
        showPhaseNotification(`Entering ${flightState.bodyId || 'destination'} SOI`);
        applyTimeWarp(1);
      } else {
        showPhaseNotification(getPhaseLabel(transition.to));
      }
    }
  }

  // Reset control mode when flight phase leaves ORBIT (but allow MANOEUVRE).
  if (ps.controlMode !== ControlMode.NORMAL &&
      flightState.phase !== FlightPhase.ORBIT &&
      flightState.phase !== FlightPhase.MANOEUVRE) {
    const wasReset: boolean = resetControlModeIfNeeded(ps, flightState, bodyId);
    if (wasReset) {
      showPhaseNotification(CONTROL_MODE_TIPS[ControlMode.NORMAL]);
    }
  }
}
