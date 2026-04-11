/**
 * gameState.ts — Central in-memory game state.
 *
 * ARCHITECTURE RULE: Every game system reads from and writes to the single
 * state object returned by `createGameState()`.  No system owns private
 * state; all data lives here so it can be serialised, restored, and tested
 * in isolation.
 */

import {
  AstronautStatus,
  EARTH_HUB_ID,
  FlightOutcome,
  FlightPhase,
  GameMode,
  MalfunctionMode,
  MissionState,
  STARTING_MONEY,
  STARTING_LOAN_BALANCE,
  DEFAULT_LOAN_INTEREST_RATE,
  FACILITY_DEFINITIONS,
  STARTING_REPUTATION,
  DEFAULT_DIFFICULTY_SETTINGS,
} from './constants.ts';

import type {
  CelestialBody,
  ContractCategory,
  DifficultySettings,
  FieldCraftStatus,
  MiningModuleType,
  ResourceState,
  ResourceType,
  SatelliteType,
  SurfaceItemType,
} from './constants.ts';

import type { Hub } from './hubTypes.ts';

// ---------------------------------------------------------------------------
// Cross-module types (standalone definitions for JS module shapes)
// ---------------------------------------------------------------------------

/** A log entry recording a phase transition during flight. */
export interface PhaseTransition {
  from: string;
  to: string;
  time: number;
  reason: string;
  meta?: Record<string, unknown>;
}

/** Persistent docking state carried on the FlightState. */
export interface DockingSystemState {
  state: string;
  targetId: string | null;
  targetDistance: number;
  targetRelSpeed: number;
  targetOriDiff: number;
  targetLateral: number;
  speedOk: boolean;
  orientationOk: boolean;
  lateralOk: boolean;
  dockedObjectIds: string[];
  combinedMass: number;
}

/** Power state tracked per physics tick on an active flight. */
export interface PowerState {
  batteryCapacity: number;
  batteryCharge: number;
  solarGeneration: number;
  powerDraw: number;
  sunlit: boolean;
  hasPower: boolean;
  solarPanelArea: number;
}

/** Communication link state. */
export interface CommsState {
  status: string;
  linkType: string;
  canTransmit: boolean;
  controlLocked: boolean;
}

/** Weather conditions for a single day at a launch site. */
export interface WeatherConditions {
  windSpeed: number;
  windAngle: number;
  temperature: number;
  visibility: number;
  extreme: boolean;
  description: string;
  bodyId: string;
}

/** Weather state stored in the game state. */
export interface WeatherState {
  current: WeatherConditions;
  skipCount: number;
  seed: number;
}

/** A single mission objective. */
export interface ObjectiveDef {
  id: string;
  type: string;
  target: Record<string, unknown>;
  completed: boolean;
  description: string;
  /** If true, this objective is not required for mission completion. */
  optional?: boolean;
  /** Cash bonus awarded when this optional objective is completed. */
  bonusReward?: number;
  /** Runtime-only: flight time when HOLD_ALTITUDE objective entered the valid band. */
  _holdEnteredAt?: number | null;
}

/** Medal thresholds for challenge scoring. */
export interface MedalThresholds {
  bronze: number;
  silver: number;
  gold: number;
}

/** A challenge definition (hand-crafted or player-created). */
export interface ChallengeDef {
  /** Unique challenge identifier. */
  id: string;
  /** Display name. */
  title: string;
  /** Flavour text explaining the challenge. */
  description: string;
  /** Short constraint summary shown on the card. */
  briefing: string;
  /** Required objectives (all must pass). */
  objectives: ObjectiveDef[];
  /** FlightState field to measure for scoring. */
  scoreMetric: string;
  /** Human-readable label for the metric. */
  scoreLabel: string;
  /** Unit suffix (e.g. 'm/s', '$', 'parts'). */
  scoreUnit: string;
  /** Whether lower or higher values are better ('lower' | 'higher'). */
  scoreDirection: string;
  /** Threshold values for each medal. */
  medals: MedalThresholds;
  /** Cash reward per medal tier. */
  rewards: { bronze: number; silver: number; gold: number };
  /** Mission IDs that must be completed to unlock this challenge. */
  requiredMissions?: string[];
  /** True if this is a player-created custom challenge. */
  custom?: boolean;
}

// ---------------------------------------------------------------------------
// Type Definitions
// ---------------------------------------------------------------------------

