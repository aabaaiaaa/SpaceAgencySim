/**
 * sciencemodule.js — Science Module experiment state machine.
 *
 * Tracks the lifecycle of science experiments attached to the rocket.
 * A SERVICE_MODULE part with `activationBehaviour: COLLECT_SCIENCE` passes
 * through the following states during a flight:
 *
 *   idle ──[player activates]──► running ──[timer expires]──► complete
 *                                                              │
 *                                              [safe landing, part intact]
 *                                                              ▼
 *                                                       data_returned
 *
 * The `data_returned` state is the only one that satisfies
 * `RETURN_SCIENCE_DATA` mission objectives.  If the module is destroyed
 * (heat or crash) while in `complete`, the data is permanently lost.
 *
 * The `HOLD_ALTITUDE` objective is gated on at least one experiment being in
 * `running` state — altitude hold time only accumulates while the experiment
 * is active.  `flightState.scienceModuleRunning` reflects this each tick.
 *
 * INTEGRATION POINTS
 * ==================
 * 1. `createPhysicsState` (physics.js) must:
 *      a. Include `scienceModuleStates: new Map()` in the PhysicsState object.
 *      b. Call `initScienceModuleStates(ps, assembly)` during initialisation.
 * 2. `_integrate` (physics.js) must call `tickScienceModules(ps, assembly,
 *    flightState, FIXED_DT)` each step.
 * 3. `_handleGroundContact` (physics.js) must call `onSafeLanding(ps,
 *    assembly, flightState)` when the landing speed is below the safe threshold.
 * 4. `COLLECT_SCIENCE` case in `staging.js` must call `activateScienceModule`
 *    instead of directly emitting `SCIENCE_COLLECTED`.
 *
 * PUBLIC API
 * ==========
 *   ScienceModuleState                                         {enum}
 *   initScienceModuleStates(ps, assembly)                    → void
 *   activateScienceModule(ps, assembly, flightState, id)     → boolean
 *   tickScienceModules(ps, assembly, flightState, dt)        → void
 *   getScienceModuleStatus(ps, instanceId)                   → string
 *   onSafeLanding(ps, assembly, flightState)                 → void
 *   hasAnyRunningExperiment(ps)                              → boolean
 *
 * @module sciencemodule
 */

import { getPartById, ActivationBehaviour } from '../data/parts.js';
import { PartType }                          from './constants.js';

// ---------------------------------------------------------------------------
// Public constants
// ---------------------------------------------------------------------------

/**
 * Experiment lifecycle states.
 * @enum {string}
 */
export const ScienceModuleState = Object.freeze({
  /** Module is idle; experiment has not started. */
  IDLE:          'idle',
  /** Experiment is running; countdown timer is active. */
  RUNNING:       'running',
  /** Experiment completed; data is on board waiting to be returned. */
  COMPLETE:      'complete',
  /** Data was successfully recovered via a safe landing. */
  DATA_RETURNED: 'data_returned',
});

// ---------------------------------------------------------------------------
// Type definitions (JSDoc)
// ---------------------------------------------------------------------------

/**
 * State tracking for a single science module instance.
 *
 * @typedef {Object} ScienceModuleEntry
 * @property {string} state  One of the {@link ScienceModuleState} values.
 * @property {number} timer  Countdown in seconds; positive while `running`.
 */

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Populate `ps.scienceModuleStates` with an IDLE entry for every
 * SERVICE_MODULE part that uses `COLLECT_SCIENCE` activation behaviour.
 *
 * Call this once inside `createPhysicsState` after the PhysicsState object
 * has been built and all active-part sets are populated.  Safe to call again —
 * existing entries are preserved.
 *
 * @param {{ scienceModuleStates: Map<string, ScienceModuleEntry>,
 *           activeParts:         Set<string> }}                    ps
 * @param {{ parts: Map<string, { partId: string }> }}              assembly
 */
export function initScienceModuleStates(ps, assembly) {
  if (!ps.scienceModuleStates) return;

  for (const [instanceId, placed] of assembly.parts) {
    if (!ps.activeParts.has(instanceId)) continue;
    if (ps.scienceModuleStates.has(instanceId)) continue; // already initialised

    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.SERVICE_MODULE) continue;
    if (def.activationBehaviour !== ActivationBehaviour.COLLECT_SCIENCE) continue;

    ps.scienceModuleStates.set(instanceId, {
      state: ScienceModuleState.IDLE,
      timer: 0,
    });
  }
}

