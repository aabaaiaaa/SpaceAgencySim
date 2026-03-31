/**
 * power.js — Power generation, storage, and consumption system.
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
} from './constants.js';
import { getPartById } from '../data/parts.js';

// ---------------------------------------------------------------------------
// Shadow / Sunlight
// ---------------------------------------------------------------------------

/**
 * Compute the sun direction angle (degrees, 0–360) at a given game time.
 *
 * The sun direction rotates slowly to model the apparent shadow-cone motion.
 * This is a simplified 2D model — the angle increases linearly with time.
 *
 * @param {number} gameTimeSeconds  Cumulative game time (e.g. flightTimeSeconds).
 * @returns {number}  Sun angle in degrees [0, 360).
 */
export function getSunAngle(gameTimeSeconds) {
  return ((gameTimeSeconds * SUN_ROTATION_RATE) % 360 + 360) % 360;
}

/**
 * Compute the half-angle of the shadow cone cast by a body at a given
 * orbital altitude.
 *
 * Uses the geometric relation: shadowHalfAngle = arcsin(R_body / r_orbit).
 * Higher orbits have narrower shadow cones (less time in eclipse).
 *
 * @param {number} altitude  Altitude above the body surface (metres).
 * @param {string} bodyId    Celestial body identifier.
 * @returns {number}  Shadow half-angle in degrees.
 */
