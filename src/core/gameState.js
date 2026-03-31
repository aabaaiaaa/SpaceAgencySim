/**
 * gameState.js — Central in-memory game state.
 *
 * ARCHITECTURE RULE: Every game system reads from and writes to the single
 * state object returned by `createGameState()`.  No system owns private
 * state; all data lives here so it can be serialised, restored, and tested
 * in isolation.
 *
 * Type definitions are expressed as JSDoc `@typedef` so that editors with
 * TypeScript language-service support (VS Code, WebStorm, etc.) provide
 * full autocomplete and type-checking without requiring a compile step.
 */

import {
  CrewStatus,
  FlightOutcome,
  FlightPhase,
  GameMode,
  MissionState,
  STARTING_MONEY,
  STARTING_LOAN_BALANCE,
  DEFAULT_LOAN_INTEREST_RATE,
  FACILITY_DEFINITIONS,
  STARTING_REPUTATION,
  DEFAULT_DIFFICULTY_SETTINGS,
} from './constants.js';

// ---------------------------------------------------------------------------
// Type Definitions (JSDoc)
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} Loan
 * @property {number} balance               - Outstanding principal owed (dollars).
 * @property {number} interestRate          - Per-mission interest rate expressed as a
 *                                            decimal (e.g. 0.03 = 3 %).
 * @property {number} totalInterestAccrued  - Running total of all interest charges
 *                                            applied via applyInterest() (dollars).
 */

/**
 * Skills a crew member can improve through training and experience.
 * Each skill is a number in the range [0, 100].
 * @typedef {Object} CrewSkills
 * @property {number} piloting     - Affects rocket control and landing.
 * @property {number} engineering  - Affects repair chances and fuel efficiency.
 * @property {number} science      - Affects science experiment yields.
 */

/**
 * A single astronaut record.
 * @typedef {Object} CrewMember
 * @property {string}      id         - Unique identifier (UUID string).
 * @property {string}      name       - Display name.
 * @property {CrewStatus}  status     - Current activity status.
 * @property {CrewSkills}  skills     - Skill levels.
 * @property {number}      salary     - Weekly salary cost (dollars).
 * @property {string}      hiredDate  - ISO 8601 date string when hired.
 * @property {number|null} injuryEnds - Period number when the injury clears
 *                                      (crew becomes IDLE again), or null if
 *                                      not injured.
 */

/**
 * A mission available on, accepted from, or removed from the board.
 * @typedef {Object} Mission
 * @property {string}       id           - Unique identifier.
 * @property {string}       title        - Short display name.
 * @property {string}       description  - Detailed objective text.
 * @property {number}       reward       - Cash payout on success (dollars).
 * @property {string}       deadline     - ISO 8601 date by which the mission
 *                                         must be completed.
 * @property {MissionState} state        - Current lifecycle state.
 * @property {Object}       requirements - Constraints the rocket must satisfy.
 * @property {number}       [requirements.minDeltaV]    - m/s needed.
 * @property {number}       [requirements.minCrewCount] - Crew seats needed.
 * @property {string[]}     [requirements.requiredParts]- Part IDs that must be
 *                                                        included.
 * @property {string|null}  acceptedDate  - ISO 8601 date accepted, or null.
 * @property {string|null}  completedDate - ISO 8601 date completed, or null.
 */

/**
 * One component placed on a rocket in the builder.
 * @typedef {Object} RocketPart
 * @property {string} partId     - ID referencing the part definition catalog.
 * @property {{ x: number, y: number }} position - Grid position in the builder.
 */

/**
 * Serialisable staging data stored alongside a saved rocket design.
 * Each inner array holds the 0-based indices (into `RocketDesign.parts`) of
 * the parts assigned to that stage.  Index 0 = Stage 1 (fires first).
 *
 * @typedef {Object} StagingDesign
 * @property {number[][]} stages    Ordered stage slots; each is an array of part indices.
 * @property {number[]}   unstaged  Indices of activatable parts not assigned to any stage.
 */

