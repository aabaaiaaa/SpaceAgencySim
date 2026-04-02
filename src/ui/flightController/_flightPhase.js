/**
 * _flightPhase.js — Flight phase transition evaluation, deorbit warning,
 * phase notification display.
 *
 * @module ui/flightController/_flightPhase
 */

import { FlightPhase, ControlMode } from '../../core/constants.js';
import {
  evaluateAutoTransitions,
  getPhaseLabel,
  transitionPhase,
  getDeorbitWarningMessage,
} from '../../core/flightPhase.js';
import { checkOrbitStatus, getMinOrbitAltitude, getOrbitEntryLabel } from '../../core/orbit.js';
import {
  recalculateOrbit,
  isOrbitalBurnActive,
  isEscapeTrajectory,
} from '../../core/manoeuvre.js';
import { resetControlModeIfNeeded, CONTROL_MODE_TIPS } from '../../core/controlMode.js';
import { getFCState } from './_state.js';
import { applyTimeWarp } from './_timeWarp.js';
import { toggleMapView } from './_mapView.js';

/**
 * Show a brief notification label at the top of the screen when the flight
 * phase changes (e.g. "Low Earth Orbit", "Re-Entry").  The label fades out
 * after 3 s.
 *
 * @param {string} label  Text to display.
 * @param {'info'|'warning'|'status'} [style='info']  Visual style — 'warning'
 *   uses an amber colour scheme for deorbit warnings; 'status' uses a subtle
 *   passive text style for view indicators.
 */
export function showPhaseNotification(label, style = 'info') {
  const host = document.getElementById('ui-overlay') ?? document.body;

  // Remove any existing notification.
  const existing = host.querySelector('.phase-notification');
  if (existing) existing.remove();

  const el = document.createElement('div');
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
 *
 * @param {string} bodyId  Celestial body ID.
 */
function _showDeorbitWarning(bodyId) {
  const s = getFCState();
  if (s.deorbitWarningActive) return;
  s.deorbitWarningActive = true;

  const warningMsg = getDeorbitWarningMessage(bodyId);
  showPhaseNotification(warningMsg, 'warning');

  // After a brief delay, execute the REENTRY transition.
  setTimeout(() => {
    const s2 = getFCState();
    if (!s2.flightState || !s2.ps) { s2.deorbitWarningActive = false; return; }

    const result = transitionPhase(
      s2.flightState, FlightPhase.REENTRY,
      'De-orbit — periapsis below minimum stable orbit altitude',
    );

    if (result.success) {
      s2.flightState.inOrbit = false;
      s2.flightState.orbitalElements = null;
      s2.flightState.orbitBandId = null;

      // Force-close the map view on deorbit — other orbital objects are no
      // longer visible once the craft leaves the orbital model.
      if (s2.mapActive) {
        toggleMapView();
      }

      showPhaseNotification('Re-Entry');
      applyTimeWarp(1); // Force warp to 1x on reentry.
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
 */
export function evaluateFlightPhase() {
  const s = getFCState();
  if (!s.ps || !s.flightState) return;

  const bodyId = s.flightState.bodyId || 'EARTH';
  const minOrbitAlt = getMinOrbitAltitude(bodyId);

  // Only compute orbit status when above the minimum orbit altitude.
  let orbitStatus = null;
  if (s.ps.posY >= minOrbitAlt && !s.ps.landed && !s.ps.crashed) {
    orbitStatus = checkOrbitStatus(s.ps.posX, s.ps.posY, s.ps.velX, s.ps.velY, bodyId);
  }

  // --- Continuous orbit recalculation during MANOEUVRE / TRANSFER / CAPTURE ---
  const phase = s.flightState.phase;
  if (phase === FlightPhase.MANOEUVRE ||
      phase === FlightPhase.TRANSFER ||
      phase === FlightPhase.CAPTURE ||
      (phase === FlightPhase.ORBIT && isOrbitalBurnActive(s.ps))) {
    const newElements = recalculateOrbit(s.ps, bodyId, s.flightState.timeElapsed);
    if (newElements) {
      s.flightState.orbitalElements = newElements;
    } else {
      s.flightState.orbitalElements = null;
    }
  }

  // Detect REENTRY: if we're in ORBIT and periapsis drops below the minimum
  // orbit altitude, the player has initiated a de-orbit burn.
  if (s.flightState.phase === FlightPhase.ORBIT && orbitStatus && !orbitStatus.valid) {
    if (!isEscapeTrajectory(s.ps, bodyId)) {
      _showDeorbitWarning(bodyId);
      return;
    }
  }

  const transition = evaluateAutoTransitions(s.flightState, s.ps, orbitStatus);

  if (transition) {
    if (transition.to === FlightPhase.ORBIT && orbitStatus) {
      const label = getOrbitEntryLabel(orbitStatus);
      showPhaseNotification(label);

      s.flightState.inOrbit = true;
      s.flightState.orbitalElements = orbitStatus.elements;
      s.flightState.orbitBandId = orbitStatus.altitudeBand ? orbitStatus.altitudeBand.id : null;
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
      showPhaseNotification(`Entering ${s.flightState.bodyId || 'destination'} SOI`);
      applyTimeWarp(1);
    } else {
      showPhaseNotification(getPhaseLabel(transition.to));
    }
  }

  // Reset control mode when flight phase leaves ORBIT (but allow MANOEUVRE).
  if (s.ps.controlMode !== ControlMode.NORMAL &&
      s.flightState.phase !== FlightPhase.ORBIT &&
      s.flightState.phase !== FlightPhase.MANOEUVRE) {
    const wasReset = resetControlModeIfNeeded(s.ps, s.flightState, bodyId);
    if (wasReset) {
      showPhaseNotification(CONTROL_MODE_TIPS[ControlMode.NORMAL]);
    }
  }
}
