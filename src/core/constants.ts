/**
 * constants.ts — Shared enums and constants for all game systems.
 *
 * All game logic modules import from here. Using `as const` objects as enums
 * provides compile-time type safety and runtime immutability.
 */

// ---------------------------------------------------------------------------
// Part Types
// ---------------------------------------------------------------------------

/**
 * Every component a player can attach to a rocket.
 */
export const PartType = Object.freeze({
  /** Provides thrust. Consumes fuel. */
  ENGINE: 'ENGINE',
  /** Stores liquid or solid propellant. */
  FUEL_TANK: 'FUEL_TANK',
  /** Houses the crew and mission payload. Required on crewed flights. */
  COMMAND_MODULE: 'COMMAND_MODULE',
  /** Uncrewed avionics pod; controls the rocket without a crew seat. */
  COMPUTER_MODULE: 'COMPUTER_MODULE',
  /** Science instrument, comms relay, or auxiliary service bay. */
  SERVICE_MODULE: 'SERVICE_MODULE',
  /** Slows descent for safe recovery. Required for crew return. */
  PARACHUTE: 'PARACHUTE',
  /** Absorbs heat on atmospheric re-entry. */
  HEAT_SHIELD: 'HEAT_SHIELD',
  /** Cushions landing impact on solid surfaces. */
  LANDING_LEG: 'LANDING_LEG',
  /** Extendable landing supports (plural leg assembly, e.g. a 4-leg unit). */
  LANDING_LEGS: 'LANDING_LEGS',
  /** Carries science instruments or cargo. */
  PAYLOAD: 'PAYLOAD',
  /** Deployable satellite or probe payload released in flight. */
  SATELLITE: 'SATELLITE',
  /** Connects stages and provides axial (in-line) separation events. */
  DECOUPLER: 'DECOUPLER',
  /** Separates stages along the vertical (top/bottom) stack axis. */
  STACK_DECOUPLER: 'STACK_DECOUPLER',
  /** Mounts to the side of a stack and separates a radially-attached part. */
  RADIAL_DECOUPLER: 'RADIAL_DECOUPLER',
  /** Pre-loaded with solid propellant; not throttleable; burns until empty. */
  SOLID_ROCKET_BOOSTER: 'SOLID_ROCKET_BOOSTER',
  /** Provides attitude control and small orbital adjustments. */
  RCS_THRUSTER: 'RCS_THRUSTER',
  /** Generates electricity for systems with no atmosphere. */
  SOLAR_PANEL: 'SOLAR_PANEL',
  /** Stores electrical energy for use during eclipse periods. */
  BATTERY: 'BATTERY',
  /** Docking port for connecting vessels in orbit. */
  DOCKING_PORT: 'DOCKING_PORT',
  /** Aerodynamic nose cone that reduces drag on atmospheric ascent. */
  NOSE_CONE: 'NOSE_CONE',
  /** Ground-mounted launch clamp that holds the rocket on the pad until staged. */
  LAUNCH_CLAMP: 'LAUNCH_CLAMP',
  /** Communication antenna for satellite data links. */
  ANTENNA: 'ANTENNA',
  /** Sensor package for satellite observation and data collection. */
  SENSOR: 'SENSOR',
  /** Specialised scientific instrument for satellite platforms. */
  INSTRUMENT: 'INSTRUMENT',
  /** Grabbing arm for attaching to satellites for repair and servicing. */
  GRABBING_ARM: 'GRABBING_ARM',
  /** Cargo bay for transporting solid resources. */
  CARGO_BAY: 'CARGO_BAY',
  /** Pressurized tank for transporting gaseous resources. */
  PRESSURIZED_TANK: 'PRESSURIZED_TANK',
  /** Cryo-cooled tank for transporting liquid resources. */
  CRYO_TANK: 'CRYO_TANK',
  /** Mining module deployed on a celestial body surface. */
  MINING_MODULE: 'MINING_MODULE',
  /** Deployable outpost core for establishing off-world hubs. */
  OUTPOST_CORE: 'OUTPOST_CORE',
} as const);

export type PartType = (typeof PartType)[keyof typeof PartType];

// ---------------------------------------------------------------------------
// Mission States
// ---------------------------------------------------------------------------

/**
 * Lifecycle states a mission object can be in.
 */
export const MissionState = Object.freeze({
  /** Generated and visible on the mission board; not yet accepted. */
  AVAILABLE: 'AVAILABLE',
  /** Player has accepted; a rocket must be launched before the deadline. */
  ACCEPTED: 'ACCEPTED',
  /** All objectives were met; reward has been paid out. */
  COMPLETED: 'COMPLETED',
  /** A flight was attempted but objectives were not met. */
  FAILED: 'FAILED',
  /** Deadline passed before the mission was completed. */
  EXPIRED: 'EXPIRED',
} as const);

export type MissionState = (typeof MissionState)[keyof typeof MissionState];

// ---------------------------------------------------------------------------
// Crew Statuses
// ---------------------------------------------------------------------------

/**
 * Career / employment status of an astronaut.
 * Tracks the astronaut's permanent career arc (active → fired / kia).
 * Operational state (on mission, training, injured) is tracked by dedicated
 * fields on CrewMember rather than an enum.
 */
export const AstronautStatus = Object.freeze({
  /** Currently employed and available (alive, not fired). */
  ACTIVE: 'active',
  /** Employment terminated by the player; no longer takes missions. */
  FIRED: 'fired',
  /** Killed in action; record is retained permanently in history. */
  KIA: 'kia',
} as const);

export type AstronautStatus = (typeof AstronautStatus)[keyof typeof AstronautStatus];

// ---------------------------------------------------------------------------
// Flight Phases
// ---------------------------------------------------------------------------

/**
 * Distinct phases of a flight.  The state machine enforces valid transitions:
 *
 *   PRELAUNCH -> LAUNCH -> FLIGHT -> ORBIT
 *   ORBIT -> MANOEUVRE -> ORBIT
 *   ORBIT -> REENTRY -> FLIGHT (landing)
 *   ORBIT -> TRANSFER -> CAPTURE -> ORBIT (at destination)
 *   ORBIT -> (return to agency -- completes a period)
 *   FLIGHT -> (land / crash)
 *
 * Docking mode is a *control mode* within ORBIT, not a phase (see TASK-005).
 */
export const FlightPhase = Object.freeze({
  /** On the pad, engines not yet ignited. */
  PRELAUNCH: 'PRELAUNCH',
  /** Engines ignited; ascending through lower atmosphere. */
  LAUNCH: 'LAUNCH',
  /** Powered or unpowered atmospheric / sub-orbital flight. */
  FLIGHT: 'FLIGHT',
  /** Stable orbit achieved; can time-warp, return to agency, or plan manoeuvres. */
  ORBIT: 'ORBIT',
  /** Executing an orbital manoeuvre (burn); returns to ORBIT when complete. */
  MANOEUVRE: 'MANOEUVRE',
  /** De-orbiting; descending back into the atmosphere toward landing. */
  REENTRY: 'REENTRY',
  /** In-transit between celestial bodies (player cannot leave craft). */
  TRANSFER: 'TRANSFER',
  /** Arriving at destination body; transitioning to stable orbit. */
  CAPTURE: 'CAPTURE',
} as const);

