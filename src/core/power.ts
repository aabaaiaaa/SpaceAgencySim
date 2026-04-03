/**
 * power.ts — Power generation, storage, and consumption system.
 *
 * Models solar panel generation (position-dependent day/night), battery
 * charge/discharge, and power consumers (science instruments, comms,
 * attitude control).
 *
 * KEY CONCEPTS
 * ============
 *   - Solar panels generate power when the craft/satellite is sunlit.
 *   - Sunlit state is determined by angular position relative to the
 *     body's shadow cone (anti-sun direction).
 *   - Batteries store excess energy for eclipse periods.
 *   - When batteries are depleted, power-dependent systems shut down.
 *   - Orbital manoeuvres do NOT require power unless the engine uses
 *     FuelType.ELECTRIC.
 *   - Pre-made satellite parts and command/probe modules have built-in
 *     batteries.  Custom satellites use separate battery parts.
 *
 * UNITS
 * =====
 *   Generation / consumption: watts (W)
 *   Storage capacity / charge: watt-hours (Wh)
 *
 * @module core/power
 */

import {
  BODY_RADIUS,
  SOLAR_IRRADIANCE_SCALE,
  SUN_ROTATION_RATE,
  POWER_DRAW_ROTATION,
  POWER_DRAW_SCIENCE,
  POWER_DRAW_COMMS,
  POWER_CRITICAL_THRESHOLD,
  SOLAR_PANEL_EFFICIENCY,
  ONE_AU,
  MAX_SOLAR_IRRADIANCE_MULTIPLIER,
  SOLAR_IRRADIANCE_1AU,
} from './constants.js';
import { getPartById } from '../data/parts.js';
import type { PowerState } from './gameState.js';
import type { RocketAssembly } from './physics.js';

// ---------------------------------------------------------------------------
// Shadow / Sunlight
// ---------------------------------------------------------------------------

/**
 * Compute the sun direction angle (degrees, 0–360) at a given game time.
 *
 * The sun direction rotates slowly to model the apparent shadow-cone motion.
 * This is a simplified 2D model — the angle increases linearly with time.
 *
 * @param gameTimeSeconds - Cumulative game time (e.g. flightTimeSeconds).
 * @returns Sun angle in degrees [0, 360).
 */
export function getSunAngle(gameTimeSeconds: number): number {
  return ((gameTimeSeconds * SUN_ROTATION_RATE) % 360 + 360) % 360;
}

/**
 * Compute the half-angle of the shadow cone cast by a body at a given
 * orbital altitude.
 *
 * Uses the geometric relation: shadowHalfAngle = arcsin(R_body / r_orbit).
 * Higher orbits have narrower shadow cones (less time in eclipse).
 *
 * @param altitude - Altitude above the body surface (metres).
 * @param bodyId - Celestial body identifier.
 * @returns Shadow half-angle in degrees.
 */
export function getShadowHalfAngle(altitude: number, bodyId: string): number {
  const R = BODY_RADIUS[bodyId] ?? 6_371_000;
  const r = R + Math.max(0, altitude);
  if (r <= R) return 180; // on the surface, always in shadow on the dark side
  const ratio = Math.min(1, R / r);
  return Math.asin(ratio) * (180 / Math.PI);
}

/**
 * Determine whether a position in orbit is in sunlight.
 *
 * The shadow is centred on the anti-sun direction (sunAngle + 180).
 * A position is in shadow if its angular distance from the anti-sun point
 * is less than the shadow half-angle.
 *
 * @param angularPositionDeg - Object's angular position (degrees, 0–360).
 * @param sunAngleDeg - Sun direction angle (degrees, 0–360).
 * @param shadowHalfAngleDeg - Shadow cone half-angle (degrees).
 * @returns True if the position is sunlit (NOT in shadow).
 */
export function isSunlit(
  angularPositionDeg: number,
  sunAngleDeg: number,
  shadowHalfAngleDeg: number,
): boolean {
  // Anti-sun direction.
  const antiSun = (sunAngleDeg + 180) % 360;
  // Angular distance between the object and the anti-sun point.
  let dist = Math.abs(angularPositionDeg - antiSun);
  if (dist > 180) dist = 360 - dist;
  return dist > shadowHalfAngleDeg;
}

/**
 * Compute the sunlit fraction of an orbit at a given altitude.
 *
 * This is the fraction of angular positions that are NOT in shadow.
 * Used for period-based satellite power calculations.
 *
 * @param altitude - Altitude above body surface (metres).
 * @param bodyId - Celestial body identifier.
 * @returns Fraction of the orbit that is sunlit (0–1).
 */
export function getSunlitFraction(altitude: number, bodyId: string): number {
  const halfAngle = getShadowHalfAngle(altitude, bodyId);
  // Sunlit fraction = 1 − (shadow arc / full circle).
  return Math.max(0, Math.min(1, 1 - halfAngle / 180));
}

// ---------------------------------------------------------------------------
// Distance-based solar irradiance (Sun proximity)
// ---------------------------------------------------------------------------