/**
 * A saved rocket design (blueprint).
 * @typedef {Object} RocketDesign
 * @property {string}        id           - Unique identifier.
 * @property {string}        name         - Player-assigned name.
 * @property {RocketPart[]}  parts        - Ordered list of placed components.
 * @property {StagingDesign} staging      - Staging configuration for this design.
 * @property {number}        totalMass    - Computed dry mass (kg).
 * @property {number}        totalThrust  - Computed sea-level thrust (kN).
 * @property {string}        createdDate  - ISO 8601 creation date.
 * @property {string}        updatedDate  - ISO 8601 last-modified date.
 * @property {boolean}       [savePrivate] - If true, design is private to the
 *                                           current save slot (not shared across saves).
 */

/**
 * A record written to flight history after each launch.
 * @typedef {Object} FlightResult
 * @property {string}        id           - Unique identifier.
 * @property {string}        missionId    - ID of the associated mission.
 * @property {string}        rocketId     - ID of the rocket design used.
 * @property {string[]}      crewIds      - IDs of crew members aboard.
 * @property {string}        launchDate   - ISO 8601 launch timestamp.
 * @property {FlightOutcome} outcome      - How the flight ended.
 * @property {number}        deltaVUsed   - Δv consumed during the flight (m/s).
 * @property {number}        revenue      - Money earned (0 if not successful).
 * @property {string}        notes        - Human-readable summary of events.
 */

/**
 * A discrete event that occurred during a flight (stage separation, anomaly,
 * milestone reached, etc.).
 * @typedef {Object} FlightEvent
 * @property {number} time        - Seconds elapsed since launch.
 * @property {string} type        - Event category (e.g. 'STAGE_SEP', 'ANOMALY').
 * @property {string} description - Human-readable detail.
 */

/**
 * Keplerian orbital elements for a 2D orbit.
 * @typedef {Object} OrbitalElements
 * @property {number} semiMajorAxis      - Semi-major axis (m from body centre).
 * @property {number} eccentricity       - Eccentricity (0 = circular, 0 < e < 1 = elliptical).
 * @property {number} argPeriapsis       - Argument of periapsis ω (radians).
 * @property {number} meanAnomalyAtEpoch - Mean anomaly M₀ at the epoch (radians).
 * @property {number} epoch              - Reference time for M₀ (seconds).
 */

/**
 * A persistent object tracked in orbit (satellite, debris, station).
 * @typedef {Object} OrbitalObject
 * @property {string}          id       - Unique identifier.
 * @property {string}          bodyId   - Celestial body this object orbits (e.g. 'EARTH').
 * @property {string}          type     - OrbitalObjectType value.
 * @property {string}          name     - Display name.
 * @property {OrbitalElements} elements - Current orbital elements.
 */

/**
 * State of a single built facility.
 * @typedef {Object} FacilityState
 * @property {boolean} built - Whether the facility has been constructed.
 * @property {number}  tier  - Current upgrade tier (1 = base, higher = upgraded).
 */

/**
 * A procedurally generated contract on the board or in the player's active list.
 * @typedef {Object} Contract
 * @property {string}       id               - Unique identifier (e.g. 'contract-abc123').
 * @property {string}       title            - Short display name.
 * @property {string}       description      - Flavour text explaining the contract.
 * @property {string}       category         - ContractCategory enum value.
 * @property {import('../data/missions.js').ObjectiveDef[]} objectives - Objectives to complete.
 * @property {number}       reward           - Cash payout on completion (dollars).
 * @property {number}       penaltyFee       - Cash penalty for cancellation (dollars).
 * @property {number}       reputationReward - Reputation gained on completion.
 * @property {number}       reputationPenalty- Reputation lost on cancellation/failure.
 * @property {number|null}  deadlinePeriod   - Period by which the contract must be completed,
 *                                             or null if open-ended.
 * @property {number}       boardExpiryPeriod- Period when this contract expires from the board
 *                                             (only relevant while on the board).
 * @property {number}       generatedPeriod  - Period when this contract was generated.
 * @property {number|null}  acceptedPeriod   - Period when accepted, or null.
 * @property {string|null}  chainId          - ID linking multi-part chain contracts, or null.
 * @property {number|null}  chainPart        - 1-based part number in the chain, or null.
 * @property {number|null}  chainTotal       - Total parts in the chain, or null.
 */

