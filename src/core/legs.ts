/**
 * legs.ts — Landing leg state machine and deployment mechanics.
 *
 * Implements the full landing leg lifecycle:
 *
 *   retracted  --[deploy trigger]-->  deploying  --[1.5 s timer]-->  deployed
 *
 * DEPLOYMENT
 *   Deployment takes 1.5 seconds (LEG_DEPLOY_DURATION).  During the deploying
 *   phase the leg is extending outward and downward.  Once fully deployed the
 *   effective landing footprint is widened.
 *
 * LANDING DETECTION (handled in physics.ts)
 *   physics.ts counts legs whose state is 'deployed' when a ground contact
 *   event fires:
 *     - >= 2 deployed legs AND vertical speed < 10 m/s  -> controlled landing
 *     - >= 1 deployed leg  AND speed 10-30 m/s          -> hard landing (legs destroyed)
 *     - speed >= 30 m/s (any leg state)                 -> full destruction / crash
 *     - 0 deployed legs   AND speed > 5 m/s             -> crash (bottom parts damaged)
 *     - speed <= 5 m/s  (no legs)                       -> safe landing
 *
 * CONTEXT MENU
 *   `getLegContextMenuItems(ps, assembly)` returns a list of objects describing
 *   each landing leg's current state and available actions for the flight UI.
 *
 * PUBLIC API
 *   LegState                                                       {enum}
 *   LEG_DEPLOY_DURATION                                            {number}
 *   initLegStates(ps, assembly)                                   -> void
 *   deployLandingLeg(ps, instanceId)                              -> void
 *   tickLegs(ps, assembly, flightState, dt)                       -> void
 *   getLegStatus(ps, instanceId)                                  -> string
 *   getLegContextMenuItems(ps, assembly)                          -> Object[]
 *
 * @module legs
 */

import { getPartById } from '../data/parts.js';
import { PartType }    from './constants.js';

import type { LegEntry } from './physics.js';
import type { PartDef } from '../data/parts.js';
import type { FlightEvent } from './gameState.js';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Context menu item describing one landing leg's state and available actions. */
export interface LegContextMenuItem {
  instanceId:  string;
  name:        string;
  state:       string;
  statusLabel: string;
  canDeploy:   boolean;
  deployTimer: number | null;
}

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/** Landing leg lifecycle states. */
export const LegState = Object.freeze({
  /** Stowed -- retracted against the rocket body; no landing protection. */
  RETRACTED: 'retracted',
  /** Extending -- leg is in motion (animation window, 1.5 s). */
  DEPLOYING: 'deploying',
  /** Fully extended -- leg is deployed and providing landing protection. */
  DEPLOYED:  'deployed',
} as const);

export type LegState = (typeof LegState)[keyof typeof LegState];

/** Duration of the deploying -> deployed animation transition in seconds. */
export const LEG_DEPLOY_DURATION: number = 1.5;

// ---------------------------------------------------------------------------
// Internal helper -- is this a landing leg type?
// ---------------------------------------------------------------------------

/**
 * Return true if the given part definition is a landing leg part.
 */