/**
 * Compute the solar irradiance scale factor based on distance from the
 * Sun's centre.  When orbiting the Sun directly, irradiance scales with
 * the inverse square of the distance (closer = exponentially brighter).
 *
 * For bodies other than the Sun, returns the pre-defined per-body constant.
 *
 * @param altitude - Altitude above body surface (metres).
 * @param bodyId - Celestial body identifier.
 * @returns Irradiance scale factor (1.0 = Earth distance).
 */
export function getSolarIrradianceScale(altitude: number, bodyId: string): number {
  if (bodyId === 'SUN') {
    const sunRadius = BODY_RADIUS.SUN;
    const dist = sunRadius + Math.max(0, altitude);
    // Inverse-square from 1 AU.
    const scale = (ONE_AU * ONE_AU) / (dist * dist);
    return Math.min(scale, MAX_SOLAR_IRRADIANCE_MULTIPLIER);
  }
  return SOLAR_IRRADIANCE_SCALE[bodyId] ?? 1.0;
}

// ---------------------------------------------------------------------------
// Power State
// ---------------------------------------------------------------------------

/**
 * Initialise power state from a rocket assembly.
 *
 * Scans all active parts for:
 *   - Solar panels → solarPanelArea
 *   - Batteries (standalone and built-in) → batteryCapacity
 *   - Command/probe modules with builtInBattery → batteryCapacity
 *
 * @param assembly - The rocket assembly.
 * @param activeParts - Instance IDs of parts still attached.
 * @returns Initial power state.
 */
export function initPowerState(assembly: RocketAssembly, activeParts: Set<string>): PowerState {
  let batteryCapacity = 0;
  let solarPanelArea = 0;

  for (const [instanceId, placed] of assembly.parts) {
    if (!activeParts.has(instanceId)) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;

    const props: Record<string, unknown> = def.properties || {};

    // Solar panels contribute area.
    if (props.solarPanelArea) {
      solarPanelArea += props.solarPanelArea as number;
    }

    // Battery capacity: standalone batteries and built-in batteries.
    if (props.batteryCapacity) {
      batteryCapacity += props.batteryCapacity as number;
    }
  }

  return {
    batteryCapacity,
    batteryCharge: batteryCapacity, // start fully charged
    solarGeneration: 0,
    powerDraw: 0,
    sunlit: true,
    hasPower: batteryCapacity > 0 || solarPanelArea > 0,
    solarPanelArea,
  };
}

/**
 * Recompute power state from the current assembly (called when parts
 * are separated / destroyed to update capacity and panel area).
 *
 * Preserves the current charge level, clamping it to the new capacity.
 *
 * @param powerState - The power state to update in-place.
 * @param assembly - The rocket assembly.
 * @param activeParts - Instance IDs of currently active parts.
 */
export function recalcPowerState(
  powerState: PowerState,
  assembly: RocketAssembly,
  activeParts: Set<string>,
): void {
  let batteryCapacity = 0;
  let solarPanelArea = 0;

  for (const [instanceId, placed] of assembly.parts) {
    if (!activeParts.has(instanceId)) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;

    const props: Record<string, unknown> = def.properties || {};
    if (props.solarPanelArea) solarPanelArea += props.solarPanelArea as number;
    if (props.batteryCapacity) batteryCapacity += props.batteryCapacity as number;
  }

  powerState.batteryCapacity = batteryCapacity;
  powerState.batteryCharge = Math.min(powerState.batteryCharge, batteryCapacity);
  powerState.solarPanelArea = solarPanelArea;
  powerState.hasPower = batteryCapacity > 0 || solarPanelArea > 0;
}

// ---------------------------------------------------------------------------
// Power Tick
// ---------------------------------------------------------------------------

interface TickPowerOpts {
  /** Physics timestep (seconds). */
  dt: number;
  /** Current altitude (metres). */
  altitude: number;
  /** Celestial body. */
  bodyId: string;
  /** Cumulative game time. */
  gameTimeSeconds: number;
  /** Angular position for orbital sunlight check. */
  angularPositionDeg?: number;
  /** Whether the craft is in stable orbit. */
  inOrbit?: boolean;
  /** Whether science instruments are actively running. */
  scienceRunning?: boolean;
  /** Number of actively running instruments. */
  activeScienceCount?: number;
  /** Whether comms are active. */
  commsActive?: boolean;
}

/**
 * Advance the power system by one physics timestep.
 *
 * 1. Determine if the craft is sunlit (angular position vs shadow cone).
 * 2. Calculate solar generation from panel area and irradiance.
 * 3. Calculate total power draw from active consumers.
 * 4. Net = generation − draw.  Charge or discharge battery.
 * 5. Set hasPower flag; consumers check this to enable/disable.
 */
