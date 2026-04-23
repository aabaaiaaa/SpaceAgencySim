// ---------------------------------------------------------------------------
// Top-level physics tick. Extracted from physics.ts.
// ---------------------------------------------------------------------------

import { tickCollisions } from '../collision.ts';
import { tickLandedParachutes } from '../parachute.ts';
import { activateCurrentStage, tickDebris } from '../staging.ts';
import type { FlightState } from '../gameState.ts';
import {
  ANGULAR_VEL_SNAP_THRESHOLD,
  FIXED_DT,
  TILT_SNAP_THRESHOLD,
} from './constants.ts';
import { tickDebrisGround } from './debrisGround.ts';
import { _syncFlightState } from './flightSync.ts';
import {
  _applyGroundedSteering,
  _hasActiveParachutes,
} from './groundedSteering.ts';
import { _integrate } from './integrate.ts';
import type { DebrisState, PhysicsState, RocketAssembly, StagingConfig } from './types.ts';

/**
 * Advance the physics simulation by one real-time frame.
 *
 * Uses a fixed-step accumulator so the simulation is decoupled from the
 * render frame rate.  Pass the real elapsed seconds since the previous call.
 *
 * After this call, `flightState.altitude`, `flightState.velocity`, and
 * `flightState.fuelRemaining` reflect the updated simulation state.
 * New events may have been appended to `flightState.events`.
 */
export function tick(
  ps: PhysicsState,
  assembly: RocketAssembly,
  stagingConfig: StagingConfig,
  flightState: FlightState,
  realDeltaTime: number,
  timeWarp: number = 1,
): void {
  // Allow re-liftoff from a landed state when engines are producing thrust.
  if (ps.landed && ps.firingEngines.size > 0 && ps.throttle > 0) {
    ps.landed = false;
    ps.grounded = true;
  }

  if (ps.crashed || flightState.aborted) return;

  // When landed: run tipping physics and/or parachute post-landing swing.
  if (ps.landed) {
    const left  = ps._heldKeys.has('a') || ps._heldKeys.has('ArrowLeft');
    const right = ps._heldKeys.has('d') || ps._heldKeys.has('ArrowRight');
    let needsTipping = ps.isTipping || left || right ||
      Math.abs(ps.angle) > TILT_SNAP_THRESHOLD ||
      Math.abs(ps.angularVelocity) > ANGULAR_VEL_SNAP_THRESHOLD;
    if (!needsTipping && (ps.angle !== 0 || ps.angularVelocity !== 0)) {
      ps.angle *= 0.9;
      ps.angularVelocity *= 0.85;
      ps.isTipping = false;
      if (Math.abs(ps.angle) < 1e-4 && Math.abs(ps.angularVelocity) < 1e-4) {
        ps.angle = 0;
        ps.angularVelocity = 0;
        ps._contactCX = undefined;
        ps._contactCY = undefined;
      }
    }
    const needsParachuteTick = _hasActiveParachutes(ps);

    if (needsTipping || needsParachuteTick) {
      ps._accumulator += realDeltaTime * timeWarp;
      while (ps._accumulator >= FIXED_DT) {
        ps._accumulator -= FIXED_DT;
        if (needsTipping) {
          _applyGroundedSteering(ps, assembly, left, right, FIXED_DT);
        }
        if (needsParachuteTick) {
          tickLandedParachutes(ps, FIXED_DT);
        }
        flightState.timeElapsed += FIXED_DT;

        for (const debris of ps.debris) {
          tickDebris(debris, assembly, FIXED_DT);
          if (debris.landed && !debris.crashed) tickDebrisGround(debris, assembly, FIXED_DT, flightState?.bodyId);
        }
        tickCollisions(ps, assembly, FIXED_DT);

        if (ps.crashed) break;
      }
      if (ps._accumulator > FIXED_DT * 10) {
        ps._accumulator = FIXED_DT * 10;
      }
      _syncFlightState(ps, assembly, flightState);
    }
    return;
  }

  ps._accumulator += realDeltaTime * timeWarp;

  while (ps._accumulator >= FIXED_DT) {
    ps._accumulator -= FIXED_DT;
    _integrate(ps, assembly, flightState);
    flightState.timeElapsed += FIXED_DT;

    for (const debris of ps.debris) {
      tickDebris(debris, assembly, FIXED_DT);
      if (debris.landed && !debris.crashed) tickDebrisGround(debris, assembly, FIXED_DT, flightState?.bodyId);
    }
    tickCollisions(ps, assembly, FIXED_DT);

    if (ps.landed || ps.crashed) break;
  }

  if (ps._accumulator > FIXED_DT * 10) {
    ps._accumulator = FIXED_DT * 10;
  }

  _syncFlightState(ps, assembly, flightState);
}

/**
 * Fire the next stage (called when the player presses Spacebar).
 *
 * Delegates to {@link activateCurrentStage} which activates each
 * part in the current stage and creates DebrisState objects for any
 * rocket sections that become disconnected after a decoupler fires.  Newly
 * created debris fragments are appended to `ps.debris` so they are simulated
 * on every subsequent {@link tick}.
 */
export function fireNextStage(
  ps: PhysicsState,
  assembly: RocketAssembly,
  stagingConfig: StagingConfig,
  flightState: FlightState,
): void {
  if (ps.crashed || flightState.aborted) return;

  if (ps.landed) {
    ps.landed = false;
    ps.grounded = true;
  }

  const newDebris: DebrisState[] = activateCurrentStage(ps, assembly, stagingConfig, flightState);
  ps.debris.push(...newDebris);

  // If staging produced debris (decouple/release) and we're in stable-orbit
  // analytical propagation, the separation impulse just applied to ps.velX/velY
  // would be clobbered by the next tick reading stale orbitalElements. Drop
  // them so tickOrbitPhase recomputes from the post-impulse velocity.
  if (newDebris.length > 0 && flightState.orbitalElements) {
    flightState.orbitalElements = null;
  }
}
