/**
 * _docking.ts — Docking system tick, docking target cycling, undock handler,
 * fuel transfer, docking HUD.
 *
 * @module ui/flightController/_docking
 */

import { FlightPhase } from '../../core/constants.js';
import { DockingState } from '../../core/constants.js';
import {
  tickDocking,
  getDockingGuidance,
  getTargetsInVisualRange,
  selectDockingTarget,
  clearDockingTarget,
  hasDockingPort,
  canDockWith,
  undock,
  transferFuel,
} from '../../core/docking.js';
import { getFCState } from './_state.js';
import { showPhaseNotification } from './_flightPhase.js';
import { setMapTarget } from './_mapView.js';

/**
 * Tick the docking system each frame.
 */
export function tickDockingSystem(dt: number): void {
  const s = getFCState();
  if (!s.ps || !s.assembly || !s.flightState || !s.state) return;

  const dockingState = s.flightState.dockingState;
  if (!dockingState) return;

  // Only tick docking when in ORBIT phase.
  if (s.flightState.phase !== FlightPhase.ORBIT) {
    if (dockingState.state !== DockingState.IDLE && dockingState.state !== DockingState.DOCKED) {
      clearDockingTarget(dockingState);
    }
    return;
  }

  // Update combined mass on physics state for thrust calculations.
  s.ps._dockedCombinedMass = dockingState.combinedMass;

  const result = tickDocking(dockingState, s.ps, s.assembly, s.flightState, s.state, dt);

  if (result.docked) {
    showPhaseNotification('Docking Complete!');
    // Set all docking ports to 'docked' state.
    for (const [instanceId, portState] of s.ps.dockingPortStates) {
      if (portState === 'extended') {
        s.ps.dockingPortStates.set(instanceId, 'docked');
      }
    }
  }

  if (result.event === 'AUTO_DOCK_ABORT') {
    showPhaseNotification('Auto-dock aborted \u2014 moved too far', 'warning');
  }
}

/**
 * Cycle through available docking targets in visual range.
 */
export function cycleDockingTarget(): void {
  const s = getFCState();
  if (!s.ps || !s.assembly || !s.flightState || !s.state) return;

  const dockingState = s.flightState.dockingState;
  if (!dockingState) return;

  // If already docked, can't select new target.
  if (dockingState.state === DockingState.DOCKED) {
    showPhaseNotification('Already docked \u2014 press U to undock');
    return;
  }

  if (!hasDockingPort(s.ps, s.assembly)) {
    showPhaseNotification('No docking port on craft');
    return;
  }

  const targets = getTargetsInVisualRange(s.ps, s.flightState, s.state);
  const dockable = targets.filter(t => canDockWith(t.object));

  if (dockable.length === 0) {
    showPhaseNotification('No docking targets in range');
    clearDockingTarget(dockingState);
    return;
  }

  // Find current target index and cycle to next.
  const currentIdx = dockable.findIndex(t => t.object.id === dockingState.targetId);
  const nextIdx = (currentIdx + 1) % dockable.length;
  const nextTarget = dockable[nextIdx];

  const result = selectDockingTarget(dockingState, nextTarget.object.id, s.ps, s.assembly);
  if (result.success) {
    showPhaseNotification(`Docking target: ${nextTarget.object.name} (${Math.round(nextTarget.distance)} m)`);
    // Extend docking ports.
    for (const [instanceId, portState] of s.ps.dockingPortStates) {
      if (portState === 'retracted') {
        s.ps.dockingPortStates.set(instanceId, 'extended');
      }
    }
    // Also set this as the map target for visibility.
    setMapTarget(nextTarget.object.id);
  } else {
    showPhaseNotification(result.reason || 'Cannot select target');
  }
}

/**
 * Handle undocking from the current docked vessel.
 */
export function handleUndock(): void {
  const s = getFCState();
  if (!s.ps || !s.assembly || !s.flightState || !s.state) return;

  const dockingState = s.flightState.dockingState;
  if (!dockingState || dockingState.state !== DockingState.DOCKED) {
    return;
  }

  const result = undock(dockingState, s.ps, s.assembly, s.flightState, s.state);
  if (result.success) {
    showPhaseNotification('Undocked');
    // Reset docking port states.
    for (const [instanceId] of s.ps.dockingPortStates) {
      s.ps.dockingPortStates.set(instanceId, 'retracted');
    }
    s.ps._dockedCombinedMass = 0;
  }
}

