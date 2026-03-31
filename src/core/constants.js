/**
 * constants.js — Shared enums and constants for all game systems.
 *
 * All game logic modules import from here. Using frozen objects as enums
 * prevents accidental mutation and makes invalid values easy to catch.
 */

// ---------------------------------------------------------------------------
// Part Types
// ---------------------------------------------------------------------------

/**
 * Every component a player can attach to a rocket.
 * @enum {string}
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
  /** Docking port for connecting vessels in orbit. */
  DOCKING_PORT: 'DOCKING_PORT',
  /** Aerodynamic nose cone that reduces drag on atmospheric ascent. */
  NOSE_CONE: 'NOSE_CONE',
});

// ---------------------------------------------------------------------------
// Mission States
// ---------------------------------------------------------------------------

/**
 * Lifecycle states a mission object can be in.
 * @enum {string}
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
});

// ---------------------------------------------------------------------------
// Crew Statuses
// ---------------------------------------------------------------------------

/**
 * Career / employment status of an astronaut.
 * Distinct from the operational CrewStatus below; tracks the astronaut's
 * permanent career arc rather than their current activity within a mission.
 * @enum {string}
 */
export const AstronautStatus = Object.freeze({
  /** Currently employed and available (alive, not fired). */
  ACTIVE: 'active',
  /** Employment terminated by the player; no longer takes missions. */
  FIRED: 'fired',
  /** Killed in action; record is retained permanently in history. */
  KIA: 'kia',
});

/**
 * What a crew member is currently doing.
 * @enum {string}
 */
export const CrewStatus = Object.freeze({
  /** Available to be assigned to a mission. */
  IDLE: 'IDLE',
  /** Currently aboard a rocket on an active mission. */
  ON_MISSION: 'ON_MISSION',
  /** In a training program; unavailable for missions until training ends. */
  TRAINING: 'TRAINING',
  /** Recovering from an injury; temporarily unavailable. */
  INJURED: 'INJURED',
  /** Killed in action; permanently removed from the crew roster. */
  DEAD: 'DEAD',
});

// ---------------------------------------------------------------------------
// Flight Phases
// ---------------------------------------------------------------------------

/**
 * Distinct phases of a flight.  The state machine enforces valid transitions:
 *
 *   PRELAUNCH → LAUNCH → FLIGHT → ORBIT
 *   ORBIT → MANOEUVRE → ORBIT
 *   ORBIT → REENTRY → FLIGHT (landing)
 *   ORBIT → TRANSFER → CAPTURE → ORBIT (at destination)
 *   ORBIT → (return to agency — completes a period)
 *   FLIGHT → (land / crash)
 *
 * Docking mode is a *control mode* within ORBIT, not a phase (see TASK-005).
 *
 * @enum {string}
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
});

// ---------------------------------------------------------------------------
// Control Modes (within ORBIT phase)
// ---------------------------------------------------------------------------

/**
 * Control modes available during orbital flight.
 * Normal is the default; Docking and RCS are toggled by the player.
 *
 * @enum {string}
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
});

// ---------------------------------------------------------------------------
// Flight Outcomes
// ---------------------------------------------------------------------------

/**
 * Possible results of a completed flight.
 * @enum {string}
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
});

// ---------------------------------------------------------------------------
// Fuel Types
// ---------------------------------------------------------------------------

/**
 * Propellant types used by engines and fuel tanks.
 * @enum {string}
 */
export const FuelType = Object.freeze({
  LIQUID: 'LIQUID',
  SOLID: 'SOLID',
  MONOPROPELLANT: 'MONOPROPELLANT',
  ELECTRIC: 'ELECTRIC',
});

// ---------------------------------------------------------------------------
// Starting / Default Values
// ---------------------------------------------------------------------------

/** Player's starting cash balance at a new game (equal to the initial loan proceeds). */
export const STARTING_MONEY = 2_000_000;

/** Starting loan balance — players begin the game $2 million in debt. */
export const STARTING_LOAN_BALANCE = 2_000_000;

