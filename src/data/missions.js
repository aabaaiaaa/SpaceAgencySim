/**
 * missions.js — Mission template catalog and data-layer types.
 *
 * This file defines the static mission templates used throughout the game.
 * The MISSIONS array is populated by TASK-013 (Tutorial Mission Set).
 *
 * ARCHITECTURE
 * ============
 * This file is the source-of-truth for mission *definitions* (metadata,
 * objectives, rewards, unlock conditions).  It does NOT hold live game
 * state — that lives in `state.missions` within the central GameState.
 *
 * When a mission becomes available, `initializeMissions()` or
 * `getUnlockedMissions()` in `/src/core/missions.js` creates a deep copy
 * of the template and places it in `state.missions.available`.  This
 * keeps the templates immutable while allowing the live copies to be
 * mutated freely (status changes, objective completion flags, etc.).
 *
 * ADDING MISSIONS
 * ===============
 * Append a plain-object entry conforming to the MissionDef schema to the
 * MISSIONS array.  No other files need to change for new missions.
 *
 * Exception — if a brand-new objective type is introduced:
 *   1. Add the type string to ObjectiveType below.
 *   2. Add a matching case to the `checkObjectiveCompletion()` switch in
 *      `/src/core/missions.js`.
 */

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

/**
 * All possible mission objective types.
 *
 * Each type maps to a specific check performed by `checkObjectiveCompletion()`
 * on every physics tick.  The `target` field on each objective carries the
 * type-specific threshold values documented below.
 *
 * @enum {string}
 */
export const ObjectiveType = Object.freeze({
  /**
   * Reach a minimum altitude.
   * target: { altitude: number }  (metres above ground)
   */
  REACH_ALTITUDE: 'REACH_ALTITUDE',

  /**
   * Reach a minimum speed.
   * target: { speed: number }  (m/s)
   */
  REACH_SPEED: 'REACH_SPEED',

  /**
   * Land the rocket (or capsule) at or below a maximum impact speed.
   * Checks for a 'LANDING' flight event with `event.speed <= maxLandingSpeed`.
   * target: { maxLandingSpeed: number }  (m/s)
   */
  SAFE_LANDING: 'SAFE_LANDING',

  /**
   * Activate a specific part type during flight.
   * Checks for a 'PART_ACTIVATED' flight event with `event.partType === partType`.
   * target: { partType: string }  (PartType enum value)
   */
  ACTIVATE_PART: 'ACTIVATE_PART',

  /**
   * Hold altitude within a range for a continuous duration.
   * Checks that flightState.altitude stays between minAltitude and maxAltitude
   * for at least `duration` seconds without leaving the band.
   * target: { minAltitude: number, maxAltitude: number, duration: number }
   */
  HOLD_ALTITUDE: 'HOLD_ALTITUDE',

  /**
   * Activate a Science Module and return its data via a safe landing.
   * Requires both a 'SCIENCE_COLLECTED' event and a safe landing (speed <= 10 m/s).
   * target: {}
   */
  RETURN_SCIENCE_DATA: 'RETURN_SCIENCE_DATA',

  /**
   * Crash at or above a minimum impact speed (intentional destruction test).
   * Checks for a 'LANDING' or 'CRASH' event with `event.speed >= minCrashSpeed`.
   * target: { minCrashSpeed: number }  (m/s)
   */
  CONTROLLED_CRASH: 'CONTROLLED_CRASH',

  /**
   * Activate the ejector seat with a crewed command module at minimum altitude.
   * Checks for a 'CREW_EJECTED' event at `event.altitude >= minAltitude`.
   * target: { minAltitude: number }  (metres)
   */
  EJECT_CREW: 'EJECT_CREW',

  /**
   * Release a satellite payload at or above a minimum altitude.
   * Checks for a 'SATELLITE_RELEASED' event at `event.altitude >= minAltitude`.
   * target: { minAltitude: number }  (metres)
   */
  RELEASE_SATELLITE: 'RELEASE_SATELLITE',

  /**
   * Reach orbital altitude and speed simultaneously.
   * Completed when flightState.altitude >= orbitAltitude AND
   * flightState.velocity >= orbitalVelocity.
   * target: { orbitAltitude: number, orbitalVelocity: number }
   */
  REACH_ORBIT: 'REACH_ORBIT',
});

