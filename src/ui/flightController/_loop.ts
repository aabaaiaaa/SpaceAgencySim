/**
 * _loop.ts — The RAF game loop function and related helpers.
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
import { recordFrame } from '../fpsMonitor.js';
import { checkTimeWarpResets, applyTimeWarp } from './_timeWarp.js';
import { applyMapThrust, updateMapHud } from './_mapView.js';
import { applyNormalOrbitRcs } from './_orbitRcs.js';
import { evaluateFlightPhase } from './_flightPhase.js';
import { tickDockingSystem, updateDockingHud } from './_docking.js';
import { showPostFlightSummary } from './_postFlight.js';
import { handleAbortReturnToAgency } from './_menuActions.js';

/** Maximum consecutive loop errors before showing the abort banner. */
export const MAX_CONSECUTIVE_LOOP_ERRORS: number = 5;

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

  try {
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
        altitude: ps.posY + ((ps as any).surfaceAltitude ?? 0),
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
    (flightState as any).scienceModuleRunning = false;

    // Advance physics simulation with the current warp multiplier.
    tick(ps, assembly, stagingConfig, flightState, realDt, s.timeWarp);

    // --- Flight phase state machine: auto-detect transitions each frame ---
    evaluateFlightPhase();

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
    console.error(`[Flight Loop] Error (${s.loopConsecutiveErrors} consecutive):`, err);
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
  banner.style.cssText =
    'position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);' +
    'background:rgba(30,10,10,0.95);border:2px solid #ff4444;border-radius:8px;' +
    'padding:20px 28px;z-index:9999;text-align:center;color:#fff;' +
    'font-family:inherit;max-width:400px;';

  const msg: HTMLParagraphElement = document.createElement('p');
  msg.style.cssText = 'margin:0 0 16px 0;font-size:1rem;line-height:1.4;';
  msg.textContent = 'The flight simulation encountered repeated errors. You can try to continue or abort to the hub.';
  banner.appendChild(msg);

  const btnRow: HTMLDivElement = document.createElement('div');
  btnRow.style.cssText = 'display:flex;gap:12px;justify-content:center;';

  const continueBtn: HTMLButtonElement = document.createElement('button');
  continueBtn.textContent = 'Try to Continue';
  continueBtn.style.cssText =
    'padding:8px 16px;border:1px solid #888;border-radius:4px;' +
    'background:#333;color:#fff;cursor:pointer;font-size:0.9rem;';
  continueBtn.addEventListener('click', () => {
    s.loopConsecutiveErrors = 0;
    if (s.loopErrorBanner) { s.loopErrorBanner.remove(); s.loopErrorBanner = null; }
  });

  const abortBtn: HTMLButtonElement = document.createElement('button');
  abortBtn.textContent = 'Abort to Hub';
  abortBtn.dataset.testid = 'loop-error-abort-btn';
  abortBtn.style.cssText =
    'padding:8px 16px;border:1px solid #ff4444;border-radius:4px;' +
    'background:#882222;color:#fff;cursor:pointer;font-size:0.9rem;';
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
