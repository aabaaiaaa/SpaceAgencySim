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

/** Reputation gained per completed contract (base, before difficulty scaling). */
export const CONTRACT_REP_GAIN_BASE = 5;

/** Reputation lost per cancelled contract. */
export const CONTRACT_REP_LOSS_CANCEL = 8;

/** Reputation lost per expired/failed contract. */
export const CONTRACT_REP_LOSS_FAIL = 5;

/** Starting reputation for a new agency. */
export const STARTING_REPUTATION = 50;

// ---------------------------------------------------------------------------
// Period / Operating Costs
// ---------------------------------------------------------------------------

/** Crew salary charged per period (per astronaut). */
export const CREW_SALARY_PER_PERIOD = 5_000;

/** Base facility upkeep charged per period. */
export const FACILITY_UPKEEP_PER_PERIOD = 10_000;

// ---------------------------------------------------------------------------
// Celestial Bodies & Orbital Mechanics
// ---------------------------------------------------------------------------

/**
 * Known celestial bodies.
 * @enum {string}
 */
export const CelestialBody = Object.freeze({
  EARTH: 'EARTH',
  MOON: 'MOON',
});

/**
 * Gravitational parameters (GM) in m³/s² for each body.
 * μ = G × M, used in Keplerian orbit calculations.
 */
export const BODY_GM = Object.freeze({
  EARTH: 3.986004418e14,
  MOON: 4.9048695e12,
});

/**
 * Mean radius in metres for each body.
 */
export const BODY_RADIUS = Object.freeze({
  EARTH: 6_371_000,
  MOON: 1_737_400,
});

/**
 * Minimum stable orbit altitude per celestial body (metres above the surface).
 * Below this altitude, atmospheric drag (or surface proximity for airless bodies)
 * prevents a stable orbit.  Used by orbit entry detection.
 *
 * @type {Readonly<Record<string, number>>}
 */
export const MIN_ORBIT_ALTITUDE = Object.freeze({
  EARTH: 70_000,
  MOON: 15_000,
});

/**
 * Altitude bands per celestial body.
 * Each band defines a range of altitudes (metres above the surface).
 * Objects in the same band can interact via proximity detection.
 *
 * @type {Readonly<Record<string, ReadonlyArray<Readonly<{id: string, name: string, min: number, max: number}>>>>}
 */
export const ALTITUDE_BANDS = Object.freeze({
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

/**
 * Calculate the reputation discount fraction for facility construction.
 *
 * Discount scales linearly from 0 % at reputation 50 to 25 % at reputation 100.
 * Below the starting reputation (50), no discount is given.
 *
 *   discount = max(0, reputation − 50) / 200
 *
 * @param {number} reputation  Current agency reputation (0–100).
 * @returns {number}  Discount fraction (0.0–0.25).
 */
export function getReputationDiscount(reputation) {
  return Math.max(0, reputation - STARTING_REPUTATION) / 200;
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