/**
 * Handle fuel transfer from docked depot.
 */
export function handleFuelTransfer(): void {
  const s = getFCState();
  if (!s.ps || !s.assembly || !s.flightState) return;

  const dockingState = s.flightState.dockingState;
  if (!dockingState) return;

  // Transfer up to 500 kg at a time.
  const result = transferFuel(dockingState, s.ps, s.assembly, s.flightState, 500);
  if (result.success && result.transferred > 0) {
    showPhaseNotification(`Transferred ${Math.round(result.transferred)} kg fuel`);
  } else if (result.transferred === 0) {
    showPhaseNotification('Tanks are full');
  }
}

/**
 * Build or update the docking guidance HUD overlay.
 */
export function updateDockingHud(): void {
  const s = getFCState();
  if (!s.flightState || !s.flightState.dockingState) {
    destroyDockingHud();
    return;
  }

  const guidance = getDockingGuidance(s.flightState.dockingState);

  if (!guidance.active) {
    destroyDockingHud();
    return;
  }

  // Create the HUD element if it doesn't exist.
  if (!s.dockingHud && s.container) {
    s.dockingHud = document.createElement('div');
    s.dockingHud.id = 'docking-guidance-hud';
    s.container.appendChild(s.dockingHud);
  }

  if (!s.dockingHud) return;

  // Color helpers.
  const greenStyle = 'color: #4f4; font-weight: bold;';
  const redStyle   = 'color: #f44; font-weight: bold;';
  const whiteStyle = 'color: #fff;';

  let stateLabel: string;
  switch (guidance.state) {
    case DockingState.APPROACHING:   stateLabel = 'APPROACHING'; break;
    case DockingState.ALIGNING:      stateLabel = 'ALIGNING'; break;
    case DockingState.FINAL_APPROACH:stateLabel = 'AUTO-DOCK'; break;
    case DockingState.DOCKED:        stateLabel = 'DOCKED'; break;
    default:                         stateLabel = guidance.state;
  }

  const distStr: string = guidance.distance < 1000
    ? `${guidance.distance.toFixed(1)} m`
    : `${(guidance.distance / 1000).toFixed(2)} km`;

  const speedColor: string = guidance.speedOk ? greenStyle : redStyle;
  const oriColor: string   = guidance.orientationOk ? greenStyle : redStyle;
  const latColor: string   = guidance.lateralOk ? greenStyle : redStyle;

  let html = `<div style="${whiteStyle}; margin-bottom: 6px; font-size: 14px; border-bottom: 1px solid #555; padding-bottom: 4px;">
    DOCKING \u2014 ${stateLabel}
  </div>`;

  if (guidance.isDocked) {
    html += `<div style="${greenStyle}">DOCKED (${guidance.dockedCount} vessel${guidance.dockedCount !== 1 ? 's' : ''})</div>`;
    html += `<div style="color: #888; margin-top: 6px; font-size: 11px;">U = Undock &nbsp; F = Transfer fuel</div>`;
  } else {
    html += `<div>Distance: ${distStr}</div>`;
    html += `<div style="${speedColor}">Rel. Speed: ${guidance.relativeSpeed.toFixed(2)} m/s ${guidance.speedOk ? '\u2713' : '\u2717'}</div>`;
    html += `<div style="${oriColor}">Orientation: ${(guidance.orientationDiff * 180 / Math.PI).toFixed(1)}\u00b0 ${guidance.orientationOk ? '\u2713' : '\u2717'}</div>`;
    html += `<div style="${latColor}">Lateral: ${guidance.lateralOffset.toFixed(1)} m ${guidance.lateralOk ? '\u2713' : '\u2717'}</div>`;

    if (guidance.state === DockingState.FINAL_APPROACH) {
      html += `<div style="${greenStyle}; margin-top: 6px;">Auto-dock engaged...</div>`;
    } else if (guidance.allGreen && guidance.distance <= 500) {
      html += `<div style="color: #ff0; margin-top: 6px;">Close to ${Math.round(15)} m for auto-dock</div>`;
    }

    html += `<div style="color: #888; margin-top: 6px; font-size: 11px;">T = Cycle target</div>`;
  }

  s.dockingHud.innerHTML = html;
}

/**
 * Remove the docking guidance HUD.
 */
export function destroyDockingHud(): void {
  const s = getFCState();
  if (s.dockingHud) {
    s.dockingHud.remove();
    s.dockingHud = null;
  }
}
