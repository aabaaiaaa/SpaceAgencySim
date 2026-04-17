// ---------------------------------------------------------------------------
// Integration loop (shell)
//
// This module will eventually own the main `_integrate` dispatcher that
// advances a PhysicsState by a fixed timestep. The current authoritative
// implementation still lives in `../physics.ts` (`_integrate`); this file
// stands up the shell with imports wired to the newly-extracted sub-modules
// so subsequent tasks can move phase branches out of the monolith one at a
// time without churn on import bookkeeping.
//
// See requirements §8 — the planned structure is:
//   - integrate.ts (this file) — top-level orchestrator; dispatches by phase
//   - phases/orbitPhase.ts, transferPhase.ts, capturePhase.ts,
//     flightPhase.ts, descentPhase.ts — phase-specific integrators
//   - gravity.ts / thrust.ts / steering.ts / docking.ts / rcs.ts /
//     debrisGround.ts — already-extracted helpers, imported below.
//
// NOTE: no logic is moved in this task. The exported `_integrate` is a
// skeleton delegating to the existing implementation in `../physics.ts`.
// ---------------------------------------------------------------------------

import { gravityForBody } from './gravity.ts';
import { computeThrust, updateThrottleFromTWR } from './thrust.ts';
import { applySteering } from './steering.ts';
import { applyDockingMovement } from './docking.ts';
import { hasRcs, applyRcsAngularDamping, RCS_TORQUE_MULTIPLIER } from './rcs.ts';
import { tickDebrisGround } from './debrisGround.ts';
import { tickOrbitPhase } from './phases/orbitPhase.ts';
import { tickTransferPhase } from './phases/transferPhase.ts';
import { tickCapturePhase } from './phases/capturePhase.ts';

import type { FlightState } from '../gameState.ts';
import type { PhysicsState, RocketAssembly } from '../physics.ts';

// Re-expose the imports so TypeScript does not flag them as unused while
// the phase-branch extraction tasks are still in flight. They will be
// consumed by the phase implementations that land in follow-up tasks.
void gravityForBody;
void computeThrust;
void updateThrottleFromTWR;
void applySteering;
void applyDockingMovement;
void hasRcs;
void applyRcsAngularDamping;
void RCS_TORQUE_MULTIPLIER;
void tickDebrisGround;
void tickOrbitPhase;
void tickTransferPhase;
void tickCapturePhase;

/** Fixed integration step in seconds (60 Hz). Mirrors physics.ts FIXED_DT. */
export const FIXED_DT: number = 1 / 60;

/**
 * Advance `ps` by one fixed timestep.
 *
 * **Shell only** — the real implementation currently lives in
 * `../physics.ts` (`_integrate`). Follow-up tasks (per requirements §8,
 * recommended extraction order) will migrate phase branches into
 * `./phases/*` and wire the dispatcher here.
 */
export function _integrate(
  _ps: PhysicsState,
  _assembly: RocketAssembly,
  _flightState: FlightState,
): void {
  // Intentionally empty. See module header.
}