export type FlightPhase = (typeof FlightPhase)[keyof typeof FlightPhase];

// ---------------------------------------------------------------------------
// Control Modes (within ORBIT phase)
// ---------------------------------------------------------------------------

/**
 * Control modes available during orbital flight.
 * Normal is the default; Docking and RCS are toggled by the player.
 */
export const ControlMode = Object.freeze({
  /** Default orbital mode: A/D rotate, W/S throttle, Space stages.
   *  Engines affect the orbit directly. */
  NORMAL: 'NORMAL',
  /** Docking mode: engines affect local position within the orbit slot.
   *  Current orbit is frozen as a reference frame.
   *  A/D = along track, W/S = radial. */
  DOCKING: 'DOCKING',
  /** RCS mode (sub-mode of docking): WASD directional translation,
   *  no rotation, RCS plumes visible. */
  RCS: 'RCS',
} as const);

export type ControlMode = (typeof ControlMode)[keyof typeof ControlMode];

// ---------------------------------------------------------------------------
// Flight Outcomes
// ---------------------------------------------------------------------------

/**
 * Possible results of a completed flight.
 */
export const FlightOutcome = Object.freeze({
  /** Rocket and crew (if any) returned safely; objectives met. */
  SUCCESS: 'SUCCESS',
  /** Objectives met but rocket or crew were lost. */
  PARTIAL_SUCCESS: 'PARTIAL_SUCCESS',
  /** Rocket destroyed or mission aborted; objectives not met. */
  FAILURE: 'FAILURE',
  /** Rocket reached orbit / destination but crew not recovered. */
  CREW_LOST: 'CREW_LOST',
} as const);

export type FlightOutcome = (typeof FlightOutcome)[keyof typeof FlightOutcome];

// ---------------------------------------------------------------------------
// Fuel Types
// ---------------------------------------------------------------------------

/**
 * Propellant types used by engines and fuel tanks.
 */
export const FuelType = Object.freeze({
  LIQUID: 'LIQUID',
  SOLID: 'SOLID',
  MONOPROPELLANT: 'MONOPROPELLANT',
  ELECTRIC: 'ELECTRIC',
} as const);

export type FuelType = (typeof FuelType)[keyof typeof FuelType];

// ---------------------------------------------------------------------------
// Game Modes
// ---------------------------------------------------------------------------

/**
 * Available game modes.
 */
export const GameMode = Object.freeze({
  /** Guided tutorial: missions unlock parts and facilities step by step. */
  TUTORIAL: 'tutorial',
  /** Free play: all starter parts, building available from the start. */
  FREEPLAY: 'freeplay',
  /** Sandbox: everything unlocked, free building, toggleable malfunctions/weather. */
  SANDBOX: 'sandbox',
} as const);

export type GameMode = (typeof GameMode)[keyof typeof GameMode];

// ---------------------------------------------------------------------------
// Starting / Default Values
// ---------------------------------------------------------------------------

/** Player's starting cash balance at a new game (equal to the initial loan proceeds). */
export const STARTING_MONEY: number = 2_000_000;

/** Sandbox mode starting cash -- effectively unlimited. */
export const SANDBOX_STARTING_MONEY: number = 999_999_999;

/** Starting loan balance -- players begin the game $2 million in debt. */
export const STARTING_LOAN_BALANCE: number = 2_000_000;

/** Per-mission interest rate applied to the outstanding loan (3 %). */
export const DEFAULT_LOAN_INTEREST_RATE: number = 0.03;

/** Fine per astronaut killed in action (deducted from cash). */
export const DEATH_FINE_PER_ASTRONAUT: number = 500_000;

/** Cost to hire a new astronaut. */
export const HIRE_COST: number = 50_000;

/** Maximum cumulative loan balance the player may carry. */
export const MAX_LOAN_BALANCE: number = 10_000_000;

/** Maximum number of crew members the player can hire. */
export const MAX_CREW_SIZE: number = 20;

/** Number of missions generated on the board at one time. */
export const AVAILABLE_MISSION_SLOTS: number = 5;

// ---------------------------------------------------------------------------
// Facilities
// ---------------------------------------------------------------------------

/**
 * Unique identifiers for each facility the player can build on the hub.
 */
export const FacilityId = Object.freeze({
  LAUNCH_PAD:       'launch-pad',
  VAB:              'vab',
  MISSION_CONTROL:  'mission-control',
  CREW_ADMIN:       'crew-admin',
  TRACKING_STATION: 'tracking-station',
  RD_LAB:           'rd-lab',
  SATELLITE_OPS:    'satellite-ops',
  LIBRARY:          'library',
  LOGISTICS_CENTER: 'logistics-center',
  CREW_HAB:         'crew-hab',
} as const);

export type FacilityId = (typeof FacilityId)[keyof typeof FacilityId];

/**
 * Static definition for a buildable facility.
 * `cost` is the base build cost in dollars.  `starter` facilities are
 * pre-built at tier 1 in every new game (both tutorial and non-tutorial).
 * `scienceCost` is the science-point cost to build (default 0; only the
 * R&D Lab costs science).
 */
export interface FacilityDefinition {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly cost: number;
  readonly scienceCost: number;
  readonly starter: boolean;
}

