// ---------------------------------------------------------------------------
// Continuous steering — airborne A/D torque, parachute pendulum torque and
// damping, captured-asteroid torque, and aero / RCS angular damping.
//
// When the craft is grounded or landed we delegate to the tipping physics in
// _applyGroundedSteering (kept in physics.ts for now). Parachute torque and
// parachute damping remain here with the rest of the steering pipeline to
// avoid fragmenting parachute handling further.
// ---------------------------------------------------------------------------

import { ControlMode } from '../constants.ts';
import { LOW_DENSITY_THRESHOLD } from '../parachute.ts';

import type { FlightState } from '../gameState.ts';
import type {
  PhysicsState,
  RocketAssembly,
  Point2D,
} from '../physics.ts';
import {
  _computeCoMLocal,
  _computeMomentOfInertia,
  _densityForBody,
  _atmosphereTopForBody,
  _getMaxCrewSkill,
  _computeParachuteTorque,
  _computeAsteroidTorque,
  _applyGroundedSteering,
} from '../physics.ts';

import {
  RCS_TORQUE_MULTIPLIER,
  hasRcs,
  applyRcsAngularDamping,
} from './rcs.ts';

/** N·m of torque applied by player A/D input while airborne. */
const PLAYER_FLIGHT_TORQUE: number = 2000;
/** Angular damping coefficient in atmosphere (proportional to density). */
const AERO_ANGULAR_DAMPING: number = 0.02;
/** Angular velocity decay rate (1/s) for deployed parachutes. */
const CHUTE_DIRECT_DAMPING: number = 5.0;
/** Maximum angular acceleration (rad/s²) from player input. */
const MAX_PLAYER_ANGULAR_ACCEL: number = 2.0;
/** Maximum angular acceleration (rad/s²) from parachute torques. */
const MAX_CHUTE_ANGULAR_ACCEL: number = 50.0;

export function applySteering(
  ps: PhysicsState,
  assembly: RocketAssembly,
  altitude: number,
  dt: number,
  bodyId: string | undefined,
  flightState: FlightState,
  thrustMagnitude: number = 0,
): void {
  // In RCS mode, rotation is disabled.
  if (ps.controlMode === ControlMode.RCS) return;

  // In DOCKING mode, A/D don't rotate — they're handled by _applyDockingMovement.
  if (ps.controlMode === ControlMode.DOCKING) return;

  const left: boolean  = ps._heldKeys.has('a') || ps._heldKeys.has('ArrowLeft');
  const right: boolean = ps._heldKeys.has('d') || ps._heldKeys.has('ArrowRight');

  // Grounded or landed: delegate to tipping physics (always runs for gravity torque).
  if (ps.grounded || ps.landed) {
    _applyGroundedSteering(ps, assembly, left, right, dt, bodyId);
    return;
  }

  // --- Airborne torque-based rotation ---
  const com: Point2D = _computeCoMLocal(ps, assembly);
  const I: number = _computeMomentOfInertia(ps, assembly, com);
  const density: number = _densityForBody(Math.max(0, ps.posY), bodyId);
  const speed: number   = Math.hypot(ps.velX, ps.velY);
  const atmoTop: number = _atmosphereTopForBody(bodyId);

  // Player input torque — compute angular acceleration and cap it so light
  // rockets don't spin uncontrollably.
  // Piloting skill bonus: up to +30% torque at max skill.
  const pilotingSkill: number = _getMaxCrewSkill(ps, flightState, 'piloting');
  const pilotingBonus: number = 1 + (pilotingSkill / 100) * 0.3;
  let baseTorque: number = PLAYER_FLIGHT_TORQUE * pilotingBonus;
  if (altitude > atmoTop && hasRcs(ps, assembly)) {
    baseTorque *= RCS_TORQUE_MULTIPLIER;
  }
  let playerAlpha = 0;
  if (right) playerAlpha += baseTorque / I;
  if (left)  playerAlpha -= baseTorque / I;
  playerAlpha = Math.max(-MAX_PLAYER_ANGULAR_ACCEL, Math.min(MAX_PLAYER_ANGULAR_ACCEL, playerAlpha));

  // Parachute restoring torque (pendulum effect) — capped per angular accel
  // to prevent integration blow-up on very light capsules.
  const restoringTorque: number = _computeParachuteTorque(ps, assembly, com, density, speed);
  let restoringAlpha: number = restoringTorque / I;
  restoringAlpha = Math.max(-MAX_CHUTE_ANGULAR_ACCEL, Math.min(MAX_CHUTE_ANGULAR_ACCEL, restoringAlpha));

  // Captured asteroid torque — when engines fire with an unaligned asteroid,
  // the off-CoM thrust produces a rotational torque that spins the craft.
  const asteroidAlpha: number = _computeAsteroidTorque(ps, assembly, thrustMagnitude);

  const alpha: number = playerAlpha + restoringAlpha + asteroidAlpha;
  ps.angularVelocity += alpha * dt;

  // Parachute angular damping — applied as implicit exponential decay so it
  // is unconditionally stable even for tiny moments of inertia.
  if (density > 0 && ps.parachuteStates) {
    let hasActiveChute = false;
    for (const [, entry] of ps.parachuteStates) {
      if (entry.state === 'deploying' || entry.state === 'deployed') {
        hasActiveChute = true;
        break;
      }
    }
    if (hasActiveChute) {
      const densityFrac: number = Math.min(1, density / LOW_DENSITY_THRESHOLD);
      ps.angularVelocity *= Math.exp(-CHUTE_DIRECT_DAMPING * densityFrac * dt);
    }
  }

  // Damping (when no input).
  if (!left && !right) {
    // Aerodynamic damping (proportional to density).
    const aeroDamping: number = AERO_ANGULAR_DAMPING * density;
    ps.angularVelocity -= aeroDamping * ps.angularVelocity * dt;

    // RCS active braking in vacuum.
    if (altitude > atmoTop && hasRcs(ps, assembly)) {
      applyRcsAngularDamping(ps, I, dt);
    }
  }

  ps.angle += ps.angularVelocity * dt;
}