function _isLegType(def: PartDef | null | undefined): boolean {
  return (
    def !== null &&
    def !== undefined &&
    (def.type === PartType.LANDING_LEGS || def.type === PartType.LANDING_LEG)
  );
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Populate `ps.legStates` with a `retracted` entry for every LANDING_LEGS /
 * LANDING_LEG part currently in `ps.activeParts`.
 *
 * Call this once inside `createPhysicsState` after the state object has been
 * constructed.  Safe to call again -- existing entries are preserved.
 */
export function initLegStates(
  ps: { legStates: Map<string, LegEntry>; activeParts: Set<string> },
  assembly: { parts: Map<string, { partId: string }> },
): void {
  for (const [instanceId, placed] of assembly.parts) {
    if (!ps.activeParts.has(instanceId)) continue;
    if (ps.legStates.has(instanceId)) continue; // already initialised
    const def = getPartById(placed.partId);
    if (!_isLegType(def)) continue;
    ps.legStates.set(instanceId, {
      state:       LegState.RETRACTED,
      deployTimer: 0,
    });
  }
}

// ---------------------------------------------------------------------------
// Deployment trigger
// ---------------------------------------------------------------------------

/**
 * Initiate deployment of the specified landing leg.
 *
 * Transitions the leg from `retracted` -> `deploying` and starts the
 * LEG_DEPLOY_DURATION countdown.  If the leg is already in any other
 * state (deploying or deployed) this function is a no-op.
 *
 * Can be called from:
 *   - staging.js when an in-flight stage fires a DEPLOY activation.
 *   - A flight-scene context menu when the player manually deploys the leg.
 */
export function deployLandingLeg(
  ps: { legStates: Map<string, LegEntry> },
  instanceId: string,
): void {
  if (!ps.legStates) return;

  let entry = ps.legStates.get(instanceId);
  if (!entry) {
    // Late-initialise for parts that weren't present at createPhysicsState time.
    entry = { state: LegState.RETRACTED, deployTimer: 0 };
    ps.legStates.set(instanceId, entry);
  }

  if (entry.state !== LegState.RETRACTED) return;

  entry.state       = LegState.DEPLOYING;
  entry.deployTimer = LEG_DEPLOY_DURATION;
}

// ---------------------------------------------------------------------------
// Per-tick update
// ---------------------------------------------------------------------------

/**
 * Advance all landing leg state machines by one fixed timestep.
 *
 * For every leg in the DEPLOYING state:
 *   - Decrements `deployTimer` by `dt`.
 *   - When the timer reaches zero, transitions to DEPLOYED and emits a
 *     LEG_DEPLOYED event to `flightState.events`.
 *
 * Call once per fixed integration step from `_integrate` in physics.ts.
 */
export function tickLegs(
  ps: { legStates: Map<string, LegEntry>; posY: number },
  assembly: { parts: Map<string, { partId: string }> },
  flightState: { events: FlightEvent[]; timeElapsed: number },
  dt: number,
): void {
  if (!ps.legStates) return;

  for (const [instanceId, entry] of ps.legStates) {
    if (entry.state !== LegState.DEPLOYING) continue;

    entry.deployTimer -= dt;
    if (entry.deployTimer > 0) continue; // Still animating.

    // --- Timer expired: transition to DEPLOYED ---

    const placed   = assembly.parts.get(instanceId);
    const def      = placed ? getPartById(placed.partId) : null;
    const partName = def?.name ?? 'Landing Leg';
    const altitude = Math.max(0, ps.posY);
    const time     = flightState.timeElapsed;

    entry.state       = LegState.DEPLOYED;
    entry.deployTimer = 0;

    flightState.events.push({
      type:        'LEG_DEPLOYED',
      time,
      instanceId,
      partName,
      altitude,
      description: `${partName} fully deployed at ${altitude.toFixed(0)} m.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Status query
// ---------------------------------------------------------------------------

/**
 * Return the current state string for the given landing leg instance.
 *
 * Returns LegState.RETRACTED when:
 *   - `ps.legStates` is absent (debris without state map).
 *   - The instance ID is not tracked.
 */
export function getLegStatus(
  ps: { legStates?: Map<string, LegEntry> },
  instanceId: string,
): string {
  if (!ps.legStates) return LegState.RETRACTED;
  const entry = ps.legStates.get(instanceId);
  return entry ? entry.state : LegState.RETRACTED;
}

// ---------------------------------------------------------------------------
// Foot offset helper
// ---------------------------------------------------------------------------

/**
 * Compute the deployed foot offset for a landing leg instance.
 *
 * Returns { dx, dy, t } where dx/dy are unsigned pixel offsets from the
 * leg's centre position.  dy = downward extension, dx = outward extension.
 * The caller applies the appropriate side sign to dx.
 */
export function getDeployedLegFootOffset(
  instanceId: string,
  def: { width?: number; height?: number },
  legStates: Map<string, LegEntry> | undefined,
): { dx: number; dy: number; t: number } {
  let t = 0;
  const entry = legStates?.get(instanceId);
  if (entry) {
    if (entry.state === LegState.DEPLOYED) t = 1;
    else if (entry.state === LegState.DEPLOYING) {
      t = 1 - (entry.deployTimer / LEG_DEPLOY_DURATION);
      t = Math.max(0, Math.min(1, t));
    }
  }
  const pw = def.width ?? 10;
  const ph = def.height ?? 20;
  return { dx: pw * 1.0 * t, dy: ph * 3.0 * t, t };
}

// ---------------------------------------------------------------------------
// Count helper
// ---------------------------------------------------------------------------

/**
 * Return the number of landing leg instances that are currently in the
 * DEPLOYED state.
 *
 * Used by physics.ts `_handleGroundContact` to determine whether the rocket
 * has sufficient leg support for a controlled landing.
 */
export function countDeployedLegs(
  ps: { legStates?: Map<string, LegEntry> },
): number {
  if (!ps.legStates) return 0;
  let count = 0;
  for (const [, entry] of ps.legStates) {
    if (entry.state === LegState.DEPLOYED) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Retraction trigger
// ---------------------------------------------------------------------------

/**
 * Retract a previously-deployed landing leg, returning it to the stowed position.
 *
 * Transitions the leg from `deployed` -> `retracted`.  This allows the player
 * to reposition legs before final touchdown.  If the leg is already retracted
 * or still deploying this function is a no-op.
 */
export function retractLandingLeg(
  ps: { legStates: Map<string, LegEntry> },
  instanceId: string,
): void {
  if (!ps.legStates) return;

  const entry = ps.legStates.get(instanceId);
  if (!entry) return;

  if (entry.state !== LegState.DEPLOYED) return;

  entry.state       = LegState.RETRACTED;
  entry.deployTimer = 0;
}

// ---------------------------------------------------------------------------
// Context menu helpers
// ---------------------------------------------------------------------------

/**
 * Build a list of context menu items for all LANDING_LEGS / LANDING_LEG parts
 * in the rocket.
 *
 * Each item describes the current state of one leg and optionally provides a
 * deployable action.  The flight UI layer calls this function to populate a
 * right-click or action panel menu.
 */
export function getLegContextMenuItems(
  ps: { legStates?: Map<string, LegEntry>; activeParts: Set<string> },
  assembly: { parts: Map<string, { partId: string }> },
): LegContextMenuItem[] {
  const items: LegContextMenuItem[] = [];

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!_isLegType(def)) continue;

    const state = getLegStatus(ps, instanceId);

    let statusLabel: string;
    let deployTimer: number | null = null;
    switch (state) {
      case LegState.RETRACTED:
        statusLabel = 'Retracted (ready)';
        break;
      case LegState.DEPLOYING: {
        const entry = ps.legStates?.get(instanceId);
        deployTimer = entry ? Math.max(0, entry.deployTimer) : null;
        statusLabel = deployTimer !== null
          ? `Deploying\u2026 (${deployTimer.toFixed(1)} s)`
          : 'Deploying\u2026';
        break;
      }
      case LegState.DEPLOYED:
        statusLabel = 'Deployed';
        break;
      default:
        statusLabel = state;
    }

    items.push({
      instanceId,
      name:        def!.name,
      state,
      statusLabel,
      canDeploy:   state === LegState.RETRACTED,
      deployTimer,
    });
  }

  return items;
}
