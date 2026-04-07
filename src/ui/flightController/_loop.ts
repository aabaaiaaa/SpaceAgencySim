/**
 * _loop.ts — The RAF game loop function and related helpers.
 *
 * Supports two physics modes:
 *   1. **Main-thread** (default fallback): calls `tick()` directly each frame.
 *   2. **Web Worker**: sends a `tick` command to the physics worker and
 *      applies the returned snapshot to the local state for rendering.
 *
 * The active mode is determined by `FCState.workerActive`.  On worker error
 * the loop automatically falls back to main-thread physics.
 *
 * @module ui/flightController/_loop
 */

import { tick } from '../../core/physics.ts';
import { checkObjectiveCompletion } from '../../core/missions.ts';
import { checkContractObjectives } from '../../core/contracts.ts';
import { checkChallengeObjectives } from '../../core/challenges.ts';
import { renderFlightFrame } from '../../render/flight.ts';
import { renderMapFrame } from '../../render/map.ts';
import { isDebrisTrackingAvailable } from '../../core/mapView.ts';
import { getSurfaceItemsAtBody } from '../../core/surfaceOps.ts';
import { evaluateComms } from '../../core/comms.ts';
import { FlightPhase } from '../../core/constants.ts';
import { PartType } from '../../core/constants.ts';
import { getPartById } from '../../data/parts.ts';
import { getPhaseLabel } from '../../core/flightPhase.ts';
import { getOrbitEntryLabel, checkOrbitStatus } from '../../core/orbit.ts';
import { getFCState } from './_state.ts';
import { recordFrame } from '../fpsMonitor.ts';
import { logger } from '../../core/logger.ts';
import { checkTimeWarpResets, applyTimeWarp } from './_timeWarp.ts';
import { applyMapThrust, updateMapHud } from './_mapView.ts';
import { applyNormalOrbitRcs } from './_orbitRcs.ts';
import { evaluateFlightPhase, showPhaseNotification } from './_flightPhase.ts';
import { tickDockingSystem, updateDockingHud } from './_docking.ts';
import { showPostFlightSummary } from './_postFlight.ts';
import { handleAbortReturnToAgency } from './_menuActions.ts';
import {
  isWorkerReady,
  hasWorkerError,
  consumeMainThreadSnapshot,
  sendTick,
  sendThrottle,
  sendAngle,
  applyPhysicsSnapshot,
  applyFlightSnapshot,
  terminatePhysicsWorker,
} from './_workerBridge.ts';
import { createSnapshotFromState } from '../../core/snapshotFactory.ts';
import type { MainThreadSnapshot } from '../../core/physicsWorkerProtocol.ts';
import type { PhysicsSnapshot } from '../../core/physicsWorkerProtocol.ts';

/** Maximum consecutive loop errors before showing the abort banner. */
export const MAX_CONSECUTIVE_LOOP_ERRORS: number = 5;

/** Monotonic frame counter for the main-thread fallback snapshot path. */
let _fallbackFrame = 0;

/**
 * Returns true when the assembly contains at least one COMMAND_MODULE part
 * and ALL of them have been removed from `ps.activeParts` (destroyed or
 * separated).  Returns false while the rocket is still on the launch pad
 * or if no command modules were ever present.
 */
function _allCommandModulesDestroyed(): boolean {
  const s = getFCState();
  if (!s.assembly || !s.ps) return false;

  let hadCommandModule = false;

  for (const [instanceId, placed] of s.assembly.parts) {
    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.COMMAND_MODULE) continue;

    hadCommandModule = true;
    if (s.ps.activeParts.has(instanceId)) {
      return false;
    }
  }

  return hadCommandModule;
}

/**
 * When a worker snapshot causes a flight-phase change, show the appropriate
 * UI notification.  This mirrors the logic in `evaluateFlightPhase()` but
 * is driven by comparing the previous and current phases rather than by the
 * return value of `evaluateAutoTransitions()`.
 *
 * Reads position and body data from the snapshot rather than mutable FCState.
 */
function _handleWorkerPhaseTransition(
  prevPhase: string,
  newPhase: string,
  snap: MainThreadSnapshot,
): void {
  if (newPhase === FlightPhase.ORBIT) {
    const bodyId = snap.flight.bodyId || 'EARTH';
    const orbitStatus = checkOrbitStatus(
      snap.physics.posX, snap.physics.posY,
      snap.physics.velX, snap.physics.velY,
      bodyId,
    );
    if (orbitStatus) {
      showPhaseNotification(getOrbitEntryLabel(orbitStatus));
    } else {
      showPhaseNotification(getPhaseLabel(newPhase));
    }
  } else if (newPhase === FlightPhase.MANOEUVRE) {
    showPhaseNotification('Manoeuvre');
    applyTimeWarp(1);
  } else if (newPhase === FlightPhase.TRANSFER) {
    showPhaseNotification('Transfer Injection');
    applyTimeWarp(1);
  } else if (newPhase === FlightPhase.CAPTURE) {
    showPhaseNotification(`Entering ${snap.flight.bodyId || 'destination'} SOI`);
    applyTimeWarp(1);
  } else if (newPhase === FlightPhase.REENTRY) {
    showPhaseNotification('Re-Entry');
    applyTimeWarp(1);
  } else {
    showPhaseNotification(getPhaseLabel(newPhase));
  }
}

