/**
 * atmosphere.ts — Atmosphere model and reentry/ascent heat simulation.
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
 *   density(alt) = 1.225 x exp(-alt / 8500)  kg/m^3   (Earth default)
 *   Multi-body: uses per-body seaLevelDensity / scaleHeight / topAltitude.
 *   Effective vacuum above topAltitude (density < 0.0001 kg/m^3).
 *
 * HEATING CONDITIONS
 *   Active when: inside body's atmosphere AND speed > 1 500 m/s
 *   Applies during both ascent and reentry.
 *
 * HEAT RULES (per fixed-timestep tick)
 *   heatRate = (speed - 1500) x density x 0.01
 *   Leading-face part: accumulates full heatRate.
 *   Other exposed parts (not behind a heat shield): accumulate 40% heatRate.
 *   Shielded parts (behind a heat shield relative to travel direction): no heat.
 *   All parts dissipate HEAT_DISSIPATION_PER_TICK when NOT under thermal stress.
 *   A part is destroyed when: currentHeat > heatTolerance
 *
 * HEAT SHIELD PROTECTION
 *   During descent (velY < 0): shield protects parts with Y > shield.Y (above it).
 *   During ascent  (velY >= 0): shield protects parts with Y < shield.Y (below it).
 *   Only active heat shields (in ps.activeParts) provide protection.
 *
 * PUBLIC API
 *   airDensity(altitude)                                          -> number
 *   airDensityForBody(altitude, bodyId)                           -> number
 *   atmosphereTopForBody(bodyId)                                  -> number
 *   isReentryConditionForBody(altitude, speed, bodyId)            -> boolean
 *   terminalVelocity(mass, gravity, density, Cd, area)           -> number
 *   isReentryCondition(altitude, speed)                          -> boolean
 *   computeHeatRate(speed, density)                              -> number
 *   getLeadingPartId(ps, assembly)                               -> string|null
 *   getShieldedPartIds(ps, assembly)                             -> Set<string>
 *   getHeatTolerance(def)                                        -> number
 *   getHeatRatio(ps, instanceId, assembly)                       -> number
 *   updateHeat(ps, assembly, flightState, speed, altitude, density) -> void
 *
 * @module atmosphere
 */

import { getPartById } from '../data/parts.ts';
import { PartType } from './constants.ts';
import {
  SUN_DESTRUCTION_ALTITUDE,
  SUN_HEAT_START_ALTITUDE,
  SUN_HEAT_RATE_BASE,
  STANDARD_SHIELD_SOLAR_RESISTANCE,
  BODY_RADIUS,
} from './constants.ts';
import { getAirDensity as _bodyAirDensity, getAtmosphereTop as _bodyAtmoTop, hasAtmosphere } from '../data/bodies.ts';

import type { PartDef } from '../data/parts.ts';
import type { PhysicsState, RocketAssembly } from './physics.ts';
import type { FlightState } from './gameState.ts';

// ---------------------------------------------------------------------------
// Minimal duck-type interfaces for function parameters
// ---------------------------------------------------------------------------

/** Minimal physics state required by leading-part and shielding helpers. */
interface HeatQueryPhysics {
  velY: number;
  activeParts: Set<string>;
}

/** Minimal assembly shape required by leading-part and shielding helpers. */
interface HeatQueryAssembly {
  parts: Map<string, { x: number; y: number; partId: string }>;
}

/** Minimal physics state for heat-ratio queries. */
interface HeatRatioPhysics {
  heatMap: Map<string, number>;
  activeParts: Set<string>;
}

/** Minimal assembly shape for heat-ratio queries. */
interface HeatRatioAssembly {
  parts: Map<string, { partId: string }>;
}

// ---------------------------------------------------------------------------
// Constants (exported so physics.js and tests can reference the same values)
// ---------------------------------------------------------------------------

/** Altitude above which air density is effectively zero (metres). */
export const ATMOSPHERE_TOP: number = 70_000;

/** Air density at sea level (kg/m^3). */
export const SEA_LEVEL_DENSITY: number = 1.225;

/** Atmospheric scale height (metres). Controls how quickly density falls off. */
export const SCALE_HEIGHT: number = 8_500;

/** Speed threshold above which atmospheric heating begins (m/s). */
export const REENTRY_SPEED_THRESHOLD: number = 1_500;

/** Heat rate scalar: heatRate = (speed - threshold) x density x HEAT_RATE_COEFF. */
export const HEAT_RATE_COEFF: number = 0.01;

/** Heat units dissipated per tick when not under thermal stress. */
export const HEAT_DISSIPATION_PER_TICK: number = 5;

/** Default heat tolerance for structural parts (arbitrary heat units). */
export const DEFAULT_HEAT_TOLERANCE: number = 1_200;

/** Default heat tolerance for heat shield parts. */
export const HEAT_SHIELD_TOLERANCE: number = 3_000;

/** Fraction of heat rate applied to non-leading exposed parts. */
export const EXPOSED_HEAT_FRACTION: number = 0.4;

// ---------------------------------------------------------------------------
// Air density model
// ---------------------------------------------------------------------------

/**
 * Compute air density at the given altitude using the exponential atmosphere
 * model.
 *
 * Returns 0 at or above ATMOSPHERE_TOP (effective vacuum).
 */
export function airDensity(altitude: number): number {
  if (altitude >= ATMOSPHERE_TOP) return 0;
  const clamped = Math.max(0, altitude);
  return SEA_LEVEL_DENSITY * Math.exp(-clamped / SCALE_HEIGHT);
}

