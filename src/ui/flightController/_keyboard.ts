/**
 * _keyboard.ts — onKeyDown and onKeyUp handlers, warp level constants.
 *
 * @module ui/flightController/_keyboard
 */

import { handleKeyDown, handleKeyUp, fireNextStage } from '../../core/physics.ts';
import { hideLaunchTip, lockTimeWarp } from '../flightHud.ts';
import {
  sendKeyDown as workerKeyDown,
  sendKeyUp as workerKeyUp,
  sendStage as workerStage,
} from './_workerBridge.ts';
import {
  cycleMapZoom,
  getMapZoomLevel,
  setMapZoomLevel,
  cycleMapTarget,
  toggleMapShadow,
  cycleTransferTarget,
  toggleMapCommsOverlay,
} from '../../render/map.ts';
import {
  isTransferPlanningAvailable,
  getAllowedMapZooms,
  isDebrisTrackingAvailable,
} from '../../core/mapView.ts';
import { FlightPhase, ControlMode, DockingState } from '../../core/constants.ts';
import { getFCState } from './_state.ts';
import { applyTimeWarp, onTimeWarpButtonClick } from './_timeWarp.ts';
import { toggleMapView, updateMapHud, handleWarpToTarget } from './_mapView.ts';
import { cycleDockingTarget, handleUndock, handleFuelTransfer } from './_docking.ts';
import { toggleDockingMode, toggleRcsModeHandler } from './_orbitRcs.ts';
import { showPhaseNotification } from './_flightPhase.ts';

/** Ordered warp levels for < / > key stepping. */
export const WARP_LEVELS_ORDERED: number[] = [0, 0.25, 0.5, 1, 2, 5, 10, 50];

