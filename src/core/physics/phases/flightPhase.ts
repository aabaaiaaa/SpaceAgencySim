// ---------------------------------------------------------------------------
// FLIGHT-phase integrator — part 1 (atmosphere + thrust).
//
// The FLIGHT phase is the default atmospheric/ballistic integrator used when
// the craft is not in ORBIT, TRANSFER, or CAPTURE. It is significantly more
// elaborate than the other phase branches: gravity, drag, wind, docking/RCS
// local translation, steering, fuel consumption, heat, clamps, ground
// contact, parachutes, legs, science, power, and ejected crew all interact
// within a single fixed-step tick.
//
// Per requirements §8 the extraction is split across multiple tasks. This
// module currently owns the **prelude** of the FLIGHT branch — TWR throttle
// conversion, atmosphere (altitude + density), total-mass snapshot, docking-
// mode determination, and main-engine thrust. Follow-up tasks (part 2 onward)
// will move gravity/drag/wind, integration, steering, ground contact, and
// the various continuous subsystem ticks into sibling helpers that build on
// the values produced here.
//
// The ordering of operations (mass → thrust, with fuel consumption later in
// the frame) is load-bearing and must be preserved — see the "Thrust ↔ Fuel
// ↔ Mass" note in requirements §8.
// ---------------------------------------------------------------------------

import { ControlMode } from '../../constants.ts';
import { _computeTotalMass } from '../../physics.ts';
import { _densityForBody } from '../../physics.ts';
import {
  computeThrust,
  updateThrottleFromTWR,
  type ThrustResult,
} from '../thrust.ts';

import type { FlightState } from '../../gameState.ts';
import type { PhysicsState, RocketAssembly } from '../../physics.ts';

/**
 * Intermediate values produced by the FLIGHT-phase prelude and consumed by
 * the remaining portions of the tick.
 */
export interface FlightPhasePrelude {
  /** Clamped altitude (max(0, ps.posY)) at the start of the tick. */
  altitude: number;
  /** Atmospheric density at `altitude` for the current body. */
  density: number;
  /** Total craft mass (dry + remaining fuel + captured body) in kg. */
  totalMass: number;
  /** True when the craft is in DOCKING or RCS control mode. */
  isDockingOrRcs: boolean;
  /** X-component of main-engine thrust force (N). Zero in docking/RCS. */
  thrustX: number;
  /** Y-component of main-engine thrust force (N). Zero in docking/RCS. */
  thrustY: number;
}

export interface FlightPhasePreludeContext {
  flightState: FlightState;
  assembly: RocketAssembly;
  bodyId: string | undefined;
}

/**
 * Run the FLIGHT-phase prelude: TWR throttle conversion, atmosphere lookup,
 * total-mass snapshot, docking/RCS determination, and main-engine thrust.
 *
 * Mutates `ps.throttle` via {@link updateThrottleFromTWR} when the craft is
 * in TWR throttle mode; otherwise side-effect-free. Returns the intermediate
 * values needed by the remainder of the FLIGHT-phase tick.
 */
export function tickFlightPhasePrelude(
  ps: PhysicsState,
  ctx: FlightPhasePreludeContext,
): FlightPhasePrelude {
  const { assembly, bodyId } = ctx;

  // --- 0. TWR-relative throttle conversion --------------------------------
  updateThrottleFromTWR(ps, assembly, bodyId);

  const altitude: number = Math.max(0, ps.posY);
  const density: number  = _densityForBody(altitude, bodyId);

  // --- 1. Total rocket mass (dry + remaining fuel) -------------------------
  const totalMass: number = _computeTotalMass(ps, assembly);

  // --- Docking / RCS mode: thrust affects local position, not orbit --------
  const isDockingOrRcs =
    ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS;

  // --- 2. Thrust vector ----------------------------------------------------
  // In docking/RCS modes, main engine thrust is suppressed — movement comes
  // from docking thrusters only (handled in _applyDockingMovement).
  let thrustX = 0;
  let thrustY = 0;
  if (!isDockingOrRcs) {
    const thrustResult: ThrustResult = computeThrust(ps, assembly, density);
    thrustX = thrustResult.thrustX;
    thrustY = thrustResult.thrustY;
  }

  return { altitude, density, totalMass, isDockingOrRcs, thrustX, thrustY };
}