/**
 * Live state of a flight that is currently in progress.
 * Set to null when no flight is active.
 * @typedef {Object} FlightState
 * @property {string}        missionId      - Associated mission.
 * @property {string}        rocketId       - Rocket design in use.
 * @property {string[]}      crewIds        - Crew aboard.
 * @property {number}        timeElapsed    - Seconds since launch.
 * @property {number}        altitude       - Current altitude (m).
 * @property {number}        velocity       - Current velocity (m/s).
 * @property {number}        fuelRemaining  - Propellant remaining (kg).
 * @property {number}        deltaVRemaining - Remaining Δv budget (m/s).
 * @property {FlightEvent[]} events         - Log of events so far.
 * @property {boolean}       aborted        - Whether abort has been triggered.
 * @property {string}        phase          - Current flight phase (FlightPhase enum value).
 * @property {import('./flightPhase.js').PhaseTransition[]} phaseLog - Log of all phase transitions.
 * @property {boolean}       inOrbit        - True when craft is in a stable orbit.
 * @property {OrbitalElements|null} orbitalElements - Keplerian elements when in orbit, null otherwise.
 * @property {string}        bodyId         - Celestial body the craft is currently at (CelestialBody enum).
 * @property {string|null}   orbitBandId    - ID of the altitude band at orbit entry (e.g. 'LEO'), or null.
 * @property {string|null}   currentBiome   - ID of the current altitude biome (e.g. 'LOW_ATMOSPHERE').
 * @property {string[]}      biomesVisited  - Unique biome IDs visited during this flight.
 * @property {import('./docking.js').DockingSystemState|null} dockingState - Docking system state, or null.
 * @property {TransferState|null} transferState  - Active transfer data when in TRANSFER/CAPTURE phase.
 * @property {import('./power.js').PowerState|null} powerState - Power system state (generation, storage, consumption).
 * @property {import('./comms.js').CommsState|null} commsState - Communication link state (status, link type, control lockout).
 */

/**
 * State tracking for an active interplanetary transfer.
 * @typedef {Object} TransferState
 * @property {string}   originBodyId      - Body the transfer departed from.
 * @property {string}   destinationBodyId - Target body for the transfer.
 * @property {number}   departureTime     - Flight elapsed time at departure (seconds).
 * @property {number}   estimatedArrival  - Estimated flight elapsed time at arrival (seconds).
 * @property {number}   departureDV       - Planned departure delta-v (m/s).
 * @property {number}   captureDV         - Planned capture delta-v (m/s).
 * @property {number}   totalDV           - Total planned delta-v (m/s).
 * @property {{ x: number, y: number }[]} trajectoryPath - Predicted trajectory points for map rendering.
 */

