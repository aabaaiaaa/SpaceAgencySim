// ---------------------------------------------------------------------------
// ORBIT-phase integrator.
//
// When the craft is in a stable orbit with no engines firing (and not in a
// docking or RCS control mode), Newtonian integration is skipped and the
// craft is advanced analytically along its frozen orbital path. This yields
// perfectly stable orbits at any time-warp factor.
//
// If the orbital elements have not yet been frozen (e.g. just after a burn
// ends or a teleport), they are computed on-the-fly. We only freeze when the
// orbit is valid (periapsis above the body's minimum-orbit altitude).
// ---------------------------------------------------------------------------

import {
  BODY_RADIUS,
  ControlMode,
  FlightPhase,
  MIN_ORBIT_ALTITUDE,
} from '../../constants.ts';
import {
  computeOrbitalElements,
  orbitalStateToCartesian,
} from '../../orbit.ts';

import type { FlightState } from '../../gameState.ts';
import type { PhysicsState } from '../../physics.ts';

export interface OrbitPhaseContext {
  flightState: FlightState;
}

/**
 * Advance `ps` analytically along its orbital path when applicable.
 *
 * Returns `true` if the tick was handled (caller should return immediately),
 * or `false` if the craft is not in a state that allows Keplerian propagation
 * and normal Newtonian integration should proceed.
 *
 * `dt` is accepted for symmetry with other phase functions but is unused —
 * propagation reads directly from `flightState.timeElapsed`.
 */
export function tickOrbitPhase(
  ps: PhysicsState,
  _dt: number,
  ctx: OrbitPhaseContext,
): boolean {
  const { flightState } = ctx;
  const bodyId: string | undefined = flightState?.bodyId;

  const isDockingOrRcs =
    ps.controlMode === ControlMode.DOCKING || ps.controlMode === ControlMode.RCS;

  if (
    flightState?.phase !== FlightPhase.ORBIT ||
    ps.firingEngines.size !== 0 ||
    isDockingOrRcs ||
    !bodyId
  ) {
    return false;
  }

  // Compute orbital elements if not yet frozen (e.g. after teleport or burn end).
  // Only freeze if the orbit is valid (periapsis above minimum altitude).
  if (!flightState.orbitalElements) {
    const elements = computeOrbitalElements(ps.posX, ps.posY, ps.velX, ps.velY, bodyId);
    if (elements) {
      const periR = elements.semiMajorAxis * (1 - elements.eccentricity);
      const periAlt = periR - (BODY_RADIUS[bodyId] ?? 6_371_000);
      const minAlt = (MIN_ORBIT_ALTITUDE as Record<string, number>)[bodyId] ?? 70_000;
      if (periAlt >= minAlt) {
        elements.epoch = flightState.timeElapsed;
        flightState.orbitalElements = elements;
      }
    }
  }

  if (flightState.orbitalElements) {
    const state = orbitalStateToCartesian(
      flightState.orbitalElements,
      flightState.timeElapsed,
      bodyId,
    );
    ps.posX = state.posX;
    ps.posY = state.posY;
    ps.velX = state.velX;
    ps.velY = state.velY;
    return true;
  }

  return false;
}
