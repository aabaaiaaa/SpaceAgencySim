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
// Crew Injury System
// ---------------------------------------------------------------------------

/** Landing speed (m/s) at or above which crew sustain hard-landing injuries. */
export const HARD_LANDING_SPEED_MIN: number = 5;

/** Landing speed (m/s) at or above which a hard landing is fatal (crash). */
export const HARD_LANDING_SPEED_MAX: number = 10;

/** Injury duration (periods) for a hard landing -- minimum. */
export const HARD_LANDING_INJURY_MIN: number = 2;

/** Injury duration (periods) for a hard landing -- maximum. */
export const HARD_LANDING_INJURY_MAX: number = 3;

/** Injury duration (periods) for crew ejection. */
export const EJECTION_INJURY_PERIODS: number = 1;

/** Medical care fee per injured crew member (halves recovery, rounded up). */
export const MEDICAL_CARE_COST: number = 25_000;

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
// Weather & Launch Conditions
// ---------------------------------------------------------------------------

/** Base cost to skip a day's weather and reroll (dollars). */
export const WEATHER_BASE_SKIP_COST: number = 25_000;

/** Escalation factor per consecutive skip: cost *= factor^skipCount. */
export const WEATHER_SKIP_ESCALATION: number = 1.5;

/** Maximum normal wind speed in m/s. */
export const WEATHER_MAX_WIND: number = 15;

/** ISP temperature range: modifier spans [1 - range, 1 + range]. */
export const WEATHER_ISP_RANGE: number = 0.05;

/** Chance of extreme weather per reroll (10 %). */
export const WEATHER_EXTREME_CHANCE: number = 0.10;

/** Minimum wind speed threshold for extreme weather (m/s). */
export const WEATHER_EXTREME_WIND_MIN: number = 20;

/** Minimum visibility value in extreme weather (0-1 scale). */
export const WEATHER_EXTREME_VISIBILITY_MAX: number = 0.7;

// ---------------------------------------------------------------------------
// Celestial Bodies & Orbital Mechanics
// ---------------------------------------------------------------------------

/**
 * Known celestial bodies.
 */
export const CelestialBody = Object.freeze({
  SUN: 'SUN',
  MERCURY: 'MERCURY',
  VENUS: 'VENUS',
  EARTH: 'EARTH',
  MOON: 'MOON',
  MARS: 'MARS',
  PHOBOS: 'PHOBOS',
  DEIMOS: 'DEIMOS',
} as const);

export type CelestialBody = (typeof CelestialBody)[keyof typeof CelestialBody];

// ---------------------------------------------------------------------------
// Asteroid Belt Zones
// ---------------------------------------------------------------------------

/**
 * Concentric orbital zones in the asteroid belt around the Sun,
 * beyond Mars (~1.52 AU). Used to tag Sun altitude bands.
 */
export const BeltZone = Object.freeze({
  /** Outer Belt A (2.2–2.5 AU) — safe orbit zone. */
  OUTER_A: 'OUTER_A',
  /** Dense Belt (2.5–2.8 AU) — high debris density, unsafe orbit zone. */
  DENSE: 'DENSE',
  /** Outer Belt B (2.8–3.2 AU) — safe orbit zone. */
  OUTER_B: 'OUTER_B',
} as const);

export type BeltZone = (typeof BeltZone)[keyof typeof BeltZone];

/**
 * Gravitational parameters (GM) in m^3/s^2 for each body.
 * mu = G * M, used in Keplerian orbit calculations.
 */
export const BODY_GM: Readonly<Record<string, number>> = Object.freeze({
  SUN: 1.32712440018e20,
  MERCURY: 2.2032e13,
  VENUS: 3.24859e14,
  EARTH: 3.986004418e14,
  MOON: 4.9048695e12,
  MARS: 4.282837e13,
  PHOBOS: 7.112e5,
  DEIMOS: 9.8e4,
});

/**
 * Mean radius in metres for each body.
 */
export const BODY_RADIUS: Readonly<Record<string, number>> = Object.freeze({
  SUN: 695_700_000,
  MERCURY: 2_439_700,
  VENUS: 6_051_800,
  EARTH: 6_371_000,
  MOON: 1_737_400,
  MARS: 3_389_500,
  PHOBOS: 11_267,
  DEIMOS: 6_200,
});

/**
 * Minimum stable orbit altitude per celestial body (metres above the surface).
 * Below this altitude, atmospheric drag (or surface proximity for airless bodies)
 * prevents a stable orbit.  Used by orbit entry detection.
 */
export const MIN_ORBIT_ALTITUDE: Readonly<Record<string, number>> = Object.freeze({
  SUN: 2_000_000_000,
  MERCURY: 20_000,
  VENUS: 250_000,
  EARTH: 70_000,
  MOON: 15_000,
  MARS: 80_000,
  PHOBOS: 1_000,
  DEIMOS: 500,
});