/**
 * The complete game state.  All subsystems read from and write to this shape.
 * @typedef {Object} GameState
 * @property {string}        agencyName     - Player-assigned agency name (set on new game).
 * @property {number}        money          - Current cash balance (dollars).
 * @property {Loan}          loan           - Outstanding loan details.
 * @property {CrewMember[]}  crew           - Hired astronauts.
 * @property {{ available: Mission[], accepted: Mission[], completed: Mission[] }} missions
 * @property {RocketDesign[]} rockets       - Saved rocket blueprints.
 * @property {string[]}       parts         - IDs of unlocked part definitions.
 * @property {FlightResult[]} flightHistory - Past flight records.
 * @property {number}         currentPeriod     - Current period (flight) counter.
 *                                                Starts at 0; incremented each time the
 *                                                player completes a flight and returns to
 *                                                the agency. Time-based mechanics reference
 *                                                this counter, not wall-clock time.
 * @property {number}         playTimeSeconds   - Total real-world seconds of play.
 * @property {number}         flightTimeSeconds - Cumulative in-game flight time (seconds).
 * @property {FlightState|null} currentFlight - Active flight, or null.
 * @property {OrbitalObject[]}  orbitalObjects - Persistent objects tracked in orbit
 *                                               (satellites, debris, stations).
 * @property {Object|null}      vabAssembly    - Serialisable snapshot of the VAB
 *                                               rocket assembly (Map→Array), or null.
 * @property {Object|null}      vabStagingConfig - Serialisable snapshot of the VAB
 *                                                 staging configuration, or null.
 * @property {boolean}          tutorialMode   - True when the game is in tutorial mode
 *                                               (facilities awarded via missions, not built).
 * @property {string}           gameMode       - Current game mode (GameMode enum value).
 * @property {SandboxSettings|null} sandboxSettings - Settings for sandbox mode, or null
 *                                                    when not in sandbox mode.
 * @property {DifficultySettings}  difficultySettings - Difficulty options changeable
 *                                                      in-game from the hub settings menu.
 * @property {Object<string, FacilityState>} facilities - Map of facility ID → state.
 *                                               Only facilities that have been built appear here.
 * @property {{ board: Contract[], active: Contract[], completed: Contract[], failed: Contract[] }} contracts
 *                                               - Procedurally generated contract system state.
 * @property {number}          reputation        - Agency reputation (0–100). Affects contract
 *                                                 generation quality and some rewards.
 * @property {number}          sciencePoints     - Accumulated science points earned from
 *                                                 experiments (used for tech-tree unlocks).
 * @property {Array<{instrumentId: string, biomeId: string, count: number}>} scienceLog
 *                                               - Tracks how many times each (instrument, biome)
 *                                                 pair has been collected, for diminishing-return
 *                                                 calculations.
 * @property {TechTreeState}   techTree          - Technology tree research progress.
 * @property {SatelliteNetworkState} satelliteNetwork - Deployed satellite network state.
 * @property {InventoryPart[]}      partInventory    - Recovered parts available for reuse.
 * @property {import('./weather.js').WeatherState|null} weather - Current weather conditions at the launch site.
 * @property {SurfaceItem[]}  surfaceItems - Items deployed on celestial body surfaces
 *                                           (flags, samples, instruments, beacons).
 * @property {AchievementRecord[]} achievements - Earned prestige milestones.
 * @property {FieldCraft[]}  fieldCraft   - Crewed vessels left in the field (orbit or
 *                                           landed on non-Earth bodies). Life support
 *                                           supplies count down each period.
 */

/**
 * A record of an earned achievement.
 * @typedef {Object} AchievementRecord
 * @property {string}  id           - Achievement definition ID.
 * @property {number}  earnedPeriod - Period when the achievement was earned.
 */

/**
 * Settings specific to sandbox mode.
 * @typedef {Object} SandboxSettings
 * @property {boolean} malfunctionsEnabled - Whether part malfunctions can occur.
 * @property {boolean} weatherEnabled      - Whether weather affects launches.
 */

/**
 * Difficulty settings changeable in-game from the hub settings menu.
 * @typedef {Object} DifficultySettings
 * @property {string} malfunctionFrequency - MalfunctionFrequency enum value.
 * @property {string} weatherSeverity      - WeatherSeverity enum value.
 * @property {string} financialPressure    - FinancialPressure enum value.
 * @property {string} injuryDuration       - InjuryDuration enum value.
 */

/**
 * A crewed vessel left in the field (orbit or landed on a non-Earth body).
 * Crew aboard consume life support supplies each period.
 * @typedef {Object} FieldCraft
 * @property {string}   id                      - Unique identifier.
 * @property {string}   name                    - Display name of the vessel.
 * @property {string}   bodyId                  - Celestial body the craft is at.
 * @property {string}   status                  - FieldCraftStatus value ('IN_ORBIT' or 'LANDED').
 * @property {string[]} crewIds                 - IDs of crew members aboard.
 * @property {number}   suppliesRemaining       - Periods of life support remaining.
 * @property {boolean}  hasExtendedLifeSupport  - True if Extended Mission Module is present (infinite supplies).
 * @property {number}   deployedPeriod          - Period when the craft was left in the field.
 * @property {OrbitalElements|null} orbitalElements - Orbital elements if in orbit, null if landed.
 * @property {string|null} orbitBandId           - Altitude band ID if in orbit (e.g. 'LEO').
 */