export const FACILITY_DEFINITIONS: readonly FacilityDefinition[] = Object.freeze([
  Object.freeze({
    id:          FacilityId.LAUNCH_PAD,
    name:        'Launch Pad',
    description: 'Launch rockets into space.',
    cost:        0,
    scienceCost: 0,
    starter:     true,
  }),
  Object.freeze({
    id:          FacilityId.VAB,
    name:        'Vehicle Assembly Building',
    description: 'Design and assemble rockets.',
    cost:        0,
    scienceCost: 0,
    starter:     true,
  }),
  Object.freeze({
    id:          FacilityId.MISSION_CONTROL,
    name:        'Mission Control Centre',
    description: 'Accept contracts and monitor missions.',
    cost:        0,
    scienceCost: 0,
    starter:     true,
  }),
  Object.freeze({
    id:          FacilityId.CREW_ADMIN,
    name:        'Crew Administration',
    description: 'Hire, manage, and train astronauts.',
    cost:        100_000,
    scienceCost: 0,
    starter:     false,
  }),
  Object.freeze({
    id:          FacilityId.TRACKING_STATION,
    name:        'Tracking Station',
    description: 'Track orbital objects and plan transfers.',
    cost:        200_000,
    scienceCost: 0,
    starter:     false,
  }),
  Object.freeze({
    id:          FacilityId.RD_LAB,
    name:        'R&D Lab',
    description: 'Research new technologies and unlock advanced parts.',
    cost:        300_000,
    scienceCost: 20,
    starter:     false,
  }),
  Object.freeze({
    id:          FacilityId.SATELLITE_OPS,
    name:        'Satellite Network Operations Centre',
    description: 'Manage satellite networks and orbital infrastructure.',
    cost:        400_000,
    scienceCost: 0,
    starter:     false,
  }),
  Object.freeze({
    id:          FacilityId.LIBRARY,
    name:        'Library',
    description: 'View agency statistics, records, and knowledge.',
    cost:        0,
    scienceCost: 0,
    starter:     false,
  }),
  Object.freeze({
    id:          FacilityId.LOGISTICS_CENTER,
    name:        'Logistics Center',
    description: 'Manage mining sites and automated transport routes.',
    cost:        350_000,
    scienceCost: 15,
    starter:     false,
  }),
]);

// ---------------------------------------------------------------------------
// Contract System
// ---------------------------------------------------------------------------

/**
 * Categories of procedurally generated contracts.
 */
export const ContractCategory = Object.freeze({
  ALTITUDE_RECORD: 'ALTITUDE_RECORD',
  SPEED_RECORD: 'SPEED_RECORD',
  SCIENCE_SURVEY: 'SCIENCE_SURVEY',
  SATELLITE_DEPLOY: 'SATELLITE_DEPLOY',
  SAFE_RECOVERY: 'SAFE_RECOVERY',
  ORBITAL: 'ORBITAL',
  CRASH_TEST: 'CRASH_TEST',
  RESOURCE: 'RESOURCE',
} as const);

export type ContractCategory = (typeof ContractCategory)[keyof typeof ContractCategory];

/**
 * Contract board pool and active contract caps by Mission Control tier.
 *
 * pool  = max contracts visible on the board at once.
 * active = max contracts the player may have accepted simultaneously.
 */
export interface ContractTierCap {
  readonly pool: number;
  readonly active: number;
}

export const CONTRACT_TIER_CAPS: Readonly<Record<number, ContractTierCap>> = Object.freeze({
  1: Object.freeze({ pool: 4,  active: 2 }),
  2: Object.freeze({ pool: 8,  active: 5 }),
  3: Object.freeze({ pool: 12, active: 8 }),
});

/**
 * Mission Control Centre tier feature descriptions.
 *
 * Each tier defines:
 *   - label:       Display name for the tier.
 *   - features:    Array of feature strings for UI display.
 *   - minMccTier:  The minimum MCC tier a contract template must declare
 *                  to be eligible for generation.  Templates with
 *                  `minMccTier <= currentMccTier` are included.
 *
 * Tier 1 (free):   Tutorial-level and basic contracts only.
 * Tier 2 ($200k):  Unlocks medium-difficulty contracts.
 * Tier 3 ($500k):  Unlocks premium contracts and multi-part chains.
 */
export interface TierFeatureSet {
  readonly label: string;
  readonly features: readonly string[];
}

export const MCC_TIER_FEATURES: Readonly<Record<number, TierFeatureSet>> = Object.freeze({
  1: Object.freeze({
    label: 'Basic',
    features: Object.freeze([
      'Tutorial missions',
      '2 active contracts',
      '4 board pool',
      'Basic contracts only',
    ]),
  }),
  2: Object.freeze({
    label: 'Standard',
    features: Object.freeze([
      '5 active contracts',
      '8 board pool',
      'Medium-difficulty contracts',
    ]),
  }),
  3: Object.freeze({
    label: 'Advanced',
    features: Object.freeze([
      '8 active contracts',
      '12 board pool',
      'Premium contracts',
      'Multi-part chain contracts',
    ]),
  }),
});

/**
 * Icons (text glyphs) for each contract category, used in the UI.
 */
export const CONTRACT_CATEGORY_ICONS: Readonly<Record<string, string>> = Object.freeze({
  ALTITUDE_RECORD: '\u2191',   // ↑
  SPEED_RECORD:    '\u2192',   // →
  SCIENCE_SURVEY:  '\u25C9',   // ◉
  SATELLITE_DEPLOY:'\u2295',   // ⊕
  SAFE_RECOVERY:   '\u2193',   // ↓
  ORBITAL:         '\u25CB',   // ○
  CRASH_TEST:      '\u2716',   // ✖
});

/**
 * Conflict tags that indicate contracts in the same tag group are harder
 * to complete simultaneously.  Used to warn the player in the UI.
 */
export const CONTRACT_CONFLICT_TAGS = Object.freeze({
  DESTRUCTIVE:  'DESTRUCTIVE',   // crash test vs safe recovery
  BUDGET:       'BUDGET',        // budget-limited flights
  CREW_HEAVY:   'CREW_HEAVY',    // crew requirement contracts
  MINIMALIST:   'MINIMALIST',    // part-count-limited flights
} as const);

export type ContractConflictTag = (typeof CONTRACT_CONFLICT_TAGS)[keyof typeof CONTRACT_CONFLICT_TAGS];

/** Bonus reward multiplier: bonus reward = base reward * this factor. */
export const CONTRACT_BONUS_REWARD_RATE: number = 0.5;

/** Number of new contracts generated after each flight return. */
export const CONTRACTS_PER_FLIGHT_MIN: number = 2;
export const CONTRACTS_PER_FLIGHT_MAX: number = 3;

/** Number of flights before an unaccepted board contract expires. */
export const CONTRACT_BOARD_EXPIRY_FLIGHTS: number = 4;

/** Cancellation penalty as a fraction of the contract reward. */
export const CONTRACT_CANCEL_PENALTY_RATE: number = 0.25;

/** Reputation gained per completed contract (minimum of random 3-5 range). */
export const CONTRACT_REP_GAIN_MIN: number = 3;

/** Reputation gained per completed contract (maximum of random 3-5 range). */
export const CONTRACT_REP_GAIN_MAX: number = 5;

/** @deprecated Use CONTRACT_REP_GAIN_MIN/MAX. Kept for contract generation compat. */
export const CONTRACT_REP_GAIN_BASE: number = 5;

/** Reputation lost per cancelled contract. */
export const CONTRACT_REP_LOSS_CANCEL: number = 8;

/** Reputation lost per expired/failed contract. */
export const CONTRACT_REP_LOSS_FAIL: number = 5;

/** Starting reputation for a new agency. */
export const STARTING_REPUTATION: number = 50;

// ---------------------------------------------------------------------------
// Reputation Events
// ---------------------------------------------------------------------------