/** Per-mission interest rate applied to the outstanding loan (3 %). */
export const DEFAULT_LOAN_INTEREST_RATE = 0.03;

/** Fine per astronaut killed in action (deducted from cash). */
export const DEATH_FINE_PER_ASTRONAUT = 500_000;

/** Cost to hire a new astronaut. */
export const HIRE_COST = 50_000;

/** Maximum cumulative loan balance the player may carry. */
export const MAX_LOAN_BALANCE = 10_000_000;

/** Maximum number of crew members the player can hire. */
export const MAX_CREW_SIZE = 20;

/** Number of missions generated on the board at one time. */
export const AVAILABLE_MISSION_SLOTS = 5;

// ---------------------------------------------------------------------------
// Facilities
// ---------------------------------------------------------------------------

/**
 * Unique identifiers for each facility the player can build on the hub.
 * @enum {string}
 */
export const FacilityId = Object.freeze({
  LAUNCH_PAD:     'launch-pad',
  VAB:            'vab',
  MISSION_CONTROL:'mission-control',
  CREW_ADMIN:     'crew-admin',
  TRACKING_STATION: 'tracking-station',
  RD_LAB:         'rd-lab',
  SATELLITE_OPS:  'satellite-ops',
  LIBRARY:        'library',
});

/**
 * Static definitions for every buildable facility.
 * `cost` is the base build cost in dollars.  `starter` facilities are
 * pre-built at tier 1 in every new game (both tutorial and non-tutorial).
 * `scienceCost` is the science-point cost to build (default 0; only the
 * R&D Lab costs science).
 *
 * @type {ReadonlyArray<Readonly<{
 *   id: string,
 *   name: string,
 *   description: string,
 *   cost: number,
 *   scienceCost: number,
 *   starter: boolean,
 * }>>}
 */