export interface Loan {
  /** Outstanding principal owed (dollars). */
  balance: number;
  /** Per-mission interest rate expressed as a decimal (e.g. 0.03 = 3 %). */
  interestRate: number;
  /** Running total of all interest charges applied via applyInterest() (dollars). */
  totalInterestAccrued: number;
}

/**
 * Skills a crew member can improve through training and experience.
 * Each skill is a number in the range [0, 100].
 */
export interface CrewSkills {
  /** Affects rocket control and landing. */
  piloting: number;
  /** Affects repair chances and fuel efficiency. */
  engineering: number;
  /** Affects science experiment yields. */
  science: number;
}

/** A single astronaut record. */
export interface CrewMember {
  /** Unique identifier (UUID string). */
  id: string;
  /** Display name. */
  name: string;
  /** Career / employment status (active, fired, kia). */
  status: AstronautStatus;
  /** Skill levels. */
  skills: CrewSkills;
  /** Weekly salary cost (dollars). */
  salary: number;
  /** ISO 8601 date string when hired. */
  hireDate: string;
  /** Total missions flown. */
  missionsFlown: number;
  /** Total flights flown. */
  flightsFlown: number;
  /** ISO 8601 date of death, or null if alive. */
  deathDate: string | null;
  /** Cause of death description, or null if alive. */
  deathCause: string | null;
  /** ID of rocket the crew member is assigned to, or null. */
  assignedRocketId: string | null;
  /**
   * Period number when the injury clears (crew becomes IDLE again),
   * or null if not injured.
   */
  injuryEnds: number | null;
  /** Skill currently being trained, or null if not training. */
  trainingSkill: 'piloting' | 'engineering' | 'science' | null;
  /** Period number when training completes, or null. */
  trainingEnds: number | null;
  /** Hub ID where the crew member is stationed. */
  stationedHubId: string;
  /** Period number when transit completes, or null if not in transit. */
  transitUntil: number | null;
}

/** Requirements that a rocket must satisfy for a mission. */
export interface MissionRequirements {
  /** m/s needed. */
  minDeltaV?: number;
  /** Crew seats needed. */
  minCrewCount?: number;
  /** Part IDs that must be included. */
  requiredParts?: string[];
}

/** A mission available on, accepted from, or removed from the board. */
export interface Mission {
  /** Unique identifier. */
  id: string;
  /** Short display name. */
  title: string;
  /** Detailed objective text. */
  description: string;
  /** Cash payout on success (dollars). */
  reward: number;
  /** ISO 8601 date by which the mission must be completed. */
  deadline: string;
  /** Current lifecycle state. */
  state: MissionState;
  /** Constraints the rocket must satisfy. */
  requirements: MissionRequirements;
  /** ISO 8601 date accepted, or null. */
  acceptedDate: string | null;
  /** ISO 8601 date completed, or null. */
  completedDate: string | null;
  /** Ordered objectives (present on MissionDef-sourced missions). */
  objectives?: ObjectiveDef[];
  /** Part IDs unlocked on completion (present on MissionDef-sourced missions). */
  unlockedParts?: string[];
}

/**
 * A mission instance combining template definition fields with runtime state.
 *
 * When a MissionDef template is instantiated into game state, the resulting
 * object carries both the runtime fields from Mission (deadline, state, etc.)
 * and the template-sourced fields (location, unlocksAfter, pathway, etc.).
 * All template fields are optional since not every mission originates from a
 * MissionDef template (e.g. contract-generated missions).
 */
export interface MissionInstance extends Mission {
  /** Launch site / environment (from template). */
  location?: string;
  /** IDs of missions that must be completed first (from template). */
  unlocksAfter?: string[];
  /** Part IDs unlocked when the mission is accepted (from template). */
  requiredParts?: string[];
  /** FacilityId awarded on completion in tutorial mode (from template). */
  unlocksFacility?: string | null;
  /** FacilityId awarded when the mission is accepted in tutorial mode (from template). */
  awardsFacilityOnAccept?: string;
  /** Tutorial pathway badge label (from template). */
  pathway?: string;
  /** Template status: 'locked' or 'available' (from template). */
  templateStatus?: string;
}

/** One component placed on a rocket in the builder. */
export interface RocketPart {
  /** ID referencing the part definition catalog. */
  partId: string;
  /** Grid position in the builder. */
  position: { x: number; y: number };
}