/**
 * Fall back from worker physics to main-thread physics.
 * Called when the worker encounters an error.
 */
function _fallbackToMainThread(): void {
  const s = getFCState();
  if (!s.workerActive) return;

  logger.warn('flightLoop', 'Falling back to main-thread physics (worker error)');
  s.workerActive = false;
  terminatePhysicsWorker();
}

/**
 * One animation frame: advance physics, render scene, re-schedule.
 */
export function loop(timestamp: number): void {
  // Destructure state once at the top of the hot path to avoid repeated
  // getFCState() calls at 60fps.
  const s = getFCState();
  const { ps, assembly, stagingConfig, flightState, state } = s;

  // Guard against stale callbacks after stopFlightScene().
  if (!ps || !assembly || !stagingConfig || !flightState) return;

  const realDt: number = Math.min((timestamp - (s.lastTs as number)) / 1000, 0.1);
  s.lastTs = timestamp;

  // Feed frame timing to the FPS monitor (no-ops if not initialised).
  recordFrame(realDt * 1000, timestamp);

  // Detect worker error and fall back to main-thread physics.
  if (s.workerActive && hasWorkerError()) {
    _fallbackToMainThread();
  }

  try {
    // ---- Worker snapshot application (FIRST) ----
    // Consume the readonly snapshot from the worker BEFORE any per-frame
    // control processing.  This ensures control inputs (keyboard, HUD
    // buttons, comms lockout, map thrust, orbit RCS) operate on the latest
    // physics state and are not overwritten by a stale snapshot.
    if (s.workerActive && isWorkerReady()) {
      const snap = consumeMainThreadSnapshot();
      if (snap) {
        const prevPhase = flightState.phase;

        // Temporary: apply snapshot to mutable state for render compatibility.
        // The worker snapshot includes control input fields at runtime even
        // though ReadonlyPhysicsSnapshot hides them via Omit<>.  The cast is
        // safe and will be removed when render functions accept snapshot types
        // directly (TASK-013a/b).
        applyPhysicsSnapshot(ps, snap.physics as unknown as PhysicsSnapshot);
        applyFlightSnapshot(flightState, snap.flight);

        // Detect phase transition from snapshot values (not mutable state).
        if (snap.flight.phase !== prevPhase) {
          _handleWorkerPhaseTransition(prevPhase, snap.flight.phase, snap);
        }
      }
    }

    // Evaluate time-warp reset conditions before advancing physics.
    checkTimeWarpResets(timestamp);

    // When the map is active during non-ORBIT phases, force 1x warp --
    // EXCEPT during TRANSFER and CAPTURE phases where time warp is allowed.
    if (s.mapActive &&
        flightState.phase !== FlightPhase.ORBIT &&
        flightState.phase !== FlightPhase.TRANSFER &&
        flightState.phase !== FlightPhase.CAPTURE) {
      if (s.timeWarp !== 1) applyTimeWarp(1);
    }

    // --- Communication range evaluation ---
    if (flightState && state) {
      const comms = evaluateComms(state, flightState, ps ? {
        altitude: ps.posY,
        posX: ps.posX,
        posY: ps.posY,
      } : undefined);
      flightState.commsState = comms;
      if (comms.controlLocked) {
        ps.throttle = 0;
      }
    }

    // Apply orbital-relative thrust when the map view is active.
    if (!(flightState.commsState?.controlLocked)) {
      applyMapThrust();
    }

    // Apply orbital-relative thrust from WASD in NORMAL orbit mode (flight view).
    if (!(flightState.commsState?.controlLocked)) {
      applyNormalOrbitRcs();
    }

    // Reset per-frame science flag before sub-steps.
    flightState.scienceModuleRunning = false;

    // ---- Physics tick: worker or main-thread ----
    if (s.workerActive && isWorkerReady()) {
      // Sync throttle to worker — main thread is the authority for throttle
      // (captures HUD buttons, keyboard events, comms lockout).
      sendThrottle(ps.throttle);

      // Sync angle to worker only when orbital thrust overrides the normal
      // rotation (map thrust or orbit RCS compute orbital-relative angles).
      // During normal flight, the worker handles A/D key rotation internally.
      if (s.mapThrusting || s.normalOrbitThrusting) {
        sendAngle(ps.angle);
      }

      // Send tick command to worker.
      sendTick(realDt, s.timeWarp);

      // Run supplementary flight-phase logic that is UI-only:
      // orbit recalculation for map rendering, control mode resets.
      // Skip evaluateAutoTransitions (worker already handled it).
      evaluateFlightPhase(true);
    } else {
      // Main-thread physics — direct tick.
      tick(ps, assembly, stagingConfig, flightState, realDt, s.timeWarp);

      // Create a readonly snapshot in the same format as the worker path.
      // This ensures both paths produce MainThreadSnapshot, giving render/UI
      // a single code path once they migrate to snapshot types (TASK-013a/b).
      createSnapshotFromState(ps, flightState, _fallbackFrame++);

      evaluateFlightPhase();
    }

    // --- Docking system tick ---
    tickDockingSystem(realDt);

    // Check mission, contract, and challenge objective completion.
    checkObjectiveCompletion(state!, flightState);
    checkContractObjectives(state!, flightState);
    checkChallengeObjectives(state!, flightState);

    // Render the active scene.
    if (s.mapActive) {
      const mapBodyId: string = (flightState && flightState.bodyId) || 'EARTH';
      renderMapFrame(ps, flightState, state!, mapBodyId, {
        showDebris: isDebrisTrackingAvailable(state!),
      });
    } else {
      const _surfItems = state ? getSurfaceItemsAtBody(state, flightState.bodyId) : [];
      renderFlightFrame(ps, assembly, flightState, _surfItems);
    }

    // Update the map HUD readouts if visible.
    if (s.mapActive) updateMapHud();

    // Update the docking guidance HUD if active.
    updateDockingHud();

    // Auto-trigger the post-flight summary when the rocket crashes, all
    // command modules are destroyed, or the craft lands safely.
    if (!s.summaryShown) {
      const shouldAutoTrigger: boolean =
        ps.crashed ||
        _allCommandModulesDestroyed() ||
        (ps.landed && ps.grounded && !ps.crashed);
      if (shouldAutoTrigger) {
        s.summaryShown = true;
        showPostFlightSummary(
          ps, assembly, flightState, state, s.onFlightEnd,
        );
      }
    }

    // Successful frame -- reset error counter.
    s.loopConsecutiveErrors = 0;
  } catch (err) {
    s.loopConsecutiveErrors++;
    logger.error('flightLoop', `Error (${s.loopConsecutiveErrors} consecutive)`, { error: String(err) });
    if (s.loopConsecutiveErrors >= MAX_CONSECUTIVE_LOOP_ERRORS && !s.loopErrorBanner) {
      _showLoopErrorBanner(s);
    }
  }

  // Reschedule unless the loop was cancelled.
  if (s.rafId !== null) {
    s.rafId = requestAnimationFrame(loop);
  }
}