/**
 * Compute air density for any celestial body at the given altitude.
 * Uses the body's atmosphere profile from the celestial body data system.
 * Returns 0 for airless bodies or altitudes above the atmosphere top.
 */
export function airDensityForBody(altitude: number, bodyId: string): number {
  return _bodyAirDensity(altitude, bodyId);
}

/**
 * Get the atmosphere top altitude for a body. Returns 0 for airless bodies.
 */
export function atmosphereTopForBody(bodyId: string): number {
  return _bodyAtmoTop(bodyId);
}

/**
 * Check heating condition for any celestial body.
 * Uses the body's atmosphere top instead of the hardcoded Earth value.
 */
export function isReentryConditionForBody(altitude: number, speed: number, bodyId: string): boolean {
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
 * Returns Infinity in vacuum (density <= 0) or when area/Cd is zero.
 */
export function terminalVelocity(mass: number, gravity: number, density: number, Cd: number, area: number): number {
  const denominator = density * Cd * area;
  if (denominator <= 0) return Infinity;
  return Math.sqrt((2 * mass * gravity) / denominator);
}

// ---------------------------------------------------------------------------
// Reentry condition helpers
// ---------------------------------------------------------------------------

/**
 * Return true when flight conditions require atmospheric heat to be applied.
 */
export function isReentryCondition(altitude: number, speed: number): boolean {
  return altitude < ATMOSPHERE_TOP && speed > REENTRY_SPEED_THRESHOLD;
}

/**
 * Compute the heat rate for a single fixed-timestep tick under atmospheric
 * heating conditions.
 *
 * Returns 0 if speed is at or below the threshold.
 */
export function computeHeatRate(speed: number, density: number): number {
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
 *   Descending (velY < 0)  -> lowest-Y part in world space (bottom of stack).
 *   Ascending  (velY >= 0) -> highest-Y part in world space (nose / top of stack).
 *
 * Falls back to the first active part when `activeParts` contains only one
 * element, or returns null if no active parts exist.
 */
export function getLeadingPartId(ps: HeatQueryPhysics, assembly: HeatQueryAssembly): string | null {
  const descending = ps.velY < 0;
  let leadingId: string | null = null;
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
 *   Descending (velY < 0): leading face is bottom -> shield protects parts
 *     with Y > shield.Y (above the shield in the stack).
 *   Ascending  (velY >= 0): leading face is top -> shield protects parts
 *     with Y < shield.Y (below the shield in the stack).
 *
 * Only active heat shields (present in ps.activeParts) provide protection.
 */
export function getShieldedPartIds(ps: HeatQueryPhysics, assembly: HeatQueryAssembly): Set<string> {
  const shielded = new Set<string>();
  const descending = ps.velY < 0;

  // Find all active heat shields.
  const shields: { instanceId: string; y: number; halfWidth: number; x: number }[] = [];
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
 *   2. HEAT_SHIELD_TOLERANCE for HEAT_SHIELD type parts.
 *   3. DEFAULT_HEAT_TOLERANCE for all other parts.
 */
export function getHeatTolerance(def: PartDef | null | undefined): number {
  if (!def) return DEFAULT_HEAT_TOLERANCE;
  if (Object.prototype.hasOwnProperty.call(def.properties ?? {}, 'heatTolerance')) {
    return def.properties.heatTolerance as number;
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
 * Return the heat ratio (0-1) for a given part, where 0 is cold and 1 is at
 * the part's thermal tolerance limit. Used by the renderer for glow intensity.
 */
export function getHeatRatio(ps: HeatRatioPhysics, instanceId: string, assembly: HeatRatioAssembly): number {
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
 */
export function updateHeat(
  ps: PhysicsState,
  assembly: RocketAssembly,
  flightState: FlightState,
  speed: number,
  altitude: number,
  density: number,
): void {
  const reentry  = isReentryCondition(altitude, speed);
  const heatRate = reentry ? computeHeatRate(speed, density) : 0;

  // Determine which part faces the oncoming atmosphere this tick.
  const leadingId = reentry ? getLeadingPartId(ps, assembly) : null;

  // Determine which parts are protected by heat shields.
  const shielded = reentry ? getShieldedPartIds(ps, assembly) : new Set<string>();

  const toDestroy: { instanceId: string; name: string }[] = [];

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
 * Uses inverse-square scaling from the Sun's centre.
 * Returns 0 when the altitude is above SUN_HEAT_START_ALTITUDE.
 */
export function computeSolarHeatRate(altitude: number): number {
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
 * Shield) provide their declared resistance (0-1).  Standard heat shields
 * without the property provide STANDARD_SHIELD_SOLAR_RESISTANCE (0.3).
 */
function _getBestSolarShieldResistance(
  activeParts: Set<string>,
  assemblyParts: Map<string, { partId: string }>,
): number {
  let best = 0;
  for (const instanceId of activeParts) {
    const placed = assemblyParts.get(instanceId);
    if (!placed) continue;
    const def = getPartById(placed.partId);
    if (!def || def.type !== PartType.HEAT_SHIELD) continue;

    const resistance = (def.properties?.solarHeatResistance as number) ?? STANDARD_SHIELD_SOLAR_RESISTANCE;
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
 */
export function updateSolarHeat(
  ps: PhysicsState,
  assembly: RocketAssembly,
  flightState: FlightState,
  altitude: number,
): void {
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
  const shielded = shieldResistance > 0 ? getShieldedPartIds(ps, assembly) : new Set<string>();

  const toDestroy: { instanceId: string; name: string }[] = [];

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
