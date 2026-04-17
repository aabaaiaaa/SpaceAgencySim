/**
 * Debris module.
 *
 * Owns the module-level debris ID counter, its reset function, and the
 * helper that constructs a DebrisState from a set of parts being jettisoned
 * from a parent rocket. Extracted from `staging.ts` as part of the
 * debris/staging split (requirements §7.1).
 */

import { getPartById } from '../data/parts.ts';
import { PartType }    from './constants.ts';

import type { PhysicsState, RocketAssembly } from './physics.ts';
import type { DebrisState, ParachuteEntry, LegEntry } from './staging.ts';

// ---------------------------------------------------------------------------
// Internal ID counter for debris fragments
// ---------------------------------------------------------------------------

let _debrisNextId = 1;

/**
 * Reset the module-level debris ID counter back to 1.
 *
 * Call on flight start/abort so debris IDs don't grow unbounded across
 * a long session. Usually invoked via `resetFlightState` in `staging.ts`.
 */
export function resetDebrisIdCounter(): void {
  _debrisNextId = 1;
}

/**
 * Allocate the next debris ID string (e.g. `debris-1`, `debris-2`, ...).
 *
 * Provided so callers outside this module can increment the counter —
 * imported `let` bindings cannot be reassigned from consuming modules.
 */
export function nextDebrisId(): string {
  return `debris-${_debrisNextId++}`;
}

// ---------------------------------------------------------------------------
// Debris construction
// ---------------------------------------------------------------------------

/** Number of physics ticks to skip collision detection after separation.
 *  Must match the value in collision.ts. */
const SEPARATION_COOLDOWN_TICKS = 10;

/**
 * Create a new DebrisState from a set of part instance IDs, extracting
 * their simulation data from the parent PhysicsState.
 */
export function createDebrisFromParts(
  ps: PhysicsState,
  partIds: string[],
  assembly: RocketAssembly,
): DebrisState {
  const activeParts     = new Set(partIds);
  const firingEngines   = new Set<string>();
  const fuelStore       = new Map<string, number>();
  const deployedParts   = new Set<string>();
  const parachuteStates = new Map<string, ParachuteEntry>();
  const legStates       = new Map<string, LegEntry>();
  const heatMap         = new Map<string, number>();

  for (const id of partIds) {
    // Transfer firing engine state.
    // Only SRBs continue burning on debris — liquid engines flame out
    // immediately (no command module to control them).
    if (ps.firingEngines.has(id)) {
      const placed = assembly.parts.get(id);
      const def    = placed ? getPartById(placed.partId) : null;
      if (def && def.type === PartType.SOLID_ROCKET_BOOSTER) {
        firingEngines.add(id);
      }
      ps.firingEngines.delete(id);
    }

    // Transfer remaining fuel.
    if (ps.fuelStore.has(id)) {
      fuelStore.set(id, ps.fuelStore.get(id)!);
    }

    // Transfer deployed state (chutes, legs).
    if (ps.deployedParts.has(id)) {
      deployedParts.add(id);
    }

    // Transfer parachute state machine entry so debris chutes keep animating.
    if (ps.parachuteStates?.has(id)) {
      // Deep-copy the entry so the debris state evolves independently.
      const src = ps.parachuteStates.get(id)!;
      parachuteStates.set(id, {
        state: src.state,
        deployTimer: src.deployTimer,
        canopyAngle: Number.isFinite(src.canopyAngle) ? src.canopyAngle : 0,
        canopyAngularVel: Number.isFinite(src.canopyAngularVel) ? src.canopyAngularVel : 0,
        stowTimer: src.stowTimer,
      });
    }

    // Transfer landing leg state machine entry.
    if (ps.legStates?.has(id)) {
      const src = ps.legStates.get(id)!;
      legStates.set(id, { state: src.state, deployTimer: src.deployTimer });
    }

    // Transfer heat accumulation.
    if (ps.heatMap.has(id)) {
      heatMap.set(id, ps.heatMap.get(id)!);
    }

    // Remove the part from the parent rocket's active set.
    ps.activeParts.delete(id);
  }

  return {
    id:             nextDebrisId(),
    activeParts,
    firingEngines,
    fuelStore,
    deployedParts,
    parachuteStates,
    legStates,
    heatMap,
    posX:    ps.posX,
    posY:    ps.posY,
    velX:    ps.velX,
    velY:    ps.velY,
    angle:   ps.angle,
    angularVelocity: (Number.isFinite(ps.angularVelocity) ? ps.angularVelocity : 0) + (Math.random() - 0.5) * 0.3,
    throttle: 1.0,  // SRBs ignore throttle; liquid engines will flame out.
    landed:  false,
    crashed: false,
    isTipping: false,
    tippingContactX: 0,
    tippingContactY: 0,
    collisionCooldown: SEPARATION_COOLDOWN_TICKS,
  };
}