/**
 * A single recovered part sitting in the player's inventory.
 * @typedef {Object} InventoryPart
 * @property {string}  id        - Unique inventory entry ID.
 * @property {string}  partId    - Catalog part ID (e.g. 'engine-spark').
 * @property {number}  wear      - Wear level 0–100 (0 = pristine, 100 = destroyed).
 * @property {number}  flights   - Number of flights this part has been through.
 */

/**
 * Tech tree research state tracked in game state.
 * @typedef {Object} TechTreeState
 * @property {string[]}  researched           - Node IDs that have been explicitly researched.
 * @property {string[]}  unlockedInstruments  - Instrument IDs unlocked via tech tree research.
 */

/**
 * Metadata for a deployed satellite in the network.
 * Linked to an OrbitalObject by `orbitalObjectId`.
 * @typedef {Object} SatelliteRecord
 * @property {string}      id                - Unique satellite record ID.
 * @property {string}      orbitalObjectId   - ID of the corresponding OrbitalObject.
 * @property {string}      satelliteType     - SatelliteType enum value (or 'GENERIC' for untyped).
 * @property {string}      partId            - Part definition ID used (e.g. 'satellite-comm').
 * @property {string}      bodyId            - Celestial body this satellite orbits.
 * @property {string}      bandId            - Altitude band ID at deployment (e.g. 'LEO').
 * @property {number}      health            - Current health (0–100). Degrades each period.
 * @property {boolean}     autoMaintain      - If true, pay per-period maintenance cost to heal.
 * @property {number}      deployedPeriod    - Period when this satellite was deployed.
 * @property {boolean}     [leased]          - If true, satellite is leased to third parties for income.
 */

/**
 * Top-level satellite network state.
 * @typedef {Object} SatelliteNetworkState
 * @property {SatelliteRecord[]} satellites  - All deployed satellite records.
 */

/**
 * An item deployed on a celestial body's surface.
 * @typedef {Object} SurfaceItem
 * @property {string}  id        - Unique identifier.
 * @property {string}  type      - SurfaceItemType enum value (FLAG, SURFACE_SAMPLE, SURFACE_INSTRUMENT, BEACON).
 * @property {string}  bodyId    - Celestial body where the item is deployed.
 * @property {number}  posX      - World X position on the surface (metres from landing site origin).
 * @property {number}  deployedPeriod - Period when the item was deployed.
 * @property {string}  [label]   - Optional display label (e.g. flag inscription, beacon name).
 * @property {boolean} [collected] - For SURFACE_SAMPLE: true when physically returned to lab.
 */

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Creates a fresh game state for a new game.
 * All subsystems should call this once and then mutate the returned object
 * in-place (or replace top-level properties immutably as preferred).
 *
 * @returns {GameState}
 */
