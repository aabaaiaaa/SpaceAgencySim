/**
 * _loop.js — The RAF game loop function and related helpers.
 *
 * @module ui/flightController/_loop
 */

import { tick } from '../../core/physics.js';
import { checkObjectiveCompletion } from '../../core/missions.js';
import { checkContractObjectives } from '../../core/contracts.js';
import { checkChallengeObjectives } from '../../core/challenges.js';
import { renderFlightFrame } from '../../render/flight.js';
import { renderMapFrame } from '../../render/map.js';
import { isDebrisTrackingAvailable } from '../../core/mapView.js';
import { getSurfaceItemsAtBody } from '../../core/surfaceOps.js';
import { evaluateComms } from '../../core/comms.js';
import { FlightPhase } from '../../core/constants.js';
import { PartType } from '../../core/constants.js';
import { getPartById } from '../../data/parts.js';
import { getFCState } from './_state.js';
import { checkTimeWarpResets, applyTimeWarp } from './_timeWarp.js';
import { applyMapThrust, updateMapHud } from './_mapView.js';
import { applyNormalOrbitRcs } from './_orbitRcs.js';
import { evaluateFlightPhase } from './_flightPhase.js';
import { tickDockingSystem, updateDockingHud } from './_docking.js';
import { showPostFlightSummary } from './_postFlight.js';

/**
 * Returns true when the assembly contains at least one COMMAND_MODULE part
 * and ALL of them have been removed from `ps.activeParts` (destroyed or
 * separated).  Returns false while the rocket is still on the launch pad
 * or if no command modules were ever present.
 *
 * @returns {boolean}
 */
function _allCommandModulesDestroyed() {
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
 * One animation frame: advance physics, render scene, re-schedule.
 * @param {number} timestamp  Performance.now() value from rAF.
 */
export function loop(timestamp) {
  // Destructure state once at the top of the hot path to avoid repeated
  // getFCState() calls at 60fps.
  const s = getFCState();
  const { ps, assembly, stagingConfig, flightState, state, mapActive, timeWarp } = s;

  // Guard against stale callbacks after stopFlightScene().
  if (!ps || !assembly || !stagingConfig || !flightState) return;

  const realDt = Math.min((timestamp - s.lastTs) / 1000, 0.1);
  s.lastTs = timestamp;

  // Evaluate time-warp reset conditions before advancing physics.
  checkTimeWarpResets(timestamp);

  // When the map is active during non-ORBIT phases, force 1x warp —
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
      altitude: ps.posY + (ps.surfaceAltitude ?? 0),
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

  // Advance physics simulation with the current warp multiplier.
  tick(ps, assembly, stagingConfig, flightState, realDt, s.timeWarp);

  // --- Flight phase state machine: auto-detect transitions each frame ---
  evaluateFlightPhase();

  // --- Docking system tick ---
  tickDockingSystem(realDt);

  // Check mission, contract, and challenge objective completion.
  checkObjectiveCompletion(state, flightState);
  checkContractObjectives(state, flightState);
  checkChallengeObjectives(state, flightState);

  // Render the active scene.
  if (s.mapActive) {
    const mapBodyId = (flightState && flightState.bodyId) || 'EARTH';
    renderMapFrame(ps, flightState, state, mapBodyId, {
      showDebris: isDebrisTrackingAvailable(state),
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
    const shouldAutoTrigger =
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

  // Reschedule unless the loop was cancelled.
  if (s.rafId !== null) {
    s.rafId = requestAnimationFrame(loop);
  }
}
