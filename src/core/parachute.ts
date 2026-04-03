/**
 * parachute.ts — Parachute state machine and deployment mechanics.
 *
 * Implements the full parachute lifecycle:
 *
 *   packed  ──[deploy trigger]──►  deploying  ──[2 s timer]──►  deployed
 *                                                                   │
 *                                                    [mass > maxSafeMass]
 *                                                                   ▼
 *                                                               failed
 *
 * DRAG MODEL
 *   A deploying parachute ramps its effective drag coefficient linearly from
 *   1× up to CHUTE_DRAG_MULTIPLIER (80×) over the 2-second animation window.
 *   A fully deployed chute applies the full 80× multiplier.
 *
 *   Additionally, the effective Cd multiplier is scaled down when atmospheric
 *   density falls below LOW_DENSITY_THRESHOLD (0.1 kg/m³):
 *
 *     effectiveMult = baseMult × min(1, density / LOW_DENSITY_THRESHOLD)
 *
 *   This ensures parachutes are ineffective in near-vacuum conditions.
 *
 * MASS SAFETY CHECK
 *   When a deploying chute transitions to fully deployed, the current total
 *   rocket mass is compared against the part's `maxSafeMass` property.  If
 *   the mass exceeds `maxSafeMass`, the chute is marked `failed`, removed
 *   from the rocket's active parts, and a PARACHUTE_FAILED event is emitted.
 *
 * CONTEXT MENU
 *   `getParachuteContextMenuItems(ps, assembly)` returns a list of objects
 *   describing each parachute's current state and available actions.  The
 *   flight UI layer calls this to build right-click / action menus.
 *   `deployParachute` can also be called directly from a context menu action.
 *
 * PUBLIC API
 *   ParachuteState                                                 {enum}
 *   DEPLOY_DURATION                                                {number}
 *   LOW_DENSITY_THRESHOLD                                          {number}
 *   initParachuteStates(ps, assembly)                             → void
 *   deployParachute(ps, instanceId)                               → void
 *   tickParachutes(ps, assembly, flightState, dt, totalMass)      → void
 *   tickCanopyAngles(ps, dt)                                     → void
 *   getChuteMultiplier(ps, instanceId, density)                   → number
 *   getParachuteStatus(ps, instanceId)                            → string
 *   getParachuteContextMenuItems(ps, assembly)                    → Object[]
 *
 * @module parachute
 */

import { getPartById } from '../data/parts.js';
import { PartType }    from './constants.js';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Parachute lifecycle states.
 */
export const ParachuteState = Object.freeze({
  /** Stowed — not yet deployed; only the normal aerodynamic profile applies. */
  PACKED:    'packed',
  /** Deployment in progress — the canopy is opening (animation window, 2 s). */
  DEPLOYING: 'deploying',
  /** Fully open — maximum density-scaled chute drag is applied each tick. */
  DEPLOYED:  'deployed',
  /** Deployment failed — rocket mass exceeded maxSafeMass; no drag applied. */
  FAILED:    'failed',
} as const);

export type ParachuteState = (typeof ParachuteState)[keyof typeof ParachuteState];

/** Duration of the deploying → deployed animation transition in seconds. */
export const DEPLOY_DURATION = 1.5;

/** Seconds after landing before deployed parachutes auto-stow to packed. */
export const POST_LANDING_STOW_DELAY = 3.0;

/**
 * Atmospheric density threshold below which chute effectiveness is reduced
 * (kg/m³).  Above this value the chute runs at full effectiveness.
 */
export const LOW_DENSITY_THRESHOLD = 0.1;

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/**
 * Cd multiplier applied to a fully deployed parachute relative to its stowed
 * drag coefficient.  Must match the CHUTE_DRAG_MULTIPLIER values in physics.js
 * and staging.js that handled the pre-module binary check.
 */
const CHUTE_DRAG_MULTIPLIER = 80;

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

/**
 * Per-parachute entry stored in PhysicsState.parachuteStates.
 */
export interface ParachuteEntry {
  /** One of the ParachuteState values. */
  state: string;
  /** Seconds remaining in the deploying animation. 0 when not DEPLOYING. */
  deployTimer: number;
  /** Independent canopy orientation (radians). 0 = upright. */
  canopyAngle: number;
  /** Angular velocity of the canopy (rad/s). */
  canopyAngularVel: number;
  /** Seconds remaining until auto-stow (post-landing). 0 or undefined when not active. */
  stowTimer?: number;
}

/**
 * Minimal physics state shape required by parachute functions.
 */
interface ParachutePhysicsState {
  parachuteStates: Map<string, ParachuteEntry>;
  activeParts: Set<string>;
  deployedParts?: Set<string>;
  posY?: number;
  angle?: number;
}

