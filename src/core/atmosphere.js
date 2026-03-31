/**
 * atmosphere.js — Atmosphere model and reentry/ascent heat simulation.
 *
 * Provides:
 *   - Exponential air density curve (ISA-inspired, simplified)
 *   - Terminal velocity calculation (informational; drag enforces it naturally)
 *   - Per-tick atmospheric heat accumulation on exposed parts
 *   - Heat shield protection for parts behind the shield in the stack
 *   - Heat dissipation when flight conditions ease
 *   - Part destruction when accumulated heat exceeds tolerance
 *   - Multi-body atmosphere support (Earth, Mars, Venus, etc.)
 *
 * ATMOSPHERE MODEL
 *   density(alt) = 1.225 × exp(−alt / 8500)  kg/m³   (Earth default)
 *   Multi-body: uses per-body seaLevelDensity / scaleHeight / topAltitude.
 *   Effective vacuum above topAltitude (density < 0.0001 kg/m³).
 *
 * HEATING CONDITIONS
 *   Active when: inside body's atmosphere AND speed > 1 500 m/s
 *   Applies during both ascent and reentry.
 *
 * HEAT RULES (per fixed-timestep tick)
 *   heatRate = (speed − 1500) × density × 0.01
 *   Leading-face part: accumulates full heatRate.
 *   Other exposed parts (not behind a heat shield): accumulate 40% heatRate.
 *   Shielded parts (behind a heat shield relative to travel direction): no heat.
 *   All parts dissipate HEAT_DISSIPATION_PER_TICK when NOT under thermal stress.
 *   A part is destroyed when: currentHeat > heatTolerance
 *
 * HEAT SHIELD PROTECTION
 *   During descent (velY < 0): shield protects parts with Y > shield.Y (above it).
 *   During ascent  (velY ≥ 0): shield protects parts with Y < shield.Y (below it).
 *   Only active heat shields (in ps.activeParts) provide protection.
 *
 * PUBLIC API
 *   airDensity(altitude)                                          → number
 *   airDensityForBody(altitude, bodyId)                           → number
 *   atmosphereTopForBody(bodyId)                                  → number
 *   isReentryConditionForBody(altitude, speed, bodyId)            → boolean
 *   terminalVelocity(mass, gravity, density, Cd, area)           → number
 *   isReentryCondition(altitude, speed)                          → boolean
 *   computeHeatRate(speed, density)                              → number
 *   getLeadingPartId(ps, assembly)                               → string|null
 *   getShieldedPartIds(ps, assembly)                             → Set<string>
 *   getHeatTolerance(def)                                        → number
 *   getHeatRatio(ps, instanceId, assembly)                       → number
 *   updateHeat(ps, assembly, flightState, speed, altitude, density) → void
 *
 * @module atmosphere
 */

import { getPartById } from '../data/parts.js';
import { PartType } from './constants.js';
import {
  SUN_DESTRUCTION_ALTITUDE,
  SUN_HEAT_START_ALTITUDE,
  SUN_HEAT_RATE_BASE,
  STANDARD_SHIELD_SOLAR_RESISTANCE,
  BODY_RADIUS,
} from './constants.js';
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

/** Speed threshold above which atmospheric heating begins (m/s). */
export const REENTRY_SPEED_THRESHOLD = 1_500;

/** Heat rate scalar: heatRate = (speed − threshold) × density × HEAT_RATE_COEFF. */
export const HEAT_RATE_COEFF = 0.01;

/** Heat units dissipated per tick when not under thermal stress. */
export const HEAT_DISSIPATION_PER_TICK = 5;

/** Default heat tolerance for structural parts (arbitrary heat units). */
export const DEFAULT_HEAT_TOLERANCE = 1_200;

/** Default heat tolerance for heat shield parts. */
export const HEAT_SHIELD_TOLERANCE = 3_000;

/** Fraction of heat rate applied to non-leading exposed parts. */
export const EXPOSED_HEAT_FRACTION = 0.4;

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
 * Check heating condition for any celestial body.
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
 * Return true when flight conditions require atmospheric heat to be applied.
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
 * Compute the heat rate for a single fixed-timestep tick under atmospheric
 * heating conditions.
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
// Heat shield protection
// ---------------------------------------------------------------------------

/**
 * Return the set of instance IDs that are shielded by an active heat shield.
 *
 * A heat shield protects parts that are "behind" it relative to the direction
 * of travel:
 *   Descending (velY < 0): leading face is bottom → shield protects parts
 *     with Y > shield.Y (above the shield in the stack).
 *   Ascending  (velY ≥ 0): leading face is top → shield protects parts
 *     with Y < shield.Y (below the shield in the stack).
 *
 * Only active heat shields (present in ps.activeParts) provide protection.
 * Radial parts are not protected — only stack-aligned parts behind the shield.
 *
 * @param {{ velY: number, activeParts: Set<string> }} ps
 * @param {{ parts: Map<string, { y: number, partId: string }> }} assembly
 * @returns {Set<string>}  Instance IDs of shielded parts.
 */
