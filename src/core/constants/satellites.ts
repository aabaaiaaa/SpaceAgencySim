/**
 * constants/satellites.ts — Satellite network, constellation, leasing,
 * repositioning, and degradation constants.
 *
 * Extracted from the omnibus `constants.ts` per iteration-19 §9. Altitude-band
 * ids referenced by `SATELLITE_VALID_BANDS` are defined in `./bodies.ts`
 * (`ALTITUDE_BANDS`); they are used here as plain string keys.
 */

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