/**
 * Altitude band definition for a celestial body.
 */
export interface AltitudeBand {
  readonly id: string;
  readonly name: string;
  readonly min: number;
  readonly max: number;
  /** Asteroid belt zone tag, if this band falls within the belt. */
  readonly beltZone?: BeltZone;
  /** Whether orbiting in this band is unsafe (e.g., high debris density). */
  readonly unsafe?: boolean;
}

/**
 * Altitude bands per celestial body.
 * Each band defines a range of altitudes (metres above the surface).
 * Objects in the same band can interact via proximity detection.
 */
export const ALTITUDE_BANDS: Readonly<Record<string, readonly AltitudeBand[]>> = Object.freeze({
  SUN: Object.freeze([
    Object.freeze({ id: 'INNER_CORONA', name: 'Inner Corona',   min: 500_000_000,     max: 2_000_000_000 }),
    Object.freeze({ id: 'OUTER_CORONA', name: 'Outer Corona',   min: 2_000_000_000,   max: 10_000_000_000 }),
    Object.freeze({ id: 'NSS',          name: 'Near Sun Space',  min: 10_000_000_000,  max: 30_000_000_000 }),
    Object.freeze({ id: 'SOL',          name: 'Solar Orbit',     min: 30_000_000_000,  max: 329_000_000_000 }),
    Object.freeze({ id: 'BELT_OUTER_A', name: 'Outer Belt A',   min: 329_000_000_000, max: 374_000_000_000, beltZone: BeltZone.OUTER_A as BeltZone }),
    Object.freeze({ id: 'BELT_DENSE',   name: 'Dense Belt',     min: 374_000_000_000, max: 419_000_000_000, beltZone: BeltZone.DENSE as BeltZone, unsafe: true }),
    Object.freeze({ id: 'BELT_OUTER_B', name: 'Outer Belt B',   min: 419_000_000_000, max: 479_000_000_000, beltZone: BeltZone.OUTER_B as BeltZone }),
  ]),
  MERCURY: Object.freeze([
    Object.freeze({ id: 'LMeO', name: 'Low Mercury Orbit', min: 20_000, max: 200_000 }),
    Object.freeze({ id: 'MMeO', name: 'Medium Mercury Orbit', min: 200_000, max: 1_000_000 }),
    Object.freeze({ id: 'HMeO', name: 'High Mercury Orbit', min: 1_000_000, max: 5_000_000 }),
  ]),
  VENUS: Object.freeze([
    Object.freeze({ id: 'LVO', name: 'Low Venus Orbit', min: 250_000, max: 500_000 }),
    Object.freeze({ id: 'MVO', name: 'Medium Venus Orbit', min: 500_000, max: 2_000_000 }),
    Object.freeze({ id: 'HVO', name: 'High Venus Orbit', min: 2_000_000, max: 10_000_000 }),
  ]),
  EARTH: Object.freeze([
    Object.freeze({ id: 'LEO', name: 'Low Earth Orbit', min: 80_000, max: 200_000 }),
    Object.freeze({ id: 'MEO', name: 'Medium Earth Orbit', min: 200_000, max: 2_000_000 }),
    Object.freeze({ id: 'HEO', name: 'High Earth Orbit', min: 2_000_000, max: 35_786_000 }),
  ]),
  MOON: Object.freeze([
    Object.freeze({ id: 'LLO', name: 'Low Lunar Orbit', min: 15_000, max: 100_000 }),
    Object.freeze({ id: 'MLO', name: 'Medium Lunar Orbit', min: 100_000, max: 1_000_000 }),
    Object.freeze({ id: 'HLO', name: 'High Lunar Orbit', min: 1_000_000, max: 10_000_000 }),
  ]),
  MARS: Object.freeze([
    Object.freeze({ id: 'LMO', name: 'Low Mars Orbit', min: 80_000, max: 300_000 }),
    Object.freeze({ id: 'MMO', name: 'Medium Mars Orbit', min: 300_000, max: 2_000_000 }),
    Object.freeze({ id: 'HMO', name: 'High Mars Orbit', min: 2_000_000, max: 20_000_000 }),
  ]),
  PHOBOS: Object.freeze([
    Object.freeze({ id: 'LPO', name: 'Low Phobos Orbit', min: 1_000, max: 5_000 }),
    Object.freeze({ id: 'HPO', name: 'High Phobos Orbit', min: 5_000, max: 20_000 }),
  ]),
  DEIMOS: Object.freeze([
    Object.freeze({ id: 'LDO', name: 'Low Deimos Orbit', min: 500, max: 3_000 }),
    Object.freeze({ id: 'HDO', name: 'High Deimos Orbit', min: 3_000, max: 10_000 }),
  ]),
});

// ---------------------------------------------------------------------------
// Altitude Biomes
// ---------------------------------------------------------------------------

/**
 * Named altitude biome definition per celestial body.
 */