/**
 * Serialisable staging data stored alongside a saved rocket design.
 * Each inner array holds the 0-based indices (into `RocketDesign.parts`) of
 * the parts assigned to that stage.  Index 0 = Stage 1 (fires first).
 */
export interface StagingDesign {
  /** Ordered stage slots; each is an array of part indices or instance IDs. */
  stages: (number | string)[][];
  /** Indices or IDs of activatable parts not assigned to any stage. */
  unstaged: (number | string)[];
}

/** A saved rocket design (blueprint). */
export interface RocketDesign {
  /** Unique identifier. */
  id: string;
  /** Player-assigned name. */
  name: string;
  /** Ordered list of placed components. */
  parts: RocketPart[];
  /** Staging configuration for this design. */
  staging: StagingDesign;
  /** Computed dry mass (kg). */
  totalMass: number;
  /** Computed sea-level thrust (kN). */
  totalThrust: number;
  /** ISO 8601 creation date. */
  createdDate: string;
  /** ISO 8601 last-modified date. */
  updatedDate: string;
  /** If true, design is private to the current save slot (not shared across saves). */
  savePrivate?: boolean;
}

/** A record written to flight history after each launch. */
export interface FlightResult {
  /** Unique identifier. */
  id: string;
  /** ID of the associated mission. */
  missionId: string;
  /** ID of the rocket design used. */
  rocketId: string;
  /** IDs of crew members aboard. */
  crewIds: string[];
  /** ISO 8601 launch timestamp. */
  launchDate: string;
  /** How the flight ended. */
  outcome: FlightOutcome;
  /** Δv consumed during the flight (m/s). */
  deltaVUsed: number;
  /** Money earned (0 if not successful). */
  revenue: number;
  /** Human-readable summary of events. */
  notes: string;
  /** Peak altitude reached during the flight (m). */
  maxAltitude?: number;
  /** Peak velocity reached during the flight (m/s). */
  maxSpeed?: number;
  /** Celestial body IDs visited during the flight. */
  bodiesVisited?: string[];
  /** Flight duration in seconds. */
  duration?: number;
  /** Display name of the rocket design used. */
  rocketName?: string;
}

/**
 * A discrete event that occurred during a flight (stage separation, anomaly,
 * milestone reached, etc.).
 */
export interface FlightEvent {
  /** Seconds elapsed since launch. */
  time: number;
  /** Event category (e.g. 'STAGE_SEP', 'ANOMALY'). */
  type: string;
  /** Human-readable detail. */
  description: string;
  /** Additional event-specific payload fields. */
  [key: string]: unknown;
}

/** Keplerian orbital elements for a 2D orbit. */
export interface OrbitalElements {
  /** Semi-major axis (m from body centre). */
  semiMajorAxis: number;
  /** Eccentricity (0 = circular, 0 < e < 1 = elliptical). */
  eccentricity: number;
  /** Argument of periapsis ω (radians). */
  argPeriapsis: number;
  /** Mean anomaly M₀ at the epoch (radians). */
  meanAnomalyAtEpoch: number;
  /** Reference time for M₀ (seconds). */
  epoch: number;
}

/** A persistent object tracked in orbit (satellite, debris, station). */
export interface OrbitalObject {
  /** Unique identifier. */
  id: string;
  /** Celestial body this object orbits (e.g. 'EARTH'). */
  bodyId: string;
  /** OrbitalObjectType value. */
  type: string;
  /** Display name. */
  name: string;
  /** Current orbital elements. */
  elements: OrbitalElements;
  /** Radius in metres (for asteroids). */
  radius?: number;
  /** Mass in kg (for asteroids). */
  mass?: number;
}

/** State of a single built facility. */
export interface FacilityState {
  /** Whether the facility has been constructed. */
  built: boolean;
  /** Current upgrade tier (1 = base, higher = upgraded). */
  tier: number;
}

