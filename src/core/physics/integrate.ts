// ---------------------------------------------------------------------------
// Integration loop dispatcher.
//
// `_integrate` advances a PhysicsState by one fixed timestep. It dispatches
// by FlightPhase to the corresponding phase integrator in `./phases/*`.
//
// Phase functions return `true` when they handled the tick (caller short-
// circuits) or `false` when normal Newtonian integration via the FLIGHT
// branch should proceed. REENTRY is not a distinct branch — its
// atmospheric-heat bookkeeping is handled inside `tickFlightPhase`.
// ---------------------------------------------------------------------------

import { tickOrbitPhase } from './phases/orbitPhase.ts';
import { tickTransferPhase } from './phases/transferPhase.ts';
import { tickCapturePhase } from './phases/capturePhase.ts';
import { tickFlightPhase } from './phases/flightPhase.ts';

import type { FlightState } from '../gameState.ts';
import type { PhysicsState, RocketAssembly } from '../physics.ts';

/** Fixed integration step in seconds (60 Hz). */
export const FIXED_DT: number = 1 / 60;

/**
 * Advance `ps` by one fixed timestep. Dispatches by FlightPhase.
 */
export function _integrate(
  ps: PhysicsState,
  assembly: RocketAssembly,
  flightState: FlightState,
): void {
  const bodyId: string | undefined = flightState?.bodyId;

  if (tickOrbitPhase(ps, FIXED_DT, { flightState, assembly })) return;
  if (tickTransferPhase(ps, FIXED_DT, { flightState, assembly })) return;
  if (tickCapturePhase(ps, FIXED_DT, { flightState, assembly, bodyId })) return;

  tickFlightPhase(ps, FIXED_DT, { flightState, assembly });
}