export interface BiomeDefinition {
  readonly id: string;
  readonly name: string;
  readonly min: number;
  readonly max: number;
  readonly scienceMultiplier: number;
  readonly color: number;
}

/**
 * Named altitude biomes per celestial body.  Each biome defines:
 *   - id:              Machine-readable identifier.
 *   - name:            Human-readable display name.
 *   - min / max:       Altitude range in metres (surface-relative).
 *   - scienceMultiplier: Multiplier applied to science experiment value when
 *                        collected in this biome.
 *   - color:           Tint hint used by the flight renderer for label colouring.
 *
 * Biome boundaries are used for label fade-in/out and for the orbital science
 * system (elliptical orbits sweeping through multiple biomes).
 */
export const BIOME_DEFINITIONS: Readonly<Record<string, readonly BiomeDefinition[]>> = Object.freeze({
  SUN: Object.freeze([
    Object.freeze({ id: 'SUN_INFERNO',         name: 'Solar Inferno',        min: 0,               max: 500_000_000,     scienceMultiplier: 0,    color: 0xffffff }),
    Object.freeze({ id: 'SUN_INNER_CORONA',    name: 'Inner Corona',         min: 500_000_000,     max: 2_000_000_000,   scienceMultiplier: 12.0, color: 0xffee44 }),
    Object.freeze({ id: 'SUN_OUTER_CORONA',    name: 'Outer Corona',         min: 2_000_000_000,   max: 10_000_000_000,  scienceMultiplier: 8.0,  color: 0xffaa22 }),
    Object.freeze({ id: 'SUN_NEAR_SPACE',      name: 'Near Sun Space',       min: 10_000_000_000,  max: 30_000_000_000,  scienceMultiplier: 5.0,  color: 0xff8800 }),
    Object.freeze({ id: 'SUN_SOLAR_ORBIT',     name: 'Solar Orbit',          min: 30_000_000_000,  max: Infinity,        scienceMultiplier: 3.0,  color: 0x332200 }),
  ]),
  MERCURY: Object.freeze([
    Object.freeze({ id: 'MERCURY_SURFACE',     name: 'Mercury Surface',      min: 0,       max: 100,       scienceMultiplier: 2.0,  color: 0x8a8a8a }),
    Object.freeze({ id: 'MERCURY_NEAR',        name: 'Near Surface',         min: 100,     max: 5_000,     scienceMultiplier: 2.5,  color: 0x707070 }),
    Object.freeze({ id: 'MERCURY_LOW_ALT',     name: 'Low Altitude',         min: 5_000,   max: 20_000,    scienceMultiplier: 3.0,  color: 0x505060 }),
    Object.freeze({ id: 'MERCURY_LOW_ORBIT',   name: 'Low Mercury Orbit',    min: 20_000,  max: 200_000,   scienceMultiplier: 3.5,  color: 0x303040 }),
    Object.freeze({ id: 'MERCURY_HIGH_ORBIT',  name: 'High Mercury Orbit',   min: 200_000, max: Infinity,  scienceMultiplier: 4.0,  color: 0x101020 }),
  ]),
  VENUS: Object.freeze([
    Object.freeze({ id: 'VENUS_SURFACE',       name: 'Venus Surface',        min: 0,       max: 100,       scienceMultiplier: 3.0,  color: 0xd4a04a }),
    Object.freeze({ id: 'VENUS_LOW_ATMO',      name: 'Low Atmosphere',       min: 100,     max: 10_000,    scienceMultiplier: 2.5,  color: 0xcc9944 }),
    Object.freeze({ id: 'VENUS_MID_ATMO',      name: 'Mid Atmosphere',       min: 10_000,  max: 50_000,    scienceMultiplier: 2.0,  color: 0xbb8833 }),
    Object.freeze({ id: 'VENUS_UPPER_ATMO',    name: 'Upper Atmosphere',     min: 50_000,  max: 150_000,   scienceMultiplier: 2.5,  color: 0x886622 }),
    Object.freeze({ id: 'VENUS_EXOSPHERE',     name: 'Exosphere',            min: 150_000, max: 250_000,   scienceMultiplier: 3.0,  color: 0x443311 }),
    Object.freeze({ id: 'VENUS_LOW_ORBIT',     name: 'Low Venus Orbit',      min: 250_000, max: 500_000,   scienceMultiplier: 3.5,  color: 0x202020 }),
    Object.freeze({ id: 'VENUS_HIGH_ORBIT',    name: 'High Venus Orbit',     min: 500_000, max: Infinity,  scienceMultiplier: 4.0,  color: 0x101010 }),
  ]),
  EARTH: Object.freeze([
    Object.freeze({ id: 'GROUND',           name: 'Ground',           min: 0,       max: 100,       scienceMultiplier: 0.5, color: 0xc4a882 }),
    Object.freeze({ id: 'LOW_ATMOSPHERE',    name: 'Low Atmosphere',   min: 100,     max: 2_000,     scienceMultiplier: 1.0, color: 0x87ceeb }),
    Object.freeze({ id: 'MID_ATMOSPHERE',    name: 'Mid Atmosphere',   min: 2_000,   max: 10_000,    scienceMultiplier: 1.2, color: 0x6aadce }),
    Object.freeze({ id: 'UPPER_ATMOSPHERE',  name: 'Upper Atmosphere', min: 10_000,  max: 40_000,    scienceMultiplier: 1.5, color: 0x3a6a9e }),
    Object.freeze({ id: 'MESOSPHERE',        name: 'Mesosphere',       min: 40_000,  max: 70_000,    scienceMultiplier: 2.0, color: 0x1a1a4e }),
    Object.freeze({ id: 'NEAR_SPACE',        name: 'Near Space',       min: 70_000,  max: 100_000,   scienceMultiplier: 2.5, color: 0x0a0a2e }),
    Object.freeze({ id: 'LOW_ORBIT',         name: 'Low Orbit',        min: 100_000, max: 200_000,   scienceMultiplier: 3.0, color: 0x050520 }),
    Object.freeze({ id: 'HIGH_ORBIT',        name: 'High Orbit',       min: 200_000, max: Infinity,  scienceMultiplier: 4.0, color: 0x000010 }),
  ]),
  MOON: Object.freeze([
    Object.freeze({ id: 'LUNAR_SURFACE',    name: 'Lunar Surface',     min: 0,       max: 100,       scienceMultiplier: 1.0, color: 0xa0a0a0 }),
    Object.freeze({ id: 'NEAR_SURFACE',     name: 'Near Surface',      min: 100,     max: 5_000,     scienceMultiplier: 1.5, color: 0x808080 }),
    Object.freeze({ id: 'LOW_ALTITUDE',     name: 'Low Altitude',      min: 5_000,   max: 15_000,    scienceMultiplier: 2.0, color: 0x404060 }),
    Object.freeze({ id: 'LOW_LUNAR_ORBIT',  name: 'Low Lunar Orbit',   min: 15_000,  max: 100_000,   scienceMultiplier: 3.0, color: 0x202040 }),
    Object.freeze({ id: 'HIGH_LUNAR_ORBIT', name: 'High Lunar Orbit',  min: 100_000, max: Infinity,  scienceMultiplier: 4.0, color: 0x101020 }),
  ]),
  MARS: Object.freeze([
    Object.freeze({ id: 'MARS_SURFACE',       name: 'Mars Surface',        min: 0,       max: 100,       scienceMultiplier: 2.0,  color: 0xc1440e }),
    Object.freeze({ id: 'MARS_LOW_ATMO',      name: 'Low Atmosphere',      min: 100,     max: 5_000,     scienceMultiplier: 2.5,  color: 0xb0550e }),
    Object.freeze({ id: 'MARS_MID_ATMO',      name: 'Mid Atmosphere',      min: 5_000,   max: 20_000,    scienceMultiplier: 2.8,  color: 0x8a3a0a }),
    Object.freeze({ id: 'MARS_UPPER_ATMO',    name: 'Upper Atmosphere',    min: 20_000,  max: 50_000,    scienceMultiplier: 3.0,  color: 0x5a2208 }),
    Object.freeze({ id: 'MARS_EXOSPHERE',     name: 'Exosphere',           min: 50_000,  max: 80_000,    scienceMultiplier: 3.5,  color: 0x2a1104 }),
    Object.freeze({ id: 'MARS_LOW_ORBIT',     name: 'Low Mars Orbit',      min: 80_000,  max: 300_000,   scienceMultiplier: 4.0,  color: 0x150808 }),
    Object.freeze({ id: 'MARS_HIGH_ORBIT',    name: 'High Mars Orbit',     min: 300_000, max: Infinity,  scienceMultiplier: 5.0,  color: 0x0a0404 }),
  ]),
  PHOBOS: Object.freeze([
    Object.freeze({ id: 'PHOBOS_SURFACE',     name: 'Phobos Surface',      min: 0,      max: 50,        scienceMultiplier: 3.0, color: 0x6a6a60 }),
    Object.freeze({ id: 'PHOBOS_NEAR',        name: 'Near Phobos',         min: 50,     max: 1_000,     scienceMultiplier: 3.5, color: 0x505050 }),
    Object.freeze({ id: 'PHOBOS_ORBIT',       name: 'Phobos Orbit',        min: 1_000,  max: Infinity,  scienceMultiplier: 4.0, color: 0x303030 }),
  ]),
  DEIMOS: Object.freeze([
    Object.freeze({ id: 'DEIMOS_SURFACE',     name: 'Deimos Surface',      min: 0,      max: 50,        scienceMultiplier: 3.0, color: 0x7a7a70 }),
    Object.freeze({ id: 'DEIMOS_NEAR',        name: 'Near Deimos',         min: 50,     max: 1_000,     scienceMultiplier: 3.5, color: 0x606060 }),
    Object.freeze({ id: 'DEIMOS_ORBIT',       name: 'Deimos Orbit',        min: 1_000,  max: Infinity,  scienceMultiplier: 4.0, color: 0x404040 }),
  ]),
});

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
// Satellite Network System
// ---------------------------------------------------------------------------

