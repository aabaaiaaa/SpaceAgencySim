/**
 * ejector.ts — Ejector seat state machine and crew casualty resolution.
 *
 * Tracks the armed/activated state for the ejector seat of each crewed command
 * module (parts with `properties.hasEjectorSeat = true`) and provides helpers
 * for the flight-scene context menu.
 *
 * EJECTOR SEAT LIFECYCLE
 *   armed  --[activate trigger]-->  activated
 *
 * On activation:
 *   - The CREW_EJECTED flight event is emitted.
 *   - All crew listed in `flightState.crewIds` are added to `ps.ejectedCrewIds`
 *     so `resolveCrewCasualties()` knows they survived.
 *   - The command module part REMAINS in `ps.activeParts` -- ejection does not
 *     physically destroy the capsule.
 *
 * CREW CASUALTY RESOLUTION
 *   Call `resolveCrewCasualties()` once at the end of a flight (after
 *   `ps.crashed` or `ps.landed` is true).  It applies KIA records and fines
 *   ($500,000 per crew member, via `recordKIA`) for any crew who were still
 *   aboard a command module that was destroyed without prior ejection.
 *
 *   Two destruction paths are handled:
 *     1. Crash  (`ps.crashed = true`)           -- catastrophic or hard impact.
 *     2. Heat   (PART_DESTROYED event for a     -- command module destroyed by
 *                COMMAND_MODULE part)              reentry heating.
 *
 * PUBLIC API
 *   EjectorState                                                   {enum}
 *   initEjectorStates(ps, assembly)                               -> void
 *   activateEjectorSeat(ps, assembly, flightState, instanceId)    -> boolean
 *   getEjectorSeatStatus(ps, instanceId)                          -> string
 *   getEjectorSeatContextMenuItems(ps, assembly)                  -> Object[]
 *   resolveCrewCasualties(state, ps, assembly, flightState)       -> string[]
 *
 * @module ejector
 */

import { getPartById } from '../data/parts.ts';
import { PartType }    from './constants.ts';
import { recordKIA }   from './crew.ts';

import type { GameState, FlightEvent } from './gameState.ts';
import type { PartDef } from '../data/parts.ts';

// ---------------------------------------------------------------------------
// Local type aliases for duck-typed physics/flight state parameters
// ---------------------------------------------------------------------------

/** Subset of PhysicsState used by initEjectorStates. */
interface InitEjectorPs {
  ejectorStates: Map<string, string>;
  activeParts: Set<string>;
}

/** Subset of PhysicsState used by activateEjectorSeat. */
interface ActivateEjectorPs {
  ejectorStates?: Map<string, string>;
  ejectedCrewIds?: Set<string>;
  ejectedCrew?: Array<{
    x: number; y: number;
    velX: number; velY: number;
    hasChute?: boolean; chuteOpen: boolean; chuteTimer: number;
  }>;
  posX: number;
  posY: number;
  velX: number;
  velY: number;
  angle: number;
}

/** Subset of FlightState used by activateEjectorSeat. */
interface ActivateFlightState {
  events: Array<Record<string, unknown>>;
  timeElapsed: number;
  crewIds: string[];
}

/** Subset of PhysicsState used by resolveCrewCasualties. */
interface CasualtyPs {
  crashed: boolean;
  ejectorStates?: Map<string, string>;
  ejectedCrewIds?: Set<string>;
}

/** Subset of FlightState used by resolveCrewCasualties. */
interface CasualtyFlightState {
  crewIds: string[];
  events: FlightEvent[];
}

/** Assembly shape used throughout. */
interface AssemblyLike {
  parts: Map<string, { partId: string; x: number; y: number }>;
}

/** Context menu item for an ejector seat. */
export interface EjectorContextMenuItem {
  instanceId: string;
  name: string;
  state: string;
  statusLabel: string;
  canActivate: boolean;
}

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Ejector seat lifecycle states. */
export const EjectorState = Object.freeze({
  /** Seat is armed and ready to fire. */
  ARMED:     'armed',
  /** Seat has been activated; crew were safely ejected. */
  ACTIVATED: 'activated',
} as const);

