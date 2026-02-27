/**
 * ejector.js — Ejector seat state machine and crew casualty resolution.
 *
 * Tracks the armed/activated state for the ejector seat of each crewed command
 * module (parts with `properties.hasEjectorSeat = true`) and provides helpers
 * for the flight-scene context menu.
 *
 * EJECTOR SEAT LIFECYCLE
 *   armed  ──[activate trigger]──►  activated
 *
 * On activation:
 *   - The CREW_EJECTED flight event is emitted.
 *   - All crew listed in `flightState.crewIds` are added to `ps.ejectedCrewIds`
 *     so `resolveCrewCasualties()` knows they survived.
 *   - The command module part REMAINS in `ps.activeParts` — ejection does not
 *     physically destroy the capsule.
 *
 * CREW CASUALTY RESOLUTION
 *   Call `resolveCrewCasualties()` once at the end of a flight (after
 *   `ps.crashed` or `ps.landed` is true).  It applies KIA records and fines
 *   ($500,000 per crew member, via `recordKIA`) for any crew who were still
 *   aboard a command module that was destroyed without prior ejection.
 *
 *   Two destruction paths are handled:
 *     1. Crash  (`ps.crashed = true`)           — catastrophic or hard impact.
 *     2. Heat   (PART_DESTROYED event for a     — command module destroyed by
 *                COMMAND_MODULE part)              reentry heating.
 *
 * PUBLIC API
 *   EjectorState                                                   {enum}
 *   initEjectorStates(ps, assembly)                               → void
 *   activateEjectorSeat(ps, assembly, flightState, instanceId)    → boolean
 *   getEjectorSeatStatus(ps, instanceId)                          → string
 *   getEjectorSeatContextMenuItems(ps, assembly)                  → Object[]
 *   resolveCrewCasualties(state, ps, assembly, flightState)       → string[]
 *
 * @module ejector
 */

import { getPartById } from '../data/parts.js';
import { PartType }    from './constants.js';
import { recordKIA }   from './crew.js';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Ejector seat lifecycle states.
 * @enum {string}
 */
export const EjectorState = Object.freeze({
  /** Seat is armed and ready to fire. */
  ARMED:     'armed',
  /** Seat has been activated; crew were safely ejected. */
  ACTIVATED: 'activated',
});

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Populate `ps.ejectorStates` with an ARMED entry for every COMMAND_MODULE
 * part that has `properties.hasEjectorSeat = true` and is currently in
 * `ps.activeParts`.
 *
 * Call this once inside `createPhysicsState` after the state object has been
 * constructed.  Safe to call again — existing entries are preserved.
 *
 * @param {{ ejectorStates: Map<string, string>,
 *           activeParts:   Set<string> }}                  ps
 * @param {{ parts: Map<string, { partId: string }> }}      assembly
 */