/**
 * Functional types of satellite that provide network bonuses.
 */
export const SatelliteType = Object.freeze({
  /** Communication satellite -- enables science data transmission from orbit. */
  COMMUNICATION: 'COMMUNICATION',
  /** Weather satellite -- reduces weather-skip cost and improves forecast. */
  WEATHER: 'WEATHER',
  /** Science satellite -- generates passive science points per period. */
  SCIENCE: 'SCIENCE',
  /** GPS/Navigation satellite -- widens landing threshold, recovery profitability, new mission types. */
  GPS: 'GPS',
  /** Relay satellite -- extends deep-space communication range. */
  RELAY: 'RELAY',
} as const);

export type SatelliteType = (typeof SatelliteType)[keyof typeof SatelliteType];

/**
 * Which altitude bands each satellite type may operate in.
 * A satellite must be deployed in one of its valid bands to be active.
 */
export const SATELLITE_VALID_BANDS: Readonly<Record<string, readonly string[]>> = Object.freeze({
  [SatelliteType.COMMUNICATION]: Object.freeze([
    'LEO', 'MEO', 'HEO',       // Earth
    'LLO', 'MLO', 'HLO',       // Moon
    'LMO', 'MMO', 'HMO',       // Mars
    'LMeO', 'MMeO', 'HMeO',   // Mercury
    'LVO', 'MVO', 'HVO',       // Venus
    'LPO', 'HPO',              // Phobos
    'LDO', 'HDO',              // Deimos
  ]),
  [SatelliteType.WEATHER]:       Object.freeze([
    'LEO', 'MEO',               // Earth
    'LLO', 'MLO',               // Moon
    'LMO', 'MMO',               // Mars
    'LVO', 'MVO',               // Venus
  ]),
  [SatelliteType.SCIENCE]:       Object.freeze([
    'LEO', 'MEO', 'HEO',       // Earth
    'LLO', 'MLO', 'HLO',       // Moon
    'LMO', 'MMO', 'HMO',       // Mars
    'LMeO', 'MMeO', 'HMeO',   // Mercury
    'LVO', 'MVO', 'HVO',       // Venus
    'LPO', 'HPO',              // Phobos
    'LDO', 'HDO',              // Deimos
  ]),
  [SatelliteType.GPS]:           Object.freeze([
    'MEO',                      // Earth
    'MLO',                      // Moon
    'MMO',                      // Mars
  ]),
  [SatelliteType.RELAY]:         Object.freeze([
    'HEO',                      // Earth
    'HLO',                      // Moon
    'HMO',                      // Mars
    'HMeO',                     // Mercury
    'HVO',                      // Venus
    'HPO',                      // Phobos
    'HDO',                      // Deimos
  ]),
});

