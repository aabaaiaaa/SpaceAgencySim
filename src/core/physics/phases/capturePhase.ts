// ---------------------------------------------------------------------------
// CAPTURE-phase integrator.
//
// The craft is approaching a destination body and must burn to slow down.
// Gravity is radial toward the body's centre (no atmosphere in deep
// approach). Player thrust accelerates the craft along its orientation axis
// and (if an asteroid is captured) can induce asteroid torque. Fuel is
// consumed while engines fire; density is zero so there is no drag.
// ---------------------------------------------------------------------------

import { BODY_RADIUS, FlightPhase } from '../../constants.ts';
import { tickFuelSystem } from '../../fuelsystem.ts';
import { gravityForBody } from '../gravity.ts';
import {
  computeThrust,
  updateThrottleFromTWR,
  type ThrustResult,
} from '../thrust.ts';
import { _computeTotalMass, _computeAsteroidTorque } from '../../physics.ts';

import type { FlightState } from '../../gameState.ts';
import type { PhysicsState, RocketAssembly } from '../../physics.ts';

export interface CapturePhaseContext {
  flightState: FlightState;
  assembly: RocketAssembly;
  bodyId: string | undefined;
}

/**
 * Advance `ps` by one fixed timestep when in the CAPTURE phase.
 *
 * Returns `true` if the tick was handled (caller should return immediately),
 * or `false` if the craft is not in CAPTURE (or `bodyId` is missing) and
 * normal integration should proceed.
 */
export function tickCapturePhase(
  ps: PhysicsState,
  dt: number,
  ctx: CapturePhaseContext,
): boolean {
  const { flightState, assembly, bodyId } = ctx;

  if (flightState?.phase !== FlightPhase.CAPTURE || !bodyId) {
    return false;
  }

  updateThrottleFromTWR(ps, assembly, bodyId);
  const totalMassC: number = _computeTotalMass(ps, assembly);

  // Thrust (no atmosphere in deep approach).
  let txc = 0;
  let tyc = 0;
  if (ps.firingEngines.size > 0) {
    const tr: ThrustResult = computeThrust(ps, assembly, 0);
    txc = tr.thrustX;
    tyc = tr.thrustY;
    // Asteroid torque during capture approach — spin from off-CoM thrust.
    const captureThrustMag: number = Math.hypot(txc, tyc);
    const captureAstTorque: number = _computeAsteroidTorque(ps, assembly, captureThrustMag);
    if (captureAstTorque !== 0) {
      ps.angularVelocity += captureAstTorque * dt;
      ps.angle += ps.angularVelocity * dt;
    }
    tickFuelSystem(ps, assembly, dt, 0);
  }

  // Radial gravity toward destination body centre.
  const gravAccelC: number = gravityForBody(bodyId, Math.max(0, ps.posY));
  const Rc: number = BODY_RADIUS[bodyId] ?? 6_371_000;
  const rxc: number = ps.posX;
  const ryc: number = ps.posY + Rc;
  const rc: number = Math.hypot(rxc, ryc);
  const gxc: number = (-gravAccelC * totalMassC * rxc) / rc;
  const gyc: number = (-gravAccelC * totalMassC * ryc) / rc;

  if (totalMassC > 0) {
    ps.velX += ((txc + gxc) / totalMassC) * dt;
    ps.velY += ((tyc + gyc) / totalMassC) * dt;
  }
  ps.posX += ps.velX * dt;
  ps.posY += ps.velY * dt;
  return true;
}