/**
 * Minimal physics state shape that may lack parachuteStates (e.g. debris).
 */
interface PartialParachuteState {
  parachuteStates?: Map<string, ParachuteEntry>;
  activeParts: Set<string>;
  deployedParts?: Set<string>;
  posY?: number;
  angle?: number;
}

/**
 * Minimal assembly shape required by parachute functions.
 */
interface ParachuteAssembly {
  parts: Map<string, { partId: string }>;
}

/**
 * Minimal flight state shape required by parachute functions.
 */
interface ParachuteFlightState {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  events: Array<any>;
  timeElapsed: number;
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Populate `ps.parachuteStates` with a `packed` entry for every PARACHUTE
 * part currently in `ps.activeParts`.
 *
 * Call this once inside `createPhysicsState` after the state object has been
 * constructed.  Safe to call again — existing entries are preserved.
 */
export function initParachuteStates(
  ps: ParachutePhysicsState,
  assembly: ParachuteAssembly,
): void {
  for (const [instanceId, placed] of assembly.parts) {
    if (!ps.activeParts.has(instanceId)) continue;
    if (ps.parachuteStates.has(instanceId)) continue; // already initialised
    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.PARACHUTE) continue;
    ps.parachuteStates.set(instanceId, {
      state:            ParachuteState.PACKED,
      deployTimer:      0,
      canopyAngle:      0,
      canopyAngularVel: 0,
      stowTimer:        0,
    });
  }
}

// ---------------------------------------------------------------------------
// Deployment trigger
// ---------------------------------------------------------------------------

/**
 * Initiate deployment of the specified parachute.
 *
 * Transitions the parachute from `packed` → `deploying` and starts the
 * {@link DEPLOY_DURATION} countdown.  If the chute is already in any other
 * state (deploying, deployed, or failed) this function is a no-op.
 *
 * Can be called from:
 *   - staging.js when an in-flight stage fires a DEPLOY activation.
 *   - A flight-scene context menu when the player manually deploys the chute.
 */
export function deployParachute(
  ps: PartialParachuteState,
  instanceId: string,
): void {
  if (!ps.parachuteStates) return;

  let entry = ps.parachuteStates.get(instanceId);
  if (!entry) {
    // Late-initialise for parts that weren't present at createPhysicsState time.
    entry = { state: ParachuteState.PACKED, deployTimer: 0, canopyAngle: 0, canopyAngularVel: 0, stowTimer: 0 };
    ps.parachuteStates.set(instanceId, entry);
  }

  if (entry.state !== ParachuteState.PACKED) return;

  entry.state            = ParachuteState.DEPLOYING;
  entry.deployTimer      = DEPLOY_DURATION;
  // Initialise canopy orientation to the rocket's current angle so it starts
  // aligned with the rocket and then springs toward upright independently.
  entry.canopyAngle      = ps.angle ?? 0;
  entry.canopyAngularVel = 0;
}

// ---------------------------------------------------------------------------
// Per-tick update
// ---------------------------------------------------------------------------

/**
 * Advance all parachute state machines by one fixed timestep.
 *
 * For every parachute in the DEPLOYING state:
 *   - Decrements `deployTimer` by `dt`.
 *   - When the timer reaches zero, attempts to transition to DEPLOYED.
 *   - At the moment of full deployment, checks `totalMass` against the part's
 *     `maxSafeMass` property:
 *       • If `totalMass > maxSafeMass` → transition to FAILED; the part is
 *         removed from `ps.activeParts` and `ps.deployedParts`; a
 *         PARACHUTE_FAILED event is appended to `flightState.events`.
 *       • Otherwise → transition to DEPLOYED; a PARACHUTE_DEPLOYED event is
 *         appended.
 *
 * Call once per fixed integration step from `_integrate` in physics.js.
 */