/**
 * Show an error banner offering the player a way to abort to the hub.
 * Matches the pattern used in flightHud.js.
 */
function _showLoopErrorBanner(s: ReturnType<typeof getFCState>): void {
  const host: HTMLElement = s.container ?? document.body;
  if (s.loopErrorBanner) return;

  const banner: HTMLDivElement = document.createElement('div');
  banner.dataset.testid = 'loop-error-banner';
  banner.className = 'error-banner';

  const msg: HTMLParagraphElement = document.createElement('p');
  msg.className = 'error-banner-msg';
  msg.textContent = 'The flight simulation encountered repeated errors. You can try to continue or abort to the hub.';
  banner.appendChild(msg);

  const btnRow: HTMLDivElement = document.createElement('div');
  btnRow.className = 'error-banner-buttons';

  const continueBtn: HTMLButtonElement = document.createElement('button');
  continueBtn.textContent = 'Try to Continue';
  continueBtn.className = 'error-banner-btn-continue';
  continueBtn.addEventListener('click', () => {
    s.loopConsecutiveErrors = 0;
    if (s.loopErrorBanner) { s.loopErrorBanner.remove(); s.loopErrorBanner = null; }
  });

  const abortBtn: HTMLButtonElement = document.createElement('button');
  abortBtn.textContent = 'Abort to Hub';
  abortBtn.dataset.testid = 'loop-error-abort-btn';
  abortBtn.className = 'error-banner-btn-abort';
  abortBtn.addEventListener('click', () => {
    if (s.loopErrorBanner) { s.loopErrorBanner.remove(); s.loopErrorBanner = null; }
    handleAbortReturnToAgency();
  });

  btnRow.appendChild(continueBtn);
  btnRow.appendChild(abortBtn);
  banner.appendChild(btnRow);
  host.appendChild(banner);
  s.loopErrorBanner = banner;
}
