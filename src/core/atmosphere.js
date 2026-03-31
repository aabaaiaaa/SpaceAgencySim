/**
 * atmosphere.js — Atmosphere model and reentry heat simulation.
 *
 * Provides:
 *   - Exponential air density curve (ISA-inspired, simplified)
 *   - Terminal velocity calculation (informational; drag enforces it naturally)
 *   - Per-tick reentry heat accumulation on the leading-face part
 *   - Heat dissipation when flight conditions ease
 *   - Part destruction when accumulated heat exceeds tolerance
 *
 * ATMOSPHERE MODEL
 *   density(alt) = 1.225 × exp(−alt / 8500)  kg/m³
 *   Effective vacuum above 70 000 m (density < 0.0001 kg/m³).
 *
 * REENTRY CONDITIONS
 *   Active when: altitude < 70 000 m  AND  speed > 1 500 m/s
 *
 * HEAT RULES (per fixed-timestep tick)
 *   heatRate = (speed − 1500) × density × 0.01
 *   Leading-face part accumulates the full heatRate each tick.
 *   All parts dissipate 5 heat units per tick when NOT in reentry.
 *   A part is destroyed (removed from the rocket graph) when:
 *     currentHeat > heatTolerance
 *   Default tolerances:
 *     Structural parts  → 1 200
 *     Heat shield parts → 3 000
 *
 * PUBLIC API
 *   airDensity(altitude)                                          → number
 *   terminalVelocity(mass, gravity, density, Cd, area)           → number
 *   isReentryCondition(altitude, speed)                          → boolean
 *   computeHeatRate(speed, density)                              → number
 *   getLeadingPartId(ps, assembly)                               → string|null
 *   getHeatTolerance(def)                                        → number
 *   updateHeat(ps, assembly, flightState, speed, altitude, density) → void
 *
 * @module atmosphere
 */

import { getPartById } from '../data/parts.js';
import { PartType } from './constants.js';
import { getAirDensity as _bodyAirDensity, getAtmosphereTop as _bodyAtmoTop, hasAtmosphere } from '../data/bodies.js';

// ---------------------------------------------------------------------------
// Constants (exported so physics.js and tests can reference the same values)
// ---------------------------------------------------------------------------

/** Altitude above which air density is effectively zero (metres). */
export const ATMOSPHERE_TOP = 70_000;

/** Air density at sea level (kg/m³). */
export const SEA_LEVEL_DENSITY = 1.225;

/** Atmospheric scale height (metres). Controls how quickly density falls off. */
export const SCALE_HEIGHT = 8_500;

/** Speed threshold above which reentry heating begins (m/s). */
export const REENTRY_SPEED_THRESHOLD = 1_500;

/** Heat rate scalar: heatRate = (speed − threshold) × density × HEAT_RATE_COEFF. */
export const HEAT_RATE_COEFF = 0.01;

/** Heat units dissipated per tick when not in reentry conditions. */
export const HEAT_DISSIPATION_PER_TICK = 5;

/** Default heat tolerance for structural parts (arbitrary heat units). */
export const DEFAULT_HEAT_TOLERANCE = 1_200;

/** Default heat tolerance for heat shield parts. */
export const HEAT_SHIELD_TOLERANCE = 3_000;

// ---------------------------------------------------------------------------
// Air density model
// ---------------------------------------------------------------------------

/**
 * Compute air density at the given altitude using the exponential atmosphere
 * model:
 *
 *   density = SEA_LEVEL_DENSITY × exp(−altitude / SCALE_HEIGHT)
 *
 * Returns 0 at or above {@link ATMOSPHERE_TOP} (effective vacuum).
 *
 * @param {number} altitude  Metres above sea level (clamped to ≥ 0 internally).
 * @returns {number}  Air density in kg/m³.
 */
export function airDensity(altitude) {
  if (altitude >= ATMOSPHERE_TOP) return 0;
  const clamped = Math.max(0, altitude);
  return SEA_LEVEL_DENSITY * Math.exp(-clamped / SCALE_HEIGHT);
}

/**
 * Compute air density for any celestial body at the given altitude.
 * Uses the body's atmosphere profile from the celestial body data system.
 * Returns 0 for airless bodies or altitudes above the atmosphere top.
 *
 * @param {number} altitude  Metres above body surface.
 * @param {string} bodyId    Celestial body ID (e.g., 'EARTH', 'MARS', 'VENUS').
 * @returns {number}  Air density in kg/m³.
 */