/** Reputation gained for each crew member safely returned from a crewed flight. */
export const REP_GAIN_SAFE_CREW_RETURN: number = 1;

/** Reputation gained for reaching a milestone (first orbit, first landing, etc.). */
export const REP_GAIN_MILESTONE: number = 10;

/** Reputation lost per crew member killed in action. */
export const REP_LOSS_CREW_DEATH: number = 10;

/** Reputation lost when a flight ends in failure (objectives not met). */
export const REP_LOSS_MISSION_FAILURE: number = 3;

/** Reputation lost when rocket is destroyed with no recovery. */
export const REP_LOSS_ROCKET_DESTRUCTION: number = 2;

// ---------------------------------------------------------------------------
// Reputation Tiers
// ---------------------------------------------------------------------------

/**
 * Reputation tier definitions.  Each tier covers a range of reputation values
 * and applies modifiers to crew hiring cost and facility construction cost.
 *
 * `crewCostModifier`:    multiplier applied to HIRE_COST (1.0 = normal).
 * `facilityDiscount`:    fractional discount on money cost of facilities/upgrades.
 *                        Never applied to science costs (e.g. R&D Lab).
 * `label`:               human-readable tier name.
 * `color`:               hex CSS colour for UI display.
 */
export interface ReputationTier {
  readonly min: number;
  readonly max: number;
  readonly label: string;
  readonly color: string;
  readonly crewCostModifier: number;
  readonly facilityDiscount: number;
}

export const REPUTATION_TIERS: readonly ReputationTier[] = Object.freeze([
  { min: 0,  max: 20,  label: 'Basic',   color: '#cc4444', crewCostModifier: 1.50, facilityDiscount: 0.00 },
  { min: 21, max: 40,  label: 'Standard', color: '#cc8844', crewCostModifier: 1.25, facilityDiscount: 0.00 },
  { min: 41, max: 60,  label: 'Good',    color: '#cccc44', crewCostModifier: 1.00, facilityDiscount: 0.05 },
  { min: 61, max: 80,  label: 'Premium', color: '#44cc88', crewCostModifier: 0.90, facilityDiscount: 0.10 },
  { min: 81, max: 100, label: 'Elite',   color: '#4488ff', crewCostModifier: 0.75, facilityDiscount: 0.15 },
]);

/**
 * Get the reputation tier object for a given reputation value.
 *
 * @param reputation  Current agency reputation (0-100).
 */
export function getReputationTier(reputation: number): ReputationTier {
  const rep = Math.max(0, Math.min(100, reputation));
  for (const tier of REPUTATION_TIERS) {
    if (rep >= tier.min && rep <= tier.max) return tier;
  }
  return REPUTATION_TIERS[0];
}

/**
 * Get the crew hiring cost modifier for the current reputation.
 * Applied as a multiplier to HIRE_COST.
 *
 * @param reputation  Current agency reputation (0-100).
 * @returns  Multiplier (e.g. 1.5 = +50 %, 0.75 = -25 %).
 */
export function getCrewCostModifier(reputation: number): number {
  return getReputationTier(reputation).crewCostModifier;
}

// ---------------------------------------------------------------------------
// Period / Operating Costs
// ---------------------------------------------------------------------------

/** Crew salary charged per period (per astronaut). */
export const CREW_SALARY_PER_PERIOD: number = 5_000;

/** Base facility upkeep charged per period. */
export const FACILITY_UPKEEP_PER_PERIOD: number = 10_000;

// ---------------------------------------------------------------------------
// Crew Admin Tier Features
// ---------------------------------------------------------------------------

/**
 * Crew Administration facility tier feature descriptions.
 *
 * Tier 1 ($100k):  Basic hire/fire, skill tracking.
 * Tier 2 ($250k):  Training facility -- assign crew to skill training between flights.
 * Tier 3 ($600k):  Recruit experienced crew (starting skills > 0), advanced medical.
 */
export const CREW_ADMIN_TIER_FEATURES: Readonly<Record<number, TierFeatureSet>> = Object.freeze({
  1: Object.freeze({
    label: 'Basic',
    features: Object.freeze([
      'Hire and fire astronauts',
      'Basic skill tracking',
      'Medical care (halves recovery)',
    ]),
  }),
  2: Object.freeze({
    label: 'Training Centre',
    features: Object.freeze([
      'Assign crew to training courses (1 slot)',
      'Course: $20k, 3 periods, +15 skill',
      'All Tier 1 features',
    ]),
  }),
  3: Object.freeze({
    label: 'Advanced Operations',
    features: Object.freeze([
      'Recruit experienced crew (starting skills > 0)',
      'Advanced medical (recovery time reduced to 1/3)',
      'Training slots increased to 3',
      'All Tier 2 features',
    ]),
  }),
});

/**
 * Tracking Station facility tier feature descriptions.
 *
 * Tier 1 ($200k):  Map view (local body only), see objects in orbit.
 * Tier 2 ($500k):  Map view (solar system), track debris, predict weather windows.
 * Tier 3 ($1M):    Deep space communication, transfer route planning, track distant bodies.
 */
export const TRACKING_STATION_TIER_FEATURES: Readonly<Record<number, TierFeatureSet>> = Object.freeze({
  1: Object.freeze({
    label: 'Basic',
    features: Object.freeze([
      'Map view (local body only)',
      'See objects in orbit',
      'Basic orbital tracking',
    ]),
  }),
  2: Object.freeze({
    label: 'Advanced',
    features: Object.freeze([
      'Map view (solar system)',
      'Track debris',
      'Predict weather windows',
      'All Tier 1 features',
    ]),
  }),
  3: Object.freeze({
    label: 'Deep Space',
    features: Object.freeze([
      'Deep space communication',
      'Transfer route planning',
      'Track distant bodies',
      'All Tier 2 features',
    ]),
  }),
});

/**
 * Cost to enrol one astronaut in a training course.
 * Charged upfront when training is assigned.
 */
export const TRAINING_COURSE_COST: number = 20_000;

/**
 * Duration of a single training course in periods.
 * The astronaut is unavailable for flights for this many periods.
 */
export const TRAINING_COURSE_DURATION: number = 3;

/**
 * Flat skill points awarded when a training course completes.
 * Applied directly (not subject to diminishing returns) to the chosen skill,
 * but still capped at 100.
 */
export const TRAINING_SKILL_GAIN: number = 15;

/**
 * Maximum number of simultaneous training slots by Crew Admin tier.
 * Tier 2 provides 1 slot, Tier 3 provides 3.
 */
export const TRAINING_SLOTS_BY_TIER: Readonly<Record<number, number>> = Object.freeze({ 2: 1, 3: 3 });

/**
 * Starting skill range for experienced crew (Tier 3 recruitment).
 * Each skill starts at a random value in [min, max].
 */