/** A procedurally generated contract on the board or in the player's active list. */
export interface Contract {
  /** Unique identifier (e.g. 'contract-abc123'). */
  id: string;
  /** Short display name. */
  title: string;
  /** Flavour text explaining the contract. */
  description: string;
  /** ContractCategory enum value. */
  category: ContractCategory;
  /** Objectives to complete. */
  objectives: ObjectiveDef[];
  /** Cash payout on completion (dollars). */
  reward: number;
  /** Cash penalty for cancellation (dollars). */
  penaltyFee: number;
  /** Reputation gained on completion. */
  reputationReward: number;
  /** Reputation lost on cancellation/failure. */
  reputationPenalty: number;
  /** Period by which the contract must be completed, or null if open-ended. */
  deadlinePeriod: number | null;
  /** Period when this contract expires from the board (only relevant while on the board). */
  boardExpiryPeriod: number;
  /** Period when this contract was generated. */
  generatedPeriod: number;
  /** Period when accepted, or null. */
  acceptedPeriod: number | null;
  /** ID linking multi-part chain contracts, or null. */
  chainId: string | null;
  /** 1-based part number in the chain, or null. */
  chainPart: number | null;
  /** Total parts in the chain, or null. */
  chainTotal: number | null;
}

/** State tracking for an active interplanetary transfer. */
export interface TransferState {
  /** Body the transfer departed from. */
  originBodyId: string;
  /** Target body for the transfer. */
  destinationBodyId: string;
  /** Flight elapsed time at departure (seconds). */
  departureTime: number;
  /** Estimated flight elapsed time at arrival (seconds). */
  estimatedArrival: number;
  /** Planned departure delta-v (m/s). */
  departureDV: number;
  /** Planned capture delta-v (m/s). */
  captureDV: number;
  /** Total planned delta-v (m/s). */
  totalDV: number;
  /** Predicted trajectory points for map rendering. */
  trajectoryPath: Array<{ x: number; y: number }>;
}

/**
 * Live state of a flight that is currently in progress.
 * Set to null when no flight is active.
 */
export interface FlightState {
  /** Associated mission. */
  missionId: string;
  /** Rocket design in use. */
  rocketId: string;
  /** Crew aboard. */
  crewIds: string[];
  /** Number of crew aboard. */
  crewCount: number;
  /** Seconds since launch. */
  timeElapsed: number;
  /** Current altitude (m). */
  altitude: number;
  /** Current velocity (m/s). */
  velocity: number;
  /** Current horizontal velocity (m/s). */
  horizontalVelocity: number;
  /** Propellant remaining (kg). */
  fuelRemaining: number;
  /** Remaining Δv budget (m/s). */
  deltaVRemaining: number;
  /** Log of events so far. */
  events: FlightEvent[];
  /** Whether abort has been triggered. */
  aborted: boolean;
  /** Current flight phase (FlightPhase enum value). */
  phase: FlightPhase;
  /** Log of all phase transitions. */
  phaseLog: PhaseTransition[];
  /** True when craft is in a stable orbit. */
  inOrbit: boolean;
  /** Keplerian elements when in orbit, null otherwise. */
  orbitalElements: OrbitalElements | null;
  /** Celestial body the craft is currently at (CelestialBody enum). */
  bodyId: CelestialBody;
  /** ID of the altitude band at orbit entry (e.g. 'LEO'), or null. */
  orbitBandId: string | null;
  /** ID of the current altitude biome (e.g. 'LOW_ATMOSPHERE'). */
  currentBiome: string | null;
  /** Unique biome IDs visited during this flight. */
  biomesVisited: string[];
  /** Peak altitude reached during this flight (m). */
  maxAltitude: number;
  /** Peak velocity reached during this flight (m/s). */
  maxVelocity: number;
  /** Docking system state, or null. */
  dockingState: DockingSystemState | null;
  /** Active transfer data when in TRANSFER/CAPTURE phase. */
  transferState: TransferState | null;
  /** Power system state (generation, storage, consumption). */
  powerState: PowerState | null;
  /** Communication link state (status, link type, control lockout). */
  commsState: CommsState | null;
  /** Total rocket build cost (set at flight start for challenge scoring). */
  rocketCost?: number;
  /** Number of parts in the rocket (set at flight start for challenge scoring). */
  partCount?: number;
  /** Array of part type IDs in the rocket (set at flight start for challenge scoring). */
  partTypes?: string[];
  /** Fuel fraction remaining (0–1), for challenge scoring. */
  fuelFraction?: number;
  /** True when at least one science module is aboard. */
  hasScienceModules?: boolean;
  /** True while a science module experiment is running. */
  scienceModuleRunning?: boolean;
  /** Whether death fines have already been applied mid-flight. */
  deathFinesApplied?: boolean;
  /** Whether this is a surface or orbital launch. */
  launchType?: 'surface' | 'orbital';
  /** Hub ID from which the craft launched. */
  launchHubId?: string;
  /** Hub ID selected for craft recovery after landing. */
  recoveryHubId?: string;
}