/**
 * Initial status values for mission definitions.
 * These determine where a mission begins in the unlock tree.
 *
 * Note: 'accepted' and 'completed' are live states managed by the core
 * missions module and are not used in static template definitions.
 *
 * @enum {string}
 */
export const MissionStatus = Object.freeze({
  /** Prerequisites not yet met; mission is not visible on the board. */
  LOCKED: 'locked',
  /** Visible on the mission board; player can accept it. */
  AVAILABLE: 'available',
  /** Player has accepted; a rocket must be launched to complete it. */
  ACCEPTED: 'accepted',
  /** All objectives met and reward collected. */
  COMPLETED: 'completed',
});

// ---------------------------------------------------------------------------
// Type Definitions (JSDoc)
// ---------------------------------------------------------------------------

/**
 * Type-specific threshold values for a mission objective.
 * The shape depends on the `type` field of the objective:
 *
 *   REACH_ALTITUDE      → { altitude: number }
 *   REACH_SPEED         → { speed: number }
 *   SAFE_LANDING        → { maxLandingSpeed: number }
 *   ACTIVATE_PART       → { partType: string }
 *   HOLD_ALTITUDE       → { minAltitude: number, maxAltitude: number, duration: number }
 *   RETURN_SCIENCE_DATA → {}
 *   CONTROLLED_CRASH    → { minCrashSpeed: number }
 *   EJECT_CREW          → { minAltitude: number }
 *   RELEASE_SATELLITE   → { minAltitude: number }
 *   REACH_ORBIT         → { orbitAltitude: number, orbitalVelocity: number }
 *
 * @typedef {Object} ObjectiveTarget
 */

/**
 * A single mission objective.
 *
 * @typedef {Object} ObjectiveDef
 * @property {string}                                    id          - Unique within the parent mission.
 * @property {import('./missions.js').ObjectiveType}     type        - What action must be performed.
 * @property {ObjectiveTarget}                           target      - Type-specific threshold values.
 * @property {boolean}                                   completed   - Starts false; set true when met.
 * @property {string}                                    description - Player-facing description.
 */

/**
 * A mission template definition (static; lives in the MISSIONS array).
 *
 * @typedef {Object} MissionDef
 * @property {string}         id            - Unique mission identifier (e.g. 'mission-001').
 * @property {string}         title         - Short display name shown on the mission board.
 * @property {string}         description   - Longer flavour text explaining the mission.
 * @property {'desert'}       location      - Launch site / environment.
 * @property {ObjectiveDef[]} objectives    - Ordered list of objectives to complete.
 * @property {number}         reward        - Cash payout on successful completion (dollars).
 * @property {string[]}       unlocksAfter  - IDs of missions that must be completed first.
 *                                            Empty array means available from game start.
 * @property {string[]}       unlockedParts - Part IDs added to state.parts on completion.
 * @property {MissionStatus}  status        - Initial status: 'locked' or 'available'.
 */

// ---------------------------------------------------------------------------
// Mission Catalog
// ---------------------------------------------------------------------------

/**
 * All mission definitions, ordered by progression.
 * Populated by TASK-013 (Tutorial Mission Set).
 *
 * Rules:
 *   - IDs must be globally unique strings (e.g. 'mission-001').
 *   - Objective IDs must be unique within their parent mission.
 *   - `unlocksAfter: []` → starts as 'available'; otherwise starts as 'locked'.
 *   - Parts listed in `unlockedParts` are added to `state.parts` on completion.
 *
 * @type {MissionDef[]}
 */
export const MISSIONS = [
  // Missions are defined in TASK-013.
  // Example structure for reference:
  //
  // {
  //   id: 'mission-001',
  //   title: 'First Flight',
  //   description: 'Launch your first rocket and reach 100m altitude.',
  //   location: 'desert',
  //   objectives: [
  //     {
  //       id: 'obj-001-1',
  //       type: ObjectiveType.REACH_ALTITUDE,
  //       target: { altitude: 100 },
  //       completed: false,
  //       description: 'Reach 100m altitude',
  //     },
  //   ],
  //   reward: 15_000,
  //   unlocksAfter: [],
  //   unlockedParts: [],
  //   status: MissionStatus.AVAILABLE,
  // },
];