export interface SkillRange {
  readonly min: number;
  readonly max: number;
}

export const EXPERIENCED_CREW_SKILL_RANGE: SkillRange = Object.freeze({ min: 10, max: 30 });

/**
 * Hire cost multiplier for experienced crew (Tier 3).
 * Applied on top of the reputation-adjusted hire cost.
 */
export const EXPERIENCED_HIRE_COST_MULTIPLIER: number = 2.5;

// ---------------------------------------------------------------------------
// Celestial Bodies, Altitude Bands, Biomes, Surface Ops, Life Support
// ---------------------------------------------------------------------------
// Moved to ./constants/bodies.ts; re-exported here so existing imports of
// `../constants` keep working.
export * from './constants/bodies.ts';

// ---------------------------------------------------------------------------
// Science Data Types
// ---------------------------------------------------------------------------

/**
 * How a completed instrument's data can be recovered.
 */
export const ScienceDataType = Object.freeze({
  /** Physical sample -- must be returned to the ground for full yield.
   *  Cannot be transmitted. */
  SAMPLE: 'SAMPLE',
  /** Telemetry / analysis data -- can be transmitted from orbit at reduced
   *  yield (40-60 %), or returned physically for full yield. */
  ANALYSIS: 'ANALYSIS',
} as const);

export type ScienceDataType = (typeof ScienceDataType)[keyof typeof ScienceDataType];

// ---------------------------------------------------------------------------
// Science Yield Constants
// ---------------------------------------------------------------------------

/**
 * Diminishing-return multipliers applied when the same (instrument, biome)
 * pair is collected repeatedly across flights.
 *
 * Index = number of prior collections in that pair.
 *   0 -> first time  -> 100 %
 *   1 -> second time ->  25 %
 *   2 -> third time  ->  10 %
 *   3+ -> no further value
 */
export const DIMINISHING_RETURNS: readonly number[] = Object.freeze([1.0, 0.25, 0.10]);

/** Minimum yield fraction when transmitting ANALYSIS data from orbit. */
export const ANALYSIS_TRANSMIT_YIELD_MIN: number = 0.40;

/** Maximum yield fraction when transmitting ANALYSIS data from orbit. */
export const ANALYSIS_TRANSMIT_YIELD_MAX: number = 0.60;

// ---------------------------------------------------------------------------
// Tech Tree
// ---------------------------------------------------------------------------

/**
 * Maximum tech tier accessible per R&D Lab facility tier.
 *
 *   R&D Lab Tier 1 -> tech tiers 1-2
 *   R&D Lab Tier 2 -> tech tiers 3-4
 *   R&D Lab Tier 3 -> tech tiers 5-6
 */
export const RD_TIER_MAX_TECH: Readonly<Record<number, number>> = Object.freeze({
  1: 2,
  2: 4,
  3: 6,
});

// ---------------------------------------------------------------------------
// R&D Lab Upgrade Definitions
// ---------------------------------------------------------------------------

/**
 * R&D Lab science yield bonus per facility tier.
 * Applied as a multiplier: `yield *= (1 + bonus)`.
 */
export const RD_LAB_SCIENCE_BONUS: Readonly<Record<number, number>> = Object.freeze({
  0: 0,     // No lab built
  1: 0.10,  // Tier 1: +10 %
  2: 0.20,  // Tier 2: +20 %
  3: 0.30,  // Tier 3: +30 %
});

/**
 * Upgrade cost definition for an R&D Lab tier.
 */
export interface RdLabTierDef {
  readonly moneyCost: number;
  readonly scienceCost: number;
  readonly description: string;
}

/**
 * Upgrade cost definitions for each R&D Lab tier.
 *
 * Tier 1 is the initial build.  Tiers 2-3 are upgrades.
 * The R&D Lab is the only facility that costs both money AND science.
 * Reputation discounts apply to the money portion only.
 */
export const RD_LAB_TIER_DEFS: Readonly<Record<number, RdLabTierDef>> = Object.freeze({
  1: Object.freeze({ moneyCost: 300_000,   scienceCost: 20,  description: 'Tech tiers 1–2, 10% science bonus' }),
  2: Object.freeze({ moneyCost: 600_000,   scienceCost: 100, description: 'Tech tiers 3–4, 20% science bonus' }),
  3: Object.freeze({ moneyCost: 1_000_000, scienceCost: 200, description: 'Tier 5, 30% science bonus, experimental parts' }),
});

/** Maximum upgrade tier for the R&D Lab. */
export const RD_LAB_MAX_TIER: number = 3;

// ---------------------------------------------------------------------------
// Generalized Facility Upgrade Definitions
// ---------------------------------------------------------------------------

/**
 * Upgrade cost for a single facility tier.
 */
export interface FacilityTierUpgrade {
  readonly moneyCost: number;
  readonly scienceCost: number;
  readonly description: string;
}

/**
 * Upgrade definition for a facility: max tier and per-tier costs.
 */
export interface FacilityUpgradeDef {
  readonly maxTier: number;
  readonly tiers: Readonly<Record<number, FacilityTierUpgrade>>;
}

/**
 * Upgrade tier definitions for every upgradeable facility.
 *
 * Each key is a FacilityId.  The value is an object with:
 *   - `maxTier` -- the highest tier this facility can reach.
 *   - `tiers`   -- a map from tier number (2+) to upgrade cost & description.
 *     Tier 1 is always the initial build (no upgrade cost).
 *
 * All facilities cost money only, except R&D Lab which also costs science.
 * Reputation discounts apply to the money portion only.
 *
 * Facilities absent from this map (e.g. Library) have no upgrades (max tier 1).
 */
