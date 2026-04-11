/**
 * _loop.ts — The RAF game loop function and related helpers.
 *
 * Physics runs exclusively in a Web Worker.  Each frame the loop sends a
 * `tick` command to the worker and applies the returned snapshot to the
 * local state for rendering.
 *
 * @module ui/flightController/_loop
 */

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
import { getFCState, getPhysicsState, getFlightState } from './_state.ts';
import { recordFrame } from '../fpsMonitor.ts';
import { beginFrame as perfBeginFrame, endFrame as perfEndFrame } from '../../core/perfMonitor.ts';
import { logger } from '../../core/logger.ts';
import { checkTimeWarpResets, applyTimeWarp } from './_timeWarp.ts';
import { applyMapThrust, updateMapHud } from './_mapView.ts';
import { applyNormalOrbitRcs } from './_orbitRcs.ts';
import { evaluateFlightPhase, showPhaseNotification } from './_flightPhase.ts';
import { tickDockingSystem, updateDockingHud } from './_docking.ts';
import { checkHubDocking } from './_hubDocking.ts';
import { showPostFlightSummary } from './_postFlight.ts';
import { handleAbortReturnToAgency } from './_menuActions.ts';
import {
  isWorkerReady,
  hasWorkerError,
  getWorkerErrorMessage,
  consumeMainThreadSnapshot,
  sendTick,
  sendThrottle,
  sendAngle,
} from './_workerBridge.ts';
import type { MainThreadSnapshot } from '../../core/physicsWorkerProtocol.ts';

/** Maximum consecutive loop errors before showing the abort banner. */
export const MAX_CONSECUTIVE_LOOP_ERRORS: number = 5;

/**
 * When true, the main thread has changed throttle this frame (keyboard,
 * HUD button, comms lockout).  The loop will send the override to the
 * worker and skip syncing throttle from the snapshot.
 */
let _throttleDirty = false;

/** Called by the keyboard handler and HUD when throttle is changed locally. */
export function markThrottleDirty(): void { _throttleDirty = true; }

/**
 * Sync a worker snapshot's scalar values back to the mutable PhysicsState and
 * FlightState objects.  This keeps the local mutable state current for:
 *  - Loop-internal reads (comms evaluation, post-flight auto-trigger, etc.)
 *  - E2E test access via `window.__flightPs` / `window.__flightState`
 *
 * Angle and throttle ARE synced from the worker because the worker computes
 * angle from A/D key rotation and throttle from TWR mode.  The main thread
 * sends overrides (keyboard throttle changes, map/orbit angle overrides)
 * via sendThrottle/sendAngle each frame AFTER the sync, so the worker
 * always receives the latest main-thread intent.
 */