/** A record of an earned achievement. */
export interface AchievementRecord {
  /** Achievement definition ID. */
  id: string;
  /** Period when the achievement was earned. */
  earnedPeriod: number;
}

/** Settings specific to sandbox mode. */
export interface SandboxSettings {
  /** Whether part malfunctions can occur. */
  malfunctionsEnabled: boolean;
  /** Whether weather affects launches. */
  weatherEnabled: boolean;
}

/**
 * A crewed vessel left in the field (orbit or landed on a non-Earth body).
 * Crew aboard consume life support supplies each period.
 */
export interface FieldCraft {
  /** Unique identifier. */
  id: string;
  /** Display name of the vessel. */
  name: string;
  /** Celestial body the craft is at. */
  bodyId: string;
  /** FieldCraftStatus value ('IN_ORBIT' or 'LANDED'). */
  status: FieldCraftStatus;
  /** IDs of crew members aboard. */
  crewIds: string[];
  /** Periods of life support remaining. */
  suppliesRemaining: number;
  /** True if Extended Mission Module is present (infinite supplies). */
  hasExtendedLifeSupport: boolean;
  /** Period when the craft was left in the field. */
  deployedPeriod: number;
  /** Orbital elements if in orbit, null if landed. */
  orbitalElements: OrbitalElements | null;
  /** Altitude band ID if in orbit (e.g. 'LEO'). */
  orbitBandId: string | null;
}

/** A single recovered part sitting in the player's inventory. */
export interface InventoryPart {
  /** Unique inventory entry ID. */
  id: string;
  /** Catalog part ID (e.g. 'engine-spark'). */
  partId: string;
  /** Wear level 0–100 (0 = pristine, 100 = destroyed). */
  wear: number;
  /** Number of flights this part has been through. */
  flights: number;
}

/** Tech tree research state tracked in game state. */
export interface TechTreeState {
  /** Node IDs that have been explicitly researched. */
  researched: string[];
  /** Instrument IDs unlocked via tech tree research. */
  unlockedInstruments: string[];
}

/**
 * Metadata for a deployed satellite in the network.
 * Linked to an OrbitalObject by `orbitalObjectId`.
 */
export interface SatelliteRecord {
  /** Unique satellite record ID. */
  id: string;
  /** ID of the corresponding OrbitalObject. */
  orbitalObjectId: string;
  /** SatelliteType enum value (or 'GENERIC' for untyped). */
  satelliteType: SatelliteType | 'GENERIC';
  /** Part definition ID used (e.g. 'satellite-comm'). */
  partId: string;
  /** Celestial body this satellite orbits. */
  bodyId: string;
  /** Altitude band ID at deployment (e.g. 'LEO'). */
  bandId: string;
  /** Current health (0–100). Degrades each period. */
  health: number;
  /** If true, pay per-period maintenance cost to heal. */
  autoMaintain: boolean;
  /** Period when this satellite was deployed. */
  deployedPeriod: number;
  /** If true, satellite is leased to third parties for income. */
  leased?: boolean;
}

/** Top-level satellite network state. */
export interface SatelliteNetworkState {
  /** All deployed satellite records. */
  satellites: SatelliteRecord[];
}

/** An item deployed on a celestial body's surface. */
export interface SurfaceItem {
  /** Unique identifier. */
  id: string;
  /** SurfaceItemType enum value (FLAG, SURFACE_SAMPLE, SURFACE_INSTRUMENT, BEACON). */
  type: SurfaceItemType;
  /** Celestial body where the item is deployed. */
  bodyId: string;
  /** World X position on the surface (metres from landing site origin). */
  posX: number;
  /** Period when the item was deployed. */
  deployedPeriod: number;
  /** Optional display label (e.g. flag inscription, beacon name). */
  label?: string;
  /** For SURFACE_SAMPLE: true when physically returned to lab. */
  collected?: boolean;
}

/** Tracks how many times each (instrument, biome) pair has been collected. */
export interface ScienceLogEntry {
  instrumentId: string;
  biomeId: string;
  count: number;
}

/** Best result for a challenge. */
export interface ChallengeResultEntry {
  medal: string;
  score: number;
  attempts: number;
}