export function onKeyDown(e: KeyboardEvent): void {
  const s = getFCState();
  if (!s.ps || !s.assembly || !s.stagingConfig || !s.flightState) return;

  // M — toggle map view.
  if (e.code === 'KeyM') {
    e.preventDefault();
    toggleMapView();
    return;
  }

  // Map-specific keys when the map is active.
  if (s.mapActive) {
    // Tab — cycle zoom level (filtered by Tracking Station tier).
    if (e.code === 'Tab') {
      e.preventDefault();
      const allowed = getAllowedMapZooms(s.state!);
      const current = getMapZoomLevel();
      const idx = allowed.indexOf(current);
      const next = allowed[(idx + 1) % allowed.length];
      setMapZoomLevel(next);
      updateMapHud();
      return;
    }
    // N — toggle day/night shadow overlay.
    if (e.code === 'KeyN') {
      toggleMapShadow();
      return;
    }
    // C — toggle comms coverage overlay.
    if (e.code === 'KeyC') {
      toggleMapCommsOverlay();
      return;
    }
    // T — cycle target selection.
    if (e.code === 'KeyT' && !e.ctrlKey) {
      const tBodyId: string = (s.flightState && s.flightState.bodyId) || 'EARTH';
      cycleMapTarget(s.state!.orbitalObjects, tBodyId);
      updateMapHud();
      return;
    }
    // G — warp to target.
    if (e.code === 'KeyG') {
      handleWarpToTarget();
      return;
    }
    // B — cycle transfer target (route planning, requires Tracking Station tier 3).
    if (e.code === 'KeyB') {
      if (!isTransferPlanningAvailable(s.state!)) {
        showPhaseNotification('Tracking Station Tier 3 required for transfer planning');
        return;
      }
      if (s.flightState) {
        const bodyId: string = s.flightState.bodyId || 'EARTH';
        const alt: number = Math.max(0, s.ps.posY);
        const selected = cycleTransferTarget(bodyId, alt, s.flightState.phase);
        if (selected) {
          showPhaseNotification(`Transfer target: ${selected}`);
        } else {
          showPhaseNotification('Transfer target: none');
        }
        updateMapHud();
      }
      return;
    }
    // WASD — orbital-relative thrust (tracked separately, applied in _loop).
    const lower = e.key.toLowerCase();
    if (lower === 'w' || lower === 's' || lower === 'a' || lower === 'd') {
      s.mapHeldKeys.add(lower);
      return;
    }
  }

  // T — cycle docking target (in docking/RCS mode, flight view).
  if (e.code === 'KeyT' && !s.mapActive &&
      (s.ps.controlMode === ControlMode.DOCKING || s.ps.controlMode === ControlMode.RCS)) {
    e.preventDefault();
    cycleDockingTarget();
    return;
  }

  // U — undock from currently docked vessel.
  if (e.code === 'KeyU' && !s.mapActive) {
    e.preventDefault();
    handleUndock();
    return;
  }

  // F — transfer fuel from docked depot.
  if (e.code === 'KeyF' && !s.mapActive && !e.ctrlKey) {
    if (s.flightState?.dockingState?.state === DockingState.DOCKED) {
      e.preventDefault();
      handleFuelTransfer();
      return;
    }
  }

  // V — toggle docking mode (only in ORBIT phase).
  if (e.code === 'KeyV') {
    e.preventDefault();
    toggleDockingMode();
    return;
  }

  // --- Comms control lockout ---
  if (s.flightState.commsState?.controlLocked) {
    if (e.code !== 'KeyM' && e.code !== 'Comma' && e.code !== 'Period' &&
        e.code !== 'Tab' && e.code !== 'KeyN' && e.code !== 'KeyT' &&
        e.code !== 'KeyG' && e.code !== 'KeyB' && e.code !== 'KeyC') {
      e.preventDefault();
      return;
    }
  }

  // R — toggle RCS mode.
  if (e.code === 'KeyR') {
    e.preventDefault();
    toggleRcsModeHandler();
    return;
  }

  // Spacebar staging.
  if (e.code === 'Space') {
    e.preventDefault();

    // Block staging in docking/RCS mode.
    if (s.ps.controlMode === ControlMode.DOCKING || s.ps.controlMode === ControlMode.RCS) {
      return;
    }

    // Reset time warp to 1x and lock it out for 2 seconds.
    applyTimeWarp(1);
    s.stagingLockoutUntil = performance.now() + 2_000;
    lockTimeWarp(true);

    if (s.workerActive) {
      workerStage();
    } else {
      fireNextStage(s.ps, s.assembly, s.stagingConfig, s.flightState);
    }
    hideLaunchTip();
    return;
  }

  // < (Comma) — decrease warp one step.
  if (e.code === 'Comma') {
    e.preventDefault();
    const idx = WARP_LEVELS_ORDERED.indexOf(s.timeWarp);
    if (idx > 0) onTimeWarpButtonClick(WARP_LEVELS_ORDERED[idx - 1]);
    return;
  }

  // > (Period) — increase warp one step.
  if (e.code === 'Period') {
    e.preventDefault();
    const idx = WARP_LEVELS_ORDERED.indexOf(s.timeWarp);
    if (idx < WARP_LEVELS_ORDERED.length - 1) onTimeWarpButtonClick(WARP_LEVELS_ORDERED[idx + 1]);
    return;
  }

  // Prevent browser defaults for Shift/Ctrl used as throttle controls.
  if (e.key === 'Shift' || e.key === 'Control') {
    e.preventDefault();
  }

  // In NORMAL orbit mode (not docking/RCS), WASD applies orbital-relative thrust.
  if (!s.mapActive && s.ps.controlMode === ControlMode.NORMAL &&
      (s.flightState.phase === FlightPhase.ORBIT || s.flightState.phase === FlightPhase.MANOEUVRE)) {
    const lower = e.key.toLowerCase();
    if (lower === 'w' || lower === 's' || lower === 'a' || lower === 'd') {
      s.normalOrbitHeldKeys.add(lower);
      return;
    }
  }

  if (s.workerActive) {
    workerKeyDown(e.key);
  }
  handleKeyDown(s.ps, s.assembly, e.key);
}

export function onKeyUp(e: KeyboardEvent): void {
  const s = getFCState();
  if (!s.ps) return;

  // Release map thrust keys.
  if (s.mapActive) {
    const lower = e.key.toLowerCase();
    s.mapHeldKeys.delete(lower);
  }

  // Release normal-orbit WASD keys.
  {
    const lower = e.key.toLowerCase();
    s.normalOrbitHeldKeys.delete(lower);
  }

  if (s.workerActive) {
    workerKeyUp(e.key);
  }
  handleKeyUp(s.ps, e.key);
}