export const FACILITY_UPGRADE_DEFS: Readonly<Record<string, FacilityUpgradeDef>> = Object.freeze({
  [FacilityId.LAUNCH_PAD]: Object.freeze({
    maxTier: 3,
    tiers: Object.freeze({
      2: Object.freeze({ moneyCost: 200_000, scienceCost: 0, description: 'Higher max mass, fuel top-off' }),
      3: Object.freeze({ moneyCost: 500_000, scienceCost: 0, description: 'Highest max mass, launch clamp support' }),
    }),
  }),
  [FacilityId.VAB]: Object.freeze({
    maxTier: 3,
    tiers: Object.freeze({
      2: Object.freeze({ moneyCost: 150_000, scienceCost: 0, description: 'Higher part count, greater height/width' }),
      3: Object.freeze({ moneyCost: 400_000, scienceCost: 0, description: 'Highest part count, largest height/width' }),
    }),
  }),
  [FacilityId.MISSION_CONTROL]: Object.freeze({
    maxTier: 3,
    tiers: Object.freeze({
      2: Object.freeze({ moneyCost: 200_000, scienceCost: 0, description: '5 active contracts, 8 board pool, medium-difficulty' }),
      3: Object.freeze({ moneyCost: 500_000, scienceCost: 0, description: '8 active contracts, 12 board pool, premium contracts' }),
    }),
  }),
  [FacilityId.CREW_ADMIN]: Object.freeze({
    maxTier: 3,
    tiers: Object.freeze({
      2: Object.freeze({ moneyCost: 250_000, scienceCost: 0, description: 'Training facility for crew skill development' }),
      3: Object.freeze({ moneyCost: 600_000, scienceCost: 0, description: 'Recruit experienced crew, advanced medical' }),
    }),
  }),
  [FacilityId.TRACKING_STATION]: Object.freeze({
    maxTier: 3,
    tiers: Object.freeze({
      2: Object.freeze({ moneyCost: 500_000, scienceCost: 0, description: 'Solar system map, debris tracking, weather windows' }),
      3: Object.freeze({ moneyCost: 1_000_000, scienceCost: 0, description: 'Deep space comms, transfer route planning' }),
    }),
  }),
  [FacilityId.RD_LAB]: Object.freeze({
    maxTier: 3,
    tiers: Object.freeze({
      2: Object.freeze({ moneyCost: 600_000,   scienceCost: 100, description: 'Tech tiers 3–4, 20% science bonus' }),
      3: Object.freeze({ moneyCost: 1_000_000, scienceCost: 200, description: 'Tier 5, 30% science bonus, experimental parts' }),
    }),
  }),
  [FacilityId.SATELLITE_OPS]: Object.freeze({
    maxTier: 3,
    tiers: Object.freeze({
      2: Object.freeze({ moneyCost: 400_000, scienceCost: 0, description: 'Lease satellites to third parties, constellation management' }),
      3: Object.freeze({ moneyCost: 700_000, scienceCost: 0, description: 'Advanced network planning, satellite repositioning, shadow overlay' }),
    }),
  }),
});

/**
 * Look up the upgrade definition for a facility.
 */
export function getFacilityUpgradeDef(facilityId: string): FacilityUpgradeDef | null {
  return FACILITY_UPGRADE_DEFS[facilityId] ?? null;
}

/**
 * Calculate the reputation discount fraction for facility construction.
 *
 * Uses tier-based discounts:
 *   0-20:  0 %    (Basic)
 *   21-40: 0 %    (Standard)
 *   41-60: 5 %    (Good)
 *   61-80: 10 %   (Premium)
 *   81-100: 15 %  (Elite)
 *
 * Facility discounts apply to money only -- never to science costs (R&D Lab).
 *
 * @param reputation  Current agency reputation (0-100).
 * @returns  Discount fraction (0.0-0.15).
 */
export function getReputationDiscount(reputation: number): number {
  return getReputationTier(reputation).facilityDiscount;
}

// ---------------------------------------------------------------------------
// Facility Tier Labels (for facilities without full TierFeatureSet definitions)
// ---------------------------------------------------------------------------

/**
 * Launch Pad tier display labels for the facility header.
 */
export const LAUNCH_PAD_TIER_LABELS: Readonly<Record<number, string>> = Object.freeze({
  1: 'Basic',
  2: 'Enhanced',
  3: 'Heavy Lift',
});

/**
 * R&D Lab tier display labels for the facility header.
 */
export const RD_LAB_TIER_LABELS: Readonly<Record<number, string>> = Object.freeze({
  1: 'Foundation',
  2: 'Advanced',
  3: 'Cutting Edge',
});

/**
 * Satellite Network Operations Centre tier display labels for the facility header.
 */
export const SATELLITE_OPS_TIER_LABELS: Readonly<Record<number, string>> = Object.freeze({
  1: 'Monitoring',
  2: 'Commercial',
  3: 'Command',
});

// ---------------------------------------------------------------------------
// Launch Pad Tier Limits
// ---------------------------------------------------------------------------

/**
 * Maximum total rocket mass (wet mass, kg) allowed per Launch Pad tier.
 *
 *   Tier 1: 18,000 kg  -- small sounding rockets
 *   Tier 2: 80,000 kg  -- medium orbital launch vehicles
 *   Tier 3: Infinity   -- no mass limit (heavy-lift allowed)
 */
export const LAUNCH_PAD_MAX_MASS: Readonly<Record<number, number>> = Object.freeze({
  1: 18_000,
  2: 80_000,
  3: Infinity,
});

// ---------------------------------------------------------------------------
// VAB Tier Limits
// ---------------------------------------------------------------------------

/**
 * Maximum number of parts allowed in a rocket assembly per VAB tier.
 *
 *   Tier 1: 20 parts  -- basic sounding rockets and simple multi-stage
 *   Tier 2: 40 parts  -- larger multi-stage vehicles with radial mounts
 *   Tier 3: Infinity  -- no part limit
 */
export const VAB_MAX_PARTS: Readonly<Record<number, number>> = Object.freeze({
  1: 20,
  2: 40,
  3: Infinity,
});

/**
 * Maximum rocket height (pixels, from getRocketBounds) per VAB tier.
 * 1 px = 0.05 m, so 400 px ~ 20 m, 800 px ~ 40 m.
 *
 *   Tier 1: 400 px (20 m)
 *   Tier 2: 800 px (40 m)
 *   Tier 3: Infinity
 */
export const VAB_MAX_HEIGHT: Readonly<Record<number, number>> = Object.freeze({
  1: 400,
  2: 800,
  3: Infinity,
});

/**
 * Maximum rocket width (pixels, from getRocketBounds) per VAB tier.
 *
 *   Tier 1: 120 px (6 m)
 *   Tier 2: 200 px (10 m)
 *   Tier 3: Infinity
 */
export const VAB_MAX_WIDTH: Readonly<Record<number, number>> = Object.freeze({
  1: 120,
  2: 200,
  3: Infinity,
});

// ---------------------------------------------------------------------------
// Orbit Segments
// ---------------------------------------------------------------------------

/** Number of angular segments dividing each orbit plane. */
export const ORBIT_SEGMENTS: number = 36;

/** Degrees per angular segment. */
export const ORBIT_SEGMENT_SIZE: number = 360 / 36; // 10 degrees

/** Maximum angular distance (degrees) for proximity detection. */
export const PROXIMITY_ANGLE_DEG: number = 5;

/**
 * Type of object tracked in orbit.
 */
export const OrbitalObjectType = Object.freeze({
  CRAFT: 'CRAFT',
  SATELLITE: 'SATELLITE',
  DEBRIS: 'DEBRIS',
  STATION: 'STATION',
} as const);

export type OrbitalObjectType = (typeof OrbitalObjectType)[keyof typeof OrbitalObjectType];

// ---------------------------------------------------------------------------
// Malfunction System
// ---------------------------------------------------------------------------

/**
 * Types of part malfunctions that can occur during flight.
 * Each malfunction has specific effects and recovery options.
 */