function _syncSnapshotToMutableState(
  snap: MainThreadSnapshot,
  ps: ReturnType<typeof getPhysicsState>,
  fs: ReturnType<typeof getFlightState>,
): void {
  if (!ps || !fs) return;

  // The worker snapshot includes control input fields (angle, throttle, etc.)
  // at runtime even though ReadonlyPhysicsSnapshot strips them via Omit<>.
  // We need angle because the worker computes rotation from A/D keys.
  const fullSnap = snap.physics as import('../../core/physicsWorkerProtocol.ts').PhysicsSnapshot;

  // Physics scalars — includes control inputs (angle, throttle, throttleMode,
  // targetTWR) which the worker may compute/modify (e.g. TWR mode, A/D rotation).
  ps.posX = snap.physics.posX;
  ps.posY = snap.physics.posY;
  ps.velX = snap.physics.velX;
  ps.velY = snap.physics.velY;
  ps.angle = fullSnap.angle;
  // Sync throttle from worker only when the main thread hasn't overridden it
  // this frame (keyboard, HUD button, comms lockout).  The worker computes
  // throttle from TWR mode and needs to flow that back.
  if (!_throttleDirty) {
    ps.throttle = fullSnap.throttle;
    ps.throttleMode = fullSnap.throttleMode;
    ps.targetTWR = fullSnap.targetTWR;
  }
  ps.landed = snap.physics.landed;
  ps.crashed = snap.physics.crashed;
  ps.grounded = snap.physics.grounded;
  ps.angularVelocity = snap.physics.angularVelocity;
  ps.isTipping = snap.physics.isTipping;
  ps.tippingContactX = snap.physics.tippingContactX;
  ps.tippingContactY = snap.physics.tippingContactY;
  ps.controlMode = snap.physics.controlMode;
  ps.baseOrbit = snap.physics.baseOrbit;
  ps.hasLaunchClamps = snap.physics.hasLaunchClamps;
  ps.weatherIspModifier = snap.physics.weatherIspModifier;

  // Docking fields
  ps.dockingAltitudeBand = snap.physics.dockingAltitudeBand;
  ps.dockingOffsetAlongTrack = snap.physics.dockingOffsetAlongTrack;
  ps.dockingOffsetRadial = snap.physics.dockingOffsetRadial;

  // Collections — rebuild from serialised form
  ps.firingEngines = new Set(snap.physics.firingEngines);
  ps.activeParts = new Set(snap.physics.activeParts);
  ps.deployedParts = new Set(snap.physics.deployedParts);
  ps.rcsActiveDirections = new Set(snap.physics.rcsActiveDirections);
  ps.ejectedCrewIds = new Set(snap.physics.ejectedCrewIds);
  ps.ejectedCrew = snap.physics.ejectedCrew;
  ps.fuelStore = new Map(Object.entries(snap.physics.fuelStore));
  ps.heatMap = new Map(Object.entries(snap.physics.heatMap).map(([k, v]) => [k, Number(v)]));
  ps.parachuteStates = new Map(Object.entries(snap.physics.parachuteStates));
  ps.legStates = new Map(Object.entries(snap.physics.legStates));
  ps.ejectorStates = new Map(Object.entries(snap.physics.ejectorStates));
  ps.instrumentStates = new Map(Object.entries(snap.physics.instrumentStates)) as typeof ps.instrumentStates;
  ps.scienceModuleStates = new Map(Object.entries(snap.physics.scienceModuleStates)) as typeof ps.scienceModuleStates;
  ps.dockingPortStates = new Map(Object.entries(snap.physics.dockingPortStates));
  ps.powerState = snap.physics.powerState;
  ps.capturedBody = snap.physics.capturedBody;
  ps.thrustAligned = snap.physics.thrustAligned;
  ps.malfunctions = snap.physics.malfunctions
    ? new Map(Object.entries(snap.physics.malfunctions))
    : ps.malfunctions;

  // Debris — rebuild Sets/Maps from serialised form so E2E tests and
  // render code can access them via window.__flightPs.debris.
  ps.debris = snap.physics.debris.map(d => ({
    id: d.id,
    activeParts: new Set(d.activeParts),
    firingEngines: new Set(d.firingEngines),
    fuelStore: new Map(Object.entries(d.fuelStore)),
    deployedParts: new Set(d.deployedParts),
    parachuteStates: new Map(Object.entries(d.parachuteStates)),
    legStates: new Map(Object.entries(d.legStates)),
    heatMap: new Map(Object.entries(d.heatMap).map(([k, v]) => [k, Number(v)])),
    posX: d.posX,
    posY: d.posY,
    velX: d.velX,
    velY: d.velY,
    angle: d.angle,
    throttle: d.throttle,
    angularVelocity: d.angularVelocity,
    isTipping: d.isTipping,
    tippingContactX: d.tippingContactX,
    tippingContactY: d.tippingContactY,
    landed: d.landed,
    crashed: d.crashed,
  }));

  // Flight state scalars
  fs.phase = snap.flight.phase;
  fs.timeElapsed = snap.flight.timeElapsed;
  fs.altitude = snap.flight.altitude;
  fs.velocity = snap.flight.velocity;
  fs.fuelRemaining = snap.flight.fuelRemaining;
  fs.deltaVRemaining = snap.flight.deltaVRemaining;
  fs.aborted = snap.flight.aborted;
  fs.inOrbit = snap.flight.inOrbit;
  fs.orbitalElements = snap.flight.orbitalElements;
  fs.bodyId = snap.flight.bodyId;
  fs.orbitBandId = snap.flight.orbitBandId;
  fs.currentBiome = snap.flight.currentBiome;
  fs.maxAltitude = snap.flight.maxAltitude;
  fs.maxVelocity = snap.flight.maxVelocity;
  fs.dockingState = snap.flight.dockingState;
  fs.transferState = snap.flight.transferState;

  // Sync arrays — the worker mutates phaseLog and events during phase
  // transitions and objective evaluation.
  fs.phaseLog = snap.flight.phaseLog;
  fs.events = snap.flight.events;
  fs.biomesVisited = snap.flight.biomesVisited;
  fs.crewIds = snap.flight.crewIds;

  // Power and comms state
  fs.powerState = snap.flight.powerState ?? fs.powerState;
  fs.commsState = snap.flight.commsState ?? fs.commsState;

  // Science / crew fields mutated by the worker's tick
  fs.crewCount = snap.flight.crewCount;
  fs.scienceModuleRunning = snap.flight.scienceModuleRunning ?? fs.scienceModuleRunning;
  fs.hasScienceModules = snap.flight.hasScienceModules ?? fs.hasScienceModules;

  // Staging index — keep main-thread stagingConfig in sync with the worker
  // so that resyncs and UI display the correct stage.
  const s = getFCState();
  if (s.stagingConfig && snap.currentStageIdx !== undefined) {
    s.stagingConfig.currentStageIdx = snap.currentStageIdx;
  }
}