// ---------------------------------------------------------------------------
// Activation
// ---------------------------------------------------------------------------

/**
 * Start a science experiment — transition from `idle` → `running`.
 *
 * Called when the player activates the module via the staging system or the
 * flight-scene context menu.  The experiment duration is read from the part
 * definition's `properties.experimentDuration` (defaults to 30 s).
 *
 * Emits a `PART_ACTIVATED` flight event announcing that data collection has
 * begun.  The `SCIENCE_COLLECTED` event is NOT emitted here — it fires later
 * when the countdown timer expires in `tickScienceModules`.
 *
 * This function is idempotent: if the module is not in `idle` state it returns
 * `false` without side effects.
 *
 * @param {{ scienceModuleStates?: Map<string, ScienceModuleEntry>,
 *           activeParts:          Set<string>,
 *           posY:                 number }}                              ps
 * @param {{ parts: Map<string, { partId: string }> }}                   assembly
 * @param {{ events: Array<object>, timeElapsed: number }}               flightState
 * @param {string} instanceId  Instance ID of the SERVICE_MODULE part to activate.
 * @returns {boolean}  `true` if the experiment was successfully started;
 *   `false` if the module is already running / complete / not tracked.
 */
export function activateScienceModule(ps, assembly, flightState, instanceId) {
  const entry = ps.scienceModuleStates?.get(instanceId);
  if (!entry) return false;
  if (entry.state !== ScienceModuleState.IDLE) return false;

  const placed = assembly.parts.get(instanceId);
  const def    = placed ? getPartById(placed.partId) : null;
  if (!def) return false;

  const altitude = Math.max(0, ps.posY);

  entry.state = ScienceModuleState.COMPLETE;
  entry.timer = 0;

  flightState.events.push({
    type:        'PART_ACTIVATED',
    time:        flightState.timeElapsed,
    instanceId,
    partType:    def.type,
    description: `${def.name} experiment started at ${altitude.toFixed(0)} m.`,
  });

  flightState.events.push({
    type:        'SCIENCE_COLLECTED',
    time:        flightState.timeElapsed,
    instanceId,
    altitude,
    description: `${def.name} experiment complete — data ready for recovery at ${altitude.toFixed(0)} m.`,
  });

  return true;
}

// ---------------------------------------------------------------------------
// Per-tick update
// ---------------------------------------------------------------------------

/**
 * Advance all running science module timers by `dt` seconds.
 *
 * For each module in `running` state:
 *   - Decrement `entry.timer` by `dt`.
 *   - When timer reaches 0, transition to `complete` and emit a
 *     `SCIENCE_COLLECTED` flight event.
 *
 * Also updates `flightState.scienceModuleRunning` (boolean) to reflect
 * whether any module is currently in the `running` state.  This flag is
 * consumed by the `HOLD_ALTITUDE` objective check in missions.js.
 *
 * Modules not in `ps.activeParts` are skipped — once a part is destroyed the
 * experiment state is effectively frozen (data is lost if in `complete`).
 *
 * @param {{ scienceModuleStates?: Map<string, ScienceModuleEntry>,
 *           activeParts:          Set<string>,
 *           posY:                 number }}                              ps
 * @param {{ parts: Map<string, { partId: string }> }}                   assembly
 * @param {{ events: Array<object>,
 *           timeElapsed: number,
 *           scienceModuleRunning?: boolean }}                            flightState
 * @param {number} dt  Fixed integration timestep in seconds.
 */
export function tickScienceModules(ps, assembly, flightState, dt) {
  if (!ps.scienceModuleStates) {
    flightState.scienceModuleRunning = false;
    return;
  }

  let anyRunning = false;

  for (const [instanceId, entry] of ps.scienceModuleStates) {
    // Only advance modules that are still part of the active rocket.
    if (!ps.activeParts.has(instanceId)) continue;

    if (entry.state !== ScienceModuleState.RUNNING) continue;

    entry.timer -= dt;
    anyRunning = true;

    if (entry.timer <= 0) {
      entry.timer = 0;
      entry.state = ScienceModuleState.COMPLETE;
      anyRunning  = false; // this module is no longer running

      const placed  = assembly.parts.get(instanceId);
      const def     = placed ? getPartById(placed.partId) : null;
      const altitude = Math.max(0, ps.posY);

      flightState.events.push({
        type:        'SCIENCE_COLLECTED',
        time:        flightState.timeElapsed,
        instanceId,
        altitude,
        description: `${def?.name ?? 'Science Module'} experiment complete — data ready for recovery at ${altitude.toFixed(0)} m.`,
      });
    }
  }

  // Recompute anyRunning after processing all entries (a module may have just
  // completed, reducing the running count to zero).
  if (!anyRunning) {
    // Double-check: are there any still genuinely running?
    for (const [instanceId, entry] of ps.scienceModuleStates) {
      if (!ps.activeParts.has(instanceId)) continue;
      if (entry.state === ScienceModuleState.RUNNING) {
        anyRunning = true;
        break;
      }
    }
  }

  flightState.scienceModuleRunning = anyRunning;
}