/** Challenge system state. */
export interface ChallengesState {
  /** Currently accepted challenge instance (max 1), or null. */
  active: ChallengeDef | null;
  /** Best result per challenge: { [id]: { medal, score, attempts } }. */
  results: Record<string, ChallengeResultEntry>;
}

// ---------------------------------------------------------------------------
// Mining & Route Types
// ---------------------------------------------------------------------------

export interface MiningSiteModule {
  id: string;
  partId: string;
  type: MiningModuleType;
  powerDraw: number;
  connections: string[];    // bidirectional adjacency list
  recipeId?: string;        // REFINERY modules only
  stored?: Partial<Record<ResourceType, number>>;  // storage modules only
  storageCapacityKg?: number;                        // storage modules only
  storageState?: ResourceState;                      // storage modules only
}

export interface MiningSite {
  id: string;
  name: string;
  bodyId: string;
  coordinates: { x: number; y: number };
  controlUnit: { partId: string };
  modules: MiningSiteModule[];
  storage: Partial<Record<ResourceType, number>>;
  powerGenerated: number;
  powerRequired: number;
  orbitalBuffer: Partial<Record<ResourceType, number>>;
}

export interface RouteLocation {
  bodyId: string;
  locationType: 'surface' | 'orbit';
  altitude?: number;
}

export interface RouteLeg {
  id: string;
  origin: RouteLocation;
  destination: RouteLocation;
  craftDesignId: string;
  craftCount: number;
  cargoCapacityKg: number;
  costPerRun: number;
  provenFlightId: string;
}

export type RouteStatus = 'active' | 'paused' | 'broken';

export interface Route {
  id: string;
  name: string;
  status: RouteStatus;
  resourceType: ResourceType;
  legs: RouteLeg[];
  throughputPerPeriod: number;
  totalCostPerPeriod: number;
}

export interface ProvenLeg {
  id: string;
  origin: RouteLocation;
  destination: RouteLocation;
  craftDesignId: string;
  cargoCapacityKg: number;
  costPerRun: number;
  provenFlightId: string;
  dateProven: number;
}