export function airDensityForBody(altitude, bodyId) {
  return _bodyAirDensity(altitude, bodyId);
}

/**
 * Get the atmosphere top altitude for a body. Returns 0 for airless bodies.
 * @param {string} bodyId
 * @returns {number}
 */
export function atmosphereTopForBody(bodyId) {
  return _bodyAtmoTop(bodyId);
}

/**
 * Check reentry condition for any celestial body.
 * Uses the body's atmosphere top instead of the hardcoded Earth value.
 *
 * @param {number} altitude  Metres above body surface.
 * @param {number} speed     Rocket speed magnitude (m/s).
 * @param {string} bodyId    Celestial body ID.
 * @returns {boolean}
 */
export function isReentryConditionForBody(altitude, speed, bodyId) {
  const top = _bodyAtmoTop(bodyId);
  if (top <= 0) return false; // Airless bodies have no reentry heating
  return altitude < top && speed > REENTRY_SPEED_THRESHOLD;
}

// ---------------------------------------------------------------------------
// Terminal velocity
// ---------------------------------------------------------------------------

/**
 * Compute the terminal (maximum free-fall) velocity at the given conditions.
 *
 *   v_terminal = √( 2 × mass × gravity / (density × Cd × area) )
 *
 * This is purely informational — drag automatically enforces terminal velocity
 * without any hard speed clamp being needed.
 *
 * Returns {@link Infinity} in vacuum (density ≤ 0) or when area/Cd is zero.
 *
 * @param {number} mass     Total rocket mass (kg).
 * @param {number} gravity  Gravitational acceleration (m/s²).
 * @param {number} density  Air density at current altitude (kg/m³).
 * @param {number} Cd       Drag coefficient (dimensionless).
 * @param {number} area     Cross-sectional reference area (m²).
 * @returns {number}  Terminal velocity in m/s.
 */
export function terminalVelocity(mass, gravity, density, Cd, area) {
  const denominator = density * Cd * area;
  if (denominator <= 0) return Infinity;
  return Math.sqrt((2 * mass * gravity) / denominator);
}

// ---------------------------------------------------------------------------
// Reentry condition helpers
// ---------------------------------------------------------------------------

/**
 * Return true when flight conditions require reentry heat to be applied.
 *
 * Conditions: altitude < {@link ATMOSPHERE_TOP}  AND  speed > {@link REENTRY_SPEED_THRESHOLD}
 *
 * @param {number} altitude  Metres above sea level.
 * @param {number} speed     Rocket speed magnitude (m/s).
 * @returns {boolean}
 */
export function isReentryCondition(altitude, speed) {
  return altitude < ATMOSPHERE_TOP && speed > REENTRY_SPEED_THRESHOLD;
}

/**
 * Compute the heat rate for a single fixed-timestep tick under reentry
 * conditions.
 *
 *   heatRate = (speed − REENTRY_SPEED_THRESHOLD) × density × HEAT_RATE_COEFF
 *
 * Returns 0 if speed is at or below the threshold.
 *
 * @param {number} speed    Rocket speed magnitude (m/s).
 * @param {number} density  Air density at current altitude (kg/m³).
 * @returns {number}  Heat units added per tick.
 */
export function computeHeatRate(speed, density) {
  if (speed <= REENTRY_SPEED_THRESHOLD) return 0;
  return (speed - REENTRY_SPEED_THRESHOLD) * density * HEAT_RATE_COEFF;
}

// ---------------------------------------------------------------------------
// Leading-face detection
// ---------------------------------------------------------------------------

/**
 * Return the instance ID of the part currently at the "leading face" of travel.
 *
 * The leading face is the portion of the rocket that meets oncoming air first:
 *
 *   Descending (velY < 0)  → lowest-Y part in world space (bottom of stack).
 *   Ascending  (velY ≥ 0)  → highest-Y part in world space (nose / top of stack).
 *
 * Parts use Y-up world-space coordinates (from rocketbuilder.js), so higher
 * `placed.y` values correspond to higher physical positions on the rocket.
 *
 * Falls back to the first active part when `activeParts` contains only one
 * element, or returns null if no active parts exist.
 *
 * @param {{ velY: number, activeParts: Set<string> }} ps  Physics state (minimal duck-type).
 * @param {{ parts: Map<string, { y: number }> }}    assembly
 * @returns {string|null}  Instance ID of the leading part, or null.
 */
