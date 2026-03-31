/**
 * missions.js — Mission lifecycle management.
 *
 * This module provides all mission-related game logic: unlocking, accepting,
 * objective tracking, and completion.  It operates on the central GameState
 * and reads mission template definitions from `/src/data/missions.js`.
 *
 * ARCHITECTURE
 * ============
 * Static mission *definitions* live in `src/data/missions.js` (MISSIONS array).
 * Live mission *instances* — copies of those definitions with mutable status
 * and objective flags — live in `state.missions.{available,accepted,completed}`.
 *
 * `initializeMissions(state)` seeds the state from the catalog on game start.
 * After each mission completes, `completeMission()` calls `getUnlockedMissions()`
 * to move any newly-satisfied missions into the available bucket automatically.
 *
 * FLIGHT EVENT CONTRACT
 * =====================
 * `checkObjectiveCompletion()` inspects `flightState.events` for specific event
 * types.  The physics / flight runner is responsible for emitting these events
 * with the fields documented below:
 *
 *   'LANDING'           — { type, time, speed: number, description }
 *   'CRASH'             — { type, time, speed: number, description }
 *   'PART_ACTIVATED'    — { type, time, partType: string, description }
 *   'SCIENCE_COLLECTED' — { type, time, description }
 *   'CREW_EJECTED'      — { type, time, altitude: number, description }
 *   'SATELLITE_RELEASED'— { type, time, altitude: number, description }
 *
 * @module missions
 */

import { MISSIONS, MissionStatus, ObjectiveType } from '../data/missions.js';
import { earn } from './finance.js';
import { getTechTreeUnlockedParts } from './techtree.js';
import { awardFacility } from './construction.js';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Create a deep copy of a mission template for use as a live instance.
 * All scalar fields are copied; arrays and nested objects are shallow-cloned
 * one level deep, which is sufficient for the mission data shape.
 *
 * @param {import('../data/missions.js').MissionDef} def
 * @returns {import('../data/missions.js').MissionDef}
 */
function _copyMission(def) {
  return {
    id: def.id,
    title: def.title,
    description: def.description,
    location: def.location,
    objectives: def.objectives.map((obj) => ({ ...obj })),
    reward: def.reward,
    unlocksAfter: [...def.unlocksAfter],
    unlockedParts: [...def.unlockedParts],
    requiredParts: def.requiredParts ? [...def.requiredParts] : [],
    status: def.status,
  };
}

// ---------------------------------------------------------------------------
// Initialisation
// ---------------------------------------------------------------------------

/**
 * Seed `state.missions.available` from the MISSIONS catalog.
 * Should be called once when creating a new game.
 *
 * Missions whose `unlocksAfter` array is empty (or whose initial `status`
 * is already 'available') are added to the available bucket.  All other
 * missions are implicitly locked and will appear via `getUnlockedMissions()`
 * as prerequisites are met.
 *
 * @param {import('./gameState.js').GameState} state
 */
