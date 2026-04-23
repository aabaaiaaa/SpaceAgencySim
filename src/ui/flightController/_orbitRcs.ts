/**
 * _orbitRcs.ts — Docking mode toggle and RCS mode toggle.
 *
 * @module ui/flightController/_orbitRcs
 */

import { FlightPhase, ControlMode } from '../../core/constants.ts';
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
 * Toggle docking mode on/off.
 * Only available in ORBIT phase. Shows a control tip on every switch.
 */
export function toggleDockingMode(): void {
  const ps = getPhysicsState();
  const flightState = getFlightState();
  if (!ps || !flightState) return;

  if (ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS) {
    // Exit docking mode -> NORMAL.
    const dockBodyId: string = (flightState && flightState.bodyId) || 'EARTH';
    const result = exitDockingMode(ps, flightState, dockBodyId);
    if (result.success) {
      showPhaseNotification(CONTROL_MODE_TIPS[ControlMode.NORMAL]);
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
 * Only meaningful within docking mode; in NORMAL orbit mode it nudges the
 * player to enter docking mode first.
 */
export function toggleRcsModeHandler(): void {
  const s = getFCState();
  const ps = getPhysicsState();
  const flightState = getFlightState();
  if (!ps || !s.assembly || !flightState) return;

  if (ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS) {
    const result = toggleRcsMode(ps, s.assembly);
    if (result.success) {
      showPhaseNotification(CONTROL_MODE_TIPS[ps.controlMode]);
    } else {
      showPhaseNotification(result.reason || 'Cannot toggle RCS');
    }
  } else if (flightState.phase === FlightPhase.ORBIT) {
    showPhaseNotification('Press V to enter docking mode first');
  }
}