export function getLeadingPartId(ps, assembly) {
  const descending = ps.velY < 0;
  let leadingId = null;
  let extremeY  = descending ? Infinity : -Infinity;

  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const y = placed.y;
    if (descending ? y < extremeY : y > extremeY) {
      extremeY  = y;
      leadingId = instanceId;
    }
  }

  return leadingId;
}

// ---------------------------------------------------------------------------
// Heat tolerance lookup
// ---------------------------------------------------------------------------

/**
 * Return the heat tolerance for a given part definition.
 *
 * Priority order:
 *   1. `def.properties.heatTolerance` if explicitly set on the part.
 *   2. {@link HEAT_SHIELD_TOLERANCE} for HEAT_SHIELD type parts.
 *   3. {@link DEFAULT_HEAT_TOLERANCE} for all other parts.
 *
 * @param {import('../data/parts.js').PartDef|null|undefined} def
 * @returns {number}  Heat tolerance in arbitrary heat units.
 */
export function getHeatTolerance(def) {
  if (!def) return DEFAULT_HEAT_TOLERANCE;
  if (Object.prototype.hasOwnProperty.call(def.properties ?? {}, 'heatTolerance')) {
    return def.properties.heatTolerance;
  }
  if (def.type === PartType.HEAT_SHIELD) {
    return HEAT_SHIELD_TOLERANCE;
  }
  return DEFAULT_HEAT_TOLERANCE;
}

// ---------------------------------------------------------------------------
// Per-tick heat update — main integration hook
// ---------------------------------------------------------------------------

/**
 * Apply reentry heat to the leading-face part and dissipate heat from all
 * other active parts.  Destroys any part whose accumulated heat exceeds its
 * tolerance.
 *
 * Call once per fixed-timestep integration step (typically dt = 1/60 s).
 *
 * Heat rules per tick:
 *   IN reentry  → leading part: `currentHeat += heatRate`
 *                 all other parts: `currentHeat = max(0, currentHeat − 5)`
 *   NOT reentry → all parts: `currentHeat = max(0, currentHeat − 5)`
 *
 * Destruction: when `currentHeat > heatTolerance`, the part is removed from
 * `ps.activeParts` and `ps.firingEngines`, its heat entry is deleted, and a
 * `PART_DESTROYED` event is appended to `flightState.events`.
 *
 * @param {import('./physics.js').PhysicsState}            ps
 * @param {import('./rocketbuilder.js').RocketAssembly}    assembly
 * @param {import('./gameState.js').FlightState}           flightState
 * @param {number} speed     Rocket speed magnitude (m/s).
 * @param {number} altitude  Altitude above sea level (m).
 * @param {number} density   Air density at current altitude (kg/m³).
 */
export function updateHeat(ps, assembly, flightState, speed, altitude, density) {
  const reentry  = isReentryCondition(altitude, speed);
  const heatRate = reentry ? computeHeatRate(speed, density) : 0;

  // Determine which part faces the oncoming atmosphere this tick.
  const leadingId = reentry ? getLeadingPartId(ps, assembly) : null;

  const toDestroy = [];

  for (const instanceId of ps.activeParts) {
    let heat = ps.heatMap.get(instanceId) ?? 0;

    if (reentry && instanceId === leadingId) {
      // Leading face: absorb the full heat rate.
      heat += heatRate;
    } else {
      // All other parts cool down (or stay cool if already at 0).
      heat = Math.max(0, heat - HEAT_DISSIPATION_PER_TICK);
    }

    ps.heatMap.set(instanceId, heat);

    // Check whether the accumulated heat has exceeded the part's tolerance.
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (heat > getHeatTolerance(def)) {
      toDestroy.push({ instanceId, name: def?.name ?? 'Unknown part' });
    }
  }

  // Destroy over-heated parts.
  for (const { instanceId, name } of toDestroy) {
    ps.activeParts.delete(instanceId);
    ps.firingEngines.delete(instanceId);
    ps.heatMap.delete(instanceId);

    flightState.events.push({
      type:        'PART_DESTROYED',
      time:        flightState.timeElapsed,
      instanceId,
      partName:    name,
      altitude,
      description: `${name} destroyed by reentry heat at ${altitude.toFixed(0)} m.`,
    });
  }
}