export type EjectorState = (typeof EjectorState)[keyof typeof EjectorState];

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Populate `ps.ejectorStates` with an ARMED entry for every COMMAND_MODULE
 * part that has `properties.hasEjectorSeat = true` and is currently in
 * `ps.activeParts`.
 *
 * Call this once inside `createPhysicsState` after the state object has been
 * constructed.  Safe to call again -- existing entries are preserved.
 */
export function initEjectorStates(
  ps: InitEjectorPs,
  assembly: AssemblyLike,
): void {
  if (!ps.ejectorStates) return;

  for (const [instanceId, placed] of assembly.parts) {
    if (!ps.activeParts.has(instanceId)) continue;
    if (ps.ejectorStates.has(instanceId)) continue; // already initialised

    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def || def.type !== PartType.COMMAND_MODULE) continue;
    if (!def.properties?.hasEjectorSeat) continue;

    ps.ejectorStates.set(instanceId, EjectorState.ARMED);
  }
}

// ---------------------------------------------------------------------------
// Activation trigger
// ---------------------------------------------------------------------------

/**
 * Fire the ejector seat in the specified command module.
 *
 * Transitions the ejector seat from `armed` -> `activated`, adds all crew
 * listed in `flightState.crewIds` to `ps.ejectedCrewIds`, and emits a
 * CREW_EJECTED event to `flightState.events`.
 *
 * This function is idempotent: if the seat is already ACTIVATED it returns
 * `false` without emitting a duplicate event.
 *
 * Can be called from:
 *   - `staging.js` when the player fires an EJECT stage via Spacebar.
 *   - A flight-scene context menu when the player manually activates the seat.
 */
export function activateEjectorSeat(
  ps: ActivateEjectorPs,
  assembly: AssemblyLike,
  flightState: ActivateFlightState,
  instanceId: string,
): boolean {
  if (!ps.ejectorStates) return false;

  const currentState = ps.ejectorStates.get(instanceId);

  // Already activated -- do nothing.
  if (currentState === EjectorState.ACTIVATED) return false;

  // Mark the ejector as activated.
  ps.ejectorStates.set(instanceId, EjectorState.ACTIVATED);

  // Record all crew as safely ejected.
  if (ps.ejectedCrewIds && flightState.crewIds) {
    for (const crewId of flightState.crewIds) {
      ps.ejectedCrewIds.add(crewId);
    }
  }

  // Spawn a visible ejected crew capsule at the command module's world position.
  const placed = assembly.parts.get(instanceId);
  if (placed && ps.ejectedCrew) {
    const cosA = Math.cos(ps.angle);
    const sinA = Math.sin(ps.angle);
    const lx = placed.x * 0.05;  // SCALE_M_PER_PX
    const ly = placed.y * 0.05;
    const worldX = ps.posX + lx * cosA + ly * sinA;
    const worldY = ps.posY - lx * sinA + ly * cosA;

    // Eject upward at 20 m/s relative to rocket, plus rocket's velocity.
    ps.ejectedCrew.push({
      x: worldX,
      y: worldY,
      velX: ps.velX - sinA * 20,
      velY: ps.velY + cosA * 20,
      hasChute: true,
      chuteOpen: false,
      chuteTimer: 1.5, // seconds before chute deploys
    });
  }

  // Emit the CREW_EJECTED flight event.
  const altitude = Math.max(0, ps.posY);
  flightState.events.push({
    type:        'CREW_EJECTED',
    time:        flightState.timeElapsed,
    altitude,
    description: `Crew ejected at ${altitude.toFixed(0)} m.`,
  });

  return true;
}

// ---------------------------------------------------------------------------
// Status query
// ---------------------------------------------------------------------------

/**
 * Return the current ejector seat state for the given command module instance.
 *
 * Returns EjectorState.ARMED when:
 *   - `ps.ejectorStates` is absent.
 *   - The instance ID is not tracked.
 */
export function getEjectorSeatStatus(
  ps: { ejectorStates?: Map<string, string> },
  instanceId: string,
): string {
  if (!ps.ejectorStates) return EjectorState.ARMED;
  return ps.ejectorStates.get(instanceId) ?? EjectorState.ARMED;
}

// ---------------------------------------------------------------------------
// Context menu helpers
// ---------------------------------------------------------------------------

/**
 * Build a list of context menu items for all crewed command modules with
 * ejector seats currently active on the rocket.
 *
 * Each item describes the current state of one command module's ejector seat
 * and whether the player can activate it.  The flight UI layer calls this
 * function to populate an action panel or right-click menu.
 */