/** The complete game state.  All subsystems read from and write to this shape. */
export interface GameState {
  /** Player-assigned agency name (set on new game). */
  agencyName: string;
  /** Current cash balance (dollars). */
  money: number;
  /** Outstanding loan details. */
  loan: Loan;
  /** Hired astronauts. */
  crew: CrewMember[];
  /** Missions across all lifecycle states. */
  missions: {
    available: MissionInstance[];
    accepted: MissionInstance[];
    completed: MissionInstance[];
  };
  /** Saved rocket blueprints. */
  rockets: RocketDesign[];
  /** Saved designs (separate from rockets). */
  savedDesigns: RocketDesign[];
  /** IDs of unlocked part definitions. */
  parts: string[];
  /** Past flight records. */
  flightHistory: FlightResult[];
  /**
   * Current period (flight) counter.
   * Starts at 0; incremented each time the player completes a flight and
   * returns to the agency. Time-based mechanics reference this counter,
   * not wall-clock time.
   */
  currentPeriod: number;
  /** Total real-world seconds of play. */
  playTimeSeconds: number;
  /** Cumulative in-game flight time (seconds). */
  flightTimeSeconds: number;
  /** Active flight, or null. */
  currentFlight: FlightState | null;
  /** Persistent objects tracked in orbit (satellites, debris, stations). */
  orbitalObjects: OrbitalObject[];
  /** Serialisable snapshot of the VAB rocket assembly (Map→Array), or null. */
  vabAssembly: unknown | null;
  /** Serialisable snapshot of the VAB staging configuration, or null. */
  vabStagingConfig: unknown | null;
  /** True when the game is in tutorial mode (facilities awarded via missions, not built). */
  tutorialMode: boolean;
  /** Current game mode (GameMode enum value). */
  gameMode: GameMode;
  /** Settings for sandbox mode, or null when not in sandbox mode. */
  sandboxSettings: SandboxSettings | null;
  /** Difficulty options changeable in-game from the hub settings menu. */
  difficultySettings: DifficultySettings;
  /**
   * Map of facility ID → state.
   * Only facilities that have been built appear here.
   */
  facilities: Record<string, FacilityState>;
  /** Procedurally generated contract system state. */
  contracts: {
    /** Available contracts visible on the board (pool). */
    board: Contract[];
    /** Accepted contracts the player is working on. */
    active: Contract[];
    /** Successfully completed contracts (history). */
    completed: Contract[];
    /** Failed, expired, or cancelled contracts (history). */
    failed: Contract[];
  };
  /** Agency reputation (0–100). Affects contract generation quality and some rewards. */
  reputation: number;
  /** Accumulated science points earned from experiments (used for tech-tree unlocks). */
  sciencePoints: number;
  /**
   * Tracks how many times each (instrument, biome) pair has been collected,
   * for diminishing-return calculations.
   */
  scienceLog: ScienceLogEntry[];
  /** Technology tree research progress. */
  techTree: TechTreeState;
  /** Deployed satellite network state. */
  satelliteNetwork: SatelliteNetworkState;
  /** Recovered parts available for reuse. */
  partInventory: InventoryPart[];
  /** Current weather conditions at the launch site. */
  weather: WeatherState | null;
  /** Items deployed on celestial body surfaces (flags, samples, instruments, beacons). */
  surfaceItems: SurfaceItem[];
  /** Earned prestige milestones. */
  achievements: AchievementRecord[];
  /** Challenge missions — replayable hand-crafted missions with medal scoring. */
  challenges: ChallengesState;
  /** Player-created custom challenges (same shape as ChallengeDef + custom: true). */
  customChallenges: ChallengeDef[];
  /**
   * Crewed vessels left in the field (orbit or landed on non-Earth bodies).
   * Life support supplies count down each period.
   */
  fieldCraft: FieldCraft[];
  /** True once the welcome/introduction modal has been shown for this save. */
  welcomeShown: boolean;
  /**
   * Current malfunction mode ('normal', 'off', 'forced').
   * Controls whether part malfunctions trigger during flight.
   * Persisted with save/load so E2E test overrides survive round-trips.
   */
  malfunctionMode: string;
  /** Whether auto-save is enabled (saves at end of flight and return to hub). */
  autoSaveEnabled: boolean;
  /** Whether debug mode is enabled (debug saves, FPS monitor, etc.). Default: off. */
  debugMode: boolean;
  /** Whether the performance dashboard overlay is visible. Default: off. */
  showPerfDashboard: boolean;
  /** Active mining sites deployed on celestial bodies. */
  miningSites: MiningSite[];
  /** Legs proven by manual flights, available for route assembly. */
  provenLegs: ProvenLeg[];
  /** Automated resource transport routes. */
  routes: Route[];
  /** All player hubs (Earth HQ + off-world bases and stations). */
  hubs: Hub[];
  /** ID of the currently active hub for UI context. */
  activeHubId: string;
}

// ---------------------------------------------------------------------------
// Factory Functions
// ---------------------------------------------------------------------------

/**
 * Creates a fresh game state for a new game.
 * All subsystems should call this once and then mutate the returned object
 * in-place (or replace top-level properties immutably as preferred).
 */
export function createGameState(): GameState {
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

    // Player-created custom challenges (same shape as ChallengeDef + custom: true).
    customChallenges: [],

    // Crewed vessels left in orbit or landed on non-Earth bodies.
    // Life support supplies count down each period.
    fieldCraft: [],

    // Welcome modal — shown once on first hub visit for a new game.
    welcomeShown: false,

    // Malfunction mode — 'normal' (standard rolls), 'off', or 'forced'.
    malfunctionMode: MalfunctionMode.NORMAL,

    // Auto-save — enabled by default.
    autoSaveEnabled: true,

    // Debug mode — disabled by default.
    debugMode: false,

    // Performance dashboard — disabled by default.
    showPerfDashboard: false,

    // Resource transportation system.
    miningSites: [],
    provenLegs: [],
    routes: [],

    // Hub system — Earth HQ is always the first hub.
    hubs: [{
      id: EARTH_HUB_ID,
      name: 'Earth HQ',
      type: 'surface',
      bodyId: 'EARTH',
      coordinates: { x: 0, y: 0 },
      facilities: Object.fromEntries(
        FACILITY_DEFINITIONS
          .filter((f) => f.starter)
          .map((f) => [f.id, { built: true, tier: 1 }]),
      ),
      tourists: [],
      partInventory: [],
      constructionQueue: [],
      maintenanceCost: 0,
      established: 0,
      online: true,
    }],
    activeHubId: EARTH_HUB_ID,
  };
}

