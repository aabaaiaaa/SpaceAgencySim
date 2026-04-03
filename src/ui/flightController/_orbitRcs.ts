/**
 * _orbitRcs.ts — Normal orbit RCS thrust application, docking mode toggle,
 * RCS mode toggle.
 *
 * @module ui/flightController/_orbitRcs
 */

import { FlightPhase, ControlMode } from '../../core/constants.js';
import { MapThrustDir, computeOrbitalThrustAngle } from '../../core/mapView.js';
import {
  enterDockingMode,
  exitDockingMode,
  toggleRcsMode,
  CONTROL_MODE_TIPS,
} from '../../core/controlMode.js';
import { getFCState } from './_state.js';
import { showPhaseNotification } from './_flightPhase.js';
import { applyTimeWarp } from './_timeWarp.js';

/**
 * Apply orbital-relative thrust from WASD in NORMAL orbit mode (flight view).
 * Similar to map-view thrust but operates from the flight view.
 * W=prograde, S=retrograde, A=radial-in, D=radial-out.
 */
export function applyNormalOrbitRcs(): void {
  const s = getFCState();
  if (s.mapActive || !s.ps || !s.flightState) return;
  if (s.ps.controlMode !== ControlMode.NORMAL) {
    if (s.normalOrbitThrusting) {
      s.ps.throttle = 0;
      s.normalOrbitThrusting = false;
    }
    s.normalOrbitHeldKeys.clear();
    return;
  }
  if (s.flightState.phase !== FlightPhase.ORBIT && s.flightState.phase !== FlightPhase.MANOEUVRE) {
    if (s.normalOrbitThrusting) {
      s.ps.throttle = 0;
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

  const nBodyId: string = (s.flightState && s.flightState.bodyId) || 'EARTH';

  if (direction) {
    s.ps.angle = computeOrbitalThrustAngle(s.ps, nBodyId, direction);
    if (s.ps.throttle === 0) s.ps.throttle = 1;
    s.normalOrbitThrusting = true;
  } else if (s.normalOrbitThrusting) {
    s.ps.throttle = 0;
    s.normalOrbitThrusting = false;
  }
}

/**
 * Toggle docking mode on/off.
 * Only available in ORBIT phase. Shows a control tip on every switch.
 */
export function toggleDockingMode(): void {
  const s = getFCState();
  if (!s.ps || !s.flightState) return;

  if (s.ps.controlMode === ControlMode.DOCKING || s.ps.controlMode === ControlMode.RCS) {
    // Exit docking mode -> NORMAL.
    const dockBodyId: string = (s.flightState && s.flightState.bodyId) || 'EARTH';
    const result = exitDockingMode(s.ps, s.flightState, dockBodyId);
    if (result.success) {
      showPhaseNotification(CONTROL_MODE_TIPS[ControlMode.NORMAL]);
      s.normalOrbitHeldKeys.clear();
      s.normalOrbitThrusting = false;
    }
  } else {
    // Enter docking mode.
    const dockBodyId: string = (s.flightState && s.flightState.bodyId) || 'EARTH';
    const result = enterDockingMode(s.ps, s.flightState, dockBodyId);
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
  if (!s.ps || !s.assembly || !s.flightState) return;

  if (s.ps.controlMode === ControlMode.DOCKING || s.ps.controlMode === ControlMode.RCS) {
    // Toggle RCS within docking mode.
    const result = toggleRcsMode(s.ps, s.assembly);
    if (result.success) {
      showPhaseNotification(CONTROL_MODE_TIPS[s.ps.controlMode]);
    } else {
      showPhaseNotification(result.reason || 'Cannot toggle RCS');
    }
  } else if (s.flightState.phase === FlightPhase.ORBIT) {
    // In NORMAL orbit mode, R shows the RCS orbit tip.
    showPhaseNotification('RCS Orbit: W prograde, S retrograde, A radial-in, D radial-out');
  }
}