/**
 * Constellation bonus threshold -- 3+ satellites of the same type = 2x benefit.
 */
export const CONSTELLATION_THRESHOLD: number = 3;

/** Multiplier applied when constellation bonus is active. */
export const CONSTELLATION_MULTIPLIER: number = 2;

/**
 * Base benefits per satellite type (before constellation multiplier).
 *
 * COMMUNICATION: transmitYieldBonus -- additive bonus to science transmit yield.
 * WEATHER:       weatherSkipDiscount -- fraction discount on weather-skip cost;
 *                forecastAccuracy -- bonus to launch forecast display.
 * SCIENCE:       sciencePerPeriod -- passive science points earned per period.
 * GPS:           landingThresholdBonus -- m/s added to safe-landing tolerance;
 *                recoveryBonus -- fraction bonus to recovery revenue.
 * RELAY:         deepSpaceComms -- enables deep-space mission types.
 */
export const SATELLITE_BENEFITS: Readonly<Record<string, Readonly<Record<string, number | boolean>>>> = Object.freeze({
  [SatelliteType.COMMUNICATION]: Object.freeze({ transmitYieldBonus: 0.15 }),
  [SatelliteType.WEATHER]:       Object.freeze({ weatherSkipDiscount: 0.10, forecastAccuracy: 0.15 }),
  [SatelliteType.SCIENCE]:       Object.freeze({ sciencePerPeriod: 2 }),
  [SatelliteType.GPS]:           Object.freeze({ landingThresholdBonus: 2, recoveryBonus: 0.10 }),
  [SatelliteType.RELAY]:         Object.freeze({ deepSpaceComms: true }),
});

/**
 * Satellite health degradation per period (percentage points).
 * A satellite starts at 100 health and loses this each period.
 * At 0 health, the satellite is decommissioned.
 */