export function tickPower(powerState: PowerState, opts: TickPowerOpts): void {
  const {
    dt,
    altitude,
    bodyId,
    gameTimeSeconds,
    angularPositionDeg,
    inOrbit = false,
    scienceRunning = false,
    activeScienceCount = 0,
    commsActive = false,
  } = opts;

  // No power system if there are no panels and no batteries.
  if (powerState.batteryCapacity === 0 && powerState.solarPanelArea === 0) {
    powerState.hasPower = false;
    return;
  }

  // --- Sunlight check ---
  if (bodyId === 'SUN') {
    // Orbiting the Sun: always in direct sunlight (no shadow cone).
    powerState.sunlit = true;
  } else if (angularPositionDeg != null && inOrbit) {
    const sunAngle = getSunAngle(gameTimeSeconds);
    const halfAngle = getShadowHalfAngle(altitude, bodyId);
    powerState.sunlit = isSunlit(angularPositionDeg, sunAngle, halfAngle);
  } else if (!inOrbit && altitude > 0) {
    // During ascent/descent: sunlit above ground (simplified — no shadow check).
    powerState.sunlit = true;
  } else {
    // On the ground: assume sunlit (launch pad is in daylight).
    powerState.sunlit = true;
  }

  // --- Solar generation ---
  // Use distance-based irradiance when orbiting the Sun (extreme power near Sun).
  const irradianceScale = getSolarIrradianceScale(altitude, bodyId);
  const irradiance = irradianceScale * SOLAR_IRRADIANCE_1AU; // W/m² at this distance
  const rawGeneration = powerState.solarPanelArea * irradiance * SOLAR_PANEL_EFFICIENCY;
  powerState.solarGeneration = powerState.sunlit ? rawGeneration : 0;

  // --- Power draw ---
  let draw = 0;
  // Rotation / attitude control (always active in orbit).
  if (inOrbit) {
    draw += POWER_DRAW_ROTATION;
  }
  // Science instruments.
  if (scienceRunning && activeScienceCount > 0) {
    draw += POWER_DRAW_SCIENCE * activeScienceCount;
  }
  // Communications.
  if (commsActive) {
    draw += POWER_DRAW_COMMS;
  }
  powerState.powerDraw = draw;

  // --- Net power and battery update ---
  const netPower = powerState.solarGeneration - draw; // watts
  // Convert watts to watt-hours for the timestep: Wh = W × (dt / 3600).
  const energyDelta = netPower * (dt / 3600);

  powerState.batteryCharge = Math.max(
    0,
    Math.min(powerState.batteryCapacity, powerState.batteryCharge + energyDelta),
  );

  // --- Power availability ---
  powerState.hasPower =
    powerState.batteryCharge > POWER_CRITICAL_THRESHOLD || powerState.solarGeneration > draw;
}

// ---------------------------------------------------------------------------
// Satellite Power Helpers
// ---------------------------------------------------------------------------

export interface SatellitePowerInfo {
  avgGeneration: number;
  sunlitFraction: number;
}

/**
 * Compute average solar generation for a satellite at a given orbit.
 *
 * Uses the sunlit fraction and irradiance at the body's distance from the sun.
 * Pre-made satellites with builtInPower are assumed to have adequate generation.
 *
 * @param altitude - Orbit altitude (metres above surface).
 * @param bodyId - Celestial body identifier.
 * @param panelArea - Solar panel area (m²). For builtInPower, use a default.
 * @returns Average generation (W) and sunlit fraction.
 */
export function getSatellitePowerInfo(
  altitude: number,
  bodyId: string,
  panelArea: number = 2.0,
): SatellitePowerInfo {
  const fraction = bodyId === 'SUN' ? 1.0 : getSunlitFraction(altitude, bodyId);
  const irradianceScale = getSolarIrradianceScale(altitude, bodyId);
  const rawPower = panelArea * irradianceScale * SOLAR_IRRADIANCE_1AU * SOLAR_PANEL_EFFICIENCY;
  return {
    avgGeneration: rawPower * fraction,
    sunlitFraction: fraction,
  };
}

/**
 * Check if a satellite has sufficient average power for its consumers.
 *
 * Satellites with builtInPower always have sufficient power (their panels
 * and batteries are sized for normal operation).  Custom satellites may
 * not have enough panels.
 *
 * @param partId - Part definition ID.
 * @param altitude - Orbit altitude (metres).
 * @param bodyId - Celestial body.
 * @returns True if average power meets draw requirements.
 */
export function hasSufficientSatellitePower(
  partId: string,
  altitude: number,
  bodyId: string,
): boolean {
  const def = getPartById(partId);
  if (!def) return false;
  if (def.properties?.builtInPower) return true;

  // Custom satellite: check panel area vs draw.
  const panelArea = (def.properties?.solarPanelArea as number | undefined) ?? 0;
  if (panelArea === 0) return false;

  const { avgGeneration } = getSatellitePowerInfo(altitude, bodyId, panelArea);
  // Assume a satellite draws POWER_DRAW_COMMS + POWER_DRAW_ROTATION.
  const draw = POWER_DRAW_COMMS + POWER_DRAW_ROTATION;
  return avgGeneration >= draw * 0.8; // 80% margin for eclipse battery drain
}
