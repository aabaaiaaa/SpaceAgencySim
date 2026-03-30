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
// Period / Operating Costs
// ---------------------------------------------------------------------------

/** Crew salary charged per period (per astronaut). */
export const CREW_SALARY_PER_PERIOD = 5_000;

/** Base facility upkeep charged per period. */
export const FACILITY_UPKEEP_PER_PERIOD = 10_000;