export const FACILITY_DEFINITIONS = Object.freeze([
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
 * @enum {string}
 */
export const ContractCategory = Object.freeze({
  ALTITUDE_RECORD: 'ALTITUDE_RECORD',
  SPEED_RECORD: 'SPEED_RECORD',
  SCIENCE_SURVEY: 'SCIENCE_SURVEY',
  SATELLITE_DEPLOY: 'SATELLITE_DEPLOY',
  SAFE_RECOVERY: 'SAFE_RECOVERY',
  ORBITAL: 'ORBITAL',
  CRASH_TEST: 'CRASH_TEST',
});

/**
 * Contract board pool and active contract caps by Mission Control tier.
 *
 * pool  = max contracts visible on the board at once.
 * active = max contracts the player may have accepted simultaneously.
 *
 * @type {Readonly<Record<number, Readonly<{pool: number, active: number}>>>}
 */
export const CONTRACT_TIER_CAPS = Object.freeze({
  1: Object.freeze({ pool: 4,  active: 2 }),
  2: Object.freeze({ pool: 8,  active: 5 }),
  3: Object.freeze({ pool: 12, active: 8 }),
});

/**
 * Icons (text glyphs) for each contract category, used in the UI.
 * @type {Readonly<Record<string, string>>}
 */
export const CONTRACT_CATEGORY_ICONS = Object.freeze({
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
 * @type {Readonly<Record<string, string>>}
 */
export const CONTRACT_CONFLICT_TAGS = Object.freeze({
  DESTRUCTIVE:  'DESTRUCTIVE',   // crash test vs safe recovery
  BUDGET:       'BUDGET',        // budget-limited flights
  CREW_HEAVY:   'CREW_HEAVY',    // crew requirement contracts
  MINIMALIST:   'MINIMALIST',    // part-count-limited flights
});

/** Bonus reward multiplier: bonus reward = base reward * this factor. */
export const CONTRACT_BONUS_REWARD_RATE = 0.5;

/** Number of new contracts generated after each flight return. */
export const CONTRACTS_PER_FLIGHT_MIN = 2;
export const CONTRACTS_PER_FLIGHT_MAX = 3;

/** Number of flights before an unaccepted board contract expires. */
export const CONTRACT_BOARD_EXPIRY_FLIGHTS = 4;

/** Cancellation penalty as a fraction of the contract reward. */
export const CONTRACT_CANCEL_PENALTY_RATE = 0.25;

/** Reputation gained per completed contract (minimum of random 3–5 range). */
export const CONTRACT_REP_GAIN_MIN = 3;

/** Reputation gained per completed contract (maximum of random 3–5 range). */
export const CONTRACT_REP_GAIN_MAX = 5;

/** @deprecated Use CONTRACT_REP_GAIN_MIN/MAX. Kept for contract generation compat. */
export const CONTRACT_REP_GAIN_BASE = 5;

/** Reputation lost per cancelled contract. */
export const CONTRACT_REP_LOSS_CANCEL = 8;

/** Reputation lost per expired/failed contract. */
export const CONTRACT_REP_LOSS_FAIL = 5;

/** Starting reputation for a new agency. */
export const STARTING_REPUTATION = 50;

// ---------------------------------------------------------------------------
// Reputation Events
// ---------------------------------------------------------------------------

/** Reputation gained for each crew member safely returned from a crewed flight. */
export const REP_GAIN_SAFE_CREW_RETURN = 1;

/** Reputation gained for reaching a milestone (first orbit, first landing, etc.). */
export const REP_GAIN_MILESTONE = 10;

/** Reputation lost per crew member killed in action. */
export const REP_LOSS_CREW_DEATH = 10;

/** Reputation lost when a flight ends in failure (objectives not met). */
export const REP_LOSS_MISSION_FAILURE = 3;

/** Reputation lost when rocket is destroyed with no recovery. */
export const REP_LOSS_ROCKET_DESTRUCTION = 2;

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
 *
 * @type {Array<{ min: number, max: number, label: string, color: string, crewCostModifier: number, facilityDiscount: number }>}
 */
export const REPUTATION_TIERS = Object.freeze([
  { min: 0,  max: 20,  label: 'Basic',   color: '#cc4444', crewCostModifier: 1.50, facilityDiscount: 0.00 },
  { min: 21, max: 40,  label: 'Standard', color: '#cc8844', crewCostModifier: 1.25, facilityDiscount: 0.00 },
  { min: 41, max: 60,  label: 'Good',    color: '#cccc44', crewCostModifier: 1.00, facilityDiscount: 0.05 },
  { min: 61, max: 80,  label: 'Premium', color: '#44cc88', crewCostModifier: 0.90, facilityDiscount: 0.10 },
  { min: 81, max: 100, label: 'Elite',   color: '#4488ff', crewCostModifier: 0.75, facilityDiscount: 0.15 },
]);

/**
 * Get the reputation tier object for a given reputation value.
 *
 * @param {number} reputation  Current agency reputation (0–100).
 * @returns {{ min: number, max: number, label: string, color: string, crewCostModifier: number, facilityDiscount: number }}
 */
export function getReputationTier(reputation) {
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
 * @param {number} reputation  Current agency reputation (0–100).
 * @returns {number}  Multiplier (e.g. 1.5 = +50 %, 0.75 = −25 %).
 */
export function getCrewCostModifier(reputation) {
  return getReputationTier(reputation).crewCostModifier;
}

// ---------------------------------------------------------------------------
// Period / Operating Costs
// ---------------------------------------------------------------------------

/** Crew salary charged per period (per astronaut). */
export const CREW_SALARY_PER_PERIOD = 5_000;

/** Base facility upkeep charged per period. */
export const FACILITY_UPKEEP_PER_PERIOD = 10_000;

// ---------------------------------------------------------------------------
// Crew Injury System
// ---------------------------------------------------------------------------

/** Landing speed (m/s) at or above which crew sustain hard-landing injuries. */
export const HARD_LANDING_SPEED_MIN = 5;

/** Landing speed (m/s) at or above which a hard landing is fatal (crash). */
export const HARD_LANDING_SPEED_MAX = 10;

/** Injury duration (periods) for a hard landing — minimum. */
export const HARD_LANDING_INJURY_MIN = 2;

/** Injury duration (periods) for a hard landing — maximum. */
export const HARD_LANDING_INJURY_MAX = 3;

/** Injury duration (periods) for crew ejection. */
export const EJECTION_INJURY_PERIODS = 1;

/** Medical care fee per injured crew member (halves recovery, rounded up). */
export const MEDICAL_CARE_COST = 25_000;

// ---------------------------------------------------------------------------
// Weather & Launch Conditions
// ---------------------------------------------------------------------------

/** Base cost to skip a day's weather and reroll (dollars). */
export const WEATHER_BASE_SKIP_COST = 25_000;

/** Escalation factor per consecutive skip: cost *= factor^skipCount. */
export const WEATHER_SKIP_ESCALATION = 1.5;

/** Maximum normal wind speed in m/s. */
export const WEATHER_MAX_WIND = 15;

/** ISP temperature range: modifier spans [1 - range, 1 + range]. */
export const WEATHER_ISP_RANGE = 0.05;

/** Chance of extreme weather per reroll (10 %). */
export const WEATHER_EXTREME_CHANCE = 0.10;

/** Minimum wind speed threshold for extreme weather (m/s). */
export const WEATHER_EXTREME_WIND_MIN = 20;

/** Minimum visibility value in extreme weather (0–1 scale). */
export const WEATHER_EXTREME_VISIBILITY_MAX = 0.7;

// ---------------------------------------------------------------------------
// Celestial Bodies & Orbital Mechanics
// ---------------------------------------------------------------------------

/**
 * Known celestial bodies.
 * @enum {string}
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
});

/**
 * Gravitational parameters (GM) in m³/s² for each body.
 * μ = G × M, used in Keplerian orbit calculations.
 */
export const BODY_GM = Object.freeze({
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
export const BODY_RADIUS = Object.freeze({
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
 *
 * @type {Readonly<Record<string, number>>}
 */
export const MIN_ORBIT_ALTITUDE = Object.freeze({
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
 * Altitude bands per celestial body.
 * Each band defines a range of altitudes (metres above the surface).
 * Objects in the same band can interact via proximity detection.
 *
 * @type {Readonly<Record<string, ReadonlyArray<Readonly<{id: string, name: string, min: number, max: number}>>>>}
 */
export const ALTITUDE_BANDS = Object.freeze({
  SUN: Object.freeze([
    Object.freeze({ id: 'INNER_CORONA', name: 'Inner Corona', min: 0, max: 2_000_000_000 }),
    Object.freeze({ id: 'OUTER_CORONA', name: 'Outer Corona', min: 2_000_000_000, max: 20_000_000_000 }),
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
 *
 * @type {Readonly<Record<string, ReadonlyArray<Readonly<{
 *   id: string, name: string, min: number, max: number,
 *   scienceMultiplier: number, color: number
 * }>>>>}
 */
export const BIOME_DEFINITIONS = Object.freeze({
  SUN: Object.freeze([
    Object.freeze({ id: 'SOLAR_CORONA',        name: 'Solar Corona',         min: 0,               max: 2_000_000_000, scienceMultiplier: 10.0, color: 0xffdd44 }),
    Object.freeze({ id: 'NEAR_SUN',            name: 'Near Sun Space',       min: 2_000_000_000,   max: Infinity,      scienceMultiplier: 6.0,  color: 0xff8800 }),
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
 * @enum {string}
 */
export const ScienceDataType = Object.freeze({
  /** Physical sample — must be returned to the ground for full yield.
   *  Cannot be transmitted. */
  SAMPLE: 'SAMPLE',
  /** Telemetry / analysis data — can be transmitted from orbit at reduced
   *  yield (40–60 %), or returned physically for full yield. */
  ANALYSIS: 'ANALYSIS',
});

// ---------------------------------------------------------------------------
// Science Yield Constants
// ---------------------------------------------------------------------------

/**
 * Diminishing-return multipliers applied when the same (instrument, biome)
 * pair is collected repeatedly across flights.
 *
 * Index = number of prior collections in that pair.
 *   0 → first time  → 100 %
 *   1 → second time →  25 %
 *   2 → third time  →  10 %
 *   3+ → no further value
 *
 * @type {readonly number[]}
 */
export const DIMINISHING_RETURNS = Object.freeze([1.0, 0.25, 0.10]);

/** Minimum yield fraction when transmitting ANALYSIS data from orbit. */
export const ANALYSIS_TRANSMIT_YIELD_MIN = 0.40;

/** Maximum yield fraction when transmitting ANALYSIS data from orbit. */
export const ANALYSIS_TRANSMIT_YIELD_MAX = 0.60;

// ---------------------------------------------------------------------------
// Tech Tree
// ---------------------------------------------------------------------------

/**
 * Maximum tech tier accessible per R&D Lab facility tier.
 *
 *   R&D Lab Tier 1 → tech tiers 1–2
 *   R&D Lab Tier 2 → tech tiers 3–4
 *   R&D Lab Tier 3 → tech tier 5
 *
 * @type {Readonly<Record<number, number>>}
 */
export const RD_TIER_MAX_TECH = Object.freeze({
  1: 2,
  2: 4,
  3: 5,
});

// ---------------------------------------------------------------------------
// R&D Lab Upgrade Definitions
// ---------------------------------------------------------------------------

/**
 * R&D Lab science yield bonus per facility tier.
 * Applied as a multiplier: `yield *= (1 + bonus)`.
 *
 * @type {Readonly<Record<number, number>>}
 */
export const RD_LAB_SCIENCE_BONUS = Object.freeze({
  0: 0,     // No lab built
  1: 0.10,  // Tier 1: +10 %
  2: 0.20,  // Tier 2: +20 %
  3: 0.30,  // Tier 3: +30 %
});

/**
 * Upgrade cost definitions for each R&D Lab tier.
 *
 * Tier 1 is the initial build.  Tiers 2–3 are upgrades.
 * The R&D Lab is the only facility that costs both money AND science.
 * Reputation discounts apply to the money portion only.
 *
 * @type {Readonly<Record<number, Readonly<{
 *   moneyCost: number,
 *   scienceCost: number,
 *   description: string
 * }>>>}
 */
export const RD_LAB_TIER_DEFS = Object.freeze({
  1: Object.freeze({ moneyCost: 300_000,   scienceCost: 20,  description: 'Tech tiers 1–2, 10% science bonus' }),
  2: Object.freeze({ moneyCost: 600_000,   scienceCost: 100, description: 'Tech tiers 3–4, 20% science bonus' }),
  3: Object.freeze({ moneyCost: 1_000_000, scienceCost: 200, description: 'Tier 5, 30% science bonus, experimental parts' }),
});

/** Maximum upgrade tier for the R&D Lab. */
export const RD_LAB_MAX_TIER = 3;

// ---------------------------------------------------------------------------
// Generalized Facility Upgrade Definitions
// ---------------------------------------------------------------------------

/**
 * Upgrade tier definitions for every upgradeable facility.
 *
 * Each key is a FacilityId.  The value is an object with:
 *   - `maxTier` — the highest tier this facility can reach.
 *   - `tiers`   — a map from tier number (2+) to upgrade cost & description.
 *     Tier 1 is always the initial build (no upgrade cost).
 *
 * All facilities cost money only, except R&D Lab which also costs science.
 * Reputation discounts apply to the money portion only.
 *
 * Facilities absent from this map (e.g. Library) have no upgrades (max tier 1).
 *
 * @type {Readonly<Record<string, Readonly<{
 *   maxTier: number,
 *   tiers: Readonly<Record<number, Readonly<{
 *     moneyCost: number,
 *     scienceCost: number,
 *     description: string,
 *   }>>>
 * }>>>}
 */
export const FACILITY_UPGRADE_DEFS = Object.freeze({
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
 *
 * @param {string} facilityId
 * @returns {{ maxTier: number, tiers: Record<number, { moneyCost: number, scienceCost: number, description: string }> } | null}
 */
export function getFacilityUpgradeDef(facilityId) {
  return FACILITY_UPGRADE_DEFS[facilityId] ?? null;
}

/**
 * Calculate the reputation discount fraction for facility construction.
 *
 * Uses tier-based discounts:
 *   0–20:  0 %    (Basic)
 *   21–40: 0 %    (Standard)
 *   41–60: 5 %    (Good)
 *   61–80: 10 %   (Premium)
 *   81–100: 15 %  (Elite)
 *
 * Facility discounts apply to money only — never to science costs (R&D Lab).
 *
 * @param {number} reputation  Current agency reputation (0–100).
 * @returns {number}  Discount fraction (0.0–0.15).
 */
export function getReputationDiscount(reputation) {
  return getReputationTier(reputation).facilityDiscount;
}

// ---------------------------------------------------------------------------
// Orbit Segments
// ---------------------------------------------------------------------------

/** Number of angular segments dividing each orbit plane. */
export const ORBIT_SEGMENTS = 36;

/** Degrees per angular segment. */
export const ORBIT_SEGMENT_SIZE = 360 / 36; // 10°

/** Maximum angular distance (degrees) for proximity detection. */
export const PROXIMITY_ANGLE_DEG = 5;

/**
 * Type of object tracked in orbit.
 * @enum {string}
 */
export const OrbitalObjectType = Object.freeze({
  CRAFT: 'CRAFT',
  SATELLITE: 'SATELLITE',
  DEBRIS: 'DEBRIS',
  STATION: 'STATION',
});

// ---------------------------------------------------------------------------
// Malfunction System
// ---------------------------------------------------------------------------

/**
 * Types of part malfunctions that can occur during flight.
 * Each malfunction has specific effects and recovery options.
 * @enum {string}
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
  /** Science module instruments fail — cannot activate experiments. */
  SCIENCE_INSTRUMENT_FAILURE: 'SCIENCE_INSTRUMENT_FAILURE',
  /** Landing legs refuse to deploy via staging; stuck in stowed position. */
  LANDING_LEGS_STUCK: 'LANDING_LEGS_STUCK',
});

/**
 * Malfunction mode for E2E testing.
 *   'normal'  — reliability rolls happen as designed
 *   'off'     — no malfunctions ever trigger (testing reliability)
 *   'forced'  — every roll triggers a malfunction at 100 % (testing effects)
 * @enum {string}
 */
export const MalfunctionMode = Object.freeze({
  NORMAL: 'normal',
  OFF:    'off',
  FORCED: 'forced',
});

/**
 * Mapping from PartType to which MalfunctionType(s) can affect that part.
 * When a malfunction roll succeeds, one type is chosen from the applicable list.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const MALFUNCTION_TYPE_MAP = Object.freeze({
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
export const FUEL_LEAK_RATE = 0.02;

/** Thrust multiplier for ENGINE_REDUCED_THRUST malfunction (60 %). */
export const REDUCED_THRUST_FACTOR = 0.60;

/** Drag multiplier for PARACHUTE_PARTIAL malfunction (50 % effectiveness). */
export const PARTIAL_CHUTE_FACTOR = 0.50;

/** Maximum crew engineering skill reduction to malfunction chance (30 %). */
export const MAX_ENGINEERING_MALFUNCTION_REDUCTION = 0.30;

/**
 * Default reliability values by part tier.
 * Parts reference these when defining their `reliability` property.
 */
export const RELIABILITY_TIERS = Object.freeze({
  STARTER:  0.92,
  MID:      0.96,
  HIGH:     0.98,
  UPGRADE_BONUS: 0.02,
});

// ---------------------------------------------------------------------------
// Satellite Network System
// ---------------------------------------------------------------------------

/**
 * Functional types of satellite that provide network bonuses.
 * @enum {string}
 */
export const SatelliteType = Object.freeze({
  /** Communication satellite — enables science data transmission from orbit. */
  COMMUNICATION: 'COMMUNICATION',
  /** Weather satellite — reduces weather-skip cost and improves forecast. */
  WEATHER: 'WEATHER',
  /** Science satellite — generates passive science points per period. */
  SCIENCE: 'SCIENCE',
  /** GPS/Navigation satellite — widens landing threshold, recovery profitability, new mission types. */
  GPS: 'GPS',
  /** Relay satellite — extends deep-space communication range. */
  RELAY: 'RELAY',
});

/**
 * Which altitude bands each satellite type may operate in.
 * A satellite must be deployed in one of its valid bands to be active.
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const SATELLITE_VALID_BANDS = Object.freeze({
  [SatelliteType.COMMUNICATION]: Object.freeze(['LEO', 'MEO', 'HEO', 'LLO', 'MLO', 'HLO']),
  [SatelliteType.WEATHER]:       Object.freeze(['LEO', 'MEO', 'LLO', 'MLO']),
  [SatelliteType.SCIENCE]:       Object.freeze(['LEO', 'MEO', 'HEO', 'LLO', 'MLO', 'HLO']),
  [SatelliteType.GPS]:           Object.freeze(['MEO', 'MLO']),
  [SatelliteType.RELAY]:         Object.freeze(['HEO', 'HLO']),
});

/**
 * Constellation bonus threshold — 3+ satellites of the same type = 2× benefit.
 * @type {number}
 */
export const CONSTELLATION_THRESHOLD = 3;

/** Multiplier applied when constellation bonus is active. */
export const CONSTELLATION_MULTIPLIER = 2;

/**
 * Base benefits per satellite type (before constellation multiplier).
 *
 * COMMUNICATION: transmitYieldBonus — additive bonus to science transmit yield.
 * WEATHER:       weatherSkipDiscount — fraction discount on weather-skip cost;
 *                forecastAccuracy — bonus to launch forecast display.
 * SCIENCE:       sciencePerPeriod — passive science points earned per period.
 * GPS:           landingThresholdBonus — m/s added to safe-landing tolerance;
 *                recoveryBonus — fraction bonus to recovery revenue.
 * RELAY:         deepSpaceComms — enables deep-space mission types.
 */
export const SATELLITE_BENEFITS = Object.freeze({
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
export const SATELLITE_DEGRADATION_PER_PERIOD = 3;

/** Health threshold below which a satellite provides reduced (50%) benefits. */
export const SATELLITE_DEGRADED_THRESHOLD = 30;

/** Cost per satellite for auto-maintenance per period (dollars). */
export const SATELLITE_AUTO_MAINTENANCE_COST = 15_000;

/** Health restored per auto-maintenance cycle (percentage points). */
export const SATELLITE_AUTO_MAINTENANCE_HEAL = 10;

/**
 * Satellite Ops facility tier caps for max active satellites.
 * @type {Readonly<Record<number, number>>}
 */
export const SATELLITE_OPS_TIER_CAPS = Object.freeze({
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
 * @type {Readonly<Record<string, number>>}
 */
export const SATELLITE_LEASE_INCOME = Object.freeze({
  [SatelliteType.COMMUNICATION]: 25_000,
  [SatelliteType.WEATHER]:       20_000,
  [SatelliteType.SCIENCE]:       15_000,
  [SatelliteType.GPS]:           30_000,
  [SatelliteType.RELAY]:         35_000,
});

/** Default lease income for generic/untyped satellites. */
export const SATELLITE_LEASE_INCOME_DEFAULT = 10_000;

/**
 * Leased satellites provide reduced network benefits (penalty multiplier).
 * A leased satellite still provides benefits, but at a reduced rate.
 */
export const SATELLITE_LEASE_BENEFIT_PENALTY = 0.5;

// ---------------------------------------------------------------------------
// Satellite Repositioning (Tier 3)
// ---------------------------------------------------------------------------

/**
 * Cost to reposition a satellite to a different altitude band (dollars).
 * Repositioning requires Satellite Ops Tier 3.
 * @type {Readonly<Record<string, number>>}
 */
export const SATELLITE_REPOSITION_COST = Object.freeze({
  SAME_BODY: 50_000,
});

/**
 * Health cost for repositioning a satellite (percentage points).
 * Orbital manoeuvres stress the satellite hardware.
 */
export const SATELLITE_REPOSITION_HEALTH_COST = 10;

// ---------------------------------------------------------------------------
// Docking System
// ---------------------------------------------------------------------------

/**
 * Docking procedure states.
 * @enum {string}
 */
export const DockingState = Object.freeze({
  /** No docking in progress. */
  IDLE: 'IDLE',
  /** Target selected, approaching within visual range. */
  APPROACHING: 'APPROACHING',
  /** Within docking range, aligning orientation and velocity. */
  ALIGNING: 'ALIGNING',
  /** Final approach — automatic docking engaged. */
  FINAL_APPROACH: 'FINAL_APPROACH',
  /** Hard-docked — vessels are connected. */
  DOCKED: 'DOCKED',
  /** Undocking sequence in progress. */
  UNDOCKING: 'UNDOCKING',
});

/** Maximum angular distance (degrees) at which a target becomes visible/targetable in orbit view. */
export const DOCKING_VISUAL_RANGE_DEG = 3;

/** Distance (m) at which docking guidance screen activates in docking mode. */
export const DOCKING_GUIDANCE_RANGE = 500;

/** Distance (m) at which automatic final docking engages. */
export const DOCKING_AUTO_RANGE = 15;

/** Maximum relative speed (m/s) for safe docking alignment. */
export const DOCKING_MAX_RELATIVE_SPEED = 2.0;

/** Maximum orientation difference (radians) for acceptable alignment. */
export const DOCKING_MAX_ORIENTATION_DIFF = 0.15; // ~8.6°

/** Maximum lateral offset (m) for acceptable alignment. */
export const DOCKING_MAX_LATERAL_OFFSET = 3.0;

/** Automatic docking approach speed (m/s) during final approach. */
export const DOCKING_AUTO_APPROACH_SPEED = 0.5;

/** Separation impulse speed (m/s) applied when undocking. */
export const UNDOCKING_SEPARATION_SPEED = 1.0;

// ---------------------------------------------------------------------------
// Part Inventory & Wear System
// ---------------------------------------------------------------------------

/**
 * Wear added per flight for passive parts (tanks, modules, parachutes, etc.).
 * Expressed as percentage points (0–100 scale).
 */
export const WEAR_PER_FLIGHT_PASSIVE = 5;

/**
 * Wear added per flight for engine parts (extra stress from firing).
 * Expressed as percentage points (0–100 scale).
 */
export const WEAR_PER_FLIGHT_ENGINE = 15;

/**
 * Wear added per flight for solid rocket boosters.
 * SRBs endure extreme stress; single-use in practice.
 */
export const WEAR_PER_FLIGHT_SRB = 40;

/**
 * Factor by which wear reduces effective reliability.
 * effectiveReliability = baseReliability × (1 - wear/100 × WEAR_RELIABILITY_FACTOR).
 */
export const WEAR_RELIABILITY_FACTOR = 0.5;

/**
 * Refurbishment cost as a fraction of the part's original purchase price.
 * Paying this resets wear to WEAR_AFTER_REFURBISH.
 */
export const REFURBISH_COST_FRACTION = 0.3;

/**
 * Wear level (%) after refurbishment.
 */
export const WEAR_AFTER_REFURBISH = 10;

/**
 * Fraction of original part cost returned when scrapping an inventory part.
 */
export const SCRAP_VALUE_FRACTION = 0.15;