export function initializeMissions(state) {
  for (const def of MISSIONS) {
    if (def.unlocksAfter.length === 0 || def.status === MissionStatus.AVAILABLE) {
      state.missions.available.push(_copyMission(def));
    }
  }
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/**
 * Return all missions currently visible on the mission board.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {import('../data/missions.js').MissionDef[]}
 */
export function getAvailableMissions(state) {
  return state.missions.available;
}

/**
 * Return all part IDs that have been unlocked so far.
 *
 * Collects parts from three sources:
 *   1. `state.parts` (starter parts and previously granted parts).
 *   2. `unlockedParts` from every completed mission.
 *   3. Parts unlocked via tech tree research.
 *
 * Returns a deduplicated array.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {string[]}
 */
export function getUnlockedParts(state) {
  const ids = new Set(state.parts);

  for (const completedMission of state.missions.completed) {
    const def = MISSIONS.find((m) => m.id === completedMission.id);
    if (def) {
      for (const partId of def.unlockedParts) {
        ids.add(partId);
      }
    }
  }

  // Include parts unlocked via the tech tree.
  for (const partId of getTechTreeUnlockedParts(state)) {
    ids.add(partId);
  }

  return [...ids];
}

/**
 * Ensure the player owns all parts they should have based on mission progress.
 *
 * Checks completed missions for `unlockedParts` (rewards) and accepted/completed
 * missions for `requiredParts` (needed to attempt the mission).  Any missing
 * parts are added to `state.parts`.  This handles old saves created before
 * `requiredParts` existed or before starter parts were reduced.
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {string[]}  Part IDs that were added.
 */
export function reconcileParts(state) {
  const owned = new Set(state.parts);
  const added = [];

  const allMissions = [
    ...(state.missions.accepted ?? []),
    ...(state.missions.completed ?? []),
  ];

  for (const mission of allMissions) {
    const def = MISSIONS.find((m) => m.id === mission.id);
    if (!def) continue;

    // requiredParts — unlocked on acceptance.
    const reqParts = mission.requiredParts ?? def.requiredParts ?? [];
    for (const partId of reqParts) {
      if (!owned.has(partId)) {
        state.parts.push(partId);
        owned.add(partId);
        added.push(partId);
      }
    }
  }

  // unlockedParts — rewards from completed missions.
  for (const mission of state.missions.completed ?? []) {
    const def = MISSIONS.find((m) => m.id === mission.id);
    if (!def) continue;
    for (const partId of def.unlockedParts) {
      if (!owned.has(partId)) {
        state.parts.push(partId);
        owned.add(partId);
        added.push(partId);
      }
    }
  }

  return added;
}

/**
 * Check the MISSIONS catalog for templates whose prerequisites have all been
 * completed.  Any such mission not yet tracked in state is copied into
 * `state.missions.available`.
 *
 * This function is called automatically by `completeMission()` but can also
 * be called manually (e.g. when loading a save to reconcile state).
 *
 * @param {import('./gameState.js').GameState} state
 * @returns {import('../data/missions.js').MissionDef[]} Newly unlocked mission instances.
 */
export function getUnlockedMissions(state) {
  const completedIds = new Set(state.missions.completed.map((m) => m.id));

  // Build the full set of mission IDs already tracked in any bucket.
  const trackedIds = new Set([
    ...state.missions.available.map((m) => m.id),
    ...state.missions.accepted.map((m) => m.id),
    ...state.missions.completed.map((m) => m.id),
  ]);

  const newlyUnlocked = [];

  for (const def of MISSIONS) {
    // Skip missions already in state.
    if (trackedIds.has(def.id)) continue;

    // Check that every prerequisite mission has been completed.
    const prereqsMet = def.unlocksAfter.every((prereqId) => completedIds.has(prereqId));
    if (!prereqsMet) continue;

    const instance = _copyMission(def);
    instance.status = MissionStatus.AVAILABLE;
    state.missions.available.push(instance);
    newlyUnlocked.push(instance);
  }

  return newlyUnlocked;
}

// ---------------------------------------------------------------------------
// Lifecycle mutations
// ---------------------------------------------------------------------------

/**
 * Accept a mission from the available board.
 *
 * Moves the mission from `state.missions.available` to `state.missions.accepted`
 * and updates its status to 'accepted'.  Returns a failure result if the
 * mission is not found in the available bucket.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} id  Mission ID to accept.
 * @returns {{ success: boolean, mission?: import('../data/missions.js').MissionDef, error?: string }}
 */
export function acceptMission(state, id) {
  const idx = state.missions.available.findIndex((m) => m.id === id);
  if (idx === -1) {
    return { success: false, error: `Mission '${id}' is not in the available list.` };
  }

  const [mission] = state.missions.available.splice(idx, 1);
  mission.status = MissionStatus.ACCEPTED;
  state.missions.accepted.push(mission);

  // Unlock any parts the mission requires to be completable.
  // Fall back to the catalog definition for saves created before requiredParts existed.
  const reqParts = mission.requiredParts
    ?? MISSIONS.find((d) => d.id === mission.id)?.requiredParts
    ?? [];
  const unlockedParts = [];
  if (reqParts.length > 0) {
    const owned = new Set(state.parts);
    for (const partId of reqParts) {
      if (!owned.has(partId)) {
        state.parts.push(partId);
        owned.add(partId);
        unlockedParts.push(partId);
      }
    }
  }

  // Award a facility on acceptance if the mission template specifies one.
  // Used by tutorial missions that need the facility built BEFORE the player
  // can complete the mission objectives (e.g. "use the R&D Lab").
  let awardedFacility = null;
  const def = MISSIONS.find((d) => d.id === mission.id);
  if (def?.awardsFacilityOnAccept) {
    const facilityResult = awardFacility(state, def.awardsFacilityOnAccept);
    if (facilityResult.success) {
      awardedFacility = def.awardsFacilityOnAccept;
    }
  }

  return { success: true, mission, unlockedParts, awardedFacility };
}

/**
 * Complete a mission after all objectives have been met.
 *
 * Moves the mission from `state.missions.accepted` to `state.missions.completed`,
 * awards the mission reward via `earn()`, adds any unlocked parts to `state.parts`,
 * and then triggers `getUnlockedMissions()` to surface newly available missions.
 *
 * Returns a failure result if the mission is not currently in the accepted bucket.
 *
 * @param {import('./gameState.js').GameState} state
 * @param {string} id  Mission ID to complete.
 * @returns {{
 *   success: boolean,
 *   mission?: import('../data/missions.js').MissionDef,
 *   reward?: number,
 *   unlockedParts?: string[],
 *   newlyUnlockedMissions?: import('../data/missions.js').MissionDef[],
 *   error?: string
 * }}
 */
export function completeMission(state, id) {
  const idx = state.missions.accepted.findIndex((m) => m.id === id);
  if (idx === -1) {
    return { success: false, error: `Mission '${id}' is not in the accepted list.` };
  }

  const [mission] = state.missions.accepted.splice(idx, 1);
  mission.status = MissionStatus.COMPLETED;
  mission.completedDate = new Date().toISOString();
  state.missions.completed.push(mission);

  // Award the cash reward.
  earn(state, mission.reward);

  // Unlock any parts gated on this mission.
  // The canonical unlock list comes from the template definition so that
  // edits to templates are reflected even on loaded saves.
  const def = MISSIONS.find((m) => m.id === id);
  const unlockedParts = [];
  let awardedFacility = null;
  if (def) {
    for (const partId of def.unlockedParts) {
      if (!state.parts.includes(partId)) {
        state.parts.push(partId);
        unlockedParts.push(partId);
      }
    }

    // Award a facility if the mission template specifies one (tutorial mode).
    if (def.unlocksFacility) {
      const facilityResult = awardFacility(state, def.unlocksFacility);
      if (facilityResult.success) {
        awardedFacility = def.unlocksFacility;
      }
    }
  }

  // Surface any missions whose prerequisites are now satisfied.
  const newlyUnlockedMissions = getUnlockedMissions(state);

  return {
    success: true,
    mission,
    reward: mission.reward,
    unlockedParts,
    awardedFacility,
    newlyUnlockedMissions,
  };
}

// ---------------------------------------------------------------------------
// Objective checking (called each physics tick)
// ---------------------------------------------------------------------------

/**
 * Check and update objective completion for all accepted missions.
 *
 * This function should be called once per physics tick while a flight is active.
 * It iterates over ALL missions in `state.missions.accepted` and, for each
 * incomplete objective, determines whether the completion condition is satisfied
 * given the current flight state.
 *
 * For HOLD_ALTITUDE objectives, the function tracks the time the rocket first
 * entered the required altitude band using a private `_holdEnteredAt` field on
 * the objective instance.  The timer resets whenever the rocket leaves the band.
 *
 * No-ops (returns immediately) when:
 *   - `flightState` is null / falsy
 *   - No accepted missions exist
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState} flightState  Live flight state from the physics engine.
 */
export function checkObjectiveCompletion(state, flightState) {
  if (!flightState) return;

  const accepted = state.missions.accepted;
  if (!accepted || accepted.length === 0) return;

  for (const mission of accepted) {
    if (!mission.objectives || mission.objectives.length === 0) continue;

    for (const obj of mission.objectives) {
      if (obj.completed) continue;

      switch (obj.type) {
        // ------------------------------------------------------------------
        case ObjectiveType.REACH_ALTITUDE:
          if (flightState.altitude >= obj.target.altitude) {
            obj.completed = true;
          }
          break;

        // ------------------------------------------------------------------
        case ObjectiveType.REACH_SPEED:
          if (flightState.velocity >= obj.target.speed) {
            obj.completed = true;
          }
          break;

        // ------------------------------------------------------------------
        case ObjectiveType.SAFE_LANDING: {
          const landingEvent = flightState.events.find(
            (e) =>
              e.type === 'LANDING' &&
              typeof e.speed === 'number' &&
              e.speed <= obj.target.maxLandingSpeed,
          );
          if (landingEvent) obj.completed = true;
          break;
        }

        // ------------------------------------------------------------------
        case ObjectiveType.ACTIVATE_PART: {
          const activationEvent = flightState.events.find(
            (e) => e.type === 'PART_ACTIVATED' && e.partType === obj.target.partType,
          );
          if (activationEvent) obj.completed = true;
          break;
        }

        // ------------------------------------------------------------------
        case ObjectiveType.HOLD_ALTITUDE: {
          const inRange =
            flightState.altitude >= obj.target.minAltitude &&
            flightState.altitude <= obj.target.maxAltitude;

          // When the rocket carries science modules, the experiment must be
          // running OR have already completed (SCIENCE_COLLECTED event) for
          // hold time to count.  If there are no science modules on this
          // flight, the gate is bypassed.
          const experimentOk =
            !flightState.hasScienceModules ||
            flightState.scienceModuleRunning === true ||
            flightState.events.some((e) => e.type === 'SCIENCE_COLLECTED');

          if (inRange && experimentOk) {
            if (obj._holdEnteredAt == null) {
              // Rocket just entered the altitude band — start timing.
              obj._holdEnteredAt = flightState.timeElapsed;
            } else if (flightState.timeElapsed - obj._holdEnteredAt >= obj.target.duration) {
              obj.completed = true;
            }
          } else {
            // Outside the altitude band, or experiment not running — reset timer.
            obj._holdEnteredAt = null;
          }
          break;
        }

        // ------------------------------------------------------------------
        case ObjectiveType.RETURN_SCIENCE_DATA: {
          // Requires both a SCIENCE_COLLECTED event (experiment ran) and a
          // safe LANDING event (speed ≤ 10 m/s) to recover the data.
          const scienceCollected = flightState.events.some(
            (e) => e.type === 'SCIENCE_COLLECTED',
          );
          const safeLanding = flightState.events.some(
            (e) => e.type === 'LANDING' && typeof e.speed === 'number' && e.speed <= 10,
          );
          if (scienceCollected && safeLanding) obj.completed = true;
          break;
        }

        // ------------------------------------------------------------------
        case ObjectiveType.CONTROLLED_CRASH: {
          const crashEvent = flightState.events.find(
            (e) =>
              (e.type === 'LANDING' || e.type === 'CRASH') &&
              typeof e.speed === 'number' &&
              e.speed >= obj.target.minCrashSpeed,
          );
          if (crashEvent) obj.completed = true;
          break;
        }

        // ------------------------------------------------------------------
        case ObjectiveType.EJECT_CREW: {
          const ejectEvent = flightState.events.find(
            (e) =>
              e.type === 'CREW_EJECTED' &&
              typeof e.altitude === 'number' &&
              e.altitude >= obj.target.minAltitude,
          );
          if (ejectEvent) obj.completed = true;
          break;
        }

        // ------------------------------------------------------------------
        case ObjectiveType.RELEASE_SATELLITE: {
          const releaseEvent = flightState.events.find(
            (e) =>
              e.type === 'SATELLITE_RELEASED' &&
              typeof e.altitude === 'number' &&
              e.altitude >= obj.target.minAltitude &&
              (obj.target.minVelocity == null ||
                (typeof e.velocity === 'number' &&
                  e.velocity >= obj.target.minVelocity)),
          );
          if (releaseEvent) obj.completed = true;
          break;
        }

        // ------------------------------------------------------------------
        case ObjectiveType.REACH_ORBIT:
          if (
            flightState.altitude >= obj.target.orbitAltitude &&
            flightState.velocity >= obj.target.orbitalVelocity
          ) {
            obj.completed = true;
          }
          break;

        // ------------------------------------------------------------------
        case ObjectiveType.MINIMUM_CREW:
          if (
            typeof flightState.crewCount === 'number' &&
            flightState.crewCount >= obj.target.minCrew
          ) {
            obj.completed = true;
          }
          break;

        // ------------------------------------------------------------------
        case ObjectiveType.MULTI_SATELLITE: {
          const releases = flightState.events.filter(
            (e) =>
              e.type === 'SATELLITE_RELEASED' &&
              typeof e.altitude === 'number' &&
              e.altitude >= obj.target.minAltitude,
          );
          if (releases.length >= obj.target.count) obj.completed = true;
          break;
        }

        // ------------------------------------------------------------------
        default:
          // Unknown objective type — silently skip to allow forward-compatibility.
          break;
      }
    }
  }
}