export const SATELLITE_DEGRADATION_PER_PERIOD: number = 3;

/** Health threshold below which a satellite provides reduced (50%) benefits. */
export const SATELLITE_DEGRADED_THRESHOLD: number = 30;

/** Cost per satellite for auto-maintenance per period (dollars). */
export const SATELLITE_AUTO_MAINTENANCE_COST: number = 15_000;

/** Health restored per auto-maintenance cycle (percentage points). */
export const SATELLITE_AUTO_MAINTENANCE_HEAL: number = 10;

/**
 * Satellite Ops facility tier caps for max active satellites.
 */
export const SATELLITE_OPS_TIER_CAPS: Readonly<Record<number, number>> = Object.freeze({
  1: 6,
  2: 12,
  3: 24,
});

// ---------------------------------------------------------------------------
// Satellite Leasing (Tier 2+)
// ---------------------------------------------------------------------------

/**
 * Income earned per leased satellite per period (dollars).
 * Leasing requires Satellite Ops Tier 2+.
 */
export const SATELLITE_LEASE_INCOME: Readonly<Record<string, number>> = Object.freeze({
  [SatelliteType.COMMUNICATION]: 25_000,
  [SatelliteType.WEATHER]:       20_000,
  [SatelliteType.SCIENCE]:       15_000,
  [SatelliteType.GPS]:           30_000,
  [SatelliteType.RELAY]:         35_000,
});

/** Default lease income for generic/untyped satellites. */
export const SATELLITE_LEASE_INCOME_DEFAULT: number = 10_000;

/**
 * Leased satellites provide reduced network benefits (penalty multiplier).
 * A leased satellite still provides benefits, but at a reduced rate.
 */
export const SATELLITE_LEASE_BENEFIT_PENALTY: number = 0.5;

// ---------------------------------------------------------------------------
// Satellite Repositioning (Tier 3)
// ---------------------------------------------------------------------------

/**
 * Cost to reposition a satellite to a different altitude band (dollars).
 * Repositioning requires Satellite Ops Tier 3.
 */
export const SATELLITE_REPOSITION_COST: Readonly<Record<string, number>> = Object.freeze({
  SAME_BODY: 50_000,
});

/**
 * Health cost for repositioning a satellite (percentage points).
 * Orbital manoeuvres stress the satellite hardware.
 */
export const SATELLITE_REPOSITION_HEALTH_COST: number = 10;

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
// Part Inventory & Wear System
// ---------------------------------------------------------------------------

/**
 * Wear added per flight for passive parts (tanks, modules, parachutes, etc.).
 * Expressed as percentage points (0-100 scale).
 */
export const WEAR_PER_FLIGHT_PASSIVE: number = 5;

/**
 * Wear added per flight for engine parts (extra stress from firing).
 * Expressed as percentage points (0-100 scale).
 */
export const WEAR_PER_FLIGHT_ENGINE: number = 15;

/**
 * Wear added per flight for solid rocket boosters.
 * SRBs endure extreme stress; single-use in practice.
 */
export const WEAR_PER_FLIGHT_SRB: number = 40;

/**
 * Factor by which wear reduces effective reliability.
 * effectiveReliability = baseReliability * (1 - wear/100 * WEAR_RELIABILITY_FACTOR).
 */
export const WEAR_RELIABILITY_FACTOR: number = 0.5;

/**
 * Refurbishment cost as a fraction of the part's original purchase price.
 * Paying this resets wear to WEAR_AFTER_REFURBISH.
 */
export const REFURBISH_COST_FRACTION: number = 0.3;

/**
 * Wear level (%) after refurbishment.
 */
export const WEAR_AFTER_REFURBISH: number = 10;

/**
 * Fraction of original part cost returned when scrapping an inventory part.
 */
export const SCRAP_VALUE_FRACTION: number = 0.15;

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
// Surface Operations
// ---------------------------------------------------------------------------

/**
 * Types of items that can be deployed on a celestial body's surface.
 */
export const SurfaceItemType = Object.freeze({
  /** Ceremonial flag -- one per body, crewed only. */
  FLAG: 'FLAG',
  /** Surface sample container -- requires crewed module, must return to lab. */
  SURFACE_SAMPLE: 'SURFACE_SAMPLE',
  /** Deployed science instrument package -- requires science module with surface instrument. */
  SURFACE_INSTRUMENT: 'SURFACE_INSTRUMENT',
  /** Landing site beacon -- shows on map, allows returning to landing site. */
  BEACON: 'BEACON',
} as const);

export type SurfaceItemType = (typeof SurfaceItemType)[keyof typeof SurfaceItemType];

/** Cash bonus awarded for planting the first flag on a celestial body. */
export const FLAG_MILESTONE_BONUS: number = 100_000;

/** Reputation gained for planting the first flag on a body. */
export const FLAG_MILESTONE_REP: number = 5;