export function createGameState() {
  return {
    agencyName: '',

    money: STARTING_MONEY,

    loan: {
      balance: STARTING_LOAN_BALANCE,
      interestRate: DEFAULT_LOAN_INTEREST_RATE,
      totalInterestAccrued: 0,
    },

    crew: [],

    missions: {
      available: [],
      accepted: [],
      completed: [],
    },

    rockets: [],

    savedDesigns: [],

    // New players start with no parts unlocked; the tutorial unlocks the
    // starter set during first-run onboarding.
    parts: [],

    flightHistory: [],

    currentPeriod: 0,

    playTimeSeconds: 0,
    flightTimeSeconds: 0,

    currentFlight: null,

    orbitalObjects: [],

    vabAssembly: null,
    vabStagingConfig: null,

    tutorialMode: true,

    // Game mode — 'tutorial', 'freeplay', or 'sandbox'.
    gameMode: GameMode.TUTORIAL,

    // Sandbox-only settings (null when not in sandbox mode).
    sandboxSettings: null,

    // Difficulty options — changeable in-game from the hub settings menu.
    difficultySettings: { ...DEFAULT_DIFFICULTY_SETTINGS },

    // Starter facilities are pre-built; the rest are added by
    // buildFacility() (non-tutorial) or awarded via tutorial missions.
    facilities: Object.fromEntries(
      FACILITY_DEFINITIONS
        .filter((f) => f.starter)
        .map((f) => [f.id, { built: true, tier: 1 }]),
    ),

    // Procedurally generated contract system.
    contracts: {
      board: [],      // Available contracts visible on the board (pool).
      active: [],     // Accepted contracts the player is working on.
      completed: [],  // Successfully completed contracts (history).
      failed: [],     // Failed, expired, or cancelled contracts (history).
    },

    reputation: STARTING_REPUTATION,

    // Science system — accumulated points and diminishing-return tracking.
    sciencePoints: 0,
    scienceLog: [],

    // Technology tree research progress.
    techTree: {
      researched: [],
      unlockedInstruments: [],
    },

    // Satellite network — tracks deployed satellites and their health/metadata.
    satelliteNetwork: {
      satellites: [],
    },

    // Part inventory — recovered parts available for reuse in the VAB.
    partInventory: [],

    // Weather conditions at the launch site (null until first hub visit).
    weather: null,

    // Surface operations — items deployed on celestial body surfaces.
    surfaceItems: [],

    // Prestige milestones — one-time achievements for major firsts.
    achievements: [],

    // Challenge missions — replayable hand-crafted missions with medal scoring.
    challenges: {
      active: null,     // Currently accepted challenge instance (max 1).
      results: {},      // Best result per challenge: { [id]: { medal, score, attempts } }.
    },

    // Crewed vessels left in orbit or landed on non-Earth bodies.
    // Life support supplies count down each period.
    fieldCraft: [],
  };
}

/**
 * Creates a new crew member record with default values.
 * Callers must supply id, name, and salary; all other fields default to sane
 * starting values.
 *
 * @param {{ id: string, name: string, salary: number, hiredDate?: string }} opts
 * @returns {CrewMember}
 */
export function createCrewMember({ id, name, salary, hiredDate = new Date().toISOString() }) {
  return {
    id,
    name,
    status: CrewStatus.IDLE,
    skills: {
      piloting: 0,
      engineering: 0,
      science: 0,
    },
    salary,
    hiredDate,
    injuryEnds: null,
  };
}

/**
 * Creates a new mission record.
 *
 * @param {{
 *   id: string,
 *   title: string,
 *   description: string,
 *   reward: number,
 *   deadline: string,
 *   requirements?: Partial<Mission['requirements']>
 * }} opts
 * @returns {Mission}
 */
export function createMission({
  id,
  title,
  description,
  reward,
  deadline,
  requirements = {},
}) {
  return {
    id,
    title,
    description,
    reward,
    deadline,
    state: MissionState.AVAILABLE,
    requirements: {
      minDeltaV: requirements.minDeltaV ?? 0,
      minCrewCount: requirements.minCrewCount ?? 0,
      requiredParts: requirements.requiredParts ?? [],
    },
    acceptedDate: null,
    completedDate: null,
  };
}

/**
 * Creates a new rocket design record.
 *
 * @param {{
 *   id: string,
 *   name: string,
 *   parts?: RocketPart[],
 *   staging?: StagingDesign,
 *   totalMass?: number,
 *   totalThrust?: number
 * }} opts
 * @returns {RocketDesign}
 */
export function createRocketDesign({
  id,
  name,
  parts = [],
  staging = { stages: [[]], unstaged: [] },
  totalMass = 0,
  totalThrust = 0,
  savePrivate = false,
}) {
  const now = new Date().toISOString();
  return {
    id,
    name,
    parts,
    staging,
    totalMass,
    totalThrust,
    createdDate: now,
    updatedDate: now,
    savePrivate,
  };
}