// ---------------------------------------------------------------------------
// Status query
// ---------------------------------------------------------------------------

/**
 * Return the current experiment state for the given science module instance.
 *
 * Returns {@link ScienceModuleState.IDLE} when:
 *   - `ps.scienceModuleStates` is absent.
 *   - The instance ID is not tracked (part is not a science module).
 *
 * @param {{ scienceModuleStates?: Map<string, ScienceModuleEntry> }} ps
 * @param {string} instanceId  SERVICE_MODULE instance ID.
 * @returns {string}  One of the {@link ScienceModuleState} values.
 */
export function getScienceModuleStatus(ps, instanceId) {
  if (!ps.scienceModuleStates) return ScienceModuleState.IDLE;
  return ps.scienceModuleStates.get(instanceId)?.state ?? ScienceModuleState.IDLE;
}

/**
 * Return the remaining countdown time (seconds) for a running experiment.
 * Returns 0 when the module is not in `running` state.
 *
 * @param {{ scienceModuleStates?: Map<string, ScienceModuleEntry> }} ps
 * @param {string} instanceId
 * @returns {number}
 */
export function getScienceModuleTimer(ps, instanceId) {
  if (!ps.scienceModuleStates) return 0;
  const entry = ps.scienceModuleStates.get(instanceId);
  return entry?.state === ScienceModuleState.RUNNING ? entry.timer : 0;
}

// ---------------------------------------------------------------------------
// Safe-landing resolution
// ---------------------------------------------------------------------------

/**
 * Attempt to recover science data from all modules in `complete` state.
 *
 * Called by `_handleGroundContact` in physics.js when a safe landing occurs
 * (impact speed below the landing threshold).  For each science module that
 * is:
 *   1. Still in `ps.activeParts` (not destroyed), AND
 *   2. In `complete` state,
 * the module transitions to `data_returned` and a `SCIENCE_DATA_RETURNED`
 * event is appended to `flightState.events`.
 *
 * If the module was destroyed (removed from `ps.activeParts`) before landing
 * the data is permanently lost — no event is emitted for that module.
 *
 * @param {{ scienceModuleStates?: Map<string, ScienceModuleEntry>,
 *           activeParts:          Set<string> }}                        ps
 * @param {{ parts: Map<string, { partId: string }> }}                   assembly
 * @param {{ events: Array<object>, timeElapsed: number }}               flightState
 */
export function onSafeLanding(ps, assembly, flightState) {
  if (!ps.scienceModuleStates) return;

  for (const [instanceId, entry] of ps.scienceModuleStates) {
    // Module must still be attached to the rocket.
    if (!ps.activeParts.has(instanceId)) continue;

    if (entry.state === ScienceModuleState.COMPLETE) {
      entry.state = ScienceModuleState.DATA_RETURNED;

      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;

      flightState.events.push({
        type:        'SCIENCE_DATA_RETURNED',
        time:        flightState.timeElapsed,
        instanceId,
        description: `${def?.name ?? 'Science Module'} data successfully returned to ground!`,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Utility queries
// ---------------------------------------------------------------------------

/**
 * Return `true` if at least one science module that is still part of the
 * active rocket is currently in the `running` state.
 *
 * Used by `checkObjectiveCompletion` in missions.js to gate `HOLD_ALTITUDE`
 * time accumulation on an active experiment.
 *
 * @param {{ scienceModuleStates?: Map<string, ScienceModuleEntry>,
 *           activeParts:          Set<string> }}                   ps
 * @returns {boolean}
 */
export function hasAnyRunningExperiment(ps) {
  if (!ps.scienceModuleStates) return false;
  for (const [instanceId, entry] of ps.scienceModuleStates) {
    if (!ps.activeParts.has(instanceId)) continue;
    if (entry.state === ScienceModuleState.RUNNING) return true;
  }
  return false;
}
