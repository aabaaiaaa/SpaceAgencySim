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
// Finance, Facilities, Contracts, Reputation, Training, Crew Costs, Upkeep
// ---------------------------------------------------------------------------
// Moved to ./constants/economy.ts; re-exported here so existing imports of
// `../constants` keep working.
export * from './constants/economy.ts';

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
