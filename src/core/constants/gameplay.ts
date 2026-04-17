/**
 * constants/gameplay.ts — Weather, hard-landing/injury/medical, part wear,
 * difficulty, comms, resources, and mining constants.
 *
 * Extracted from the omnibus `constants.ts` per iteration-19 §9. Self-contained:
 * no cross-references into other constants sub-modules.
 */

// ---------------------------------------------------------------------------
// Crew Injury System (hard-landing & medical)
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

// ---------------------------------------------------------------------------
// Resource System
// ---------------------------------------------------------------------------

export const ResourceType = Object.freeze({
  WATER_ICE: 'WATER_ICE',
  REGOLITH: 'REGOLITH',
  IRON_ORE: 'IRON_ORE',
  RARE_METALS: 'RARE_METALS',
  CO2: 'CO2',
  HYDROGEN: 'HYDROGEN',
  OXYGEN: 'OXYGEN',
  HELIUM_3: 'HELIUM_3',
  LIQUID_METHANE: 'LIQUID_METHANE',
  HYDRAZINE: 'HYDRAZINE',
} as const);

export type ResourceType = (typeof ResourceType)[keyof typeof ResourceType];

export const ResourceState = Object.freeze({
  SOLID: 'SOLID',
  LIQUID: 'LIQUID',
  GAS: 'GAS',
} as const);

export type ResourceState = (typeof ResourceState)[keyof typeof ResourceState];

export const MiningModuleType = Object.freeze({
  BASE_CONTROL_UNIT: 'BASE_CONTROL_UNIT',
  MINING_DRILL: 'MINING_DRILL',
  GAS_COLLECTOR: 'GAS_COLLECTOR',
  FLUID_EXTRACTOR: 'FLUID_EXTRACTOR',
  REFINERY: 'REFINERY',
  STORAGE_SILO: 'STORAGE_SILO',
  PRESSURE_VESSEL: 'PRESSURE_VESSEL',
  FLUID_TANK: 'FLUID_TANK',
  SURFACE_LAUNCH_PAD: 'SURFACE_LAUNCH_PAD',
  POWER_GENERATOR: 'POWER_GENERATOR',
} as const);

export type MiningModuleType = (typeof MiningModuleType)[keyof typeof MiningModuleType];