/**
 * Returns true when the assembly contains at least one COMMAND_MODULE part
 * and ALL of them have been removed from `ps.activeParts` (destroyed or
 * separated).  Returns false while the rocket is still on the launch pad
 * or if no command modules were ever present.
 */
function _allCommandModulesDestroyed(): boolean {
  const s = getFCState();
  const ps = getPhysicsState();
  if (!s.assembly || !ps) return false;

  let hadCommandModule = false;

  for (const [instanceId, placed] of s.assembly.parts) {
    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.COMMAND_MODULE) continue;

    hadCommandModule = true;
    if (ps.activeParts.has(instanceId)) {
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
 * One animation frame: advance physics, render scene, re-schedule.
 */
export function loop(timestamp: number): void {
  // Mark the start of this frame for the performance monitor.
  perfBeginFrame();

  // Destructure state once at the top of the hot path to avoid repeated
  // getFCState() calls at 60fps.
  const s = getFCState();
  const ps = getPhysicsState();
  const flightState = getFlightState();
  const { assembly, stagingConfig, state } = s;

  // Guard against stale callbacks after stopFlightScene().
  if (!ps || !assembly || !stagingConfig || !flightState) return;

  const realDt: number = Math.min((timestamp - (s.lastTs as number)) / 1000, 0.1);
  s.lastTs = timestamp;

  // Feed frame timing to the FPS monitor (no-ops if not initialised).
  recordFrame(realDt * 1000, timestamp);

  // Detect worker error and show error banner.
  if (hasWorkerError() && !s.loopErrorBanner) {
    logger.error('flightLoop', 'Physics worker error', { error: getWorkerErrorMessage() });
    _showLoopErrorBanner(s);
  }

  try {
    // ---- Worker snapshot application (FIRST) ----
    // Consume the readonly snapshot from the worker BEFORE any per-frame
    // control processing.  This ensures control inputs (keyboard, HUD
    // buttons, comms lockout, map thrust, orbit RCS) operate on the latest
    // physics state and are not overwritten by a stale snapshot.
    if (isWorkerReady()) {
      const snap = consumeMainThreadSnapshot();
      if (snap) {
        const prevPhase = flightState.phase;

        // Sync snapshot values to the mutable state objects so that
        // downstream loop logic (comms, post-flight, rendering) and
        // E2E test globals (window.__flightPs) see current values.
        _syncSnapshotToMutableState(snap, ps, flightState);

        // Detect phase transition from snapshot values.
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
        _throttleDirty = true;
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

    // ---- Physics tick (Web Worker) ----
    if (isWorkerReady()) {
      // Send throttle to worker only when the main thread changed it
      // (keyboard, HUD button, comms lockout).  Otherwise the worker's
      // own computation (e.g. TWR mode) stays in effect.
      if (_throttleDirty) {
        sendThrottle(ps.throttle, ps.throttleMode, ps.targetTWR);
        _throttleDirty = false;
      }

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
    }

    // --- Docking system tick ---
    tickDockingSystem(realDt);

    // --- Hub docking proximity check ---
    if (state && flightState) {
      checkHubDocking(state, ps, flightState);
    }

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

  // Mark the end of this frame for the performance monitor.
  perfEndFrame();

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