export function initEjectorStates(ps, assembly) {
  if (!ps.ejectorStates) return;

  for (const [instanceId, placed] of assembly.parts) {
    if (!ps.activeParts.has(instanceId)) continue;
    if (ps.ejectorStates.has(instanceId)) continue; // already initialised

    const def = getPartById(placed.partId);
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
 * Transitions the ejector seat from `armed` → `activated`, adds all crew
 * listed in `flightState.crewIds` to `ps.ejectedCrewIds`, and emits a
 * CREW_EJECTED event to `flightState.events`.
 *
 * This function is idempotent: if the seat is already ACTIVATED it returns
 * `false` without emitting a duplicate event.
 *
 * Can be called from:
 *   - `staging.js` when the player fires an EJECT stage via Spacebar.
 *   - A flight-scene context menu when the player manually activates the seat.
 *
 * @param {{ ejectorStates?:  Map<string, string>,
 *           ejectedCrewIds?: Set<string>,
 *           posY:            number }}                        ps
 * @param {{ parts: Map<string, { partId: string }> }}        assembly
 * @param {{ events:      Array<object>,
 *           timeElapsed: number,
 *           crewIds:     string[] }}                          flightState
 * @param {string} instanceId  Instance ID of the COMMAND_MODULE part.
 * @returns {boolean}  `true` if the seat was successfully activated; `false`
 *   if it was already fired or not tracked.
 */
export function activateEjectorSeat(ps, assembly, flightState, instanceId) {
  if (!ps.ejectorStates) return false;

  const currentState = ps.ejectorStates.get(instanceId);

  // Already activated — do nothing.
  if (currentState === EjectorState.ACTIVATED) return false;

  // Mark the ejector as activated.
  ps.ejectorStates.set(instanceId, EjectorState.ACTIVATED);

  // Record all crew as safely ejected.
  if (ps.ejectedCrewIds && flightState.crewIds) {
    for (const crewId of flightState.crewIds) {
      ps.ejectedCrewIds.add(crewId);
    }
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
 * Returns {@link EjectorState.ARMED} when:
 *   - `ps.ejectorStates` is absent.
 *   - The instance ID is not tracked.
 *
 * @param {{ ejectorStates?: Map<string, string> }} ps
 * @param {string} instanceId  Command module instance ID.
 * @returns {string}  One of the {@link EjectorState} values.
 */
export function getEjectorSeatStatus(ps, instanceId) {
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
 *
 * Returned item schema:
 * ```
 * {
 *   instanceId:  string,   // part instance ID
 *   name:        string,   // human-readable part name (e.g. 'Mk1 Command Module')
 *   state:       string,   // EjectorState value
 *   statusLabel: string,   // display text for the status chip
 *   canActivate: boolean,  // true when state is 'armed' (seat not yet fired)
 * }
 * ```
 *
 * @param {{ ejectorStates?: Map<string, string>,
 *           activeParts:    Set<string> }}                  ps
 * @param {{ parts: Map<string, { partId: string }> }}       assembly
 * @returns {Array<{
 *   instanceId:  string,
 *   name:        string,
 *   state:       string,
 *   statusLabel: string,
 *   canActivate: boolean,
 * }>}
 */
export function getEjectorSeatContextMenuItems(ps, assembly) {
  const items = [];

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;

    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.COMMAND_MODULE) continue;
    if (!def.properties?.hasEjectorSeat) continue;

    const state = getEjectorSeatStatus(ps, instanceId);

    let statusLabel;
    switch (state) {
      case EjectorState.ARMED:
        statusLabel = 'Armed (ready to fire)';
        break;
      case EjectorState.ACTIVATED:
        statusLabel = 'Activated — crew ejected';
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
 * **1. Crash** (`ps.crashed = true`):
 *   Every crew member in `flightState.crewIds` who is NOT in
 *   `ps.ejectedCrewIds` is marked KIA.  The assumption is that a crashed
 *   rocket destroys all command modules — crew who had already ejected are
 *   safely clear of the vehicle.
 *
 * **2. Heat** (PART_DESTROYED events):
 *   Scans `flightState.events` for `PART_DESTROYED` events where the
 *   destroyed part is a COMMAND_MODULE with `hasEjectorSeat`.  If the
 *   module's ejector seat was NOT activated before destruction, any crew
 *   not already in `ps.ejectedCrewIds` are marked KIA.
 *
 * For each KIA astronaut, `recordKIA()` is called, which:
 *   - Sets the astronaut's status to 'kia'.
 *   - Records the cause and timestamp.
 *   - Applies the $500,000 government fine via `applyDeathFine()`.
 *
 * @param {import('./gameState.js').GameState}             state
 * @param {{ crashed:          boolean,
 *           ejectorStates?:   Map<string, string>,
 *           ejectedCrewIds?:  Set<string> }}               ps
 * @param {import('./rocketbuilder.js').RocketAssembly}     assembly
 * @param {{ crewIds: string[],
 *           events:  Array<object> }}                       flightState
 * @returns {string[]}  IDs of astronauts newly marked KIA.
 */
export function resolveCrewCasualties(state, ps, assembly, flightState) {
  if (!flightState.crewIds || flightState.crewIds.length === 0) return [];

  const ejectedCrewIds = ps.ejectedCrewIds ?? new Set();
  const newKia = [];

  // --- Case 1: Rocket crashed — all non-ejected crew are KIA ---------------
  if (ps.crashed) {
    for (const crewId of flightState.crewIds) {
      if (!ejectedCrewIds.has(crewId)) {
        const ok = recordKIA(
          state,
          crewId,
          'Rocket destroyed — crew not ejected before impact',
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

    const placed = assembly.parts.get(event.instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (!def || def.type !== PartType.COMMAND_MODULE) continue;
    if (!def.properties?.hasEjectorSeat) continue;

    // Was the ejector seat activated before the module was destroyed?
    const ejectorActivated =
      ps.ejectorStates?.get(event.instanceId) === EjectorState.ACTIVATED;
    if (ejectorActivated) continue;

    // Crew in this module were not safely ejected — mark them KIA.
    for (const crewId of flightState.crewIds) {
      if (!ejectedCrewIds.has(crewId)) {
        const ok = recordKIA(
          state,
          crewId,
          'Command module destroyed by reentry heat — crew not ejected',
        );
        if (ok) newKia.push(crewId);
      }
    }
  }

  return newKia;
}
