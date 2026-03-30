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
  MissionState,
  STARTING_MONEY,
  STARTING_LOAN_BALANCE,
  DEFAULT_LOAN_INTEREST_RATE,
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
 * @property {string|null} injuryEnds - ISO 8601 date when injury clears, or
 *                                      null if not injured.
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
}) {
  return {
    missionId,
    rocketId,
    crewIds,
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
