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
   * Release a satellite payload at or above a minimum altitude (and optionally
   * at or above a minimum velocity).
   * Checks for a 'SATELLITE_RELEASED' event at `event.altitude >= minAltitude`
   * and, if minVelocity is provided, `event.velocity >= minVelocity`.
   * target: { minAltitude: number, minVelocity?: number }
   */
  RELEASE_SATELLITE: 'RELEASE_SATELLITE',

  /**
   * Reach orbital altitude and speed simultaneously.
   * Completed when flightState.altitude >= orbitAltitude AND
   * flightState.velocity >= orbitalVelocity.
   * target: { orbitAltitude: number, orbitalVelocity: number }
   */
  REACH_ORBIT: 'REACH_ORBIT',

  /**
   * Constraint: rocket build cost must not exceed a budget.
   * Checked against flightState.rocketCost each tick.
   * target: { maxCost: number }  (dollars)
   */
  BUDGET_LIMIT: 'BUDGET_LIMIT',

  /**
   * Constraint: rocket must use no more than N total parts.
   * Checked against flightState.partCount each tick.
   * target: { maxParts: number }
   */
  MAX_PARTS: 'MAX_PARTS',

  /**
   * Constraint: rocket must not include a specific part type.
   * Checked against flightState.partTypes each tick.
   * target: { forbiddenType: string }  (PartType enum value)
   */
  RESTRICT_PART: 'RESTRICT_PART',

  /**
   * Deploy multiple satellites in a single flight above a minimum altitude.
   * Counts 'SATELLITE_RELEASED' events at event.altitude >= minAltitude.
   * target: { count: number, minAltitude: number }
   */
  MULTI_SATELLITE: 'MULTI_SATELLITE',

  /**
   * Constraint: flight must carry a minimum number of crew members.
   * Checked against flightState.crewCount each tick.
   * target: { minCrew: number }
   */
  MINIMUM_CREW: 'MINIMUM_CREW',
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
 *   RELEASE_SATELLITE   → { minAltitude: number, minVelocity?: number }
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
 * @property {string[]}       unlockedParts  - Part IDs added to state.parts on completion.
 * @property {string[]}       [requiredParts] - Part IDs unlocked when the mission is accepted.
 * @property {MissionStatus}  status         - Initial status: 'locked' or 'available'.
 */

import { PartType } from '../core/constants.js';

// ---------------------------------------------------------------------------
// Mission Catalog
// ---------------------------------------------------------------------------

/**
 * All mission definitions, ordered by progression.
 * Tutorial Mission Set — Desert R&D campaign (TASK-013).
 *
 * Rules:
 *   - IDs must be globally unique strings (e.g. 'mission-001').
 *   - Objective IDs must be unique within their parent mission.
 *   - `unlocksAfter: []` → starts as 'available'; otherwise starts as 'locked'.
 *   - Parts listed in `unlockedParts` are added to `state.parts` on completion.
 *
 * UNLOCK TREE SUMMARY
 * ===================
 *   001 → 002 → 003 → 004 ──┬──> 005 → 008 → 010 → 012 → 014 → 016
 *                            │                                      ↓
 *                            ├──> 006                              017 (requires 015 + 016)
 *                            │                         ↑
 *                            └──> 007 → 009 ─────> 011 → 013 → 015
 *
 * Missions 1–4 are strictly linear (one at a time).
 * Missions 5, 6, 7 all unlock simultaneously after mission 4.
 * Mission 17 requires both 15 and 16 completed.
 *
 * @type {MissionDef[]}
 */