export function tickParachutes(
  ps: ParachutePhysicsState & { deployedParts: Set<string> },
  assembly: ParachuteAssembly,
  flightState: ParachuteFlightState,
  dt: number,
  totalMass: number,
): void {
  if (!ps.parachuteStates) return;

  for (const [instanceId, entry] of ps.parachuteStates) {
    if (entry.state !== ParachuteState.DEPLOYING) continue;

    entry.deployTimer -= dt;
    if (entry.deployTimer > 0) continue; // Still animating — nothing more to do.

    // --- Timer expired: attempt full deployment ---

    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;

    const maxSafeMass = (def?.properties?.maxSafeMass as number) ?? Infinity;
    const altitude    = Math.max(0, ps.posY ?? 0);
    const time        = flightState.timeElapsed;
    const partName    = def?.name ?? 'Parachute';

    if (totalMass > maxSafeMass) {
      // Rocket is too heavy — the parachute is destroyed on full deployment.
      entry.state = ParachuteState.FAILED;

      // Remove from the rocket's active and deployed part sets.
      ps.activeParts.delete(instanceId);
      ps.deployedParts.delete(instanceId);

      flightState.events.push({
        type:        'PARACHUTE_FAILED',
        time,
        instanceId,
        partName,
        altitude,
        description: `${partName} failed — rocket mass (${totalMass.toFixed(0)} kg) ` +
                     `exceeds safe limit (${maxSafeMass} kg).`,
      });
    } else {
      // Fully deployed successfully.
      entry.state = ParachuteState.DEPLOYED;

      flightState.events.push({
        type:        'PARACHUTE_DEPLOYED',
        time,
        instanceId,
        partName,
        altitude,
        description: `${partName} fully deployed at ${altitude.toFixed(0)} m.`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Canopy independent swing
// ---------------------------------------------------------------------------

/** Spring constant for canopy restoring torque toward upright. */
const CANOPY_SPRING_K = 12.0;

/** Angular damping coefficient for canopy swing. */
const CANOPY_DAMPING  = 8.0;

/**
 * Step every deploying/deployed parachute's independent canopy angle.
 *
 * The canopy is treated as a light object that quickly orients upward
 * (angle → 0) via a strong spring + damping, independent of the rocket body.
 */
export function tickCanopyAngles(
  ps: PartialParachuteState,
  dt: number,
): void {
  if (!ps.parachuteStates) return;

  for (const [, entry] of ps.parachuteStates) {
    if (entry.state !== ParachuteState.DEPLOYING && entry.state !== ParachuteState.DEPLOYED) continue;

    // Spring torque toward upright (angle = 0) + angular damping.
    const accel = -CANOPY_SPRING_K * entry.canopyAngle - CANOPY_DAMPING * entry.canopyAngularVel;
    entry.canopyAngularVel += accel * dt;
    entry.canopyAngle      += entry.canopyAngularVel * dt;
  }
}

// ---------------------------------------------------------------------------
// Post-landing swing & auto-stow
// ---------------------------------------------------------------------------

/**
 * Tick deployed/deploying parachutes while the rocket is landed.
 *
 * Springs the canopy angle toward PI (hanging straight down under gravity)
 * and counts down the stow timer.  When the timer expires, the parachute
 * resets to PACKED so it can be reused on a subsequent flight.
 */
export function tickLandedParachutes(
  ps: PartialParachuteState,
  dt: number,
): void {
  if (!ps.parachuteStates) return;

  for (const [, entry] of ps.parachuteStates) {
    if (entry.state !== ParachuteState.DEPLOYING && entry.state !== ParachuteState.DEPLOYED) continue;

    // Spring canopy toward PI (hanging down) instead of 0 (upright).
    const targetAngle = Math.PI;
    const accel = -CANOPY_SPRING_K * (entry.canopyAngle - targetAngle) - CANOPY_DAMPING * entry.canopyAngularVel;
    entry.canopyAngularVel += accel * dt;
    entry.canopyAngle      += entry.canopyAngularVel * dt;

    // Lazily start stow timer on first landed tick.
    if (!((entry.stowTimer ?? 0) > 0)) {
      entry.stowTimer = POST_LANDING_STOW_DELAY;
    }

    entry.stowTimer = (entry.stowTimer ?? 0) - dt;
    if (entry.stowTimer <= 0) {
      // Auto-stow: reset to packed state for reuse.
      entry.state            = ParachuteState.PACKED;
      entry.canopyAngle      = 0;
      entry.canopyAngularVel = 0;
      entry.deployTimer      = 0;
      entry.stowTimer        = 0;
    }
  }
}

// ---------------------------------------------------------------------------
// Effective drag multiplier
// ---------------------------------------------------------------------------

/**
 * Return the effective Cd multiplier for a parachute part at the given
 * atmospheric density.
 *
 * The multiplier determines how many times the part's base drag coefficient
 * (`def.properties.dragCoefficient`) is amplified by the open canopy:
 *
 *   | State      | Base multiplier                                  |
 *   |------------|--------------------------------------------------|
 *   | packed     | 1  (stowed — normal drag profile)                |
 *   | deploying  | 1 … 80  (linear ramp over DEPLOY_DURATION)       |
 *   | deployed   | 80  (fully open canopy)                          |
 *   | failed     | 1  (destroyed — no canopy contribution)          |
 *
 * Density scaling (applied to the chute-specific additional drag only):
 *   When `density < LOW_DENSITY_THRESHOLD` the chute contribution is reduced
 *   proportionally so that parachutes are ineffective in near-vacuum conditions:
 *
 *     chuteFactor   = baseMult − 1
 *     densityScale  = clamp(density / LOW_DENSITY_THRESHOLD, 0, 1)
 *     effectiveMult = 1 + chuteFactor × densityScale
 *
 * Falls back to a binary deployed/stowed check using `ps.deployedParts` when
 * `ps.parachuteStates` is absent (e.g., legacy debris fragments).
 */
export function getChuteMultiplier(
  ps: PartialParachuteState,
  instanceId: string,
  density: number,
): number {
  // --- Legacy fallback for debris fragments without parachuteStates ---
  if (!ps.parachuteStates) {
    return ps.deployedParts?.has(instanceId) ? CHUTE_DRAG_MULTIPLIER : 1;
  }

  const entry = ps.parachuteStates.get(instanceId);
  if (!entry) {
    // Not tracked — treat as packed (normal drag only).
    return 1;
  }

  // --- Compute base multiplier from current state ---
  let baseMult: number;
  switch (entry.state) {
    case ParachuteState.PACKED:
    case ParachuteState.FAILED:
      baseMult = 1;
      break;

    case ParachuteState.DEPLOYING: {
      // Linear ramp: drag builds steadily as canopy inflates.
      const progress = Math.max(0, Math.min(1,
        1 - entry.deployTimer / DEPLOY_DURATION,
      ));
      baseMult = 1 + (CHUTE_DRAG_MULTIPLIER - 1) * progress;
      break;
    }

    case ParachuteState.DEPLOYED:
      baseMult = CHUTE_DRAG_MULTIPLIER;
      break;

    default:
      baseMult = 1;
  }

  // --- Apply density scaling to the chute-specific drag contribution ---
  const chuteFactor  = baseMult - 1; // Additional drag above normal profile.
  const densityScale = density < LOW_DENSITY_THRESHOLD
    ? Math.max(0, density / LOW_DENSITY_THRESHOLD)
    : 1;

  return 1 + chuteFactor * densityScale;
}

// ---------------------------------------------------------------------------
// Status query
// ---------------------------------------------------------------------------

/**
 * Return the current state string for the given parachute instance.
 *
 * Returns {@link ParachuteState.PACKED} when:
 *   - `ps.parachuteStates` is absent (debris without state map).
 *   - The instance ID is not tracked.
 */
export function getParachuteStatus(
  ps: PartialParachuteState,
  instanceId: string,
): string {
  if (!ps.parachuteStates) return ParachuteState.PACKED;
  const entry = ps.parachuteStates.get(instanceId);
  return entry ? entry.state : ParachuteState.PACKED;
}

// ---------------------------------------------------------------------------
// Context menu helpers
// ---------------------------------------------------------------------------

/** Shape of one context menu item returned by getParachuteContextMenuItems. */
export interface ParachuteContextMenuItem {
  instanceId:  string;
  name:        string;
  state:       string;
  statusLabel: string;
  canDeploy:   boolean;
  deployTimer: number | null;
}

/**
 * Build a list of context menu items for all PARACHUTE parts in the rocket.
 *
 * Each item describes the current state of one parachute and optionally
 * provides a deployable action.  The flight UI layer calls this function to
 * populate a right-click or action panel menu.
 */
export function getParachuteContextMenuItems(
  ps: PartialParachuteState,
  assembly: ParachuteAssembly,
): ParachuteContextMenuItem[] {
  const items: ParachuteContextMenuItem[] = [];

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.PARACHUTE) continue;

    const state = getParachuteStatus(ps, instanceId);

    let statusLabel: string;
    let deployTimer: number | null = null;
    switch (state) {
      case ParachuteState.PACKED:
        statusLabel = 'Packed (ready)';
        break;
      case ParachuteState.DEPLOYING: {
        const entry = ps.parachuteStates?.get(instanceId);
        deployTimer = entry ? Math.max(0, entry.deployTimer) : null;
        statusLabel = deployTimer !== null
          ? `Deploying… (${deployTimer.toFixed(1)} s)`
          : 'Deploying…';
        break;
      }
      case ParachuteState.DEPLOYED:
        statusLabel = 'Deployed';
        break;
      case ParachuteState.FAILED:
        statusLabel = 'Failed (destroyed)';
        break;
      default:
        statusLabel = state;
    }

    items.push({
      instanceId,
      name:        def.name,
      state,
      statusLabel,
      canDeploy:   state === ParachuteState.PACKED,
      deployTimer,
    });
  }

  return items;
}
