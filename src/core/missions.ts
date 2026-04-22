/**
 * missions.ts — Mission lifecycle management.
 *
 * This module provides all mission-related game logic: unlocking, accepting,
 * objective tracking, and completion.  It operates on the central GameState
 * and reads mission template definitions from `/src/data/missions.ts`.
 *
 * ARCHITECTURE
 * ============
 * Static mission *definitions* live in `src/data/missions.ts` (MISSIONS array).
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

import { MISSIONS, MISSIONS_BY_ID, MissionStatus, ObjectiveType } from '../data/missions.ts';
import type { MissionDef } from '../data/missions.ts';
import { earnReward } from './finance.ts';
import { getTechTreeUnlockedParts } from './techtree.ts';
import { awardFacility } from './construction.ts';
import { MissionState } from './constants.ts';

import type { GameState, FlightState, Mission, MissionInstance, FlightEvent } from './gameState.ts';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Create a deep copy of a mission template for use as a live instance.
 * Maps MissionDef template fields to the MissionInstance runtime shape.
 * All scalar fields are copied; arrays and nested objects are shallow-cloned
 * one level deep, which is sufficient for the mission data shape.
 */
function _copyMission(def: MissionDef): MissionInstance {
  return {
    // --- Mission (runtime) fields ---
    id: def.id,
    title: def.title,
    description: def.description,
    reward: def.reward,
    deadline: '',
    state: MissionState.AVAILABLE,
    requirements: {
      requiredParts: def.requiredParts ? [...def.requiredParts] : [],
    },
    acceptedDate: null,
    completedDate: null,
    objectives: def.objectives.map((obj) => ({ ...obj })),
    unlockedParts: [...def.unlockedParts],
    // --- MissionInstance (template) fields ---
    location: def.location,
    unlocksAfter: [...def.unlocksAfter],
    requiredParts: def.requiredParts ? [...def.requiredParts] : [],
    unlocksFacility: def.unlocksFacility ?? null,
    awardsFacilityOnAccept: def.awardsFacilityOnAccept,
    pathway: def.pathway,
    templateStatus: def.status,
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
 */
export function initializeMissions(state: GameState): void {
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
 */
export function getAvailableMissions(state: GameState): MissionInstance[] {
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
 */
export function getUnlockedParts(state: GameState): string[] {
  const ids = new Set(state.parts);

  for (const completedMission of state.missions.completed) {
    const def = MISSIONS_BY_ID.get(completedMission.id);
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
 * @returns Part IDs that were added.
 */
export function reconcileParts(state: GameState): string[] {
  const owned = new Set(state.parts);
  const added: string[] = [];

  const allMissions = [
    ...(state.missions.accepted ?? []),
    ...(state.missions.completed ?? []),
  ];

  for (const mission of allMissions) {
    const def = MISSIONS_BY_ID.get(mission.id);
    if (!def) continue;

    // requiredParts — unlocked on acceptance.
    const reqParts: string[] = mission.requiredParts ?? def.requiredParts ?? [];
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
    const def = MISSIONS_BY_ID.get(mission.id);
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
 * @returns Newly unlocked mission instances.
 */
export function getUnlockedMissions(state: GameState): MissionInstance[] {
  const completedIds = new Set(state.missions.completed.map((m) => m.id));

  // Build the full set of mission IDs already tracked in any bucket.
  const trackedIds = new Set([
    ...state.missions.available.map((m) => m.id),
    ...state.missions.accepted.map((m) => m.id),
    ...state.missions.completed.map((m) => m.id),
  ]);

  const newlyUnlocked: MissionInstance[] = [];

  for (const def of MISSIONS) {
    // Skip missions already in state.
    if (trackedIds.has(def.id)) continue;

    // Check that every prerequisite mission has been completed.
    const prereqsMet = def.unlocksAfter.every((prereqId) => completedIds.has(prereqId));
    if (!prereqsMet) continue;

    const instance = _copyMission(def);
    instance.state = MissionState.AVAILABLE;
    state.missions.available.push(instance);
    newlyUnlocked.push(instance);
  }

  return newlyUnlocked;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

export interface AcceptMissionResult {
  success: boolean;
  mission?: MissionInstance;
  unlockedParts?: string[];
  awardedFacility?: string | null;
  error?: string;
}

export interface CompleteMissionResult {
  success: boolean;
  mission?: MissionInstance;
  reward?: number;
  unlockedParts?: string[];
  awardedFacility?: string | null;
  newlyUnlockedMissions?: MissionInstance[];
  error?: string;
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
 */
export function acceptMission(state: GameState, id: string): AcceptMissionResult {
  const idx = state.missions.available.findIndex((m) => m.id === id);
  if (idx === -1) {
    return { success: false, error: `Mission '${id}' is not in the available list.` };
  }

  const [mission] = state.missions.available.splice(idx, 1);
  mission.state = MissionState.ACCEPTED;
  mission.acceptedDate = new Date().toISOString();
  state.missions.accepted.push(mission);

  // Unlock any parts the mission requires to be completable.
  // Fall back to the catalog definition for saves created before requiredParts existed.
  const reqParts: string[] = mission.requiredParts
    ?? MISSIONS_BY_ID.get(mission.id)?.requiredParts
    ?? [];
  const unlockedParts: string[] = [];
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
  let awardedFacility: string | null = null;
  if (mission.awardsFacilityOnAccept) {
    const facilityResult = awardFacility(state, mission.awardsFacilityOnAccept);
    if (facilityResult.success) {
      awardedFacility = mission.awardsFacilityOnAccept;
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
 */
export function completeMission(state: GameState, id: string): CompleteMissionResult {
  const idx = state.missions.accepted.findIndex((m) => m.id === id);
  if (idx === -1) {
    return { success: false, error: `Mission '${id}' is not in the accepted list.` };
  }

  const [mission] = state.missions.accepted.splice(idx, 1);
  mission.state = MissionState.COMPLETED;
  mission.completedDate = new Date().toISOString();
  state.missions.completed.push(mission);

  // Award the cash reward (base + any completed bonus objectives).
  let totalReward = mission.reward;
  if (Array.isArray(mission.objectives)) {
    for (const obj of mission.objectives) {
      if (obj.optional && obj.completed && obj.bonusReward) {
        totalReward += obj.bonusReward;
      }
    }
  }
  earnReward(state, totalReward);

  // Unlock any parts gated on this mission.
  // The canonical unlock list comes from the template definition so that
  // edits to templates are reflected even on loaded saves.
  const def = MISSIONS_BY_ID.get(id);
  const unlockedParts: string[] = [];
  let awardedFacility: string | null = null;
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
    reward: totalReward,
    unlockedParts,
    awardedFacility,
    newlyUnlockedMissions,
  };
}

/**
 * Returns true if all required (non-optional) objectives of a mission are
 * satisfied — i.e. the mission is ready to be turned in on return to the hub.
 *
 * A mission with no `objectives` array, or an empty one, is never turn-in
 * ready. Optional objectives are ignored; a mission with required objectives
 * fully complete but optional objectives incomplete IS considered ready.
 */
export function canTurnInMission(mission: Mission): boolean {
  const objectives = mission.objectives;
  if (!Array.isArray(objectives) || objectives.length === 0) return false;
  return objectives.filter((obj) => !obj.optional).every((obj) => obj.completed);
}

/**
 * Returns the subset of `state.missions.accepted` whose required objectives
 * are all complete — the missions that would be turned in if the player
 * returned to the hub right now. Order preserves the `accepted` array order.
 */
export function getMissionsReadyToTurnIn(state: GameState): MissionInstance[] {
  const accepted = state.missions?.accepted ?? [];
  return accepted.filter((m) => canTurnInMission(m));
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
 */
export function checkObjectiveCompletion(
  state: GameState,
  flightState: FlightState | null,
): void {
  if (!flightState) return;

  const accepted = state.missions.accepted;
  if (!accepted || accepted.length === 0) return;

  for (const mission of accepted) {
    if (!mission.objectives || mission.objectives.length === 0) continue;

    for (const obj of mission.objectives) {
      if (obj.completed) continue;

      const events: FlightEvent[] = flightState.events;

      switch (obj.type) {
        // ------------------------------------------------------------------
        case ObjectiveType.REACH_ALTITUDE:
          if (flightState.altitude >= (obj.target.altitude as number)) {
            obj.completed = true;
          }
          break;

        // ------------------------------------------------------------------
        case ObjectiveType.REACH_SPEED:
          if (flightState.velocity >= (obj.target.speed as number)) {
            obj.completed = true;
          }
          break;

        // ------------------------------------------------------------------
        case ObjectiveType.REACH_HORIZONTAL_SPEED:
          if (flightState.horizontalVelocity >= (obj.target.speed as number)) {
            obj.completed = true;
          }
          break;

        // ------------------------------------------------------------------
        case ObjectiveType.SAFE_LANDING: {
          const allowCrash = obj.target.allowCrash as boolean | undefined;
          const landingEvent = events.find(
            (e) =>
              (e.type === 'LANDING' || (allowCrash && e.type === 'CRASH')) &&
              typeof e.speed === 'number' &&
              e.speed <= (obj.target.maxLandingSpeed as number),
          );
          if (landingEvent) obj.completed = true;
          break;
        }

        // ------------------------------------------------------------------
        case ObjectiveType.ACTIVATE_PART: {
          const activationEvent = events.find(
            (e) => e.type === 'PART_ACTIVATED' && e.partType === obj.target.partType,
          );
          if (activationEvent) obj.completed = true;
          break;
        }

        // ------------------------------------------------------------------
        case ObjectiveType.HOLD_ALTITUDE: {
          const inRange =
            flightState.altitude >= (obj.target.minAltitude as number) &&
            flightState.altitude <= (obj.target.maxAltitude as number);

          // When the rocket carries science modules, the experiment must be
          // running OR have already completed (SCIENCE_COLLECTED event) for
          // hold time to count.  If there are no science modules on this
          // flight, the gate is bypassed.
          const experimentOk =
            !flightState.hasScienceModules ||
            flightState.scienceModuleRunning === true ||
            events.some((e) => e.type === 'SCIENCE_COLLECTED');

          if (inRange && experimentOk) {
            if (obj._holdEnteredAt == null) {
              // Rocket just entered the altitude band — start timing.
              obj._holdEnteredAt = flightState.timeElapsed;
            } else if (flightState.timeElapsed - obj._holdEnteredAt >= (obj.target.duration as number)) {
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
          const scienceCollected = events.some(
            (e) => e.type === 'SCIENCE_COLLECTED',
          );
          const safeLanding = events.some(
            (e) => e.type === 'LANDING' && typeof e.speed === 'number' && e.speed <= 10,
          );
          if (scienceCollected && safeLanding) obj.completed = true;
          break;
        }

        // ------------------------------------------------------------------
        case ObjectiveType.CONTROLLED_CRASH: {
          const crashEvent = events.find(
            (e) =>
              (e.type === 'LANDING' || e.type === 'CRASH') &&
              typeof e.speed === 'number' &&
              e.speed >= (obj.target.minCrashSpeed as number),
          );
          if (crashEvent) obj.completed = true;
          break;
        }

        // ------------------------------------------------------------------
        case ObjectiveType.EJECT_CREW: {
          const ejectEvent = events.find(
            (e) =>
              e.type === 'CREW_EJECTED' &&
              typeof e.altitude === 'number' &&
              e.altitude >= (obj.target.minAltitude as number),
          );
          if (ejectEvent) obj.completed = true;
          break;
        }

        // ------------------------------------------------------------------
        case ObjectiveType.RELEASE_SATELLITE: {
          const releaseEvent = events.find(
            (e) =>
              e.type === 'SATELLITE_RELEASED' &&
              typeof e.altitude === 'number' &&
              e.altitude >= (obj.target.minAltitude as number) &&
              (obj.target.minVelocity == null ||
                (typeof e.velocity === 'number' &&
                  e.velocity >= (obj.target.minVelocity as number))),
          );
          if (releaseEvent) obj.completed = true;
          break;
        }

        // ------------------------------------------------------------------
        case ObjectiveType.REACH_ORBIT:
          if (
            flightState.altitude >= (obj.target.orbitAltitude as number) &&
            flightState.velocity >= (obj.target.orbitalVelocity as number)
          ) {
            obj.completed = true;
          }
          break;

        // ------------------------------------------------------------------
        case ObjectiveType.MINIMUM_CREW:
          if (
            typeof flightState.crewCount === 'number' &&
            flightState.crewCount >= (obj.target.minCrew as number)
          ) {
            obj.completed = true;
          }
          break;

        // ------------------------------------------------------------------
        case ObjectiveType.MULTI_SATELLITE: {
          const releases = events.filter(
            (e) =>
              e.type === 'SATELLITE_RELEASED' &&
              typeof e.altitude === 'number' &&
              e.altitude >= (obj.target.minAltitude as number),
          );
          if (releases.length >= (obj.target.count as number)) obj.completed = true;
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