export const MalfunctionType = Object.freeze({
  /** Engine loses all thrust; player can attempt reignition via context menu. */
  ENGINE_FLAMEOUT: 'ENGINE_FLAMEOUT',
  /** Engine output drops to 60 % of nominal. */
  ENGINE_REDUCED_THRUST: 'ENGINE_REDUCED_THRUST',
  /** Fuel tank loses ~2 %/s of remaining propellant. */
  FUEL_TANK_LEAK: 'FUEL_TANK_LEAK',
  /** Decoupler fails to fire via staging; player must manually decouple via context menu. */
  DECOUPLER_STUCK: 'DECOUPLER_STUCK',
  /** Parachute deploys at 50 % effectiveness (half drag). */
  PARACHUTE_PARTIAL: 'PARACHUTE_PARTIAL',
  /** SRB burns out earlier than expected (lose remaining fuel). */
  SRB_EARLY_BURNOUT: 'SRB_EARLY_BURNOUT',
  /** Science module instruments fail -- cannot activate experiments. */
  SCIENCE_INSTRUMENT_FAILURE: 'SCIENCE_INSTRUMENT_FAILURE',
  /** Landing legs refuse to deploy via staging; stuck in stowed position. */
  LANDING_LEGS_STUCK: 'LANDING_LEGS_STUCK',
} as const);

export type MalfunctionType = (typeof MalfunctionType)[keyof typeof MalfunctionType];

/**
 * Malfunction mode for E2E testing.
 *   'normal'  -- reliability rolls happen as designed
 *   'off'     -- no malfunctions ever trigger (testing reliability)
 *   'forced'  -- every roll triggers a malfunction at 100 % (testing effects)
 */
export const MalfunctionMode = Object.freeze({
  NORMAL: 'normal',
  OFF:    'off',
  FORCED: 'forced',
} as const);

export type MalfunctionMode = (typeof MalfunctionMode)[keyof typeof MalfunctionMode];

/**
 * Mapping from PartType to which MalfunctionType(s) can affect that part.
 * When a malfunction roll succeeds, one type is chosen from the applicable list.
 */
export const MALFUNCTION_TYPE_MAP: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [PartType.ENGINE]:               Object.freeze([MalfunctionType.ENGINE_FLAMEOUT, MalfunctionType.ENGINE_REDUCED_THRUST]),
  [PartType.FUEL_TANK]:            Object.freeze([MalfunctionType.FUEL_TANK_LEAK]),
  [PartType.SOLID_ROCKET_BOOSTER]: Object.freeze([MalfunctionType.SRB_EARLY_BURNOUT]),
  [PartType.STACK_DECOUPLER]:      Object.freeze([MalfunctionType.DECOUPLER_STUCK]),
  [PartType.RADIAL_DECOUPLER]:     Object.freeze([MalfunctionType.DECOUPLER_STUCK]),
  [PartType.DECOUPLER]:            Object.freeze([MalfunctionType.DECOUPLER_STUCK]),
  [PartType.PARACHUTE]:            Object.freeze([MalfunctionType.PARACHUTE_PARTIAL]),
  [PartType.SERVICE_MODULE]:       Object.freeze([MalfunctionType.SCIENCE_INSTRUMENT_FAILURE]),
  [PartType.LANDING_LEGS]:         Object.freeze([MalfunctionType.LANDING_LEGS_STUCK]),
  [PartType.LANDING_LEG]:          Object.freeze([MalfunctionType.LANDING_LEGS_STUCK]),
});

/** Fuel leak rate as fraction of remaining fuel per second (~2 %/s). */
export const FUEL_LEAK_RATE: number = 0.02;

/** Thrust multiplier for ENGINE_REDUCED_THRUST malfunction (60 %). */
export const REDUCED_THRUST_FACTOR: number = 0.60;

/** Drag multiplier for PARACHUTE_PARTIAL malfunction (50 % effectiveness). */
export const PARTIAL_CHUTE_FACTOR: number = 0.50;

/** Maximum crew engineering skill reduction to malfunction chance (30 %). */
export const MAX_ENGINEERING_MALFUNCTION_REDUCTION: number = 0.30;

/**
 * Default reliability values by part tier.
 * Parts reference these when defining their `reliability` property.
 */
export const RELIABILITY_TIERS = Object.freeze({
  STARTER:  0.92,
  MID:      0.96,
  HIGH:     0.98,
  UPGRADE_BONUS: 0.02,
} as const);

export type ReliabilityTierKey = keyof typeof RELIABILITY_TIERS;

// ---------------------------------------------------------------------------
// Satellite Network, Constellation, Leasing, Repositioning, Degradation
// ---------------------------------------------------------------------------
// Moved to ./constants/satellites.ts; re-exported here so existing imports of
// `../constants` keep working.
export * from './constants/satellites.ts';

// ---------------------------------------------------------------------------
// Docking System
// ---------------------------------------------------------------------------

/**
 * Docking procedure states.
 */
export const DockingState = Object.freeze({
  /** No docking in progress. */
  IDLE: 'IDLE',
  /** Target selected, approaching within visual range. */
  APPROACHING: 'APPROACHING',
  /** Within docking range, aligning orientation and velocity. */
  ALIGNING: 'ALIGNING',
  /** Final approach -- automatic docking engaged. */
  FINAL_APPROACH: 'FINAL_APPROACH',
  /** Hard-docked -- vessels are connected. */
  DOCKED: 'DOCKED',
  /** Undocking sequence in progress. */
  UNDOCKING: 'UNDOCKING',
} as const);

export type DockingState = (typeof DockingState)[keyof typeof DockingState];

/** Maximum angular distance (degrees) at which a target becomes visible/targetable in orbit view. */
export const DOCKING_VISUAL_RANGE_DEG: number = 3;

/** Distance (m) at which docking guidance screen activates in docking mode. */
export const DOCKING_GUIDANCE_RANGE: number = 500;

/** Distance (m) at which automatic final docking engages. */
export const DOCKING_AUTO_RANGE: number = 15;

/** Maximum relative speed (m/s) for safe docking alignment. */
export const DOCKING_MAX_RELATIVE_SPEED: number = 2.0;

/** Maximum orientation difference (radians) for acceptable alignment. */
export const DOCKING_MAX_ORIENTATION_DIFF: number = 0.15; // ~8.6 degrees

/** Maximum lateral offset (m) for acceptable alignment. */
export const DOCKING_MAX_LATERAL_OFFSET: number = 3.0;

/** Automatic docking approach speed (m/s) during final approach. */
export const DOCKING_AUTO_APPROACH_SPEED: number = 0.5;

/** Separation impulse speed (m/s) applied when undocking. */
export const UNDOCKING_SEPARATION_SPEED: number = 1.0;

