/**
 * _orbitRcs.ts — Normal orbit RCS thrust application, docking mode toggle,
 * RCS mode toggle.
 *
 * @module ui/flightController/_orbitRcs
 */

import { FlightPhase, ControlMode } from '../../core/constants.ts';
import { MapThrustDir, computeOrbitalThrustAngle } from '../../core/mapView.ts';
import {
  enterDockingMode,
  exitDockingMode,
  toggleRcsMode,
  CONTROL_MODE_TIPS,
} from '../../core/controlMode.ts';
import { getFCState, getPhysicsState, getFlightState } from './_state.ts';
import { showPhaseNotification } from './_flightPhase.ts';
import { applyTimeWarp } from './_timeWarp.ts';

/**
 * Apply orbital-relative thrust from WASD in NORMAL orbit mode (flight view).
 * Similar to map-view thrust but operates from the flight view.
 * W=prograde, S=retrograde, A=radial-in, D=radial-out.
 */
export function applyNormalOrbitRcs(): void {
  const s = getFCState();
  const ps = getPhysicsState();
  const flightState = getFlightState();
  if (s.mapActive || !ps || !flightState) return;
  if (ps.controlMode !== ControlMode.NORMAL) {
    if (s.normalOrbitThrusting) {
      ps.throttle = 0;
      s.normalOrbitThrusting = false;
    }
    s.normalOrbitHeldKeys.clear();
    return;
  }
  if (flightState.phase !== FlightPhase.ORBIT && flightState.phase !== FlightPhase.MANOEUVRE) {
    if (s.normalOrbitThrusting) {
      ps.throttle = 0;
      s.normalOrbitThrusting = false;
    }
    s.normalOrbitHeldKeys.clear();
    return;
  }

  let direction: string | null = null;
  if (s.normalOrbitHeldKeys.has('w'))      direction = MapThrustDir.PROGRADE;
  else if (s.normalOrbitHeldKeys.has('s')) direction = MapThrustDir.RETROGRADE;
  else if (s.normalOrbitHeldKeys.has('a')) direction = MapThrustDir.RADIAL_IN;
  else if (s.normalOrbitHeldKeys.has('d')) direction = MapThrustDir.RADIAL_OUT;

  const nBodyId: string = (flightState && flightState.bodyId) || 'EARTH';

  if (direction) {
    ps.angle = computeOrbitalThrustAngle(ps, nBodyId, direction);
    if (ps.throttle === 0) ps.throttle = 1;
    s.normalOrbitThrusting = true;
  } else if (s.normalOrbitThrusting) {
    ps.throttle = 0;
    s.normalOrbitThrusting = false;
  }
}

/**
 * Toggle docking mode on/off.
 * Only available in ORBIT phase. Shows a control tip on every switch.
 */
export function toggleDockingMode(): void {
  const s = getFCState();
  const ps = getPhysicsState();
  const flightState = getFlightState();
  if (!ps || !flightState) return;

  if (ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS) {
    // Exit docking mode -> NORMAL.
    const dockBodyId: string = (flightState && flightState.bodyId) || 'EARTH';
    const result = exitDockingMode(ps, flightState, dockBodyId);
    if (result.success) {
      showPhaseNotification(CONTROL_MODE_TIPS[ControlMode.NORMAL]);
      s.normalOrbitHeldKeys.clear();
      s.normalOrbitThrusting = false;
    }
  } else {
    // Enter docking mode.
    const dockBodyId: string = (flightState && flightState.bodyId) || 'EARTH';
    const result = enterDockingMode(ps, flightState, dockBodyId);
    if (result.success) {
      showPhaseNotification(CONTROL_MODE_TIPS[ControlMode.DOCKING]);
      // Force warp to 1x in docking mode.
      applyTimeWarp(1);
    } else {
      showPhaseNotification(result.reason || 'Cannot enter docking mode');
    }
  }
}

/**
 * Toggle RCS mode on/off.
 * If in docking mode, toggles RCS sub-mode.
 * If in NORMAL orbit mode, shows orbital-relative RCS tip.
 */
export function toggleRcsModeHandler(): void {
  const s = getFCState();
  const ps = getPhysicsState();
  const flightState = getFlightState();
  if (!ps || !s.assembly || !flightState) return;

  if (ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS) {
    // Toggle RCS within docking mode.
    const result = toggleRcsMode(ps, s.assembly);
    if (result.success) {
      showPhaseNotification(CONTROL_MODE_TIPS[ps.controlMode]);
    } else {
      showPhaseNotification(result.reason || 'Cannot toggle RCS');
    }
  } else if (flightState.phase === FlightPhase.ORBIT) {
    // In NORMAL orbit mode, R shows the RCS orbit tip.
    showPhaseNotification('RCS Orbit: W prograde, S retrograde, A radial-in, D radial-out');
  }
}