/** Science points awarded for collecting a surface sample (base, before biome multiplier). */
export const SURFACE_SAMPLE_BASE_SCIENCE: number = 15;

/** Science points per period generated by a deployed surface instrument. */
export const SURFACE_INSTRUMENT_SCIENCE_PER_PERIOD: number = 3;

/** Number of GPS satellites required at a body for surface items to be visible on map. */
export const GPS_VISIBILITY_THRESHOLD: number = 1;

// ---------------------------------------------------------------------------
// Life Support System
// ---------------------------------------------------------------------------

/**
 * Default number of periods of life support provided by the command module.
 * Each period a crewed craft spends in the field (orbit or landed on a
 * non-Earth body) consumes one period of supply.
 */
export const DEFAULT_LIFE_SUPPORT_PERIODS: number = 5;

/**
 * Government fine charged per crew member who dies from life support
 * exhaustion (same as crash death fine).
 */
export const LIFE_SUPPORT_DEATH_FINE: number = 500_000;

/**
 * Supply level at which a critical warning is shown, giving the player
 * one last chance to launch a rescue mission.
 */
export const LIFE_SUPPORT_WARNING_THRESHOLD: number = 1;

/**
 * Status of a crewed vessel left in the field.
 */
export const FieldCraftStatus = Object.freeze({
  /** Vessel is in a stable orbit around a celestial body. */
  IN_ORBIT: 'IN_ORBIT',
  /** Vessel is safely landed on a non-Earth celestial body. */
  LANDED: 'LANDED',
} as const);

export type FieldCraftStatus = (typeof FieldCraftStatus)[keyof typeof FieldCraftStatus];

// ---------------------------------------------------------------------------
// Difficulty Settings
// ---------------------------------------------------------------------------

/**
 * Malfunction frequency options.
 * Controls how likely malfunctions are to occur during flight.
 */
export const MalfunctionFrequency = Object.freeze({
  OFF:    'off',
  LOW:    'low',
  NORMAL: 'normal',
  HIGH:   'high',
} as const);

export type MalfunctionFrequency = (typeof MalfunctionFrequency)[keyof typeof MalfunctionFrequency];

/**
 * Multipliers applied to base malfunction failure chance.
 */
export const MALFUNCTION_FREQUENCY_MULTIPLIERS: Readonly<Record<string, number>> = Object.freeze({
  [MalfunctionFrequency.OFF]:    0,
  [MalfunctionFrequency.LOW]:    0.4,
  [MalfunctionFrequency.NORMAL]: 1.0,
  [MalfunctionFrequency.HIGH]:   2.0,
});

/**
 * Weather severity options.
 * Controls how severe weather conditions are at the launch site.
 */
export const WeatherSeverity = Object.freeze({
  OFF:     'off',
  MILD:    'mild',
  NORMAL:  'normal',
  EXTREME: 'extreme',
} as const);

export type WeatherSeverity = (typeof WeatherSeverity)[keyof typeof WeatherSeverity];

/**
 * Weather severity multiplier definition.
 */
export interface WeatherSeverityMultiplier {
  readonly windMult: number;
  readonly extremeChanceMult: number;
}

/**
 * Multipliers applied to wind speed and extreme weather chance.
 */
export const WEATHER_SEVERITY_MULTIPLIERS: Readonly<Record<string, WeatherSeverityMultiplier>> = Object.freeze({
  [WeatherSeverity.OFF]:     Object.freeze({ windMult: 0, extremeChanceMult: 0 }),
  [WeatherSeverity.MILD]:    Object.freeze({ windMult: 0.5, extremeChanceMult: 0.25 }),
  [WeatherSeverity.NORMAL]:  Object.freeze({ windMult: 1.0, extremeChanceMult: 1.0 }),
  [WeatherSeverity.EXTREME]: Object.freeze({ windMult: 1.5, extremeChanceMult: 3.0 }),
});

/**
 * Financial pressure options.
 * Controls reward and cost multipliers.
 */
export const FinancialPressure = Object.freeze({
  EASY:   'easy',
  NORMAL: 'normal',
  HARD:   'hard',
} as const);

export type FinancialPressure = (typeof FinancialPressure)[keyof typeof FinancialPressure];

/**
 * Financial pressure multiplier definition.
 */
export interface FinancialPressureMultiplier {
  readonly rewardMult: number;
  readonly costMult: number;
}

/**
 * Multipliers for financial pressure levels.
 * rewardMult: applied to all earned income (contracts, missions).
 * costMult: applied to operating costs (salaries, facility upkeep).
 */
export const FINANCIAL_PRESSURE_MULTIPLIERS: Readonly<Record<string, FinancialPressureMultiplier>> = Object.freeze({
  [FinancialPressure.EASY]:   Object.freeze({ rewardMult: 2.0, costMult: 1.0 }),
  [FinancialPressure.NORMAL]: Object.freeze({ rewardMult: 1.0, costMult: 1.0 }),
  [FinancialPressure.HARD]:   Object.freeze({ rewardMult: 0.5, costMult: 2.0 }),
});