/**
 * Creates a new crew member record with default values.
 * Callers must supply id, name, and salary; all other fields default to sane
 * starting values.
 */
export function createCrewMember({
  id,
  name,
  salary,
  hireDate = new Date().toISOString(),
}: {
  id: string;
  name: string;
  salary: number;
  hireDate?: string;
}): CrewMember {
  return {
    id,
    name,
    status: AstronautStatus.ACTIVE,
    skills: {
      piloting: 0,
      engineering: 0,
      science: 0,
    },
    salary,
    hireDate,
    missionsFlown: 0,
    flightsFlown: 0,
    deathDate: null,
    deathCause: null,
    assignedRocketId: null,
    injuryEnds: null,
    trainingSkill: null,
    trainingEnds: null,
    stationedHubId: EARTH_HUB_ID,
    transitUntil: null,
  };
}

/** Creates a new mission record. */
export function createMission({
  id,
  title,
  description,
  reward,
  deadline,
  requirements = {},
}: {
  id: string;
  title: string;
  description: string;
  reward: number;
  deadline: string;
  requirements?: Partial<MissionRequirements>;
}): MissionInstance {
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

/** Creates a new rocket design record. */
export function createRocketDesign({
  id,
  name,
  parts = [],
  staging = { stages: [[]], unstaged: [] },
  totalMass = 0,
  totalThrust = 0,
  savePrivate = false,
}: {
  id: string;
  name: string;
  parts?: RocketPart[];
  staging?: StagingDesign;
  totalMass?: number;
  totalThrust?: number;
  savePrivate?: boolean;
}): RocketDesign {
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

/** Creates a flight result record (written to history after a launch). */
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
}: {
  id: string;
  missionId: string;
  rocketId: string;
  crewIds?: string[];
  launchDate?: string;
  outcome: FlightOutcome;
  deltaVUsed?: number;
  revenue?: number;
  notes?: string;
}): FlightResult {
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
 */
export function createFlightState({
  missionId,
  rocketId,
  crewIds = [],
  fuelRemaining = 0,
  deltaVRemaining = 0,
  bodyId = 'EARTH' as CelestialBody,
  launchType,
  launchHubId,
}: {
  missionId: string;
  rocketId: string;
  crewIds?: string[];
  fuelRemaining?: number;
  deltaVRemaining?: number;
  bodyId?: CelestialBody;
  launchType?: 'surface' | 'orbital';
  launchHubId?: string;
}): FlightState {
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
    maxAltitude: 0,
    maxVelocity: 0,
    horizontalVelocity: 0,
    dockingState: null,
    transferState: null,
    powerState: null,
    commsState: null,
    launchType,
    launchHubId,
  };
}

// ---------------------------------------------------------------------------
// State Helpers (pure functions — return new values, do not mutate state)
// ---------------------------------------------------------------------------

/** Returns true if a flight is currently in progress. */
export function isFlightActive(state: GameState): boolean {
  return state.currentFlight !== null;
}

/** Returns all active crew members available for assignment. */
export function getIdleCrew(state: GameState): CrewMember[] {
  return state.crew.filter((c) => c.status === AstronautStatus.ACTIVE);
}

/** Finds a crew member by ID, or null if not found. */
export function findCrewById(state: GameState, id: string): CrewMember | null {
  return state.crew.find((c) => c.id === id) ?? null;
}

/** Finds a mission across all three buckets by ID, or null if not found. */
export function findMissionById(state: GameState, id: string): MissionInstance | null {
  const all = [
    ...state.missions.available,
    ...state.missions.accepted,
    ...state.missions.completed,
  ];
  return all.find((m) => m.id === id) ?? null;
}

/** Save or overwrite a rocket design in the savedDesigns array. */
export function saveDesign(state: GameState, design: RocketDesign): void {
  const idx = state.savedDesigns.findIndex(d => d.id === design.id);
  if (idx >= 0) {
    state.savedDesigns[idx] = design;
  } else {
    state.savedDesigns.push(design);
  }
}

/** Delete a saved design by ID. */
export function deleteDesign(state: GameState, designId: string): void {
  state.savedDesigns = state.savedDesigns.filter(d => d.id !== designId);
}

/** Finds a rocket design by ID, or null if not found. */
export function findRocketById(state: GameState, id: string): RocketDesign | null {
  return state.rockets.find((r) => r.id === id) ?? null;
}