// ---------------------------------------------------------------------------
// Grabbing Arm System
// ---------------------------------------------------------------------------

/**
 * Grabbing arm procedure states.
 */
export const GrabState = Object.freeze({
  /** No grab in progress. */
  IDLE: 'IDLE',
  /** Target satellite selected, approaching within range. */
  APPROACHING: 'APPROACHING',
  /** Arm extending toward satellite. */
  EXTENDING: 'EXTENDING',
  /** Arm attached to satellite -- repair/service actions available. */
  GRABBED: 'GRABBED',
  /** Arm retracting after release. */
  RELEASING: 'RELEASING',
} as const);

export type GrabState = (typeof GrabState)[keyof typeof GrabState];

/** Maximum angular distance (degrees) at which a satellite becomes targetable for grabbing. */
export const GRAB_VISUAL_RANGE_DEG: number = 3;

/** Distance (m) at which the grabbing arm guidance activates. */
export const GRAB_GUIDANCE_RANGE: number = 500;

/** Distance (m) at which the arm can extend and grab. */
export const GRAB_ARM_RANGE: number = 25;

/** Maximum relative speed (m/s) for safe grabbing. */
export const GRAB_MAX_RELATIVE_SPEED: number = 1.0;

/** Maximum lateral offset (m) for acceptable grab alignment. */
export const GRAB_MAX_LATERAL_OFFSET: number = 5.0;

/** Health points restored when a satellite is repaired via grabbing arm. */
export const GRAB_REPAIR_HEALTH: number = 100;

/** Separation impulse speed (m/s) applied when releasing a grabbed satellite. */
export const GRAB_RELEASE_SPEED: number = 0.5;

// ---------------------------------------------------------------------------
// Power System
// ---------------------------------------------------------------------------

/**
 * Power units: watts (W) for generation/consumption, watt-hours (Wh) for storage.
 * One physics tick at 1/60 s -> dt = 1/60 h / 3600 = 1/216000 hours.
 */

/** Base solar irradiance near Earth (W/m^2 at 1 AU). */
export const SOLAR_IRRADIANCE_1AU: number = 1361;

/**
 * Solar irradiance scaling per body.  Multiplied by SOLAR_IRRADIANCE_1AU to
 * get effective irradiance at each body's orbital distance.
 * Bodies orbiting a planet (Moon, Phobos, Deimos) inherit their parent's value.
 */
export const SOLAR_IRRADIANCE_SCALE: Readonly<Record<string, number>> = Object.freeze({
  SUN:     10.0,    // very close to sun (unused for orbiting, but defined)
  MERCURY: 6.68,    // ~0.387 AU -> 1/0.387^2 ~ 6.68
  VENUS:   1.91,    // ~0.723 AU -> 1/0.723^2 ~ 1.91
  EARTH:   1.00,    // 1 AU (reference)
  MOON:    1.00,    // Same distance from Sun as Earth
  MARS:    0.43,    // ~1.524 AU -> 1/1.524^2 ~ 0.43
  PHOBOS:  0.43,    // Same as Mars
  DEIMOS:  0.43,    // Same as Mars
});

/**
 * Rate at which the "sun direction angle" rotates (degrees per game-second).
 * Models the apparent motion of the shadow cone.  One full rotation every
 * ~5400 seconds (90 minutes) -- roughly an LEO orbital period, so a satellite
 * in a circular LEO orbit sees roughly one day/night cycle per orbit.
 */
export const SUN_ROTATION_RATE: number = 360 / 5400;

/**
 * Power draw (watts) for rotation / attitude control (small constant).
 * Applied whenever the craft is in orbit.
 */
export const POWER_DRAW_ROTATION: number = 5;

/**
 * Power draw (watts) for an active science instrument during data collection.
 */
export const POWER_DRAW_SCIENCE: number = 25;

/**
 * Power draw (watts) for communication/data transmission.
 * Applied when a COMMUNICATION satellite is operational (per period fraction).
 */
export const POWER_DRAW_COMMS: number = 15;

/**
 * Minimum battery charge (Wh) below which power-dependent systems are disabled.
 * Provides a small reserve so systems don't flicker at the boundary.
 */
export const POWER_CRITICAL_THRESHOLD: number = 0.5;

/**
 * Solar panel efficiency factor (0-1).  Converts raw irradiance * area to
 * usable electrical power.  Real panels are ~20-30 %; we use a gameplay value.
 */
export const SOLAR_PANEL_EFFICIENCY: number = 0.25;

// ---------------------------------------------------------------------------
// Sun Heat Mechanics
// ---------------------------------------------------------------------------

/**
 * Altitude below which a craft is instantly destroyed by the Sun (metres
 * above the Sun's surface).  This is the "point of no return" -- the solar
 * inferno zone.  ~500,000 km from the photosphere.
 */
export const SUN_DESTRUCTION_ALTITUDE: number = 500_000_000;

/**
 * Altitude below which solar proximity heat begins to accumulate (metres).
 * ~20 million km from the surface -- roughly inside Venus's orbit.
 * Heat scales with inverse-square distance from the Sun's centre.
 */
export const SUN_HEAT_START_ALTITUDE: number = 20_000_000_000;

/**
 * Base heat rate at SUN_HEAT_START_ALTITUDE (heat units per tick).
 * The actual rate scales as (SUN_HEAT_START_ALTITUDE / distance)^2.
 * At the inner corona edge (2B m) this gives ~100x the base rate.
 */
export const SUN_HEAT_RATE_BASE: number = 0.5;

/**
 * Fraction of solar heat blocked by a standard heat shield.
 * Solar heat shields have a separate, higher value via solarHeatResistance.
 */
export const STANDARD_SHIELD_SOLAR_RESISTANCE: number = 0.3;

/**
 * Maximum solar irradiance multiplier when computing solar power near
 * the Sun.  Prevents unreasonable generation values at very close range.
 */
export const MAX_SOLAR_IRRADIANCE_MULTIPLIER: number = 50.0;

/**
 * Earth's mean orbital distance from the Sun centre (1 AU in metres).
 * Used for distance-based solar irradiance calculations.
 */
export const ONE_AU: number = 149_598_000_000;

// ---------------------------------------------------------------------------
// Weather, Hard Landing, Injury, Medical, Part Wear, Difficulty,
// Comms, Resources, Mining
// ---------------------------------------------------------------------------
// Moved to ./constants/gameplay.ts; re-exported here so existing imports of
// `../constants` keep working.
export * from './constants/gameplay.ts';

// ---------------------------------------------------------------------------
// Hub Constants
// ---------------------------------------------------------------------------

/** Proximity radius (metres) for detecting orbital hub docking range. */
export const HUB_PROXIMITY_DOCK_RADIUS = 1000;

/** The ID of the default Earth hub. */
export const EARTH_HUB_ID = 'earth';