/**
 * Crew injury duration options.
 * Controls how long crew injuries last.
 */
export const InjuryDuration = Object.freeze({
  SHORT:  'short',
  NORMAL: 'normal',
  LONG:   'long',
} as const);

export type InjuryDuration = (typeof InjuryDuration)[keyof typeof InjuryDuration];

/**
 * Multipliers applied to crew injury period durations.
 */
export const INJURY_DURATION_MULTIPLIERS: Readonly<Record<string, number>> = Object.freeze({
  [InjuryDuration.SHORT]:  0.5,
  [InjuryDuration.NORMAL]: 1.0,
  [InjuryDuration.LONG]:   2.0,
});

/**
 * Difficulty settings for a game.
 */
export interface DifficultySettings {
  readonly malfunctionFrequency: MalfunctionFrequency;
  readonly weatherSeverity: WeatherSeverity;
  readonly financialPressure: FinancialPressure;
  readonly injuryDuration: InjuryDuration;
}

/**
 * Default difficulty settings for a new game.
 */
export const DEFAULT_DIFFICULTY_SETTINGS: DifficultySettings = Object.freeze({
  malfunctionFrequency: MalfunctionFrequency.NORMAL,
  weatherSeverity:      WeatherSeverity.NORMAL,
  financialPressure:    FinancialPressure.NORMAL,
  injuryDuration:       InjuryDuration.NORMAL,
});

// ---------------------------------------------------------------------------
// Communication Range System
// ---------------------------------------------------------------------------

/**
 * Communication status of a craft.
 */
export const CommsStatus = Object.freeze({
  /** Full communication link to agency -- all controls available. */
  CONNECTED: 'CONNECTED',
  /** No communication link -- probe-only: controls locked; crewed: science data blocked. */
  NO_SIGNAL: 'NO_SIGNAL',
} as const);

export type CommsStatus = (typeof CommsStatus)[keyof typeof CommsStatus];

/**
 * Communication link type indicating how the craft is connected.
 */
export const CommsLinkType = Object.freeze({
  /** Direct line-of-sight to the agency hub on Earth. */
  DIRECT: 'DIRECT',
  /** Via Tracking Station T3 ground-based long-range antenna. */
  TRACKING_STATION: 'TRACKING_STATION',
  /** Via a local comm-sat constellation around the body. */
  LOCAL_NETWORK: 'LOCAL_NETWORK',
  /** Via an interplanetary relay chain back to Earth. */
  RELAY: 'RELAY',
  /** Craft carries its own relay antenna -- self-sustaining link. */
  ONBOARD_RELAY: 'ONBOARD_RELAY',
  /** No link available. */
  NONE: 'NONE',
} as const);

export type CommsLinkType = (typeof CommsLinkType)[keyof typeof CommsLinkType];

/**
 * Direct comms range from the agency hub on Earth's surface (metres).
 * Works within Earth orbit (roughly HEO distance) but not much further.
 * ~40,000 km -- covers LEO/MEO, fades in HEO.
 */
export const COMMS_DIRECT_RANGE: number = 40_000_000;

/**
 * Extended direct range when Tracking Station is at Tier 3 (metres).
 * Significantly extends range -- covers Earth SOI including lunar distance.
 * ~500,000 km -- reaches the Moon comfortably.
 */
export const COMMS_TRACKING_T3_RANGE: number = 500_000_000;

/**
 * Comm-sat local network coverage radius around a body (metres).
 * A constellation of 3+ COMMUNICATION satellites covers the body and
 * nearby space. Coverage extends to roughly this distance from the body centre.
 * If fewer than a full constellation, coverage has dark spots (far side).
 */
export const COMMS_LOCAL_NETWORK_RANGE: number = 50_000_000;

/**
 * Number of COMMUNICATION satellites needed for full-sphere coverage
 * of a body (no dark spots).  Below this count, the far side of the body
 * relative to the agency (or relay link direction) is a dead zone.
 */
export const COMMS_FULL_COVERAGE_THRESHOLD: number = 3;

/**
 * Relay satellite interplanetary link range (metres).
 * A deployed RELAY satellite in high orbit can bridge to other bodies'
 * networks within this range.  Roughly 1 AU -- covers inner solar system.
 */
export const COMMS_RELAY_RANGE: number = 300_000_000_000;

/**
 * Angular half-width of the shadow cone behind a celestial body (degrees).
 * If a craft is within this cone on the far side of a body from the
 * signal source, and the body has no full constellation, the signal is blocked.
 * Using a generous 80 degree half-angle -- effectively the far hemisphere.
 */
export const COMMS_SHADOW_HALF_ANGLE_DEG: number = 80;
