/**
 * _keyboard.ts — onKeyDown and onKeyUp handlers, warp level constants.
 *
 * @module ui/flightController/_keyboard
 */

import { handleKeyDown, handleKeyUp, setThrustAligned } from '../../core/physics.ts';
import { breakThrustAlignment } from '../../core/grabbing.ts';
import { markThrottleDirty } from './_loop.ts';
import { hideLaunchTip, lockTimeWarp } from '../flightHud.ts';
import {
  sendKeyDown as workerKeyDown,
  sendKeyUp as workerKeyUp,
  sendStage as workerStage,
  resyncWorkerState,
} from './_workerBridge.ts';
import {
  getMapZoomLevel,
  setMapZoomLevel,
  cycleMapTarget,
  getMapTarget,
  toggleMapShadow,
  cycleTransferTarget,
  toggleMapCommsOverlay,
} from '../../render/map.ts';
import {
  isTransferPlanningAvailable,
  getAllowedMapZooms,
} from '../../core/mapView.ts';
import { FlightPhase, ControlMode, DockingState } from '../../core/constants.ts';
import { getFCState, getPhysicsState, getFlightState } from './_state.ts';
import { applyTimeWarp, onTimeWarpButtonClick } from './_timeWarp.ts';
import { toggleMapView, updateMapHud, handleWarpToTarget, handleRenameAsteroid } from './_mapView.ts';
import { cycleDockingTarget, handleUndock, handleFuelTransfer } from './_docking.ts';
import { toggleDockingMode, toggleRcsModeHandler } from './_orbitRcs.ts';
import { showPhaseNotification } from './_flightPhase.ts';
import { togglePerfDashboard } from '../perfDashboard.ts';
import { saveSettings } from '../../core/settingsStore.ts';
import type { PersistedSettings } from '../../core/settingsStore.ts';

/** Ordered warp levels for < / > key stepping. */
export const WARP_LEVELS_ORDERED: number[] = [0, 0.25, 0.5, 1, 2, 5, 10, 50];