export const MISSIONS = [

  // =========================================================================
  // LINEAR TUTORIAL CHAIN — missions 1-4 (one at a time)
  // =========================================================================

  /**
   * Mission 1 — First Flight
   * Available from game start.  Reach 100 m to prove the launch system works.
   */
  {
    id: 'mission-001',
    title: 'First Flight',
    description:
      'Our engineers have assembled a basic sounding rocket. Your task is simple: ' +
      'get it off the pad and reach 100 metres altitude. This is the first step ' +
      'in what will become a legendary space programme.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-001-1',
        type: ObjectiveType.REACH_ALTITUDE,
        target: { altitude: 100 },
        completed: false,
        description: 'Reach 100 m altitude',
      },
    ],
    reward: 15_000,
    unlocksAfter: [],
    // tank-small and engine-spark are available from the start of the game;
    // they do not need to be added to state.parts via this mission.
    unlockedParts: [],
    status: MissionStatus.AVAILABLE,
  },

  /**
   * Mission 2 — Higher Ambitions
   * Unlocks after First Flight.  Push five times higher.
   */
  {
    id: 'mission-002',
    title: 'Higher Ambitions',
    description:
      'The first flight was a success. Now we need to push the boundary. ' +
      'Reach 500 metres and prove our rocket can sustain powered flight ' +
      'long enough to climb out of the lower atmosphere.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-002-1',
        type: ObjectiveType.REACH_ALTITUDE,
        target: { altitude: 500 },
        completed: false,
        description: 'Reach 500 m altitude',
      },
    ],
    reward: 20_000,
    unlocksAfter: ['mission-001'],
    unlockedParts: [],
    status: MissionStatus.LOCKED,
  },

  /**
   * Mission 3 — Breaking the Kilometre
   * Unlocks after Higher Ambitions.  Crack 1 km.
   */
  {
    id: 'mission-003',
    title: 'Breaking the Kilometre',
    description:
      'One kilometre. A milestone that separates hobbyists from serious rocket ' +
      'engineers. Build a bigger rocket and punch through that threshold.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-003-1',
        type: ObjectiveType.REACH_ALTITUDE,
        target: { altitude: 1_000 },
        completed: false,
        description: 'Reach 1,000 m altitude',
      },
    ],
    reward: 25_000,
    unlocksAfter: ['mission-002'],
    unlockedParts: [],
    status: MissionStatus.LOCKED,
  },

  /**
   * Mission 4 — Speed Test Alpha
   * Unlocks after Breaking the Kilometre.  Prove horizontal speed capability.
   * Completing this mission opens three parallel tracks (missions 5, 6, 7).
   */
  {
    id: 'mission-004',
    title: 'Speed Test Alpha',
    description:
      'Altitude alone is not enough. We need to demonstrate that our rockets can ' +
      'build horizontal velocity for eventual orbital operations. Achieve 150 m/s ' +
      'of speed to unlock the next phase of our research programme.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-004-1',
        type: ObjectiveType.REACH_SPEED,
        target: { speed: 150 },
        completed: false,
        description: 'Reach 150 m/s speed',
      },
    ],
    reward: 30_000,
    unlocksAfter: ['mission-003'],
    unlockedParts: [],
    status: MissionStatus.LOCKED,
  },

  // =========================================================================
  // PARALLEL TRACKS — missions 5, 6, 7 all unlock after mission 4
  // =========================================================================

  /**
   * Mission 5 — Safe Return I
   * Recovery track: test parachute recovery.
   * Unlocks: Mk2 Parachute part, Mission 8.
   */
  {
    id: 'mission-005',
    title: 'Safe Return I',
    description:
      'Hardware is expensive. We cannot afford to lose rockets on every flight. ' +
      'Fit a parachute to your rocket and demonstrate a controlled descent — ' +
      'land at less than 10 m/s to protect the vehicle and any future crew.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-005-1',
        type: ObjectiveType.SAFE_LANDING,
        target: { maxLandingSpeed: 10 },
        completed: false,
        description: 'Land at 10 m/s or less using a parachute',
      },
    ],
    reward: 35_000,
    unlocksAfter: ['mission-004'],
    unlockedParts: ['parachute-mk2'],
    requiredParts: ['parachute-mk1'],
    status: MissionStatus.LOCKED,
  },

  /**
   * Mission 6 — Controlled Descent
   * Recovery track: propulsive landing, no parachutes.
   * Unlocks: Small Landing Leg part.
   */
  {
    id: 'mission-006',
    title: 'Controlled Descent',
    description:
      'Parachutes are reliable, but for precision landings and future reusability ' +
      'we need propulsive descent capability. Build a rocket that can throttle its ' +
      'engine down and touch down at less than 5 m/s under engine power alone — ' +
      'no parachutes allowed on this flight.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-006-1',
        type: ObjectiveType.ACTIVATE_PART,
        target: { partType: PartType.ENGINE },
        completed: false,
        description: 'Fire the engine during descent',
      },
      {
        id: 'obj-006-2',
        type: ObjectiveType.SAFE_LANDING,
        target: { maxLandingSpeed: 5 },
        completed: false,
        description: 'Touch down at 5 m/s or less under engine power',
      },
    ],
    reward: 40_000,
    unlocksAfter: ['mission-004'],
    unlockedParts: ['landing-legs-small'],
    status: MissionStatus.LOCKED,
  },

  /**
   * Mission 7 — Leg Day
   * Recovery track: landing legs deployment and safe touchdown.
   * Unlocks: Large Landing Leg part, Mission 9.
   */
  {
    id: 'mission-007',
    title: 'Leg Day',
    description:
      'Landing legs allow the rocket to stand upright after touchdown and protect ' +
      'the engine bell from ground impact. Deploy your landing legs in flight and ' +
      'prove they can absorb the impact of a safe landing.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-007-1',
        type: ObjectiveType.ACTIVATE_PART,
        target: { partType: PartType.LANDING_LEGS },
        completed: false,
        description: 'Deploy landing legs during flight',
      },
      {
        id: 'obj-007-2',
        type: ObjectiveType.SAFE_LANDING,
        target: { maxLandingSpeed: 10 },
        completed: false,
        description: 'Land safely at 10 m/s or less on deployed legs',
      },
    ],
    reward: 40_000,
    unlocksAfter: ['mission-004'],
    unlockedParts: ['landing-legs-large'],
    status: MissionStatus.LOCKED,
  },

  // =========================================================================
  // ADVANCED MISSIONS — unlock from parallel tracks
  // =========================================================================

  /**
   * Mission 8 — Black Box Test
   * Science/crash track: intentional crash with Science Module attached.
   * Unlocks: Mission 10.
   */
  {
    id: 'mission-008',
    title: 'Black Box Test',
    description:
      'We need to verify that our Science Module can survive extreme impact forces. ' +
      'Mount a Science Module on your rocket, activate it during flight, then ' +
      'deliberately crash at over 50 m/s impact speed. If the module survives ' +
      'and returns its data, the design is approved for high-stress missions.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-008-1',
        type: ObjectiveType.ACTIVATE_PART,
        target: { partType: PartType.SERVICE_MODULE },
        completed: false,
        description: 'Activate the Science Module during flight',
      },
      {
        id: 'obj-008-2',
        type: ObjectiveType.CONTROLLED_CRASH,
        target: { minCrashSpeed: 50 },
        completed: false,
        description: 'Impact at 50 m/s or faster with Science Module attached',
      },
    ],
    reward: 50_000,
    unlocksAfter: ['mission-005'],
    unlockedParts: [],
    requiredParts: ['science-module-mk1'],
    status: MissionStatus.LOCKED,
  },

  /**
   * Mission 9 — Ejector Seat Test
   * Crew safety track: demonstrate crew escape system at altitude.
   * Unlocks: Mission 11.
   */
  {
    id: 'mission-009',
    title: 'Ejector Seat Test',
    description:
      'Crew safety is paramount. Before we can put astronauts aboard, our escape ' +
      'systems must be verified. Fly a crewed command module to above 200 metres ' +
      'and fire the ejector seat. The crew must be safely propelled clear of the ' +
      'vehicle at altitude.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-009-1',
        type: ObjectiveType.EJECT_CREW,
        target: { minAltitude: 200 },
        completed: false,
        description: 'Activate ejector seat above 200 m altitude',
      },
    ],
    reward: 45_000,
    unlocksAfter: ['mission-007'],
    unlockedParts: [],
    requiredParts: ['cmd-mk1'],
    status: MissionStatus.LOCKED,
  },

  /**
   * Mission 10 — Science Experiment Alpha
   * Science track: sustained altitude hold with data return.
   * Unlocks: Mission 12, Poodle Engine part.
   */
  {
    id: 'mission-010',
    title: 'Science Experiment Alpha',
    description:
      'Our Science Module is ready for its first real experiment. Activate it, ' +
      'then hold altitude between 800 m and 1,200 m for at least 30 continuous ' +
      'seconds while the experiment runs. Then bring the rocket — and the data — ' +
      'home safely with a landing speed under 10 m/s.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-010-1',
        type: ObjectiveType.HOLD_ALTITUDE,
        target: { minAltitude: 800, maxAltitude: 1_200, duration: 30 },
        completed: false,
        description: 'Hold altitude between 800 m and 1,200 m for 30 continuous seconds',
      },
      {
        id: 'obj-010-2',
        type: ObjectiveType.RETURN_SCIENCE_DATA,
        target: {},
        completed: false,
        description: 'Activate the Science Module and land safely to return the data',
      },
    ],
    reward: 60_000,
    unlocksAfter: ['mission-008'],
    unlockedParts: ['engine-poodle'],
    requiredParts: ['science-module-mk1'],
    status: MissionStatus.LOCKED,
  },

  /**
   * Mission 11 — Emergency Systems Verified
   * Combined safety milestone: ejector seat during a crash scenario.
   * Requires both Mission 8 AND Mission 9 completed before unlocking.
   * Unlocks: Mission 13.
   */
  {
    id: 'mission-011',
    title: 'Emergency Systems Verified',
    description:
      'A comprehensive combined test: simulate a catastrophic failure scenario by ' +
      'firing the ejector seat above 100 m and then allowing the vehicle to impact ' +
      'at over 50 m/s. Both the crash survivability data and the crew escape system ' +
      'must be demonstrated in the same flight.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-011-1',
        type: ObjectiveType.EJECT_CREW,
        target: { minAltitude: 100 },
        completed: false,
        description: 'Fire the ejector seat above 100 m altitude',
      },
      {
        id: 'obj-011-2',
        type: ObjectiveType.CONTROLLED_CRASH,
        target: { minCrashSpeed: 50 },
        completed: false,
        description: 'Vehicle impacts at 50 m/s or faster after crew ejection',
      },
    ],
    reward: 55_000,
    unlocksAfter: ['mission-008', 'mission-009'],
    unlockedParts: [],
    status: MissionStatus.LOCKED,
  },

  /**
   * Mission 12 — Stage Separation Test
   * Engineering milestone: two-stage rocket with in-flight decoupling.
   * Unlocks: Mission 14, Reliant Engine part, SRB Small part.
   */
  {
    id: 'mission-012',
    title: 'Stage Separation Test',
    description:
      'Reaching orbit will require multiple stages. Build and fly a two-stage rocket, ' +
      'reach 2,000 m, then fire the stack decoupler to separate the stages mid-flight. ' +
      'This proves our staging system is reliable enough for high-altitude operations.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-012-1',
        type: ObjectiveType.REACH_ALTITUDE,
        target: { altitude: 2_000 },
        completed: false,
        description: 'Reach 2,000 m altitude',
      },
      {
        id: 'obj-012-2',
        type: ObjectiveType.ACTIVATE_PART,
        target: { partType: PartType.STACK_DECOUPLER },
        completed: false,
        description: 'Fire the stack decoupler to separate stages above 2,000 m',
      },
    ],
    reward: 80_000,
    unlocksAfter: ['mission-010'],
    unlockedParts: ['engine-reliant', 'srb-small'],
    requiredParts: ['decoupler-stack-tr18'],
    status: MissionStatus.LOCKED,
  },

  /**
   * Mission 13 — High Altitude Record
   * Altitude push: reach the stratosphere.
   * Unlocks: Mission 15.
   */
  {
    id: 'mission-013',
    title: 'High Altitude Record',
    description:
      'Push the design envelope. Reach 20 kilometres altitude — well into the ' +
      'stratosphere. At this height, atmospheric drag is minimal and the curvature ' +
      'of the Earth becomes faintly visible. This altitude record will attract ' +
      'attention and funding from the scientific community.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-013-1',
        type: ObjectiveType.REACH_ALTITUDE,
        target: { altitude: 20_000 },
        completed: false,
        description: 'Reach 20,000 m altitude',
      },
    ],
    reward: 100_000,
    unlocksAfter: ['mission-011'],
    unlockedParts: [],
    status: MissionStatus.LOCKED,
  },

  /**
   * Mission 14 — Kármán Line Approach
   * Altitude push: approach the edge of space at 60 km.
   * Unlocks: Mission 16, Nerv Vacuum Engine part, SRB Large part.
   */
  {
    id: 'mission-014',
    title: 'Kármán Line Approach',
    description:
      'The internationally recognised boundary of space sits at 100 km. We are ' +
      'not there yet — but reaching 60 kilometres will demonstrate that our rocket ' +
      'technology is ready for the final push. Vacuum-rated engines and heavy-lift ' +
      'boosters are required to achieve this altitude.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-014-1',
        type: ObjectiveType.REACH_ALTITUDE,
        target: { altitude: 60_000 },
        completed: false,
        description: 'Reach 60,000 m altitude',
      },
    ],
    reward: 200_000,
    unlocksAfter: ['mission-012'],
    unlockedParts: ['engine-nerv', 'srb-large'],
    status: MissionStatus.LOCKED,
  },

  /**
   * Mission 15 — Satellite Deployment Test
   * Payload delivery: release a satellite above 30 km.
   * Unlocks: Mission 17.
   */
  {
    id: 'mission-015',
    title: 'Satellite Deployment Test',
    description:
      'Satellite deployment is the backbone of our commercial revenue stream. ' +
      'Carry a Satellite Mk1 payload to above 30,000 metres altitude and release ' +
      'it into free flight. A successful deployment here opens the door to ' +
      'full orbital satellite contracts.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-015-1',
        type: ObjectiveType.RELEASE_SATELLITE,
        target: { minAltitude: 30_000 },
        completed: false,
        description: 'Release a Satellite Mk1 above 30,000 m altitude',
      },
    ],
    reward: 150_000,
    unlocksAfter: ['mission-013'],
    unlockedParts: [],
    requiredParts: ['satellite-mk1'],
    status: MissionStatus.LOCKED,
  },

  /**
   * Mission 16 — Low Earth Orbit
   * The main orbital milestone.  Reach >80 km and build orbital velocity.
   * Completing this mission triggers the congratulations screen.
   * Unlocks: Mission 17, Large Tank part.
   * Note: Reliant Engine may already be unlocked via mission-012; the
   * completeMission() logic safely skips duplicates.
   */
  {
    id: 'mission-016',
    title: 'Low Earth Orbit',
    description:
      'Everything has led to this moment. Build a rocket capable of reaching ' +
      'Low Earth Orbit: climb above 80 kilometres and sustain a horizontal ' +
      'velocity of at least 7,800 m/s. Once in orbit, the entire solar system ' +
      'becomes accessible. Welcome to space.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-016-1',
        type: ObjectiveType.REACH_ORBIT,
        target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
        completed: false,
        description: 'Reach orbital altitude (>80,000 m) at ≥7,800 m/s horizontal speed',
      },
    ],
    reward: 500_000,
    unlocksAfter: ['mission-014'],
    unlockedParts: ['tank-large', 'engine-reliant'],
    status: MissionStatus.LOCKED,
  },

  /**
   * Mission 17 — Orbital Satellite Deployment
   * Endgame contract: reach orbit AND deploy a satellite.
   * Requires both Mission 15 AND Mission 16 completed first.
   */
  {
    id: 'mission-017',
    title: 'Orbital Satellite Deployment',
    description:
      'The ultimate commercial mission: reach Low Earth Orbit and deploy a ' +
      'Satellite Mk1 payload into orbit. This contract marks the successful ' +
      'completion of the Desert R&D campaign. Your agency is now a full ' +
      'spacefaring organisation.',
    location: 'desert',
    objectives: [
      {
        id: 'obj-017-1',
        type: ObjectiveType.REACH_ORBIT,
        target: { orbitAltitude: 80_000, orbitalVelocity: 7_800 },
        completed: false,
        description: 'Reach orbital altitude (>80,000 m) at ≥7,800 m/s horizontal speed',
      },
      {
        id: 'obj-017-2',
        type: ObjectiveType.RELEASE_SATELLITE,
        target: { minAltitude: 80_000 },
        completed: false,
        description: 'Release a Satellite Mk1 while in orbit above 80,000 m',
      },
    ],
    reward: 300_000,
    unlocksAfter: ['mission-015', 'mission-016'],
    unlockedParts: [],
    status: MissionStatus.LOCKED,
  },

];