/**
 * Creates a flight result record (written to history after a launch).
 *
 * @param {{
 *   id: string,
 *   missionId: string,
 *   rocketId: string,
 *   crewIds?: string[],
 *   launchDate?: string,
 *   outcome: FlightOutcome,
 *   deltaVUsed?: number,
 *   revenue?: number,
 *   notes?: string
 * }} opts
 * @returns {FlightResult}
 */
export function createFlightResult({
  id,
  missionId,
  rocketId,
  crewIds = [],
  launchDate = new Date().toISOString(),
  outcome,
  deltaVUsed = 0,
  revenue = 0,
  notes = '',
}) {
  return {
    id,
    missionId,
    rocketId,
    crewIds,
    launchDate,
    outcome,
    deltaVUsed,
    revenue,
    notes,
  };
}

/**
 * Creates an initial live-flight state object.
 * Stored in `gameState.currentFlight` while a flight is in progress.
 *
 * @param {{
 *   missionId: string,
 *   rocketId: string,
 *   crewIds?: string[],
 *   fuelRemaining?: number,
 *   deltaVRemaining?: number
 * }} opts
 * @returns {FlightState}
 */
export function createFlightState({
  missionId,
  rocketId,
  crewIds = [],
  fuelRemaining = 0,
  deltaVRemaining = 0,
  bodyId = 'EARTH',
}) {
  return {
    missionId,
    rocketId,
    crewIds,
    crewCount: crewIds.length,
    timeElapsed: 0,
    altitude: 0,
    velocity: 0,
    fuelRemaining,
    deltaVRemaining,
    events: [],
    aborted: false,
    phase: FlightPhase.PRELAUNCH,
    phaseLog: [],
    inOrbit: false,
    orbitalElements: null,
    bodyId,
    orbitBandId: null,
    currentBiome: null,
    biomesVisited: [],
    dockingState: null,
    transferState: null,
    powerState: null,
    commsState: null,
  };
}

// ---------------------------------------------------------------------------
// State Helpers (pure functions — return new values, do not mutate state)
// ---------------------------------------------------------------------------

/**
 * Returns true if a flight is currently in progress.
 *
 * @param {GameState} state
 * @returns {boolean}
 */
export function isFlightActive(state) {
  return state.currentFlight !== null;
}

/**
 * Returns all idle crew members available for assignment.
 *
 * @param {GameState} state
 * @returns {CrewMember[]}
 */
export function getIdleCrew(state) {
  return state.crew.filter((c) => c.status === CrewStatus.IDLE);
}

/**
 * Finds a crew member by ID, or null if not found.
 *
 * @param {GameState} state
 * @param {string} id
 * @returns {CrewMember|null}
 */
export function findCrewById(state, id) {
  return state.crew.find((c) => c.id === id) ?? null;
}

/**
 * Finds a mission across all three buckets by ID, or null if not found.
 *
 * @param {GameState} state
 * @param {string} id
 * @returns {Mission|null}
 */
export function findMissionById(state, id) {
  const all = [
    ...state.missions.available,
    ...state.missions.accepted,
    ...state.missions.completed,
  ];
  return all.find((m) => m.id === id) ?? null;
}

/**
 * Save or overwrite a rocket design in the savedDesigns array.
 *
 * @param {GameState} state
 * @param {RocketDesign} design
 */
export function saveDesign(state, design) {
  const idx = state.savedDesigns.findIndex(d => d.id === design.id);
  if (idx >= 0) {
    state.savedDesigns[idx] = design;
  } else {
    state.savedDesigns.push(design);
  }
}

/**
 * Delete a saved design by ID.
 *
 * @param {GameState} state
 * @param {string} designId
 */
export function deleteDesign(state, designId) {
  state.savedDesigns = state.savedDesigns.filter(d => d.id !== designId);
}

/**
 * Finds a rocket design by ID, or null if not found.
 *
 * @param {GameState} state
 * @param {string} id
 * @returns {RocketDesign|null}
 */
export function findRocketById(state, id) {
  return state.rockets.find((r) => r.id === id) ?? null;
}