export function getShieldedPartIds(ps, assembly) {
  const shielded = new Set();
  const descending = ps.velY < 0;

  // Find all active heat shields.
  const shields = [];
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (def && def.type === PartType.HEAT_SHIELD) {
      shields.push({ instanceId, y: placed.y, halfWidth: (def.width ?? 40) / 2, x: placed.x });
    }
  }

  if (shields.length === 0) return shielded;

  // Check each active part against each shield.
  for (const instanceId of ps.activeParts) {
    const placed = assembly.parts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;
    // Heat shields don't shield themselves.
    if (def.type === PartType.HEAT_SHIELD) continue;

    for (const shield of shields) {
      // Part must be roughly inline with the shield (within shield width).
      const dx = Math.abs(placed.x - shield.x);
      if (dx > shield.halfWidth) continue;

      // Check if the part is behind the shield relative to travel direction.
      if (descending) {
        // Leading face is bottom (low Y). Shield protects parts above it (higher Y).
        if (placed.y > shield.y) {
          shielded.add(instanceId);
          break;
        }
      } else {
        // Leading face is top (high Y). Shield protects parts below it (lower Y).
        if (placed.y < shield.y) {
          shielded.add(instanceId);
          break;
        }
      }
    }
  }

  return shielded;
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
// Heat ratio helper (for rendering)
// ---------------------------------------------------------------------------

/**
 * Return the heat ratio (0–1) for a given part, where 0 is cold and 1 is at
 * the part's thermal tolerance limit. Used by the renderer for glow intensity.
 *
 * @param {{ heatMap: Map<string, number>, activeParts: Set<string> }} ps
 * @param {string} instanceId
 * @param {{ parts: Map<string, { partId: string }> }} assembly
 * @returns {number}  Heat ratio clamped to [0, 1].
 */
export function getHeatRatio(ps, instanceId, assembly) {
  const heat = ps.heatMap.get(instanceId) ?? 0;
  if (heat <= 0) return 0;
  const placed = assembly.parts.get(instanceId);
  const def = placed ? getPartById(placed.partId) : null;
  const tolerance = getHeatTolerance(def);
  return Math.min(1, heat / tolerance);
}

// ---------------------------------------------------------------------------
// Per-tick heat update — main integration hook
// ---------------------------------------------------------------------------

/**
 * Apply atmospheric heat to exposed parts and dissipate heat from shielded /
 * non-stressed parts. Destroys any part whose accumulated heat exceeds its
 * tolerance.
 *
 * Call once per fixed-timestep integration step (typically dt = 1/60 s).
 *
 * Heat rules per tick:
 *   IN heating zone → leading part: `currentHeat += heatRate`
 *                     other exposed parts: `currentHeat += heatRate × 0.4`
 *                     shielded parts: `currentHeat = max(0, currentHeat − 5)`
 *   NOT in heating zone → all parts: `currentHeat = max(0, currentHeat − 5)`
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

  // Determine which parts are protected by heat shields.
  const shielded = reentry ? getShieldedPartIds(ps, assembly) : new Set();

  const toDestroy = [];

  for (const instanceId of ps.activeParts) {
    let heat = ps.heatMap.get(instanceId) ?? 0;

    if (reentry) {
      if (instanceId === leadingId) {
        // Leading face: absorb the full heat rate.
        heat += heatRate;
      } else if (!shielded.has(instanceId)) {
        // Exposed (not shielded): absorb a fraction of the heat rate.
        heat += heatRate * EXPOSED_HEAT_FRACTION;
      } else {
        // Shielded: cool down.
        heat = Math.max(0, heat - HEAT_DISSIPATION_PER_TICK);
      }
    } else {
      // Not in heating zone: all parts cool down.
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
      description: `${name} destroyed by atmospheric heating at ${altitude.toFixed(0)} m.`,
    });
  }
}

// ---------------------------------------------------------------------------
// Solar proximity heat system
// ---------------------------------------------------------------------------

/**
 * Compute the solar heat rate at a given altitude above the Sun's surface.
 *
 * Uses inverse-square scaling from the Sun's centre:
 *   heatRate = BASE × (startDist / dist)²
 *
 * where `startDist` = SUN_HEAT_START_ALTITUDE + Sun radius
 *   and `dist`      = altitude + Sun radius.
 *
 * Returns 0 when the altitude is above SUN_HEAT_START_ALTITUDE.
 *
 * @param {number} altitude  Altitude above Sun surface in metres.
 * @returns {number}  Heat units per tick.
 */