export function getEjectorSeatContextMenuItems(
  ps: { ejectorStates?: Map<string, string>; activeParts: Set<string> },
  assembly: AssemblyLike,
): EjectorContextMenuItem[] {
  const items: EjectorContextMenuItem[] = [];

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;

    const def: PartDef | undefined = getPartById(placed.partId);
    if (!def || def.type !== PartType.COMMAND_MODULE) continue;
    if (!def.properties?.hasEjectorSeat) continue;

    const state = getEjectorSeatStatus(ps, instanceId);

    let statusLabel: string;
    switch (state) {
      case EjectorState.ARMED:
        statusLabel = 'Armed (ready to fire)';
        break;
      case EjectorState.ACTIVATED:
        statusLabel = 'Activated \u2014 crew ejected';
        break;
      default:
        statusLabel = state;
    }

    items.push({
      instanceId,
      name:        def.name,
      state,
      statusLabel,
      canActivate: state === EjectorState.ARMED,
    });
  }

  return items;
}

// ---------------------------------------------------------------------------
// Crew casualty resolution
// ---------------------------------------------------------------------------

/**
 * Resolve crew casualties at the end of a flight.
 *
 * Should be called once when the flight ends (`ps.crashed` or `ps.landed`).
 * Returns the IDs of any astronauts newly marked KIA so the caller can log
 * them or update the UI.
 *
 * Checks two destruction paths:
 *
 * 1. Crash (`ps.crashed = true`):
 *   Every crew member in `flightState.crewIds` who is NOT in
 *   `ps.ejectedCrewIds` is marked KIA.  The assumption is that a crashed
 *   rocket destroys all command modules -- crew who had already ejected are
 *   safely clear of the vehicle.
 *
 * 2. Heat (PART_DESTROYED events):
 *   Scans `flightState.events` for `PART_DESTROYED` events where the
 *   destroyed part is a COMMAND_MODULE with `hasEjectorSeat`.  If the
 *   module's ejector seat was NOT activated before destruction, any crew
 *   not already in `ps.ejectedCrewIds` are marked KIA.
 *
 * For each KIA astronaut, `recordKIA()` is called, which:
 *   - Sets the astronaut's status to 'kia'.
 *   - Records the cause and timestamp.
 *   - Applies the $500,000 government fine via `applyDeathFine()`.
 */
export function resolveCrewCasualties(
  state: GameState,
  ps: CasualtyPs,
  assembly: AssemblyLike,
  flightState: CasualtyFlightState,
): string[] {
  if (!flightState.crewIds || flightState.crewIds.length === 0) return [];

  const ejectedCrewIds = ps.ejectedCrewIds ?? new Set<string>();
  const newKia: string[] = [];

  // --- Case 1: Rocket crashed -- all non-ejected crew are KIA ---------------
  if (ps.crashed) {
    for (const crewId of flightState.crewIds) {
      if (!ejectedCrewIds.has(crewId)) {
        const ok = recordKIA(
          state,
          crewId,
          'Rocket destroyed \u2014 crew not ejected before impact',
        );
        if (ok) newKia.push(crewId);
      }
    }
    return newKia;
  }

  // --- Case 2: Heat destroyed a command module before crash ----------------
  // Scan events for PART_DESTROYED events on crewed command modules.
  for (const event of flightState.events) {
    if (event.type !== 'PART_DESTROYED') continue;

    const instanceId = event.instanceId as string;
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def || def.type !== PartType.COMMAND_MODULE) continue;
    if (!def.properties?.hasEjectorSeat) continue;

    // Was the ejector seat activated before the module was destroyed?
    const ejectorActivated =
      ps.ejectorStates?.get(instanceId) === EjectorState.ACTIVATED;
    if (ejectorActivated) continue;

    // Crew in this module were not safely ejected -- mark them KIA.
    for (const crewId of flightState.crewIds) {
      if (!ejectedCrewIds.has(crewId)) {
        const ok = recordKIA(
          state,
          crewId,
          'Command module destroyed by reentry heat \u2014 crew not ejected',
        );
        if (ok) newKia.push(crewId);
      }
    }
  }

  return newKia;
}