export function onKeyDown(e: KeyboardEvent): void {
  const s = getFCState();
  const ps = getPhysicsState();
  const flightState = getFlightState();
  if (!ps || !s.assembly || !s.stagingConfig || !flightState) return;

  // F3 — toggle performance dashboard.
  if (e.code === 'F3') {
    e.preventDefault();
    if (s.state) {
      s.state.showPerfDashboard = !s.state.showPerfDashboard;
      // Persist the change to the dedicated settings key so it survives
      // across saves and save deletions.
      void saveSettings({
        difficultySettings: { ...s.state.difficultySettings },
        autoSaveEnabled:    s.state.autoSaveEnabled,
        debugMode:          s.state.debugMode,
        showPerfDashboard:  s.state.showPerfDashboard,
        malfunctionMode:    s.state.malfunctionMode,
      } as PersistedSettings);
    }
    togglePerfDashboard();
    return;
  }

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
      const tBodyId: string = (flightState && flightState.bodyId) || 'EARTH';
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
      if (flightState) {
        const bodyId: string = flightState.bodyId || 'EARTH';
        const alt: number = Math.max(0, ps.posY);
        const selected = cycleTransferTarget(bodyId, alt, flightState.phase);
        if (selected) {
          showPhaseNotification(`Transfer target: ${selected}`);
        } else {
          showPhaseNotification('Transfer target: none');
        }
        updateMapHud();
      }
      return;
    }
    // R — rename targeted persistent asteroid.
    if (e.code === 'KeyR') {
      const rTargetId = getMapTarget();
      const rTargetObj = rTargetId && s.state
        ? (s.state.orbitalObjects || []).find(o => o.id === rTargetId && o.type === 'asteroid')
        : null;
      if (rTargetObj) {
        e.preventDefault();
        handleRenameAsteroid();
        return;
      }
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
      (ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS)) {
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

  // Y — align thrust through combined CoM (asteroid capture).
  if (e.code === 'KeyY' && !s.mapActive) {
    if (ps.capturedBody !== null) {
      e.preventDefault();
      if (ps.thrustAligned) {
        showPhaseNotification('Thrust already aligned');
      } else {
        setThrustAligned(ps, true);
        resyncWorkerState(ps, s.assembly!, s.stagingConfig!, flightState!).catch(() => {});
        showPhaseNotification('Thrust aligned through CoM');
      }
      return;
    }
  }

  // F — transfer fuel from docked depot.
  if (e.code === 'KeyF' && !s.mapActive && !e.ctrlKey) {
    if (flightState?.dockingState?.state === DockingState.DOCKED) {
      e.preventDefault();
      handleFuelTransfer();
      return;
    }
  }

  // V — toggle docking mode (only in ORBIT phase).
  if (e.code === 'KeyV') {
    e.preventDefault();
    toggleDockingMode();
    // Resync worker so it picks up the controlMode/throttle changes.
    _resyncControlMode(s, ps, flightState);
    return;
  }

  // --- Comms control lockout ---
  if (flightState.commsState?.controlLocked) {
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
    // Resync worker so it picks up the controlMode change.
    _resyncControlMode(s, ps, flightState);
    return;
  }

  // Spacebar staging.
  if (e.code === 'Space') {
    e.preventDefault();

    // Block staging in docking/RCS mode.
    if (ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS) {
      return;
    }

    // Reset time warp to 1x and lock it out for 2 seconds.
    applyTimeWarp(1);
    s.stagingLockoutUntil = performance.now() + 2_000;
    lockTimeWarp(true);

    workerStage();
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
  // Skip when landed — W/S should control throttle, not orbital thrust.
  if (!s.mapActive && !ps.landed && ps.controlMode === ControlMode.NORMAL &&
      (flightState.phase === FlightPhase.ORBIT || flightState.phase === FlightPhase.MANOEUVRE)) {
    const lower = e.key.toLowerCase();
    if (lower === 'w' || lower === 's' || lower === 'a' || lower === 'd') {
      s.normalOrbitHeldKeys.add(lower);
      return;
    }
  }

  // Manual rotation breaks asteroid thrust alignment (TASK-027).
  if ((e.key === 'a' || e.key === 'd' || e.key === 'A' || e.key === 'D' ||
       e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
      ps.capturedBody !== null && ps.thrustAligned) {
    breakThrustAlignment(ps);
    resyncWorkerState(ps, s.assembly!, s.stagingConfig!, flightState!).catch(() => {});
    showPhaseNotification('Thrust alignment lost');
  }

  const prevThrottle = ps.throttle;
  const prevTargetTWR = ps.targetTWR;
  const prevThrottleMode = ps.throttleMode;
  workerKeyDown(e.key);
  handleKeyDown(ps, s.assembly, e.key);
  // If handleKeyDown changed any throttle-related value, mark dirty so the
  // loop sends the override to the worker.  In TWR mode, Shift/W/S change
  // targetTWR (not throttle directly), so check all three fields.
  if (ps.throttle !== prevThrottle || ps.targetTWR !== prevTargetTWR || ps.throttleMode !== prevThrottleMode) {
    markThrottleDirty();
  }
}

export function onKeyUp(e: KeyboardEvent): void {
  const s = getFCState();
  const ps = getPhysicsState();
  if (!ps) return;

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

  workerKeyUp(e.key);
  handleKeyUp(ps, e.key);
}

/**
 * Push the current main-thread state to the worker after a control mode
 * change (V/R keys).  These toggles modify ps.controlMode and ps.throttle
 * on the main thread; the worker needs to see them immediately.
 */
function _resyncControlMode(
  s: ReturnType<typeof getFCState>,
  ps: ReturnType<typeof getPhysicsState>,
  flightState: ReturnType<typeof getFlightState>,
): void {
  if (ps && s.assembly && s.stagingConfig && flightState) {
    resyncWorkerState(ps, s.assembly, s.stagingConfig, flightState).catch(() => {});
  }
}
