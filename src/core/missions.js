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
 * Collects `unlockedParts` from every completed mission and merges them with
 * the base set already stored in `state.parts` (which includes starting parts
 * granted outside the mission system).  Returns a deduplicated array.
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

  return [...ids];
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

  return { success: true, mission };
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
  if (def) {
    for (const partId of def.unlockedParts) {
      if (!state.parts.includes(partId)) {
        state.parts.push(partId);
        unlockedParts.push(partId);
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
    newlyUnlockedMissions,
  };
}

// ---------------------------------------------------------------------------
// Objective checking (called each physics tick)
// ---------------------------------------------------------------------------

/**
 * Check and update objective completion for the flight currently in progress.
 *
 * This function should be called once per physics tick while a flight is active.
 * It finds the accepted mission matching `flightState.missionId` and, for each
 * incomplete objective, determines whether the completion condition is satisfied
 * given the current flight state.
 *
 * For HOLD_ALTITUDE objectives, the function tracks the time the rocket first
 * entered the required altitude band using a private `_holdEnteredAt` field on
 * the objective instance.  The timer resets whenever the rocket leaves the band.
 *
 * No-ops (returns immediately) when:
 *   - `flightState` is null / falsy
 *   - `flightState.missionId` is not set
 *   - No matching mission exists in `state.missions.accepted`
 *
 * @param {import('./gameState.js').GameState} state
 * @param {import('./gameState.js').FlightState} flightState  Live flight state from the physics engine.
 */
export function checkObjectiveCompletion(state, flightState) {
  if (!flightState || !flightState.missionId) return;

  const mission = state.missions.accepted.find((m) => m.id === flightState.missionId);
  if (!mission) return;

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

        if (inRange) {
          if (obj._holdEnteredAt == null) {
            // Rocket just entered the altitude band — start timing.
            obj._holdEnteredAt = flightState.timeElapsed;
          } else if (flightState.timeElapsed - obj._holdEnteredAt >= obj.target.duration) {
            obj.completed = true;
          }
        } else {
          // Rocket left the band — reset the timer.
          obj._holdEnteredAt = null;
        }
        break;
      }

      // ------------------------------------------------------------------
      case ObjectiveType.RETURN_SCIENCE_DATA: {
        const scienceCollected = flightState.events.some((e) => e.type === 'SCIENCE_COLLECTED');
        // Safe landing: impact speed must be <= 10 m/s.
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
            e.altitude >= obj.target.minAltitude,
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
      default:
        // Unknown objective type — silently skip to allow forward-compatibility.
        break;
    }
  }
}