export function getShadowHalfAngle(altitude, bodyId) {
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
 * @param {number} angularPositionDeg  Object's angular position (degrees, 0–360).
 * @param {number} sunAngleDeg         Sun direction angle (degrees, 0–360).
 * @param {number} shadowHalfAngleDeg  Shadow cone half-angle (degrees).
 * @returns {boolean}  True if the position is sunlit (NOT in shadow).
 */
export function isSunlit(angularPositionDeg, sunAngleDeg, shadowHalfAngleDeg) {
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
 * @param {number} altitude  Altitude above body surface (metres).
 * @param {string} bodyId    Celestial body identifier.
 * @returns {number}  Fraction of the orbit that is sunlit (0–1).
 */
export function getSunlitFraction(altitude, bodyId) {
  const halfAngle = getShadowHalfAngle(altitude, bodyId);
  // Sunlit fraction = 1 − (shadow arc / full circle).
  return Math.max(0, Math.min(1, 1 - halfAngle / 180));
}

// ---------------------------------------------------------------------------
// Power State
// ---------------------------------------------------------------------------

/**
 * Power state tracked per physics tick on an active flight.
 *
 * @typedef {Object} PowerState
 * @property {number} batteryCapacity   Total battery capacity (Wh).
 * @property {number} batteryCharge     Current charge (Wh), 0 ≤ charge ≤ capacity.
 * @property {number} solarGeneration   Current solar power generation (W).
 * @property {number} powerDraw         Current total power draw (W).
 * @property {boolean} sunlit           Whether the craft is currently in sunlight.
 * @property {boolean} hasPower         Whether there is enough power for systems.
 * @property {number} solarPanelArea    Total solar panel area (m²).
 */

/**
 * Initialise power state from a rocket assembly.
 *
 * Scans all active parts for:
 *   - Solar panels → solarPanelArea
 *   - Batteries (standalone and built-in) → batteryCapacity
 *   - Command/probe modules with builtInBattery → batteryCapacity
 *
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {Set<string>} activeParts  Instance IDs of parts still attached.
 * @returns {PowerState}
 */
export function initPowerState(assembly, activeParts) {
  let batteryCapacity = 0;
  let solarPanelArea = 0;

  for (const [instanceId, placed] of assembly.parts) {
    if (!activeParts.has(instanceId)) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;

    const props = def.properties || {};

    // Solar panels contribute area.
    if (props.solarPanelArea) {
      solarPanelArea += props.solarPanelArea;
    }

    // Battery capacity: standalone batteries and built-in batteries.
    if (props.batteryCapacity) {
      batteryCapacity += props.batteryCapacity;
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
 * @param {PowerState}     powerState
 * @param {import('./rocketbuilder.js').RocketAssembly} assembly
 * @param {Set<string>}    activeParts
 */
export function recalcPowerState(powerState, assembly, activeParts) {
  let batteryCapacity = 0;
  let solarPanelArea = 0;

  for (const [instanceId, placed] of assembly.parts) {
    if (!activeParts.has(instanceId)) continue;
    const def = getPartById(placed.partId);
    if (!def) continue;

    const props = def.properties || {};
    if (props.solarPanelArea) solarPanelArea += props.solarPanelArea;
    if (props.batteryCapacity) batteryCapacity += props.batteryCapacity;
  }

  powerState.batteryCapacity = batteryCapacity;
  powerState.batteryCharge = Math.min(powerState.batteryCharge, batteryCapacity);
  powerState.solarPanelArea = solarPanelArea;
  powerState.hasPower = batteryCapacity > 0 || solarPanelArea > 0;
}

// ---------------------------------------------------------------------------
// Power Tick
// ---------------------------------------------------------------------------

/**
 * Advance the power system by one physics timestep.
 *
 * 1. Determine if the craft is sunlit (angular position vs shadow cone).
 * 2. Calculate solar generation from panel area and irradiance.
 * 3. Calculate total power draw from active consumers.
 * 4. Net = generation − draw.  Charge or discharge battery.
 * 5. Set hasPower flag; consumers check this to enable/disable.
 *
 * @param {PowerState}   powerState
 * @param {object}       opts
 * @param {number}       opts.dt                Physics timestep (seconds).
 * @param {number}       opts.altitude           Current altitude (metres).
 * @param {string}       opts.bodyId             Celestial body.
 * @param {number}       opts.gameTimeSeconds    Cumulative game time.
 * @param {number}       [opts.angularPositionDeg]  Angular position for orbital sunlight check.
 * @param {boolean}      [opts.inOrbit]          Whether the craft is in stable orbit.
 * @param {boolean}      [opts.scienceRunning]   Whether science instruments are actively running.
 * @param {number}       [opts.activeScienceCount]  Number of actively running instruments.
 * @param {boolean}      [opts.commsActive]      Whether comms are active.
 */
export function tickPower(powerState, opts) {
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
  if (angularPositionDeg != null && inOrbit) {
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
  const irradianceScale = SOLAR_IRRADIANCE_SCALE[bodyId] ?? 1.0;
  const irradiance = irradianceScale * 1361; // W/m² at this body
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
  powerState.hasPower = powerState.batteryCharge > POWER_CRITICAL_THRESHOLD ||
                        powerState.solarGeneration > draw;
}

// ---------------------------------------------------------------------------
// Satellite Power Helpers
// ---------------------------------------------------------------------------

/**
 * Compute average solar generation for a satellite at a given orbit.
 *
 * Uses the sunlit fraction and irradiance at the body's distance from the sun.
 * Pre-made satellites with builtInPower are assumed to have adequate generation.
 *
 * @param {number} altitude   Orbit altitude (metres above surface).
 * @param {string} bodyId     Celestial body identifier.
 * @param {number} panelArea  Solar panel area (m²).  For builtInPower, use a default.
 * @returns {{ avgGeneration: number, sunlitFraction: number }}
 */
export function getSatellitePowerInfo(altitude, bodyId, panelArea = 2.0) {
  const fraction = getSunlitFraction(altitude, bodyId);
  const irradianceScale = SOLAR_IRRADIANCE_SCALE[bodyId] ?? 1.0;
  const rawPower = panelArea * irradianceScale * 1361 * SOLAR_PANEL_EFFICIENCY;
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
 * @param {string}  partId    Part definition ID.
 * @param {number}  altitude  Orbit altitude (metres).
 * @param {string}  bodyId    Celestial body.
 * @returns {boolean}
 */
export function hasSufficientSatellitePower(partId, altitude, bodyId) {
  const def = getPartById(partId);
  if (!def) return false;
  if (def.properties?.builtInPower) return true;

  // Custom satellite: check panel area vs draw.
  const panelArea = def.properties?.solarPanelArea ?? 0;
  if (panelArea === 0) return false;

  const { avgGeneration } = getSatellitePowerInfo(altitude, bodyId, panelArea);
  // Assume a satellite draws POWER_DRAW_COMMS + POWER_DRAW_ROTATION.
  const draw = POWER_DRAW_COMMS + POWER_DRAW_ROTATION;
  return avgGeneration >= draw * 0.8; // 80% margin for eclipse battery drain
}
