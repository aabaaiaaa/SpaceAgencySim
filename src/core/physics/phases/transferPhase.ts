// ---------------------------------------------------------------------------
// TRANSFER-phase integrator.
//
// Deep-space transfer: the craft drifts at constant velocity with no gravity
// or atmospheric drag. The player may fire engines for course corrections —
// thrust accelerates the craft along its orientation axis and (if a heavy
// body is captured) can induce asteroid torque. Fuel is consumed while
// engines fire, but density is zero so there is no drag-based heating.
// ---------------------------------------------------------------------------

import { FlightPhase } from '../../constants.ts';
import { tickFuelSystem } from '../../fuelsystem.ts';
import { computeThrust, type ThrustResult } from '../thrust.ts';
import { _computeTotalMass, _computeAsteroidTorque } from '../../physics.ts';
import { applySteering } from '../steering.ts';

import type { FlightState } from '../../gameState.ts';
import type { PhysicsState, RocketAssembly } from '../../physics.ts';

export interface TransferPhaseContext {
  flightState: FlightState;
  assembly: RocketAssembly;
}

/**
 * Advance `ps` by one fixed timestep when in the TRANSFER phase.
 *
 * Returns `true` if the tick was handled (caller should return immediately),
 * or `false` if the craft is not in TRANSFER and normal integration should
 * proceed.
 */
export function tickTransferPhase(
  ps: PhysicsState,
  dt: number,
  ctx: TransferPhaseContext,
): boolean {
  const { flightState, assembly } = ctx;

  if (flightState?.phase !== FlightPhase.TRANSFER) {
    return false;
  }

  if (ps.firingEngines.size > 0) {
    const totalMassT: number = _computeTotalMass(ps, assembly);
    const thrustResult: ThrustResult = computeThrust(ps, assembly, 0);
    if (totalMassT > 0) {
      ps.velX += (thrustResult.thrustX / totalMassT) * dt;
      ps.velY += (thrustResult.thrustY / totalMassT) * dt;
    }
    // Asteroid torque in deep space — spin from off-CoM thrust.
    const transferThrustMag: number = Math.hypot(thrustResult.thrustX, thrustResult.thrustY);
    const transferAstTorque: number = _computeAsteroidTorque(ps, assembly, transferThrustMag);
    if (transferAstTorque !== 0) {
      ps.angularVelocity += transferAstTorque * dt;
      ps.angle += ps.angularVelocity * dt;
    }
    tickFuelSystem(ps, assembly, dt, 0);
  }

  ps.posX += ps.velX * dt;
  ps.posY += ps.velY * dt;

  // Player-steering angle update, symmetric with orbitPhase — deep space is
  // vacuum so no aero damping contributes, but A/D input still rotates.
  applySteering(ps, assembly, 0, dt, flightState?.bodyId, flightState, 0);

  return true;
}