export function computeSolarHeatRate(altitude) {
  if (altitude >= SUN_HEAT_START_ALTITUDE) return 0;

  const sunRadius = BODY_RADIUS.SUN;
  const dist     = sunRadius + Math.max(0, altitude);
  const startDist = sunRadius + SUN_HEAT_START_ALTITUDE;

  // Inverse-square: closer = exponentially more heat.
  const ratio = startDist / dist;
  return SUN_HEAT_RATE_BASE * ratio * ratio;
}

/**
 * Return the best solar heat resistance among active heat shields.
 *
 * Heat shields with the `solarHeatResistance` property (e.g. Solar Heat
 * Shield) provide their declared resistance (0–1).  Standard heat shields
 * without the property provide STANDARD_SHIELD_SOLAR_RESISTANCE (0.3).
 *
 * @param {Set<string>} activeParts
 * @param {Map<string, { partId: string }>} assemblyParts
 * @returns {number}  Best resistance factor (0–1), or 0 if no shields.
 */
function _getBestSolarShieldResistance(activeParts, assemblyParts) {
  let best = 0;
  for (const instanceId of activeParts) {
    const placed = assemblyParts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.HEAT_SHIELD) continue;

    const resistance = def.properties?.solarHeatResistance ?? STANDARD_SHIELD_SOLAR_RESISTANCE;
    if (resistance > best) best = resistance;
  }
  return best;
}

/**
 * Apply solar proximity heat to all parts when the craft is near the Sun.
 *
 * Unlike atmospheric reentry heat (which only affects the leading face),
 * solar radiant heat affects ALL parts uniformly — there is no "leading
 * face" in radiative heating.  Heat shields with solarHeatResistance
 * reduce the heat rate for shielded parts (same shielding logic as
 * atmospheric heat — parts behind the shield in the stack).
 *
 * DESTRUCTION ZONE: If altitude < SUN_DESTRUCTION_ALTITUDE, ALL parts are
 * instantly destroyed — the craft is vaporised.  This is the point of no
 * return.
 *
 * @param {import('./physics.js').PhysicsState}          ps
 * @param {import('./rocketbuilder.js').RocketAssembly}  assembly
 * @param {import('./gameState.js').FlightState}         flightState
 * @param {number} altitude  Altitude above Sun surface (m).
 */
export function updateSolarHeat(ps, assembly, flightState, altitude) {
  // Only applies when orbiting / flying near the Sun.
  if (altitude >= SUN_HEAT_START_ALTITUDE) return;

  // --- Destruction zone: instant vaporisation ---
  if (altitude < SUN_DESTRUCTION_ALTITUDE) {
    const toDestroy = [...ps.activeParts];
    for (const instanceId of toDestroy) {
      const placed = assembly.parts.get(instanceId);
      const def    = placed ? getPartById(placed.partId) : null;
      const name   = def?.name ?? 'Unknown part';

      ps.activeParts.delete(instanceId);
      ps.firingEngines.delete(instanceId);
      ps.heatMap.delete(instanceId);

      flightState.events.push({
        type:        'PART_DESTROYED',
        time:        flightState.timeElapsed,
        instanceId,
        partName:    name,
        altitude,
        description: `${name} vaporised by solar inferno at ${(altitude / 1_000_000).toFixed(0)} Mm altitude.`,
      });
    }
    return;
  }

  // --- Escalating heat damage ---
  const solarHeatRate = computeSolarHeatRate(altitude);
  if (solarHeatRate <= 0) return;

  // Determine shield protection.
  const shieldResistance = _getBestSolarShieldResistance(ps.activeParts, assembly.parts);
  const shielded = shieldResistance > 0 ? getShieldedPartIds(ps, assembly) : new Set();

  const toDestroy = [];

  for (const instanceId of ps.activeParts) {
    let heat = ps.heatMap.get(instanceId) ?? 0;

    if (shielded.has(instanceId)) {
      // Shielded parts receive reduced solar heat.
      heat += solarHeatRate * (1 - shieldResistance);
    } else {
      // Unshielded parts receive full solar heat.
      heat += solarHeatRate;
    }

    ps.heatMap.set(instanceId, heat);

    // Check destruction.
    const placed = assembly.parts.get(instanceId);
    const def    = placed ? getPartById(placed.partId) : null;
    if (heat > getHeatTolerance(def)) {
      toDestroy.push({ instanceId, name: def?.name ?? 'Unknown part' });
    }
  }

  // Destroy overheated parts.
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
      description: `${name} destroyed by solar radiation at ${(altitude / 1_000_000).toFixed(0)} Mm from the Sun.`,
    });
  }
}
